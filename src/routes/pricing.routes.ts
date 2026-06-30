import { Router } from "express";
import { pricingController } from "../controllers/pricing.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const pricingRouter = Router();

pricingRouter.post("/estimate", asyncHandler(pricingController.estimate));
