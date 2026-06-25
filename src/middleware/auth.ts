import type { Request } from "express";
import { PUBLIC_WRITE_KEYS } from "../config/storeKeys.js";
import { verifyAdminToken } from "../services/auth.service.js";
import { HttpError } from "../utils/httpError.js";

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
