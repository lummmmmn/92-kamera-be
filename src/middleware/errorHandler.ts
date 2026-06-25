import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../utils/httpError.js";

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("cache-control", "no-store");
  next();
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route ${req.method} ${req.path} was not found`));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const isHttp = error instanceof HttpError;
  const status = isHttp ? error.status : 500;

  if (!isHttp) {
    console.error("[api]", error);
  }

  res.status(status).json({
    ok: false,
    error: isHttp ? error.message : "Internal server error",
    details: isHttp ? error.details : undefined,
  });
};
