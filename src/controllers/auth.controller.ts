import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { getRepository } from "../repositories/index.js";
import { createAdminToken, createCustomerToken, getAdminPasswordHash, sha256Hex } from "../services/auth.service.js";
import type { KvRecord } from "../services/kvResource.service.js";
import { upsertUsers } from "../services/userResource.service.js";
import { HttpError } from "../utils/httpError.js";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

async function verifyGoogleCredential(credential: string): Promise<KvRecord> {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", credential);

  const response = await fetch(url);
  if (!response.ok) throw new HttpError(401, "Invalid Google credential");

  const parsed = (await response.json()) as unknown;
  const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as KvRecord) : {};
  if (!payload.sub) throw new HttpError(401, "Invalid Google credential");
  if (env.googleClientId && payload.aud !== env.googleClientId) {
    throw new HttpError(401, "Google credential audience is invalid");
  }

  return payload;
}

export const authController = {
  async login(req: Request, res: Response) {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) throw new HttpError(400, "password is required");

    const repo = await getRepository();
    const expectedHash = await getAdminPasswordHash(repo);

    if (sha256Hex(password) !== expectedHash) {
      throw new HttpError(401, "Invalid admin password");
    }

    res.json({
      ok: true,
      token: createAdminToken(),
    });
  },

  async google(req: Request, res: Response) {
    const body = ((req.body || {}) as KvRecord) ?? {};
    const credential = typeof body.credential === "string" ? body.credential : "";
    if (!credential) throw new HttpError(400, "credential is required");
    const tokenPayload = await verifyGoogleCredential(credential);

    const googleId = pickString(tokenPayload.sub);
    if (!googleId) throw new HttpError(400, "googleId is required");

    const email = pickString(tokenPayload.email);
    const name = pickString(tokenPayload.name, pickString(body.name));
    const avatar = pickString(tokenPayload.picture, pickString(body.avatar, body.picture));
    const now = new Date().toISOString();

    const repo = await getRepository();
    const payload = {
      googleId,
      email,
      name,
      avatar,
      provider: "google",
      updatedAt: now,
      createdAt: pickString(body.createdAt) || now,
    };
    const result = await upsertUsers(repo, payload);

    res.json({
      ok: true,
      user: result.user || payload,
      token: createCustomerToken(googleId),
    });
  },

  async logout(_req: Request, res: Response) {
    res.json({ ok: true });
  },
};
