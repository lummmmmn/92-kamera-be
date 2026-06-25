import type { Repository } from "../types/repository.js";
import { parseStoredJson } from "../utils/http.js";

export type StoredValue<T> = {
  exists: boolean;
  value: T | null;
  updatedAt: string | null;
};

export async function getJsonValue<T>(repo: Repository, key: string): Promise<T | null> {
  const row = await repo.getKv(key);
  if (!row.exists) return null;
  return parseStoredJson(row.value) as T;
}

export async function getJsonValueWithMeta<T>(repo: Repository, key: string): Promise<StoredValue<T>> {
  const row = await repo.getKv(key);
  return {
    exists: row.exists,
    value: row.exists ? (parseStoredJson(row.value) as T) : null,
    updatedAt: row.updatedAt,
  };
}

export async function setJsonValue(repo: Repository, key: string, value: unknown) {
  return repo.setKv(key, JSON.stringify(value));
}

export async function casJsonValue(
  repo: Repository,
  key: string,
  value: unknown,
  expectedUpdatedAt?: string | null,
) {
  return repo.casKv(key, JSON.stringify(value), expectedUpdatedAt || null);
}

export function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
