import type { Request, Response } from "express";
import { requireWriteAccess } from "../middleware/auth.js";
import { getRepository } from "../repositories/index.js";
import { parseStoredJson, requireBodyValue, requireString } from "../utils/http.js";

export const storageController = {
  async get(req: Request, res: Response) {
    const key = requireString(req.query.key, "key");
    const repo = await getRepository();
    const row = await repo.getKv(key);

    res.json({
      ok: true,
      key,
      exists: row.exists,
      value: parseStoredJson(row.value),
      updatedAt: row.updatedAt,
    });
  },

  async getMeta(req: Request, res: Response) {
    const key = requireString(req.query.key, "key");
    const repo = await getRepository();
    const row = await repo.getKv(key);

    res.json({
      ok: true,
      key,
      exists: row.exists,
      value: parseStoredJson(row.value),
      updatedAt: row.updatedAt,
    });
  },

  async set(req: Request, res: Response) {
    const body = (req.body || {}) as Record<string, unknown>;
    const key = requireString(body.key, "key");
    const value = requireBodyValue(body, "value");

    requireWriteAccess(req, key);

    const repo = await getRepository();
    const result = await repo.setKv(key, JSON.stringify(value));

    res.json({
      ok: true,
      key,
      updatedAt: result.updatedAt,
    });
  },

  async cas(req: Request, res: Response) {
    const body = (req.body || {}) as Record<string, unknown>;
    const key = requireString(body.key, "key");
    const value = requireBodyValue(body, "value");
    const expectedUpdatedAt =
      typeof body.expectedUpdatedAt === "string" && body.expectedUpdatedAt ? body.expectedUpdatedAt : null;

    requireWriteAccess(req, key);

    const repo = await getRepository();
    const result = await repo.casKv(key, JSON.stringify(value), expectedUpdatedAt);

    res.json({
      ok: true,
      success: result.ok,
      updatedAt: result.updatedAt,
    });
  },
};
