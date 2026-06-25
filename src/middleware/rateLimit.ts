import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientKey(req: Parameters<RequestHandler>[0]): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function loginRateLimit(): RequestHandler {
  return (req, _res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + env.loginWindowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > env.loginMaxAttempts) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      next(new HttpError(429, "Too many login attempts", { retryAfterSeconds }));
      return;
    }

    next();
  };
}
