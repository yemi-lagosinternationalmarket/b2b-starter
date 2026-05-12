import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { getDb } from "./db/client.js";
import type { MessagingDb } from "./db/index.js";
import { registerInboundRoutes } from "./routes/inbound.js";
import { resolveStorageFromEnv, type StorageClient } from "./storage/index.js";

export interface BuildAppOptions {
  /**
   * Override the Drizzle DB client. Tests inject a pglite-backed client;
   * production omits this and the lazy postgres-js client from
   * `db/client.ts` is used.
   */
  db?: MessagingDb;
  /**
   * Override the storage backend. Tests inject an in-memory impl.
   */
  storage?: StorageClient;
}

/** Per-file multipart cap. ~25 MB covers PO photos comfortably. */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: 10,
    },
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  // Lazy resolution: only construct the DB / storage clients on first
  // inbound-route request. This keeps `/health` reachable when the service
  // boots without POSTGRES_URL set, matching the B.0 lazy-DB pattern.
  let resolvedDb: MessagingDb | undefined = opts.db;
  let resolvedStorage: StorageClient | undefined = opts.storage;
  const lazy = {
    get db(): MessagingDb {
      if (!resolvedDb) resolvedDb = getDb();
      return resolvedDb;
    },
    get storage(): StorageClient {
      if (!resolvedStorage) resolvedStorage = resolveStorageFromEnv();
      return resolvedStorage;
    },
  };

  app.register(async (instance) => {
    await registerInboundRoutes(instance, lazy);
  });

  return app;
}
