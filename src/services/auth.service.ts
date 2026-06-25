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

export function verifyAdminToken(token: string): boolean {
  if (!token || !token.includes(".")) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      exp?: unknown;
    };
    return data.sub === "admin" && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
