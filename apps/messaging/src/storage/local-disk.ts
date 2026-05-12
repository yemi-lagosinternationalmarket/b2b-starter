import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  PutObjectInput,
  PutObjectResult,
  StorageClient,
} from "./types.js";

/**
 * Writes attachment bytes to a local directory. Used in B.1 because the
 * Supabase Storage bucket + service-role key are not yet provisioned. The
 * route layer treats the returned `storagePath` as an opaque string, so
 * swapping in `SupabaseStorage` later is a one-line factory change.
 *
 * The default root is `./.messaging-storage` next to the running process —
 * production will set `MESSAGING_STORAGE_LOCAL_ROOT` to a persistent
 * volume mount.
 */
export class LocalDiskStorage implements StorageClient {
  readonly driver = "local-disk" as const;

  constructor(private readonly root: string) {}

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const fullPath = path.join(this.root, input.key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    // `wx` would error on existing — use `w` so retries are idempotent for
    // identical content (the sha256 in the key guarantees same bytes).
    await fs.writeFile(fullPath, input.body);
    return { storagePath: fullPath };
  }
}
