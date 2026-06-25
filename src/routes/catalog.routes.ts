import { Router } from "express";
import { catalogController } from "../controllers/catalog.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const catalogRouter = Router();

catalogRouter.get("/", asyncHandler(catalogController.getPublicCatalog));
