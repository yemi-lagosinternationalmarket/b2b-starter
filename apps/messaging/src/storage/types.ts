/**
 * Storage abstraction for messaging-domain attachments.
 *
 * The intended production backend is Supabase Storage; B.1 ships a
 * `LocalDiskStorage` impl that writes to a configurable directory so the
 * service is fully runnable before Supabase Storage credentials exist.
 * `MESSAGING_STORAGE_DRIVER=supabase` will switch backends in a follow-up
 * issue once the bucket + service-role key are wired up.
 */
export interface PutObjectInput {
  /** Object key, e.g. `attachments/<sha256-prefix>/<sha256>`. */
  key: string;
  body: Buffer;
  mimeType: string;
}

export interface PutObjectResult {
  /** Provider-specific storage path stored on `attachment.storage_path`. */
  storagePath: string;
}

export interface StorageClient {
  /** Driver identifier for logging/metrics. */
  readonly driver: "local-disk" | "supabase";
  /**
   * Idempotent put. If the key already exists with the same content the
   * impl SHOULD short-circuit; callers also dedupe at the DB layer via
   * `attachment.sha256`.
   */
  put(input: PutObjectInput): Promise<PutObjectResult>;
}
