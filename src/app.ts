import cors, { type CorsOptions } from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, noStore, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";

function buildCorsOptions(): CorsOptions {
  if (env.corsOrigin === "*") return { origin: true };

  const allowList = env.corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      if (!origin || allowList.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
  };
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: env.jsonBodyLimit }));
  app.use(noStore);

  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
