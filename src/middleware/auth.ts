import type { Request, Response, NextFunction } from "express";
import { PUBLIC_WRITE_KEYS } from "../config/storeKeys.js";
import { verifyAdminToken, verifyToken, type TokenPayload } from "../services/auth.service.js";
import { HttpError } from "../utils/httpError.js";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function getBearerToken(req: Request): string {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function isAdminRequest(req: Request): boolean {
  return verifyAdminToken(getBearerToken(req));
}

export function requireAdmin(req: Request): void {
  if (!isAdminRequest(req)) {
    throw new HttpError(401, "Admin token is required");
  }
}

export function requireWriteAccess(req: Request, key: string): void {
  if (PUBLIC_WRITE_KEYS.has(key)) return;
  requireAdmin(req);
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}
