import { Router } from "express";
import { bookingController } from "../controllers/booking.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const bookingRouter = Router();

bookingRouter.get("/", asyncHandler(bookingController.list));
bookingRouter.post("/", asyncHandler(bookingController.create));
bookingRouter.get("/availability", asyncHandler(bookingController.availability));
bookingRouter.patch("/:id/status", asyncHandler(bookingController.updateStatus));
