import { Router } from "express";
import { uploadController } from "../controllers/upload.controller.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const uploadRouter = Router();

/**
 * POST /api/upload
 * Upload ảnh lên Cloudinary, trả về secure_url + public_id.
 * Yêu cầu admin session.
 */
uploadRouter.post("/", asyncHandler(uploadController.upload));

/**
 * POST /api/upload/avatar
 * Upload avatar khách hàng — chỉ cần đăng nhập (Google), không cần admin.
 */
uploadRouter.post("/avatar", authenticate, asyncHandler(uploadController.uploadAvatar));
