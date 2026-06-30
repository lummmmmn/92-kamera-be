import type { Request, Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getRepository } from "../repositories/index.js";
import { parseLimit, requireString } from "../utils/http.js";

export const galleryController = {
  async list(req: Request, res: Response) {
    const limit = parseLimit(req.query.limit, 200, 500);
    const repo = await getRepository();
    const photos = await repo.listPhotos(limit);

    res.json({ ok: true, photos });
  },

  async upsert(req: Request, res: Response) {
    requireAdmin(req);

    const body = (req.body || {}) as Record<string, unknown>;
    const photo = ((body.photo || body) ?? {}) as Record<string, unknown>;
    const publicId = requireString(photo.public_id, "public_id");
    const url = requireString(photo.url, "url");

    const repo = await getRepository();
    const saved = await repo.upsertPhoto({
      public_id: publicId,
      url,
      uploadedAt: typeof photo.uploadedAt === "string" ? photo.uploadedAt : undefined,
      uploaded_at: typeof photo.uploaded_at === "string" ? photo.uploaded_at : undefined,
      uploaded_by: typeof photo.uploaded_by === "string" ? photo.uploaded_by : "admin",
    });

    res.json({ ok: true, photo: saved });
  },

  async remove(req: Request, res: Response) {
    requireAdmin(req);

    const body = (req.body || {}) as Record<string, unknown>;
    const publicId = requireString(body.public_id || req.query.public_id, "public_id");

    const repo = await getRepository();
    const result = await repo.deletePhoto(publicId);

    res.json({ ...result, ok: true });
  },
};
