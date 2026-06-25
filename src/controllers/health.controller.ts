import type { Request, Response } from "express";
import { getRepository } from "../repositories/index.js";

export const healthController = {
  async getHealth(_req: Request, res: Response) {
    const repo = await getRepository();
    const health = await repo.health();

    res.json({
      ...health,
      ok: true,
      api: "92kamera",
    });
  },
};
