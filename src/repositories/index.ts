import { env } from "../config/env.js";
import type { Repository } from "../types/repository.js";

let repoPromise: Promise<Repository> | null = null;

export async function getRepository(): Promise<Repository> {
  if (repoPromise) return repoPromise;

  repoPromise = (async () => {
    const driver = env.dbDriver;

    if (driver === "supabase" || driver === "postgres" || driver === "postgresql") {
      const { createSupabaseRepository } = await import("./supabase.repository.js");
      return createSupabaseRepository();
    }

    if (driver === "mysql" || driver === "mariadb") {
      const { createMysqlRepository } = await import("./mysql.repository.js");
      return createMysqlRepository();
    }

    if (driver === "mongodb" || driver === "mongo") {
      const { createMongoRepository } = await import("./mongo.repository.js");
      return createMongoRepository();
    }

    if (driver === "json" || driver === "file") {
      const { createJsonRepository } = await import("./json.repository.js");
      return createJsonRepository();
    }

    throw new Error(`Unsupported DB_DRIVER "${driver}"`);
  })();

  return repoPromise;
}
