import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDb } from "../test-helpers/db.js";
import { InMemoryStorage } from "../test-helpers/storage.js";
import { withTenant } from "../test-helpers/tenant.js";
import {
  createInboundMessage,
  listInboundMessages,
} from "./inbound.js";
import type { MessagingDb } from "../db/index.js";
import type {
  CreateInboundMessageResponse,
  InboundMessageWithAttachmentsDto,
  ListInboundMessagesResponse,
} from "@b2b-starter/shared-types";

describe("inbound routes", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let storage: InMemoryStorage;
  let tenantRestore: () => void;

  beforeEach(async () => {
    // ADR 0022: every request needs a resolvable tenant_id. The test
    // harness mints a fresh UUID and points the env var at it; each test
    // gets its own tenant so cases can't leak into each other.
    ({ restore: tenantRestore } = withTenant());
    const t = await makeTestDb();
    close = t.close;
    storage = new InMemoryStorage();
    app = buildApp({ db: t.db, storage });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await close();
    tenantRestore();
  });

  describe("POST /v1/inbound (JSON)", () => {
    it("creates an inbound manual message and auto-creates a thread", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "+15551234567",
          to_identities: ["operator@lim"],
          body_plain: "Spoke to Yusol about pallet count",
          vendor_id: "Yusol Foods",
          purchase_order_id: "LIM-PO-2026-00042",
          metadata: { entered_by: "yemi" },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as CreateInboundMessageResponse;
      expect(body.data.channel).toBe("manual");
      expect(body.data.from_identity).toBe("+15551234567");
      expect(body.data.body_plain).toContain("pallet count");
      expect(body.data.vendor_id).toBe("Yusol Foods");
      expect(body.data.purchase_order_id).toBe("LIM-PO-2026-00042");
      expect(body.data.thread_id).not.toBeNull();
      expect(body.data.attachments).toEqual([]);
    });

    it("groups follow-up messages from the same identity into the same thread", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "yusol@example.com",
          to_identities: ["ops@lim"],
          body_plain: "first",
        },
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "yusol@example.com",
          to_identities: ["ops@lim"],
          body_plain: "second",
        },
      });
      const a = (first.json() as CreateInboundMessageResponse).data;
      const b = (second.json() as CreateInboundMessageResponse).data;
      expect(a.thread_id).toBeTruthy();
      expect(b.thread_id).toBe(a.thread_id);
    });

    it("rejects an unknown channel", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: { channel: "telepathy", from_identity: "x", to_identities: [], body_plain: "" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects email channel with 501 because no adapter is wired in B.1", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "email",
          from_identity: "a@b.com",
          to_identities: ["c@d.com"],
          body_plain: "hi",
        },
      });
      expect(res.statusCode).toBe(501);
    });

    it("accepts arbitrary opaque vendor_id strings up to the soft limit", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "x",
          to_identities: [],
          body_plain: "y",
          vendor_id: "Some Vendor With Spaces & Symbols ! ñ",
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe("POST /v1/inbound (multipart with attachments)", () => {
    it("accepts a multipart upload with file parts and stores attachments", async () => {
      const boundary = "----testboundary123";
      const fileBytes = Buffer.from("fake-photo-bytes-of-the-receipt");
      const payload = JSON.stringify({
        channel: "manual",
        from_identity: "warehouse-floor",
        to_identities: ["ops@lim"],
        body_plain: "Photo of pallet damage on PO LIM-PO-2026-00042",
        purchase_order_id: "LIM-PO-2026-00042",
      });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from('Content-Disposition: form-data; name="payload"\r\n\r\n'),
        Buffer.from(payload + "\r\n"),
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(
          'Content-Disposition: form-data; name="files"; filename="damage.jpg"\r\n',
        ),
        Buffer.from("Content-Type: image/jpeg\r\n\r\n"),
        fileBytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      const data = (res.json() as CreateInboundMessageResponse).data;
      expect(data.attachments).toHaveLength(1);
      expect(data.attachments[0]!.original_name).toBe("damage.jpg");
      expect(data.attachments[0]!.mime_type).toBe("image/jpeg");
      expect(data.attachments[0]!.size_bytes).toBe(fileBytes.byteLength);
      expect(data.attachments[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      // storage actually got the bytes
      expect(storage.objects.size).toBe(1);
    });

    it("rejects multipart without a payload field", async () => {
      const boundary = "----nopayload";
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(
          'Content-Disposition: form-data; name="files"; filename="x.txt"\r\n',
        ),
        Buffer.from("Content-Type: text/plain\r\n\r\n"),
        Buffer.from("hello"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.byteLength),
        },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inbound", () => {
    it("lists messages newest-first with cursor pagination", async () => {
      // Seed three messages
      for (let i = 0; i < 3; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/v1/inbound",
          payload: {
            channel: "manual",
            from_identity: `sender-${i}`,
            to_identities: [],
            body_plain: `msg-${i}`,
            received_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
          },
        });
        expect(r.statusCode).toBe(201);
      }

      const page1 = await app.inject({
        method: "GET",
        url: "/v1/inbound?limit=2",
      });
      expect(page1.statusCode).toBe(200);
      const p1 = page1.json() as ListInboundMessagesResponse;
      expect(p1.data).toHaveLength(2);
      // Newest-first: msg-2, msg-1
      expect(p1.data[0]!.body_plain).toBe("msg-2");
      expect(p1.data[1]!.body_plain).toBe("msg-1");
      expect(p1.next_cursor).toBeTruthy();

      const page2 = await app.inject({
        method: "GET",
        url: `/v1/inbound?limit=2&cursor=${encodeURIComponent(p1.next_cursor!)}`,
      });
      const p2 = page2.json() as ListInboundMessagesResponse;
      expect(p2.data).toHaveLength(1);
      expect(p2.data[0]!.body_plain).toBe("msg-0");
      expect(p2.next_cursor).toBeNull();
    });

    it("filters by vendor_id and classification", async () => {
      await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "a",
          to_identities: [],
          body_plain: "for yusol",
          vendor_id: "Yusol Foods",
          classification: "po_followup",
        },
      });
      await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "b",
          to_identities: [],
          body_plain: "for someone else",
          vendor_id: "Someone Else",
        },
      });

      const r = await app.inject({
        method: "GET",
        url: "/v1/inbound?vendor_id=Yusol%20Foods",
      });
      const body = r.json() as ListInboundMessagesResponse;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.vendor_id).toBe("Yusol Foods");

      const r2 = await app.inject({
        method: "GET",
        url: "/v1/inbound?classification=po_followup",
      });
      const body2 = r2.json() as ListInboundMessagesResponse;
      expect(body2.data).toHaveLength(1);
      expect(body2.data[0]!.classification).toBe("po_followup");
    });

    it("filters by received_after / received_before", async () => {
      const ts = (d: number) => new Date(Date.UTC(2026, 4, d)).toISOString();
      for (const day of [10, 11, 12]) {
        await app.inject({
          method: "POST",
          url: "/v1/inbound",
          payload: {
            channel: "manual",
            from_identity: `s-${day}`,
            to_identities: [],
            body_plain: `d-${day}`,
            received_at: ts(day),
          },
        });
      }
      const r = await app.inject({
        method: "GET",
        url: `/v1/inbound?received_after=${encodeURIComponent(ts(11))}&received_before=${encodeURIComponent(ts(11))}`,
      });
      const body = r.json() as ListInboundMessagesResponse;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.body_plain).toBe("d-11");
    });
  });

  describe("GET /v1/inbound/:id", () => {
    it("returns the full message with attachments", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "x",
          to_identities: ["y"],
          body_plain: "hi",
        },
      });
      const id = (created.json() as CreateInboundMessageResponse).data.id;

      const got = await app.inject({ method: "GET", url: `/v1/inbound/${id}` });
      expect(got.statusCode).toBe(200);
      const body = got.json() as { data: InboundMessageWithAttachmentsDto };
      expect(body.data.id).toBe(id);
      expect(body.data.attachments).toEqual([]);
    });

    it("returns 404 for an unknown id", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/inbound/00000000-0000-0000-0000-000000000000",
      });
      expect(r.statusCode).toBe(404);
    });
  });

  /* ------------------------------------------------------------------ */
  /* ADR 0022 — tenant_id isolation                                      */
  /* ------------------------------------------------------------------ */

  describe("tenant_id isolation (ADR 0022)", () => {
    it("stamps tenant_id on the response and the underlying row", async () => {
      // We can't read `tenantId` from the outer scope's withTenant call
      // directly without exposing it; instead grab the env var (the route
      // resolves through the same path).
      const expected = process.env.MESSAGING_DEFAULT_TENANT_ID;
      const res = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "tenant-stamp",
          to_identities: [],
          body_plain: "x",
        },
      });
      const data = (res.json() as CreateInboundMessageResponse).data;
      expect(data.tenant_id).toBe(expected);
    });

    it("returns 0 rows when querying as a different tenant (cross-tenant isolation)", async () => {
      // Seed two messages under the current (tenant A) env tenant.
      for (const id of ["a-1", "a-2"]) {
        const r = await app.inject({
          method: "POST",
          url: "/v1/inbound",
          payload: {
            channel: "manual",
            from_identity: id,
            to_identities: [],
            body_plain: "a-msg",
          },
        });
        expect(r.statusCode).toBe(201);
      }

      // Swap to tenant B and list — must see 0 rows.
      const switched = withTenant();
      try {
        const r = await app.inject({ method: "GET", url: "/v1/inbound" });
        expect(r.statusCode).toBe(200);
        const body = r.json() as ListInboundMessagesResponse;
        expect(body.data).toHaveLength(0);
        expect(body.next_cursor).toBeNull();
      } finally {
        switched.restore();
      }
    });

    it("returns 404 on GET /:id when the message belongs to a different tenant", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/inbound",
        payload: {
          channel: "manual",
          from_identity: "owner-a",
          to_identities: [],
          body_plain: "secret",
        },
      });
      const id = (created.json() as CreateInboundMessageResponse).data.id;

      const switched = withTenant();
      try {
        const r = await app.inject({ method: "GET", url: `/v1/inbound/${id}` });
        // 404 — not 403 — because we don't want to leak existence to
        // other tenants. Same response shape as a genuinely missing row.
        expect(r.statusCode).toBe(404);
      } finally {
        switched.restore();
      }
    });

    it("filter required: listInboundMessages throws when called without a tenant_id", async () => {
      // Calling the operation directly with an empty tenant_id (e.g. a
      // future route that forgets to plumb the resolver) must throw, not
      // silently return cross-tenant data.
      // Pull the underlying db from the app's testing setup by spinning a
      // standalone instance — but the cleanest way to assert is to drive
      // the function directly. The harness exposes the db it built.
      const t = await makeTestDb();
      try {
        await expect(
          listInboundMessages(t.db as MessagingDb, "", {}),
        ).rejects.toThrow(/tenant_id is required/);
      } finally {
        await t.close();
      }
    });

    it("create + list isolation: messages inserted under tenant A never appear under tenant B", async () => {
      // Direct operation call (bypassing the HTTP layer) to exercise the
      // function-signature tenant guard. Same DB, two tenants, distinct
      // row sets.
      const t = await makeTestDb();
      try {
        const tenantA = "11111111-1111-4111-8111-111111111111";
        const tenantB = "22222222-2222-4222-8222-222222222222";
        const stor = new InMemoryStorage();

        await createInboundMessage(
          t.db as MessagingDb,
          stor,
          tenantA,
          {
            channel: "manual",
            from_identity: "a-only",
            to_identities: [],
            body_plain: "for A",
          },
          [],
        );

        const aList = await listInboundMessages(
          t.db as MessagingDb,
          tenantA,
          {},
        );
        const bList = await listInboundMessages(
          t.db as MessagingDb,
          tenantB,
          {},
        );

        expect(aList.data).toHaveLength(1);
        expect(aList.data[0]!.tenant_id).toBe(tenantA);
        expect(bList.data).toHaveLength(0);
      } finally {
        await t.close();
      }
    });
  });
});
