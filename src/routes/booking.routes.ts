import { Router } from "express";
import { bookingController } from "../controllers/booking.controller.js";
import { getRepository } from "../repositories/index.js";
import { checkCaAvailability } from "../services/booking.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireString } from "../utils/http.js";

export const bookingRouter = Router();

bookingRouter.get("/", asyncHandler(bookingController.list));
bookingRouter.post("/", asyncHandler(bookingController.create));
bookingRouter.get("/availability", asyncHandler(bookingController.availability));
bookingRouter.patch("/:id/status", asyncHandler(bookingController.updateStatus));

// GET /api/bookings/ca-availability?maMay=sony-a7iii-01&ngayNhan=2026-07-10&gioNhan=08:00&soNgay=1&gioTra=17:00&giaTheoNgay=169000
// Frontend gọi trước khi khách submit đơn để check ca có trống không
bookingRouter.get(
  "/ca-availability",
  asyncHandler(async (req, res) => {
    const repo = await getRepository();
    const result = await checkCaAvailability(repo, {
      maMay:        requireString(req.query.maMay    as string, "maMay"),
      ngayNhan:     requireString(req.query.ngayNhan as string, "ngayNhan"),
      gioNhan:      requireString(req.query.gioNhan  as string, "gioNhan"),
      soNgay:       Number(req.query.soNgay),
      gioTra:       requireString(req.query.gioTra   as string, "gioTra"),
      giaTheoNgay:  req.query.giaTheoNgay ? Number(req.query.giaTheoNgay) : undefined,
    });
    res.json({ ok: true, ...result });
  }),
);
