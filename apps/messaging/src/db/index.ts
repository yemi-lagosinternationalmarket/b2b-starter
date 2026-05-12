/**
 * Drizzle database type alias used across the messaging service. Both the
 * production `postgres-js` driver (via `getDb()` in `./client.ts`) and the
 * in-memory `pglite` driver used in tests must be assignable to this type.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

// `PgDatabase` is the broadest concrete superclass shared by every Postgres
// driver in drizzle-orm — it lets us treat node-postgres, postgres-js, and
// pglite uniformly at the route layer.
export type MessagingDb = PgDatabase<PgQueryResultHKT, typeof schema>;
