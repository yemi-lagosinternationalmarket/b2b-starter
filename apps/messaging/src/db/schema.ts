import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * All messaging tables live under the dedicated `messaging` Postgres schema
 * inside the shared Supabase database.
 *
 * Per ADR 0011, channel-specific data (email, sms, whatsapp, slack, voice,
 * manual, photo) is discriminated by a `channel` enum on a generic message
 * shape — no third-party vendor names appear in table, column, or module
 * names. Adding a new channel = extend the enum + write an adapter; no schema
 * migration churn beyond the enum value.
 *
 * Per ADR 0014 (partially superseded by 0018 — but the rule "messaging
 * service is purely messaging-domain" still holds), the cross-system
 * activity log + cross-system attachment story lives outside this service.
 * The `attachment` table here is messaging-domain only (an attachment of a
 * message), with opaque text refs (`vendor_id`, `purchase_order_id`) for
 * external entities — no FKs across services.
 *
 * Per ADR 0018, `vendor_id` and `purchase_order_id` hold ERPNext docnames
 * (e.g. `Yusol Foods`, `LIM-PO-2026-00042`) but are stored as opaque text;
 * this service performs no validation against ERPNext. Frappe docnames are
 * typically <150 characters; we use a soft 200-char limit for headroom.
 */
export const messagingSchema = pgSchema("messaging");

/**
 * Channel discriminator. Order chosen to roughly match expected usage
 * frequency: email-first inbound, then mobile-originated channels, then
 * collaboration tools, then the manual/photo upload paths used in the
 * current LIM workflows for capturing non-digital supplier comms.
 */
export const channelEnum = messagingSchema.enum("channel", [
  "email",
  "sms",
  "whatsapp",
  "slack",
  "voice",
  "manual",
  "photo",
]);

/**
 * Direction discriminator on `attachment.message_direction`. An attachment
 * belongs to either an inbound or an outbound message; B.1 only wires up
 * inbound, B.2 (#13) will start emitting `"outbound"` rows.
 */
export const messageDirectionEnum = messagingSchema.enum("message_direction", [
  "inbound",
  "outbound",
]);

/** A configured account on a given channel (mailbox, phone number, slack workspace, etc.). */
export const channelAccount = messagingSchema.table(
  "channel_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: channelEnum("channel").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    channelConfig: jsonb("channel_config").notNull().default(sql`'{}'::jsonb`),
    /** Reference to a secret in the secret store wired up in B.3 (#8). */
    secretsRef: text("secrets_ref"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    channelAddressUq: uniqueIndex("channel_account_channel_address_uq").on(
      t.channel,
      t.address,
    ),
  }),
);

/**
 * A logical conversation thread within a channel.
 *
 * `external_thread_id` is the channel-native thread identity — for email it
 * is the References/In-Reply-To root Message-ID; for SMS it's the phone-pair
 * key; for the manual channel it is synthesized from `channel + from_identity`
 * (see `routes/inbound.ts`).
 *
 * `vendor_id` is an opaque ERPNext Supplier docname (e.g. `Yusol Foods`),
 * set by the consumer (procurement-agent / Medusa admin widgets). Not
 * validated by this service.
 */
export const messageThread = messagingSchema.table(
  "message_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: channelEnum("channel").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    /** Opaque ERPNext docname (~150 chars typical, 200 max). */
    vendorId: text("vendor_id"),
    firstMessageAt: timestamp("first_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    messageCount: integer("message_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    channelExternalUq: uniqueIndex("message_thread_channel_external_uq").on(
      t.channel,
      t.externalThreadId,
    ),
    vendorIdx: index("message_thread_vendor_idx").on(t.vendorId),
  }),
);

/**
 * A single inbound message on any channel.
 *
 * `external_message_id` is the channel-native unique ID (Message-ID for
 * email, Twilio SID for SMS, etc.). Unique within (channel_account_id,
 * external_message_id) to make idempotent re-delivery safe.
 *
 * `vendor_id` and `purchase_order_id` are opaque ERPNext docnames — no
 * validation, no FK. Consumers are responsible for resolving them.
 */
export const inboundMessage = messagingSchema.table(
  "inbound_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccount.id),
    threadId: uuid("thread_id").references(() => messageThread.id),
    externalMessageId: text("external_message_id").notNull(),
    fromIdentity: text("from_identity").notNull(),
    toIdentities: text("to_identities").array().notNull().default(sql`'{}'`),
    subject: text("subject"),
    bodyPlain: text("body_plain").notNull(),
    bodyHtml: text("body_html"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    channelPayload: jsonb("channel_payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    classification: text("classification"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    /** Opaque ERPNext Supplier docname. */
    vendorId: text("vendor_id"),
    /** Opaque ERPNext Purchase Order docname (e.g. `LIM-PO-2026-00042`). */
    purchaseOrderId: text("purchase_order_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    accountExternalUq: uniqueIndex(
      "inbound_message_account_external_uq",
    ).on(t.channelAccountId, t.externalMessageId),
    receivedIdx: index("inbound_message_received_idx").on(t.receivedAt),
    vendorIdx: index("inbound_message_vendor_idx").on(t.vendorId),
    purchaseOrderIdx: index("inbound_message_purchase_order_idx").on(
      t.purchaseOrderId,
    ),
    classificationIdx: index("inbound_message_classification_idx").on(
      t.classification,
    ),
  }),
);

/**
 * Messaging-domain attachment (e.g. an inbound email attachment, a photo
 * uploaded via the manual channel). `message_id` is nullable + a
 * `message_direction` discriminator column lets B.2 (#13) attach the same
 * row shape to outbound messages.
 *
 * Dedupe semantics: rows are deduplicated by `sha256` globally within the
 * messaging service. If the same content hash arrives attached to a
 * different message, we reuse the existing storage_path and create a new
 * `attachment` row only when the message_id pairing differs (handled in
 * the route layer).
 */
export const attachment = messagingSchema.table(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id"),
    messageDirection: messageDirectionEnum("message_direction").notNull(),
    sha256: text("sha256").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Storage provider key (Supabase Storage object key, or local path). */
    storagePath: text("storage_path").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    sha256Idx: index("attachment_sha256_idx").on(t.sha256),
    messageDirIdx: index("attachment_message_dir_idx").on(
      t.messageDirection,
      t.messageId,
    ),
    /**
     * Unique on (message_id, sha256) so the same file attached twice to the
     * same message dedupes, but the same content can attach to different
     * messages.
     */
    messageContentUq: uniqueIndex("attachment_message_sha256_uq").on(
      t.messageId,
      t.sha256,
    ),
  }),
);

export type ChannelValue = (typeof channelEnum.enumValues)[number];
export type MessageDirectionValue =
  (typeof messageDirectionEnum.enumValues)[number];

export type ChannelAccountRow = typeof channelAccount.$inferSelect;
export type MessageThreadRow = typeof messageThread.$inferSelect;
export type InboundMessageRow = typeof inboundMessage.$inferSelect;
export type AttachmentRow = typeof attachment.$inferSelect;
