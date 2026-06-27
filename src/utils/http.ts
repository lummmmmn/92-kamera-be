import { HttpError } from "./httpError.js";

export function requireString(value: unknown, name: string): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpError(400, `${name} is required`);
  }
  return raw.trim();
}

export function requireBodyValue(body: Record<string, unknown>, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(body, name)) {
    throw new HttpError(400, `${name} is required`);
  }
  return body[name];
}

export function parseLimit(value: unknown, fallback = 200, max = 500): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function parseOffset(value: unknown, fallback = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function parseStoredJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
