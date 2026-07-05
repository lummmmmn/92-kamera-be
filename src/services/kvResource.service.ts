import type { Repository } from "../types/repository.js";
import { parseStoredJson } from "../utils/http.js";
import { HttpError } from "../utils/httpError.js";

const MAX_CAS_ATTEMPTS = 5;

// Đọc-sửa-ghi có compare-and-swap: tránh mất dữ liệu khi 2 admin cùng sửa
// cameras/accessories/discounts/... đồng thời (trước đây createResource/
// updateResource/deleteResource chỉ getResourceArray() rồi setResourceArray()
// thẳng, không check version, request nào ghi xong sau sẽ đè mất thay đổi của
// request ghi trước).
async function casUpdateArray(
  repo: Repository,
  key: string,
  mutate: (items: KvRecord[]) => KvRecord[],
): Promise<KvRecord[]> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const row = await repo.getKv(key);
    const items = asArray(parseStoredJson(row.value));
    const next = mutate(items);
    const result = await repo.casKv(key, JSON.stringify(next), row.updatedAt);
    if (result.ok) return next;
  }
  throw new HttpError(409, "Data changed while saving. Please try again.");
}

export type KvRecord = Record<string, unknown>;

export type ResourceConfig = {
  key: string;
  idField?: string;
  generateIdPrefix?: string;
};

function asArray(value: unknown): KvRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is KvRecord => !!item && typeof item === "object" && !Array.isArray(item));
}

function asObject(value: unknown, name = "body"): KvRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${name} must be an object`);
  }
  return value as KvRecord;
}

function getIdField(config: ResourceConfig): string {
  return config.idField || "id";
}

function sameId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

function nextId(prefix?: string): string | number {
  const id = Date.now();
  return prefix ? `${prefix}_${id}` : id;
}

export async function getResourceArray(repo: Repository, key: string): Promise<KvRecord[]> {
  const row = await repo.getKv(key);
  return asArray(parseStoredJson(row.value));
}

export async function setResourceArray(repo: Repository, key: string, items: KvRecord[]) {
  return repo.setKv(key, JSON.stringify(items));
}

export async function getResourceObject(repo: Repository, key: string): Promise<KvRecord> {
  const row = await repo.getKv(key);
  const parsed = parseStoredJson(row.value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as KvRecord) : {};
}

export async function setResourceObject(repo: Repository, key: string, value: unknown) {
  return repo.setKv(key, JSON.stringify(asObject(value)));
}

export async function createResource(repo: Repository, config: ResourceConfig, value: unknown): Promise<KvRecord> {
  const body = asObject(value);
  const idField = getIdField(config);
  const item = { ...body };
  item[idField] ??= nextId(config.generateIdPrefix);

  await casUpdateArray(repo, config.key, (items) => [item, ...items]);
  return item;
}

export async function upsertResource(repo: Repository, config: ResourceConfig, value: unknown): Promise<KvRecord> {
  const body = asObject(value);
  const idField = getIdField(config);
  if (body[idField] == null || body[idField] === "") {
    body[idField] = nextId(config.generateIdPrefix);
  }

  let next: KvRecord = body;
  await casUpdateArray(repo, config.key, (items) => {
    const index = items.findIndex((item) => sameId(item[idField], body[idField]));
    const current = index >= 0 ? items[index] : undefined;
    next = current ? { ...current, ...body } : body;

    const copy = [...items];
    if (index >= 0) {
      copy[index] = next;
    } else {
      copy.unshift(next);
    }
    return copy;
  });

  return next;
}

export async function getResourceById(repo: Repository, config: ResourceConfig, id: string): Promise<KvRecord> {
  const idField = getIdField(config);
  const items = await getResourceArray(repo, config.key);
  const item = items.find((entry) => sameId(entry[idField], id));
  if (!item) throw new HttpError(404, `${idField} was not found`);
  return item;
}

export async function updateResource(
  repo: Repository,
  config: ResourceConfig,
  id: string,
  value: unknown,
): Promise<KvRecord> {
  const body = asObject(value);
  const idField = getIdField(config);

  let next: KvRecord | null = null;
  await casUpdateArray(repo, config.key, (items) => {
    const index = items.findIndex((item) => sameId(item[idField], id));
    if (index < 0) throw new HttpError(404, `${idField} was not found`);

    const current = items[index];
    if (!current) throw new HttpError(404, `${idField} was not found`);

    next = { ...current, ...body, [idField]: current[idField] };
    const copy = [...items];
    copy[index] = next;
    return copy;
  });

  if (!next) throw new HttpError(404, `${idField} was not found`);
  return next;
}

export async function deleteResource(repo: Repository, config: ResourceConfig, id: string): Promise<KvRecord> {
  const idField = getIdField(config);

  let removed: KvRecord = {};
  await casUpdateArray(repo, config.key, (items) => {
    const index = items.findIndex((item) => sameId(item[idField], id));
    if (index < 0) throw new HttpError(404, `${idField} was not found`);

    const copy = [...items];
    const [deletedItem] = copy.splice(index, 1);
    removed = deletedItem || {};
    return copy;
  });

  return removed;
}
