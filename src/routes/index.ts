import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { bookingRouter } from "./booking.routes.js";
import { catalogRouter } from "./catalog.routes.js";
import {
  accessoryRouter,
  albumRouter,
  cameraRouter,
  deliveryFeeRouter,
  discountRouter,
  feedbackRouter,
  orderRouter,
  photoRouter,
  siteRouter,
  userRouter,
} from "./compat.routes.js";
import { galleryRouter } from "./gallery.routes.js";
import { healthRouter } from "./health.routes.js";
import { pricingRouter } from "./pricing.routes.js";
import { storageRouter } from "./storage.routes.js";
import { uploadRouter } from "./upload.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/upload", uploadRouter);
apiRouter.use("/storage", storageRouter);
apiRouter.use("/gallery", galleryRouter);
apiRouter.use("/catalog", catalogRouter);
apiRouter.use("/pricing", pricingRouter);
apiRouter.use("/bookings", bookingRouter);
apiRouter.use("/cameras", cameraRouter);
apiRouter.use("/accessories", accessoryRouter);
apiRouter.use("/orders", orderRouter);
apiRouter.use("/site", siteRouter);
apiRouter.use("/discounts", discountRouter);
apiRouter.use("/feedbacks", feedbackRouter);
apiRouter.use("/photos", photoRouter);
apiRouter.use("/albums", albumRouter);
apiRouter.use("/delivery-fees", deliveryFeeRouter);
apiRouter.use("/users", userRouter);
