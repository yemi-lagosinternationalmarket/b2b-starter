/**
 * Shared request / response types for the `apps/messaging` HTTP API.
 *
 * These are the contract consumed by procurement-agent, the Medusa admin
 * widgets, and any future caller. Keep them framework-agnostic: no Fastify,
 * no Drizzle, no Zod imports — just plain TypeScript so any consumer can
 * depend on `@b2b-starter/shared-types` without pulling in server deps.
 *
 * Per ADR 0011 the `channel` field is the single discriminator. Per ADR
 * 0018 + the issue pivot note, `vendor_id` and `purchase_order_id` are
 * opaque text (ERPNext docnames); the messaging service does not validate
 * them.
 */

export type MessagingChannel =
  | "email"
  | "sms"
  | "whatsapp"
  | "slack"
  | "voice"
  | "manual"
  | "photo";

export type MessageDirection = "inbound" | "outbound";

/** Soft length limit on opaque ERPNext docnames (Frappe convention is ~150). */
export const MESSAGING_DOCNAME_MAX_LENGTH = 200;

/* ------------------------------------------------------------------------- */
/* POST /v1/inbound — JSON body                                               */
/* ------------------------------------------------------------------------- */

export interface CreateInboundMessageBody {
  channel: MessagingChannel;
  /** Channel-native sender (email, phone, slack user id, "manual:<operator>"). */
  from_identity: string;
  /** Channel-native recipients. */
  to_identities: string[];
  /** Plain-text body. Required even for HTML-only sources (caller flattens). */
  body_plain: string;
  /** Optional HTML body. */
  body_html?: string;
  /** Optional subject (email). */
  subject?: string;
  /** Channel-native unique ID. Auto-generated if omitted (manual channel). */
  external_message_id?: string;
  /** Raw provider payload (Twilio webhook body, parsed email headers, etc.). */
  channel_payload?: Record<string, unknown>;
  /** Opaque ERPNext Supplier docname. Not validated. */
  vendor_id?: string;
  /** Opaque ERPNext Purchase Order docname. Not validated. */
  purchase_order_id?: string;
  /** Optional pre-assigned classification (procurement-agent may set later). */
  classification?: string;
  /** ISO-8601 receipt timestamp. Defaults to server now. */
  received_at?: string;
  /** Free-form metadata bag. */
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------- */
/* GET /v1/inbound — query string                                             */
/* ------------------------------------------------------------------------- */

export interface ListInboundMessagesQuery {
  channel?: MessagingChannel;
  vendor_id?: string;
  purchase_order_id?: string;
  classification?: string;
  /** ISO-8601 timestamp. Inclusive lower bound on `received_at`. */
  received_after?: string;
  /** ISO-8601 timestamp. Exclusive upper bound on `received_at`. */
  received_before?: string;
  /** Opaque cursor returned by a prior call. */
  cursor?: string;
  /** Page size; defaults to 50, max 200. */
  limit?: number;
}

/* ------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* ------------------------------------------------------------------------- */

export interface AttachmentDto {
  id: string;
  message_id: string | null;
  message_direction: MessageDirection;
  sha256: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_at: string;
  metadata: Record<string, unknown>;
}

export interface InboundMessageDto {
  id: string;
  channel: MessagingChannel;
  channel_account_id: string;
  thread_id: string | null;
  external_message_id: string;
  from_identity: string;
  to_identities: string[];
  subject: string | null;
  body_plain: string;
  body_html: string | null;
  received_at: string;
  channel_payload: Record<string, unknown>;
  classification: string | null;
  classified_at: string | null;
  vendor_id: string | null;
  purchase_order_id: string | null;
  metadata: Record<string, unknown>;
}

export interface InboundMessageWithAttachmentsDto extends InboundMessageDto {
  attachments: AttachmentDto[];
}

export interface ListInboundMessagesResponse {
  data: InboundMessageDto[];
  /** Opaque cursor for the next page; null when there are no more rows. */
  next_cursor: string | null;
}

export interface CreateInboundMessageResponse {
  data: InboundMessageWithAttachmentsDto;
}
