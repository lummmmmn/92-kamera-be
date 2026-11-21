import { Router } from "express";
import { wishController } from "../controllers/wish.controller.js";
import { wishRateLimit } from "../middleware/wishRateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const wishRouter = Router();

// Công khai: xem tất nào đang mở + gửi điều ước (có rate limit)
wishRouter.get("/socks", asyncHandler(wishController.getSocks));
wishRouter.post("/", wishRateLimit(), asyncHandler(wishController.create));

// Admin (token kiểm tra trong controller)
wishRouter.put("/socks", asyncHandler(wishController.updateSocks));
wishRouter.get("/", asyncHandler(wishController.list));
wishRouter.patch("/:id/read", asyncHandler(wishController.markRead));
wishRouter.delete("/read", asyncHandler(wishController.removeRead));
wishRouter.delete("/:id", asyncHandler(wishController.remove));
