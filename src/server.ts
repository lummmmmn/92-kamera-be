import "dotenv/config";
import { env } from "./config/env.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[92kamera-api] listening on http://localhost:${env.port}`);
});
