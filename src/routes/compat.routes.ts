import { Router } from "express";
import { cameraImageController, photoController } from "../controllers/media.controller.js";
import { orderController } from "../controllers/order.controller.js";
import {
  createArrayResourceController,
  deliveryFeeController,
  discountController,
  resources,
  siteController,
  userController,
} from "../controllers/resource.controller.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const cameraController = createArrayResourceController(resources.cameras);
const accessoryController = createArrayResourceController(resources.accessories);
const feedbackController = createArrayResourceController(resources.feedbacks);
const albumController = createArrayResourceController(resources.albums);

export const cameraRouter = Router();
cameraRouter.get("/", asyncHandler(cameraController.list));
cameraRouter.post("/", asyncHandler(cameraController.create));
cameraRouter.get("/:id", asyncHandler(cameraController.getOne));
cameraRouter.put("/:id", asyncHandler(cameraController.update));
cameraRouter.delete("/:id", asyncHandler(cameraController.remove));
cameraRouter.post("/:id/images", asyncHandler(cameraImageController.upload));

export const accessoryRouter = Router();
accessoryRouter.get("/", asyncHandler(accessoryController.list));
accessoryRouter.post("/", asyncHandler(accessoryController.create));
accessoryRouter.get("/:id", asyncHandler(accessoryController.getOne));
accessoryRouter.put("/:id", asyncHandler(accessoryController.update));
accessoryRouter.delete("/:id", asyncHandler(accessoryController.remove));

export const orderRouter = Router();
orderRouter.get("/", authenticate, asyncHandler(orderController.list));
orderRouter.post("/", asyncHandler(orderController.create));
orderRouter.get("/:id", asyncHandler(orderController.getOne));
orderRouter.put("/:id", asyncHandler(orderController.update));
orderRouter.patch("/:id/status", asyncHandler(orderController.updateStatus));
orderRouter.patch("/:id/seen", asyncHandler(orderController.markSeen));
orderRouter.delete("/:id", asyncHandler(orderController.remove));

export const siteRouter = Router();
siteRouter.get("/", asyncHandler(siteController.get));
siteRouter.put("/", asyncHandler(siteController.update));

export const discountRouter = Router();
discountRouter.get("/", asyncHandler(discountController.list));
discountRouter.post("/", asyncHandler(discountController.create));
discountRouter.post("/apply", asyncHandler(discountController.apply));
discountRouter.get("/:id", asyncHandler(discountController.getOne));
discountRouter.put("/:id", asyncHandler(discountController.update));
discountRouter.delete("/:id", asyncHandler(discountController.remove));

export const feedbackRouter = Router();
feedbackRouter.get("/", asyncHandler(feedbackController.list));
feedbackRouter.post("/", asyncHandler(feedbackController.create));
feedbackRouter.get("/:id", asyncHandler(feedbackController.getOne));
feedbackRouter.put("/:id", asyncHandler(feedbackController.update));
feedbackRouter.delete("/:id", asyncHandler(feedbackController.remove));

export const photoRouter = Router();
photoRouter.get("/", asyncHandler(photoController.list));
photoRouter.post("/", asyncHandler(photoController.upload));
photoRouter.post("/upload", asyncHandler(photoController.upload));
photoRouter.delete("/:id", asyncHandler(photoController.remove));

export const albumRouter = Router();
albumRouter.get("/", asyncHandler(albumController.list));
albumRouter.post("/", asyncHandler(albumController.create));
albumRouter.get("/:id", asyncHandler(albumController.getOne));
albumRouter.put("/:id", asyncHandler(albumController.update));
albumRouter.delete("/:id", asyncHandler(albumController.remove));

export const deliveryFeeRouter = Router();
deliveryFeeRouter.get("/", asyncHandler(deliveryFeeController.list));
deliveryFeeRouter.put("/", asyncHandler(deliveryFeeController.replace));

export const userRouter = Router();
userRouter.get("/", asyncHandler(userController.list));
userRouter.get("/google/:googleId", asyncHandler(userController.getByGoogleId));
userRouter.post("/upsert", asyncHandler(userController.upsert));
