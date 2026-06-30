import type { Request, Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getRepository } from "../repositories/index.js";
import { createBooking, getAvailability, listBookings, updateBookingStatus } from "../services/booking.service.js";
import type { BookingRequest } from "../types/domain.js";
import { requireString } from "../utils/http.js";

export const bookingController = {
  async create(req: Request, res: Response) {
    const repo = await getRepository();
    const booking = await createBooking(repo, (req.body || {}) as BookingRequest);
    res.status(201).json({ ok: true, booking });
  },

  async list(req: Request, res: Response) {
    requireAdmin(req);

    const repo = await getRepository();
    const bookings = await listBookings(repo, {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });

    res.json({ ok: true, bookings });
  },

  async availability(req: Request, res: Response) {
    const repo = await getRepository();
    const availability = await getAvailability(repo, {
      date: requireString(req.query.date, "date"),
      days: typeof req.query.days === "string" ? Number(req.query.days) : undefined,
      session: typeof req.query.session === "string" ? req.query.session : undefined,
    });

    res.json({ ok: true, availability });
  },

  async updateStatus(req: Request, res: Response) {
    requireAdmin(req);

    const orderId = requireString(req.params.id, "id");
    const status = requireString((req.body || {}).status, "status");
    const repo = await getRepository();
    const booking = await updateBookingStatus(repo, orderId, status);

    res.json({ ok: true, booking });
  },
};
