import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit(), asyncHandler(authController.login));
authRouter.post("/google", loginRateLimit(), asyncHandler(authController.google));
authRouter.post("/logout", asyncHandler(authController.logout));
