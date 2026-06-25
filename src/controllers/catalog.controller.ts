import type { Request, Response } from "express";
import { getRepository } from "../repositories/index.js";
import { getPublicCatalog } from "../services/catalog.service.js";

export const catalogController = {
  async getPublicCatalog(_req: Request, res: Response) {
    const repo = await getRepository();
    const catalog = await getPublicCatalog(repo);
    res.json({ ok: true, ...catalog });
  },
};
