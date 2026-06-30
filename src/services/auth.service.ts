import crypto from "node:crypto";
import { ADMIN_PASSWORD_KEY, DEFAULT_ADMIN_PASSWORD_HASH } from "../config/storeKeys.js";
import { env } from "../config/env.js";
import type { Repository } from "../types/repository.js";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.adminSessionSecret).update(payload).digest("base64url");
}

function parseStoredHash(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw;
  }
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function getAdminPasswordHash(repo: Repository): Promise<string> {
  const fromDb = await repo.getKv(ADMIN_PASSWORD_KEY).catch(() => null);
  return parseStoredHash(fromDb?.value ?? null) || process.env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH;
}

export function createAdminToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      sub: "admin",
      iat: now,
      exp: now + env.adminSessionTtlSeconds,
    }),
  );

  return `${payload}.${sign(payload)}`;
}

export function createCustomerToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      sub: userId,
      role: "customer",
      iat: now,
      exp: now + env.adminSessionTtlSeconds,
    }),
  );

  return `${payload}.${sign(payload)}`;
}

export interface TokenPayload {
  sub: string;
  role?: string;
  iat: number;
  exp: number;
}

export function verifyToken(token: string): TokenPayload | null {
  if (!token || !token.includes(".")) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (Number(data.exp) <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function verifyAdminToken(token: string): boolean {
  const payload = verifyToken(token);
  return payload !== null && payload.sub === "admin";
}
