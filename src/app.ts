import cors, { type CorsOptions } from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, noStore, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://92kamera-fe.vercel.app",
  "https://92kamera.com",
  "https://www.92kamera.com",
];

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function isKnownVercelPreview(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.startsWith("92kamera-fe") &&
      hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function buildCorsOptions(): CorsOptions {
  if (env.corsOrigin === "*") return { origin: true };

  const allowList = new Set(
    [...DEFAULT_ALLOWED_ORIGINS, ...env.corsOrigin.split(",")]
      .map((origin) => normalizeOrigin(origin.trim()))
      .filter(Boolean)
  );

  return {
    origin(origin, callback) {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : "";

      if (
        !origin ||
        allowList.has(normalizedOrigin) ||
        isKnownVercelPreview(normalizedOrigin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  };
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  const corsOptions = buildCorsOptions();

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(express.json({ limit: env.jsonBodyLimit }));
  app.use(noStore);

  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
