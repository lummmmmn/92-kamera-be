import { Router } from "express";
import { galleryController } from "../controllers/gallery.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const galleryRouter = Router();

galleryRouter.get("/", asyncHandler(galleryController.list));
galleryRouter.post("/", asyncHandler(galleryController.upsert));
galleryRouter.delete("/", asyncHandler(galleryController.remove));
