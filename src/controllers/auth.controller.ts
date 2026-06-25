import type { Request, Response } from "express";
import { getRepository } from "../repositories/index.js";
import { createAdminToken, getAdminPasswordHash, sha256Hex } from "../services/auth.service.js";
import { HttpError } from "../utils/httpError.js";

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
};
