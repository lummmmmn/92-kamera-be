import crypto from "node:crypto";
import path from "node:path";

// Nếu không có secret nào được cấu hình qua env, KHÔNG được fallback về hằng số
// hardcode trong source (DEFAULT_ADMIN_PASSWORD_HASH nằm public trên GitHub) —
// vì đó là secret dùng để ký token admin, lộ ra thì ai cũng forge được token.
// Thay vào đó sinh 1 secret ngẫu nhiên mỗi lần start process: an toàn hơn nhiều,
// cái giá phải trả là các phiên đăng nhập admin cũ sẽ bị logout khi server restart
// (chấp nhận được, tốt hơn nhiều so với secret bị lộ).
function resolveAdminSessionSecret(): string {
  const fromEnv = process.env.ADMIN_SESSION_SECRET || process.env.K92_API_SECRET;
  if (fromEnv) return fromEnv;

  console.warn(
    "[92K][SECURITY] ADMIN_SESSION_SECRET chưa được set — đang dùng secret " +
      "ngẫu nhiên sinh ra lúc khởi động (mọi token admin sẽ invalid sau khi " +
      "server restart). Hãy set ADMIN_SESSION_SECRET trong biến môi trường ở production.",
  );
  return crypto.randomBytes(32).toString("hex");
}

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
  adminSessionSecret: resolveAdminSessionSecret(),
  adminSessionTtlSeconds: intFromEnv("ADMIN_SESSION_TTL_SECONDS", 60 * 60 * 12),
  loginWindowMs: intFromEnv("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  loginMaxAttempts: intFromEnv("LOGIN_RATE_LIMIT_MAX", 30),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
};
