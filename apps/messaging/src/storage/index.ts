import * as path from "node:path";
import { LocalDiskStorage } from "./local-disk.js";
import type { StorageClient } from "./types.js";

export type { StorageClient, PutObjectInput, PutObjectResult } from "./types.js";
export { LocalDiskStorage } from "./local-disk.js";

/**
 * Resolve the storage backend from env. Today only `local-disk` ships;
 * `supabase` will plug in here once the bucket exists (likely B.4 / a
 * follow-up). Tests inject a `StorageClient` directly via `buildApp`.
 */
export function resolveStorageFromEnv(): StorageClient {
  const driver = process.env.MESSAGING_STORAGE_DRIVER ?? "local-disk";
  if (driver === "local-disk") {
    const root =
      process.env.MESSAGING_STORAGE_LOCAL_ROOT ??
      path.resolve(process.cwd(), ".messaging-storage");
    return new LocalDiskStorage(root);
  }
  throw new Error(
    `Unknown MESSAGING_STORAGE_DRIVER=${driver}. Supported: local-disk.`,
  );
}
