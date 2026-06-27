import path from "node:path";
import { DEFAULT_ADMIN_PASSWORD_HASH } from "./storeKeys.js";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: intFromEnv("PORT", 3000),
  dbDriver: (process.env.DB_DRIVER || "json").toLowerCase(),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "15mb",
  jsonDbFile: resolvePath(process.env.JSON_DB_FILE || ".data/k92-db.json"),
  seedFile: resolvePath(process.env.SEED_FILE || "data/seed.json"),
  adminSessionSecret:
    process.env.ADMIN_SESSION_SECRET ||
    process.env.K92_API_SECRET ||
    process.env.ADMIN_PASSWORD_HASH ||
    DEFAULT_ADMIN_PASSWORD_HASH,
  adminSessionTtlSeconds: intFromEnv("ADMIN_SESSION_TTL_SECONDS", 60 * 60 * 12),
  loginWindowMs: intFromEnv("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  loginMaxAttempts: intFromEnv("LOGIN_RATE_LIMIT_MAX", 30),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
};
