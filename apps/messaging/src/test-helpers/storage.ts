import type {
  PutObjectInput,
  PutObjectResult,
  StorageClient,
} from "../storage/index.js";

/**
 * In-memory `StorageClient` for tests. Keeps written buffers indexed by
 * `key` so assertions can verify both that bytes were written and what they
 * were.
 */
export class InMemoryStorage implements StorageClient {
  readonly driver = "local-disk" as const;
  readonly objects = new Map<string, { mimeType: string; body: Buffer }>();

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    this.objects.set(input.key, { mimeType: input.mimeType, body: input.body });
    return { storagePath: `memory://${input.key}` };
  }
}
