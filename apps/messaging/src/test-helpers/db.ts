import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema.js";
import type { MessagingDb } from "../db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spin up an in-memory pglite Postgres, run the generated drizzle migrations
 * against it, and return a Drizzle client typed identically to the
 * production postgres-js client.
 *
 * pglite is a WASM build of Postgres so we get real Postgres semantics
 * (schemas, enums, jsonb, text[], unique indexes) — important because the
 * messaging schema uses all of those features. No Docker required.
 */
export async function makeTestDb(): Promise<{
  db: MessagingDb;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  // Apply every migration SQL file in /apps/messaging/drizzle, splitting on
  // the drizzle `--> statement-breakpoint` marker. drizzle-kit's migrate
  // command does the same; we don't want to require a real DB connection
  // for tests so we replicate the apply step here.
  const migrationsDir = path.resolve(__dirname, "../../drizzle");
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sqlText = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
  const db = drizzle(client, { schema }) as unknown as MessagingDb;
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
