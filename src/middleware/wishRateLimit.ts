import type { RequestHandler } from "express";
import { HttpError } from "../utils/httpError.js";

// Chống spam hòm thư điều ước. Chỉ giữ bộ đếm trong RAM theo IP và KHÔNG ghi IP
// vào dữ liệu điều ước — khách vẫn hoàn toàn ẩn danh. Đây là lớp chặn spam cơ bản,
// không phải ranh giới bảo mật.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_GLOBAL = 100;

type Bucket = { count: number; resetAt: number };
const perIp = new Map<string, Bucket>();
const globalBucket: Bucket = { count: 0, resetAt: 0 };

function clientKey(req: Parameters<RequestHandler>[0]): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.ip || req.socket.remoteAddress || "unknown";
}

function hit(bucket: Bucket, now: number): number {
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  return bucket.count;
}

export function wishRateLimit(): RequestHandler {
  return (req, _res, next) => {
    const now = Date.now();

    if (perIp.size > 5000) {
      for (const [key, bucket] of perIp) if (bucket.resetAt <= now) perIp.delete(key);
    }

    const key = clientKey(req);
    let bucket = perIp.get(key);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      perIp.set(key, bucket);
    }

    const ipCount = hit(bucket, now);
    const globalCount = hit(globalBucket, now);

    if (ipCount > MAX_PER_IP || globalCount > MAX_GLOBAL) {
      const resetAt = ipCount > MAX_PER_IP ? bucket.resetAt : globalBucket.resetAt;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
      next(new HttpError(429, "Gửi nhiều quá rồi, đợi một lát rồi thử lại nha", { retryAfterSeconds }));
      return;
    }
    next();
  };
}
