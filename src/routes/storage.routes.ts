import { Router } from "express";
import { storageController } from "../controllers/storage.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const storageRouter = Router();

storageRouter.get("/", asyncHandler(storageController.get));
storageRouter.get("/meta", asyncHandler(storageController.getMeta));
storageRouter.post("/cas", asyncHandler(storageController.cas));
storageRouter.put("/", asyncHandler(storageController.set));
storageRouter.post("/", asyncHandler(storageController.set));
