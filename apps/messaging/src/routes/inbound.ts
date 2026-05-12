import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import type {
  AttachmentDto,
  CreateInboundMessageBody,
  CreateInboundMessageResponse,
  InboundMessageDto,
  InboundMessageWithAttachmentsDto,
  ListInboundMessagesQuery,
  ListInboundMessagesResponse,
  MessagingChannel,
} from "@b2b-starter/shared-types";
import { MESSAGING_DOCNAME_MAX_LENGTH } from "@b2b-starter/shared-types";
import type { MessagingDb } from "../db/index.js";
import {
  attachment,
  channelAccount,
  inboundMessage,
  messageThread,
  type AttachmentRow,
  type ChannelValue,
  type InboundMessageRow,
} from "../db/schema.js";
import type { StorageClient } from "../storage/index.js";

const VALID_CHANNELS: ReadonlySet<MessagingChannel> = new Set([
  "email",
  "sms",
  "whatsapp",
  "slack",
  "voice",
  "manual",
  "photo",
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Cursor encoding decision: opaque base64-url(JSON({receivedAt, id})). Two
 * fields are required because `received_at` is not unique. We keep it in
 * JSON for forward-compat (adding a `direction` or `version` field later
 * is just a key add). Documented in the PR body.
 */
interface PageCursor {
  received_at: string;
  id: string;
}

function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): PageCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<PageCursor>;
    if (typeof parsed.received_at === "string" && typeof parsed.id === "string") {
      return { received_at: parsed.received_at, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function isValidChannel(v: unknown): v is MessagingChannel {
  return typeof v === "string" && VALID_CHANNELS.has(v as MessagingChannel);
}

/**
 * Soft length validation on opaque ERPNext docnames. Any UTF-8 string up
 * to 200 chars is accepted; the messaging service does NOT validate
 * existence in ERPNext (per ADR 0018 / pivot note).
 */
function validateOpaqueDocname(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw httpError(400, `${field} must be a string`);
  }
  if (value.length > MESSAGING_DOCNAME_MAX_LENGTH) {
    throw httpError(
      400,
      `${field} exceeds ${MESSAGING_DOCNAME_MAX_LENGTH} chars`,
    );
  }
  return value;
}

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
function httpError(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message);
}

/* ------------------------------------------------------------------------- */
/* Row → DTO mapping                                                          */
/* ------------------------------------------------------------------------- */

function toMessageDto(
  row: InboundMessageRow,
  channel: MessagingChannel,
): InboundMessageDto {
  return {
    id: row.id,
    channel,
    channel_account_id: row.channelAccountId,
    thread_id: row.threadId,
    external_message_id: row.externalMessageId,
    from_identity: row.fromIdentity,
    to_identities: row.toIdentities,
    subject: row.subject,
    body_plain: row.bodyPlain,
    body_html: row.bodyHtml,
    received_at: row.receivedAt.toISOString(),
    channel_payload: (row.channelPayload ?? {}) as Record<string, unknown>,
    classification: row.classification,
    classified_at: row.classifiedAt ? row.classifiedAt.toISOString() : null,
    vendor_id: row.vendorId,
    purchase_order_id: row.purchaseOrderId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    message_id: row.messageId,
    message_direction: row.messageDirection,
    sha256: row.sha256,
    original_name: row.originalName,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    storage_path: row.storagePath,
    uploaded_at: row.uploadedAt.toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

/* ------------------------------------------------------------------------- */
/* Channel-account auto-provisioning + thread keying                          */
/* ------------------------------------------------------------------------- */

/**
 * For B.1 we don't yet have a `POST /v1/channel-accounts` endpoint
 * (deferred to B.3 with auth). To make the manual channel usable today,
 * we lazily upsert a channel_account keyed on (channel='manual', address='manual').
 * Real channels (email/sms/...) will be required to pre-exist in B.2+.
 */
async function ensureManualChannelAccount(db: MessagingDb): Promise<string> {
  const existing = await db
    .select({ id: channelAccount.id })
    .from(channelAccount)
    .where(
      and(
        eq(channelAccount.channel, "manual"),
        eq(channelAccount.address, "manual"),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(channelAccount)
    .values({
      channel: "manual",
      address: "manual",
      displayName: "Manual entry",
    })
    .returning({ id: channelAccount.id });
  return inserted[0]!.id;
}

/**
 * Thread keying for the manual channel: synthesize a thread per
 * (channel, from_identity). Matches the spec ("auto-creates thread if
 * needed, key off `from_identity` + `channel`").
 */
function manualThreadKey(fromIdentity: string): string {
  return `manual:${fromIdentity}`;
}

async function ensureThread(
  db: MessagingDb,
  channel: ChannelValue,
  externalThreadId: string,
  vendorId: string | null,
  receivedAt: Date,
): Promise<string> {
  const existing = await db
    .select({ id: messageThread.id })
    .from(messageThread)
    .where(
      and(
        eq(messageThread.channel, channel),
        eq(messageThread.externalThreadId, externalThreadId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(messageThread)
      .set({
        lastMessageAt: receivedAt,
        messageCount: sql`${messageThread.messageCount} + 1`,
        ...(vendorId ? { vendorId } : {}),
      })
      .where(eq(messageThread.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(messageThread)
    .values({
      channel,
      externalThreadId,
      vendorId,
      firstMessageAt: receivedAt,
      lastMessageAt: receivedAt,
      messageCount: 1,
    })
    .returning({ id: messageThread.id });
  return inserted[0]!.id;
}

/* ------------------------------------------------------------------------- */
/* Route registration                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Options is a getter-bag rather than concrete values so the caller can
 * defer DB / storage construction until first request (see `app.ts`).
 */
export interface InboundRoutesOptions {
  readonly db: MessagingDb;
  readonly storage: StorageClient;
}

export async function registerInboundRoutes(
  app: FastifyInstance,
  opts: InboundRoutesOptions,
): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    app.log.error({ err }, "unhandled error in messaging route");
    reply.code(500).send({ error: "internal_server_error" });
  });

  /* ---- POST /v1/inbound (JSON or multipart) -------------------------- */

  app.post("/v1/inbound", async (req, reply) => {
    const contentType = req.headers["content-type"] ?? "";
    let body: CreateInboundMessageBody;
    let attachmentParts: MultipartAttachment[] = [];

    if (contentType.startsWith("multipart/")) {
      const parsed = await parseMultipart(req);
      body = parsed.body;
      attachmentParts = parsed.attachments;
    } else {
      body = (req.body ?? {}) as CreateInboundMessageBody;
    }

    const result = await createInboundMessage(
      opts.db,
      opts.storage,
      body,
      attachmentParts,
    );
    const response: CreateInboundMessageResponse = { data: result };
    reply.code(201).send(response);
  });

  /* ---- GET /v1/inbound -------------------------------------------- */

  app.get("/v1/inbound", async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const queryParams: ListInboundMessagesQuery = {
      channel: q.channel as MessagingChannel | undefined,
      vendor_id: q.vendor_id,
      purchase_order_id: q.purchase_order_id,
      classification: q.classification,
      received_after: q.received_after,
      received_before: q.received_before,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
    };
    return listInboundMessages(opts.db, queryParams);
  });

  /* ---- GET /v1/inbound/:id --------------------------------------- */

  app.get<{ Params: { id: string } }>("/v1/inbound/:id", async (req, reply) => {
    const result = await getInboundMessage(opts.db, req.params.id);
    if (!result) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return { data: result };
  });
}

/* ------------------------------------------------------------------------- */
/* Multipart parsing                                                          */
/* ------------------------------------------------------------------------- */

interface MultipartAttachment {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

interface ParsedMultipart {
  body: CreateInboundMessageBody;
  attachments: MultipartAttachment[];
}

/**
 * Multipart parse rules:
 * - Field `payload` (a JSON string) carries the structured body. This is
 *   the simplest way to keep the JSON shape identical between the JSON and
 *   multipart variants without inventing per-field form encodings for
 *   arrays / nested objects.
 * - Any number of file fields are accepted; each becomes one attachment.
 * - We buffer files entirely in memory. For B.1 the practical caps are
 *   the @fastify/multipart defaults (1 MiB per field, 1 MB per file by
 *   default — we override to 25 MB per file in the plugin registration to
 *   match typical PO photo sizes). Streaming-to-disk-first is a follow-up
 *   if file sizes grow.
 */
async function parseMultipart(req: FastifyRequest): Promise<ParsedMultipart> {
  const attachments: MultipartAttachment[] = [];
  let payload: CreateInboundMessageBody | undefined;

  const parts = (req as unknown as {
    parts(): AsyncIterableIterator<unknown>;
  }).parts();

  for await (const partRaw of parts) {
    const part = partRaw as MultipartPart;
    if (part.type === "file") {
      const buf = await part.toBuffer();
      attachments.push({
        filename: part.filename ?? "upload",
        mimeType: part.mimetype ?? "application/octet-stream",
        buffer: buf,
      });
    } else if (part.type === "field" && part.fieldname === "payload") {
      try {
        payload = JSON.parse(String(part.value)) as CreateInboundMessageBody;
      } catch {
        throw httpError(400, "multipart `payload` field is not valid JSON");
      }
    }
  }

  if (!payload) {
    throw httpError(
      400,
      "multipart requests must include a `payload` field with the JSON body",
    );
  }
  return { body: payload, attachments };
}

interface MultipartPart {
  type: "file" | "field";
  fieldname: string;
  filename?: string;
  mimetype?: string;
  value?: unknown;
  toBuffer(): Promise<Buffer>;
}

/* ------------------------------------------------------------------------- */
/* Core operations                                                            */
/* ------------------------------------------------------------------------- */

export async function createInboundMessage(
  db: MessagingDb,
  storage: StorageClient,
  body: CreateInboundMessageBody,
  attachments: MultipartAttachment[],
): Promise<InboundMessageWithAttachmentsDto> {
  // --- validate ---
  if (!isValidChannel(body.channel)) {
    throw httpError(400, "channel must be one of email|sms|whatsapp|slack|voice|manual|photo");
  }
  if (typeof body.from_identity !== "string" || body.from_identity.length === 0) {
    throw httpError(400, "from_identity is required");
  }
  if (!Array.isArray(body.to_identities)) {
    throw httpError(400, "to_identities must be an array of strings");
  }
  if (typeof body.body_plain !== "string") {
    throw httpError(400, "body_plain is required");
  }
  // B.1 only wires up the manual channel; other channels need their adapters
  // (email pull, SMS webhook, etc.) — explicitly reject so callers don't
  // think this endpoint is a generic inbound sink yet.
  if (body.channel !== "manual") {
    throw httpError(
      501,
      `channel '${body.channel}' adapter not implemented in B.1; only 'manual' is supported`,
    );
  }
  const vendorId = validateOpaqueDocname(body.vendor_id, "vendor_id");
  const purchaseOrderId = validateOpaqueDocname(
    body.purchase_order_id,
    "purchase_order_id",
  );

  const receivedAt = body.received_at ? new Date(body.received_at) : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    throw httpError(400, "received_at must be an ISO-8601 timestamp");
  }

  const channelAccountId = await ensureManualChannelAccount(db);
  const externalMessageId = body.external_message_id ?? `manual:${randomUUID()}`;
  const threadId = await ensureThread(
    db,
    "manual",
    manualThreadKey(body.from_identity),
    vendorId,
    receivedAt,
  );

  const inserted = await db
    .insert(inboundMessage)
    .values({
      channelAccountId,
      threadId,
      externalMessageId,
      fromIdentity: body.from_identity,
      toIdentities: body.to_identities,
      subject: body.subject ?? null,
      bodyPlain: body.body_plain,
      bodyHtml: body.body_html ?? null,
      receivedAt,
      channelPayload: (body.channel_payload ?? {}) as object,
      classification: body.classification ?? null,
      classifiedAt: body.classification ? new Date() : null,
      vendorId,
      purchaseOrderId,
      metadata: (body.metadata ?? {}) as object,
    })
    .returning();

  const messageRow = inserted[0]!;

  // --- attachments ---
  const attachmentDtos: AttachmentDto[] = [];
  for (const file of attachments) {
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const key = `attachments/${sha256.slice(0, 2)}/${sha256}`;
    const { storagePath } = await storage.put({
      key,
      body: file.buffer,
      mimeType: file.mimeType,
    });
    // Dedupe within the (message_id, sha256) unique index. If a caller
    // uploads the same file twice on the same message we silently reuse.
    const insertedAttachments = await db
      .insert(attachment)
      .values({
        messageId: messageRow.id,
        messageDirection: "inbound",
        sha256,
        originalName: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.byteLength,
        storagePath,
      })
      .onConflictDoNothing({
        target: [attachment.messageId, attachment.sha256],
      })
      .returning();
    if (insertedAttachments[0]) {
      attachmentDtos.push(toAttachmentDto(insertedAttachments[0]));
    } else {
      // Fetch the existing row so the response is complete.
      const existing = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.messageId, messageRow.id),
            eq(attachment.sha256, sha256),
          ),
        )
        .limit(1);
      if (existing[0]) attachmentDtos.push(toAttachmentDto(existing[0]));
    }
  }

  return {
    ...toMessageDto(messageRow, "manual"),
    attachments: attachmentDtos,
  };
}

export async function listInboundMessages(
  db: MessagingDb,
  query: ListInboundMessagesQuery,
): Promise<ListInboundMessagesResponse> {
  const limit = Math.min(
    Math.max(Number(query.limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );

  const conditions = [];

  if (query.channel) {
    if (!isValidChannel(query.channel)) {
      throw httpError(400, "invalid channel filter");
    }
    // Filter by joining channel_account.channel — but we don't need the
    // join because manual messages all share a channel_account whose
    // channel matches. We instead filter on the channel_account.channel
    // by joining; for B.1 manual-only it's also fine to join unconditionally.
    conditions.push(
      sql`${inboundMessage.channelAccountId} IN (SELECT id FROM ${channelAccount} WHERE ${channelAccount.channel} = ${query.channel})`,
    );
  }
  if (query.vendor_id !== undefined) {
    conditions.push(eq(inboundMessage.vendorId, query.vendor_id));
  }
  if (query.purchase_order_id !== undefined) {
    conditions.push(eq(inboundMessage.purchaseOrderId, query.purchase_order_id));
  }
  if (query.classification !== undefined) {
    conditions.push(eq(inboundMessage.classification, query.classification));
  }
  if (query.received_after) {
    const t = new Date(query.received_after);
    if (Number.isNaN(t.getTime())) {
      throw httpError(400, "received_after must be ISO-8601");
    }
    conditions.push(gte(inboundMessage.receivedAt, t));
  }
  if (query.received_before) {
    const t = new Date(query.received_before);
    if (Number.isNaN(t.getTime())) {
      throw httpError(400, "received_before must be ISO-8601");
    }
    conditions.push(lte(inboundMessage.receivedAt, t));
  }

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    if (!c) throw httpError(400, "invalid cursor");
    const cursorTs = new Date(c.received_at);
    if (Number.isNaN(cursorTs.getTime())) {
      throw httpError(400, "invalid cursor");
    }
    // We sort by (received_at DESC, id DESC); the next page is rows
    // strictly older than the cursor on (received_at, id).
    conditions.push(
      or(
        lt(inboundMessage.receivedAt, cursorTs),
        and(eq(inboundMessage.receivedAt, cursorTs), lt(inboundMessage.id, c.id)),
      )!,
    );
  }

  // Join channel_account so we can return the channel value in DTOs.
  const rows = await db
    .select({
      message: inboundMessage,
      channel: channelAccount.channel,
    })
    .from(inboundMessage)
    .innerJoin(
      channelAccount,
      eq(inboundMessage.channelAccountId, channelAccount.id),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inboundMessage.receivedAt), desc(inboundMessage.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const data = page.map((r) =>
    toMessageDto(r.message, r.channel as MessagingChannel),
  );
  const next_cursor =
    hasMore && page.length > 0
      ? encodeCursor({
          received_at: page[page.length - 1]!.message.receivedAt.toISOString(),
          id: page[page.length - 1]!.message.id,
        })
      : null;

  return { data, next_cursor };
}

export async function getInboundMessage(
  db: MessagingDb,
  id: string,
): Promise<InboundMessageWithAttachmentsDto | null> {
  const rows = await db
    .select({
      message: inboundMessage,
      channel: channelAccount.channel,
    })
    .from(inboundMessage)
    .innerJoin(
      channelAccount,
      eq(inboundMessage.channelAccountId, channelAccount.id),
    )
    .where(eq(inboundMessage.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const atts = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.messageId, id),
        eq(attachment.messageDirection, "inbound"),
      ),
    )
    .orderBy(asc(attachment.uploadedAt));

  return {
    ...toMessageDto(row.message, row.channel as MessagingChannel),
    attachments: atts.map(toAttachmentDto),
  };
}
