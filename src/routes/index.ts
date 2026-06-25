import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { bookingRouter } from "./booking.routes.js";
import { catalogRouter } from "./catalog.routes.js";
import { galleryRouter } from "./gallery.routes.js";
import { healthRouter } from "./health.routes.js";
import { pricingRouter } from "./pricing.routes.js";
import { storageRouter } from "./storage.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/storage", storageRouter);
apiRouter.use("/gallery", galleryRouter);
apiRouter.use("/catalog", catalogRouter);
apiRouter.use("/pricing", pricingRouter);
apiRouter.use("/bookings", bookingRouter);
