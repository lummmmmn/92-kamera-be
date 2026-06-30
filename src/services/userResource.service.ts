import { STORE_KEYS } from "../config/storeKeys.js";
import type { User } from "../types/domain.js";
import type { Repository } from "../types/repository.js";
import { parseStoredJson } from "../utils/http.js";
import { HttpError } from "../utils/httpError.js";

export type UserRecord = User;
export type UsersMap = Record<string, UserRecord>;

function isRecord(value: unknown): value is UserRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function userKeyFromRecord(user: UserRecord): string {
  for (const field of ["email", "phone", "googleId", "id"]) {
    const value = user[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function looksLikeUsersMap(value: UserRecord): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  if (["email", "phone", "googleId", "id", "name", "displayName"].some((key) => key in value)) {
    return false;
  }
  return keys.every((key) => isRecord(value[key]));
}

function enrichUserFromKey(key: string, user: UserRecord): UserRecord {
  const next = { ...user };
  if (key.includes("@") && typeof next.email !== "string") next.email = key;
  if (!key.includes("@") && typeof next.phone !== "string") next.phone = key;
  return next;
}

export function normalizeUsersMap(value: unknown): UsersMap {
  if (Array.isArray(value)) {
    const users: UsersMap = {};
    for (const item of value) {
      if (!isRecord(item)) continue;
      const key = userKeyFromRecord(item);
      if (key) users[key] = item;
    }
    return users;
  }

  if (!isRecord(value)) return {};

  const users: UsersMap = {};
  for (const [key, user] of Object.entries(value)) {
    if (isRecord(user)) users[key] = enrichUserFromKey(key, user);
  }
  return users;
}

export async function getUsersMap(repo: Repository): Promise<UsersMap> {
  const row = await repo.getKv(STORE_KEYS.users);
  return normalizeUsersMap(parseStoredJson(row.value));
}

export async function findUserByGoogleId(repo: Repository, googleId: string): Promise<UserRecord> {
  const users = await getUsersMap(repo);
  const found = Object.values(users).find((user) => String(user.googleId || user.id || "") === googleId);
  if (!found) throw new HttpError(404, "googleId was not found");
  return found;
}

export async function upsertUsers(
  repo: Repository,
  value: unknown,
): Promise<{ users: UsersMap; user?: UserRecord; key?: string }> {
  if (!isRecord(value)) throw new HttpError(400, "user must be an object");

  const users = await getUsersMap(repo);
  const now = new Date().toISOString();

  if (looksLikeUsersMap(value)) {
    for (const [key, rawUser] of Object.entries(value)) {
      if (!isRecord(rawUser)) continue;
      const current = (users[key] || {}) as UserRecord;
      users[key] = {
        ...current,
        ...enrichUserFromKey(key, rawUser),
        createdAt: current.createdAt || rawUser.createdAt || now,
        updatedAt: now,
      };
    }
    await repo.setKv(STORE_KEYS.users, JSON.stringify(users));
    return { users };
  }

  const key = userKeyFromRecord(value);
  if (!key) throw new HttpError(400, "email, phone, or googleId is required");

  const current = (users[key] || {}) as UserRecord;
  const user = {
    ...current,
    ...enrichUserFromKey(key, value),
    createdAt: current.createdAt || value.createdAt || now,
    updatedAt: now,
  };
  users[key] = user;

  await repo.setKv(STORE_KEYS.users, JSON.stringify(users));
  return { users, user, key };
}
