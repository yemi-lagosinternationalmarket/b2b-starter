CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE TYPE "messaging"."channel" AS ENUM('email', 'sms', 'whatsapp', 'slack', 'voice', 'manual', 'photo');--> statement-breakpoint
CREATE TYPE "messaging"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging"."attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid,
	"message_direction" "messaging"."message_direction" NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging"."channel_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "messaging"."channel" NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"channel_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_ref" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging"."inbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"thread_id" uuid,
	"external_message_id" text NOT NULL,
	"from_identity" text NOT NULL,
	"to_identities" text[] DEFAULT '{}' NOT NULL,
	"subject" text,
	"body_plain" text NOT NULL,
	"body_html" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"classification" text,
	"classified_at" timestamp with time zone,
	"vendor_id" text,
	"purchase_order_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging"."message_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "messaging"."channel" NOT NULL,
	"external_thread_id" text NOT NULL,
	"vendor_id" text,
	"first_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging"."inbound_message" ADD CONSTRAINT "inbound_message_channel_account_id_channel_account_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "messaging"."channel_account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging"."inbound_message" ADD CONSTRAINT "inbound_message_thread_id_message_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "messaging"."message_thread"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_tenant_sha256_idx" ON "messaging"."attachment" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_tenant_dir_message_idx" ON "messaging"."attachment" USING btree ("tenant_id","message_direction","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_tenant_message_sha256_uq" ON "messaging"."attachment" USING btree ("tenant_id","message_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_account_tenant_channel_address_uq" ON "messaging"."channel_account" USING btree ("tenant_id","channel","address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_message_tenant_account_external_uq" ON "messaging"."inbound_message" USING btree ("tenant_id","channel_account_id","external_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_received_idx" ON "messaging"."inbound_message" USING btree ("tenant_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_vendor_received_idx" ON "messaging"."inbound_message" USING btree ("tenant_id","vendor_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_purchase_order_received_idx" ON "messaging"."inbound_message" USING btree ("tenant_id","purchase_order_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_classification_idx" ON "messaging"."inbound_message" USING btree ("tenant_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_thread_tenant_channel_external_uq" ON "messaging"."message_thread" USING btree ("tenant_id","channel","external_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_thread_tenant_vendor_idx" ON "messaging"."message_thread" USING btree ("tenant_id","vendor_id");