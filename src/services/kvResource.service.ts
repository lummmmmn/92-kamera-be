import type { Repository } from "../types/repository.js";
import { parseStoredJson } from "../utils/http.js";
import { HttpError } from "../utils/httpError.js";

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

  const items = await getResourceArray(repo, config.key);
  items.unshift(item);
  await setResourceArray(repo, config.key, items);
  return item;
}

export async function upsertResource(repo: Repository, config: ResourceConfig, value: unknown): Promise<KvRecord> {
  const body = asObject(value);
  const idField = getIdField(config);
  if (body[idField] == null || body[idField] === "") {
    body[idField] = nextId(config.generateIdPrefix);
  }

  const items = await getResourceArray(repo, config.key);
  const index = items.findIndex((item) => sameId(item[idField], body[idField]));
  const current = index >= 0 ? items[index] : undefined;
  const next = current ? { ...current, ...body } : body;

  if (index >= 0) {
    items[index] = next;
  } else {
    items.unshift(next);
  }

  await setResourceArray(repo, config.key, items);
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
  const items = await getResourceArray(repo, config.key);
  const index = items.findIndex((item) => sameId(item[idField], id));
  if (index < 0) throw new HttpError(404, `${idField} was not found`);

  const current = items[index];
  if (!current) throw new HttpError(404, `${idField} was not found`);

  const next = { ...current, ...body, [idField]: current[idField] };
  items[index] = next;
  await setResourceArray(repo, config.key, items);
  return next;
}

export async function deleteResource(repo: Repository, config: ResourceConfig, id: string): Promise<KvRecord> {
  const idField = getIdField(config);
  const items = await getResourceArray(repo, config.key);
  const index = items.findIndex((item) => sameId(item[idField], id));
  if (index < 0) throw new HttpError(404, `${idField} was not found`);

  const [removed] = items.splice(index, 1);
  await setResourceArray(repo, config.key, items);
  return removed || {};
}
