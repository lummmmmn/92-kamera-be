import type { Request, Response } from "express";
import { getRepository } from "../repositories/index.js";
import { estimatePricing } from "../services/pricing.service.js";
import type { BookingRequest } from "../types/domain.js";

export const pricingController = {
  async estimate(req: Request, res: Response) {
    const repo = await getRepository();
    const pricing = await estimatePricing(repo, (req.body || {}) as BookingRequest);
    res.json({ ok: true, pricing });
  },
};
