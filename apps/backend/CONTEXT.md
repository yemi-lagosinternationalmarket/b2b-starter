# Backend — Domain Language

LIM's procurement and commerce platform. Vocabulary adopted from stealth's procurement glossary (Place / Receive / Pay) plus B2B commerce concepts from Medusa.

**Stage 1 (MVP) per ADR 0023:** **Notion is the procurement system of record** — `Vendor Profiles`, `Purchase Orders`, and `Purchase Order Events` databases. Stealth reads/writes via the Notion API. The semantic vocabulary below (Supplier, PO, agent_authority, etc.) is unchanged; only the surface where state lives changes.

**Stage 2 destination per ADR 0018:** ERPNext as ERP system of record (Supplier, Item, PO, Purchase Receipt, Purchase Invoice, Payment Entry, BOM). Migration is a write-target swap inside each capability's `activity.ts`; prompts, schemas, tools, Temporal orchestration unchanged.

**Medusa** is scoped to commerce — B2B storefront primitives (Company, Employee, Quote, Approval) and the future wholesale storefront. **Stealth (Temporal worker)** orchestrates AI-driven workflows. **`apps/messaging`** handles inbound/outbound communications.

When this document and code disagree, fix the code.

## Phases

- **Place** — agreeing on an order with a Supplier. MVP: `Purchase Orders` DB row with `Status=Open`, driven by `Purchase Order Events` (`Purchase Request Created` → `Purchase Request Sent` → `Quote Received` → `Purchase Order Created` → `Purchase Order Sent`). Stage 2: ERPNext `Purchase Order` (with optional `Request for Quotation` + `Supplier Quotation`).
- **Receive** — getting the goods. MVP: `Delivery Received` event on the PO. Stage 2: ERPNext `Purchase Receipt` (with multi-warehouse Stock Entry).
- **Pay** — settling the bill. MVP: `Invoice Received` → `Invoice Logged in QBO` events; bill lives in QBO. Stage 2: ERPNext `Purchase Invoice` → `Payment Entry`, posting to the GL.

## Language

### Procurement (MVP: Notion DBs; Stage 2: ERPNext)

**Supplier** *(MVP: Notion `Vendor Profiles` DB row; Stage 2: ERPNext `Supplier` DocType)*:
A supplier of goods to LIM. MVP properties relevant to the agent: `Vendor` (title), `Vendor Status`, `Agent Authority` (Select: `full_auto`/`draft_only`/`review_only`), `Default PO Owner` (Person), `Frequency`, `Follow-Up Level`, `Lead Time (days)`, `Order Minimum`, `Vendor Sends Truck`, `We Arrange Freight`, `Freight Fee`, `Pallet Fee`, `Terms`, `Preferred Payment Method`. Stage 2: same semantics as ERPNext Supplier Custom Fields per ADR 0018 (`agent_authority`, `default_po_owner`, `frequency`, `follow_up_level`, `default_lead_time_days`, `order_minimum_text`, `vendor_sends_truck`, `we_arrange_freight`, `freight_fee`, `pallet_fee`).
_Avoid_: vendor in code (use only as a colloquial synonym in conversation; in code, use `Supplier`). In Notion the property is literally `Vendor` — that's UI vocabulary; treat it as Supplier.

**Item** *(MVP: Notion `Catalog` DB relation on Vendor Profiles; Stage 2: ERPNext `Item`)*:
The canonical buy/sell item identity. MVP catalog lives in Notion as the `Catalog` relation off Vendor Profiles plus the `Line Items` DB rows on invoices. Stage 2: native ERPNext `Item` DocType with LIM Custom Fields (`storage_type`, `is_perishable`, `default_buy_unit`, `notes_for_agent`).

**Purchase Order** (PO) *(MVP: Notion `Purchase Orders` DB row; Stage 2: ERPNext `Purchase Order`)*:
The agreement to buy specific items from a Supplier. MVP identifying property: `Order ID` (auto-increment integer) + `Order Name` (title). Key agent-relevant properties: `Status` (Open/Closed/Cancelled), `Vendor` (relation), `Owner` (Person), `Items Requested` (raw text — the order request from a human), `Line Items` (relation, populated from the invoice when it arrives), `Drafted By Agent` (checkbox), `Capability Version` (text). Formula columns compute state from events: `Has PR Sent`, `Has PO Sent`, `Has Delivery Received`, `Has Invoice Received`, `Has Invoice Logged in QBO`, `Ready to Close`, `Latest Event`, `Latest Event Date`. Stage 2: same semantics as ERPNext Custom Fields (`agent_active`, `drafted_by_capability`, `placeholder_count`, `temporal_workflow_id`, `idempotency_key`).
_Avoid_: order (ambiguous with sales orders; prefer **PO**).

**Items Requested vs Line Items** *(MVP semantic distinction)*:
`Items Requested` is the **raw order request** — free-text from whoever opened the PO, before placement (e.g., "20 cases palm oil 5L, 10 bags long-grain rice"). `Line Items` come from the **actual invoice** received from the supplier, structured per-row with quantity and unit cost. The place-drafting capability reads `Items Requested`; the bill-parsing capability populates `Line Items`.

**Purchase Order Event** *(MVP: Notion `Purchase Order Events` DB row — the activity log)*:
An immutable record of something that happened on a PO. Append-only. Twelve `Event Type` values enumerated: `Order Opened`, `Purchase Request Created`, `Purchase Request Sent`, `Quote Received`, `Purchase Order Created`, `Purchase Order Sent`, `Followed Up With Vendor`, `Delivery Received`, `Invoice Received`, `Invoice Logged in QBO`, `Order Closed`, `Order Cancelled`. Carries `Event Date`, `Actor` (Person), `Order` (relation), optional `Related Document`, `Vendor` (relation), `Notes`. This IS the cross-system audit log for MVP — ADR 0014's Activity pattern, instantiated in Notion. Stage 2 destination: `LIM Activity` Custom DocType per ADR 0014.

**Purchase Receipt** *(Stage 2 — ERPNext native, Receive phase)*:
Record of goods physically arriving from a Supplier for a PO. MVP equivalent: `Delivery Received` event on the PO. Carries per-line received_qty, warehouse, batch/serial info (Stage 2 only).

**Purchase Invoice / Bill** *(MVP: Notion `Bills` DB; Stage 2: ERPNext `Purchase Invoice`)*:
Supplier's request for payment after delivery. MVP: `Bills` DB row linked to PO; the PDF lives in `Documents`. Logged in QBO for accounting (event: `Invoice Logged in QBO`). Stage 2: native ERPNext `Purchase Invoice` posts to the General Ledger on submit.

**Payment Entry** *(Stage 2 — ERPNext native, Pay phase)*:
The money sent to settle a Purchase Invoice. Posts to GL. MVP equivalent: QBO bill payment, with the `Invoice Logged in QBO` event marking it.

**BOM** (Bill of Materials) *(Stage 2 — ERPNext native)*:
For Seboye packaging — defines components and routing to produce a finished Item from raw inputs. Out of scope for MVP.

### Commerce (lives in Medusa)

**Customer / Company / Employee / Quote / Approval**:
B2B commerce primitives from the Medusa B2B starter. Unchanged from the original repo. Customer is the B2B business that places sales orders with LIM.

**Product / ProductVariant / ProductCategory / ProductTag / Image**:
Medusa Product mirrors a publishable subset of ERPNext `Item` for storefront display. One-way sync ERPNext → Medusa. The Medusa side handles consumer-facing concerns (descriptions, images, categories for browsing); ERPNext owns the canonical buying/inventory side.

### Platform infrastructure

**Activity** *(cross-system audit log)*:
An immutable record of something that happened — a state transition, an agent observation, a human action. MVP home: Notion `Purchase Order Events` DB for PO-scoped activity; messaging-scoped activity stays in `apps/messaging`. Stage 2 home: `LIM Activity` Custom DocType per ADR 0014, polymorphic by target entity.
_Avoid_: "event" alone in conversation about Frappe (collides with Frappe's event hooks); "log entry". In MVP Notion-context, the property is literally `Event` and event types are enumerated — that's fine.

**Message** *(in `apps/messaging`, not Medusa or ERPNext)*:
An inbound or outbound communication on any channel (email, SMS, WhatsApp, Slack, voice, manual, photo). Stored in the messaging service's own Drizzle schema; cross-system references via opaque text IDs.

**Attachment** *(in `apps/messaging` for messages; in ERPNext File for procurement artifacts)*:
Persistent file metadata. SHA256-deduped within each storage backend. Cross-references via opaque IDs.

### External systems

**Toast** *(POS — read-only from our side)*:
The Point-of-Sale system at the LIM store. LIM's ~1,810 retail items live in Toast's catalog; sales transactions happen here. Toast's public API is **read-only**; we mirror their catalog + orders into our reporting/audit surfaces but cannot write back. Catalog edits happen in Toast's web back-office or via Toast's Bulk Import CSV — by humans, not the agent. catalog-health-worker (Slice 4) audits drift between Toast Catalog and ERPNext Item and surfaces mismatches for human resolution.

**QBO** *(QuickBooks Online — current AP / GL system)*:
LIM's current ledger of record. Stays in place through MVP; the `Invoice Logged in QBO` event marks when a bill has been posted. Retires when ERPNext Accounts is in production (Stage 2 — per ADR 0005 amendment in ADR 0018).

**Notion** *(MVP procurement system of record per ADR 0023)*:
The procurement SoR for MVP. `Vendor Profiles`, `Purchase Orders`, `Purchase Order Events`, `Line Items`, `Bills`, `Invoices`, `Documents` DBs all live here. Stealth reads/writes via the Notion API. Stage 2: ERPNext takes over procurement state; Notion DBs become historical reference.

### Agent-side terms

**stealth**:
The procurement agent. Runs as a long-running Temporal worker (`apps/procurement-agent/`). Has a visible identity in admin event timelines and in the `#stealth` Slack channel. Versioned per-capability (`place-drafting@0.1.2`).

**Capability**:
A single LLM-using job in the agent — has its own prompt, structured output schema (Zod), optional read-only tools, and a Temporal activity wrapper. Per ADR 0016. One capability = one focused LLM call preceded by deterministic prep and followed by deterministic writes to ERPNext REST and/or Medusa SDK and/or messaging API.

**`agent_authority`**:
Per-supplier control over what stealth may commit autonomously. `full_auto` (commits without human approval; downstream gates still apply), `draft_only` (drafts but never sends or marks state without explicit human approval — **default for new and seeded suppliers**), `review_only` (observes and classifies only, doesn't draft). MVP home: `Vendor Profiles.Agent Authority` Select. Stage 2 home: Custom Field on ERPNext Supplier.

**`Default PO Owner`**:
Per-vendor Person property on Vendor Profiles. No default; configured per-vendor by whoever handles that vendor's relationship. Both Yemi and Grace are peers in the purchasing group — there's no hierarchical default. When the agent drafts a PO it copies `Default PO Owner` into `Purchase Orders.Owner`. If unset, the agent leaves Owner blank and surfaces it as a setup gap in Slack.

**`Drafted By Agent` / `Capability Version`**:
Per-PO properties marking that stealth created/touched the row. `Drafted By Agent` (checkbox) is true when any agent capability authored the PO. `Capability Version` (text) records the capability + version that did the last agent write (e.g., `place-drafting@0.1.2`). MVP home: Purchase Orders DB. Stage 2 home: `agent_active` and `drafted_by_capability` Custom Fields on ERPNext Purchase Order.

**Tone reference**:
A single curated past inbound message pinned per Supplier — opaque ref to the messaging service — used to calibrate the tone of agent-drafted outbound. Set by hand; never auto-updated. MVP home: stored alongside the Vendor Profiles row (Notion or, more likely, kept entirely in the messaging service indexed by `vendor_id`). Stage 2 home: `tone_reference_message_id` Custom Field on ERPNext Supplier.

**Global pause**:
A platform-wide flag (Redis-backed with TTL) suppressing all agent auto-fires. Per-supplier authority is checked first; if global pause is on, no auto-fire happens regardless of authority. Toggled via admin control or `/stealth pause Xm` Slack slash command.

**Placeholder**:
An unresolved field in an agent draft (`[NEEDS PRICE]`, `[NEW ITEM]`, `[STALE: $X, last seen DATE]`). Sending is gated until cleared.

**Coexistence**:
The pattern by which humans and the agent share authority without explicit take-over. Per ADR 0013. The agent re-reads state at every decision point. Workflows are idempotent. MVP: Notion change polling (or webhook beta if available) becomes Temporal signals. Stage 2: ERPNext webhooks become Temporal signals.

**LIM Custom App / `procureops`** *(Stage 2)*:
The git-versioned Frappe app that holds LIM-specific extensions of ERPNext — Custom Fields, Custom DocTypes (sparingly), hooks, whitelisted REST methods. Thin by design; heavy logic lives in stealth and peer services. Not active until Stage 2 trigger.

## Relationships

- A **Supplier** / **Vendor Profile** has many **Purchase Orders**.
- A **Purchase Order** has many **Line Items** (from the invoice) and one free-text **Items Requested** field (the original request).
- A **Purchase Order** has many **Purchase Order Events** (append-only audit trail).
- A **Purchase Order** has zero or many **Bills** (MVP) / **Purchase Invoices** (Stage 2).
- A **Purchase Order** has zero or many **Documents** (PDFs, attachments).
- A **Bill** has zero or many **Payment Entries** (Stage 2 — could be split).
- A **Product** (Medusa) mirrors one **Item** for items LIM publishes to its storefront.
- An **Activity** / **Purchase Order Event** targets one PO in MVP; in Stage 2 it becomes polymorphic across `purchase_order`, `supplier`, `item`, `message_thread`.

## Example dialogue

> **Dev**: "When stealth drafts a PO for Yusol, where does it live?"
> **Owner (MVP)**: "As a new row in the Notion `Purchase Orders` DB with `Drafted By Agent=true`, `Capability Version='place-drafting@x.y.z'`, `Owner` copied from Yusol's `Default PO Owner`, `Status=Open`, and `Items Requested` carrying the raw order text. Stealth also appends a `Purchase Order Created` row to `Purchase Order Events`. If Yusol's `Agent Authority='full_auto'` and no placeholders remain, stealth sends the outbound email via the messaging service and appends a `Purchase Order Sent` event. Otherwise it waits for human approval."
> **Owner (Stage 2)**: "Same flow, ERPNext as target — `Purchase Order` DocType, `LIM Activity` rows for events, whitelisted Frappe REST method authoring the writes."

> **Dev**: "And the storefront?"
> **Owner**: "When we launch the wholesale storefront, Medusa Products are managed in Medusa for MVP. In Stage 2, Medusa pulls a subset of ERPNext Items (the ones we publish) as Medusa Products. Sales orders go through Medusa with Company/Quote/Approval primitives; on submit (Stage 2) they create a corresponding Sales Order in ERPNext for inventory deduction and accounting."

## Flagged ambiguities

- **"Order"** — colloquially ("the Ilham order") refers to the **PO**. In writing, always say **PO** (purchase order) or **Sales Order** (customer order) explicitly. Never bare "order."
- **"Vendor"** — colloquial synonym for **Supplier**. In code and docs, use **Supplier** (ERPNext's term).
- **"Account"** — never used bare. Disambiguate: **Supplier** (the business), **ChannelAccount** (a registered messaging identity), **Account** (ERPNext's chart-of-accounts entry — GL).
- **"Event"** — domain people may say "event" meaning **Activity** (something that happened, recorded in the audit log). Don't confuse with Frappe Hooks (server-side event handlers) or Temporal signals.
- **"Item"** — ERPNext's canonical buy/sell unit. Don't confuse with Medusa's "ProductVariant" — the storefront mirror.
- **"Status"** — disambiguate which: **Vendor Status** (Notion: New/Qualifying/Active/On Hold/Discontinued/Blacklisted), **Purchase Order.Status** (Notion: Open/Closed/Cancelled — MVP; ERPNext `workflow_state` / `docstatus` — Stage 2), **Agent Authority** (Notion Vendor Profiles Select), our internal **Place/Receive/Pay phase** vocabulary.
- **"Cancelled"** — flavors: Place-phase **Cancelled** (we backed out before/during ordering — PO `docstatus=2`), Receive-phase **Vendor Cancelled** (supplier reneged — Purchase Receipt not created), Pay-phase **Written Off** (no settlement happened — Purchase Invoice cancelled / written off).
