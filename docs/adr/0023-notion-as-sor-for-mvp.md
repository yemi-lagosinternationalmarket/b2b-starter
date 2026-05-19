# Notion as the MVP system of record; ERPNext deferred to Stage 2

LIM's procurement state already lives in Notion (Purchase Orders DB, Purchase Order Events DB, Vendor Profiles DB, plus Line Items / Bills / Documents). Standing up ERPNext + the `procureops` Custom App + Item/Supplier seeding + workflow config in parallel with building the agent is real work that doesn't change the agent's shape — every capability is "read state → LLM call → write state" regardless of where state lives. ADR 0018's pivot to ERPNext stands as the **Stage 2** target; for **Stage 1 (MVP)** the agent reads from and writes to Notion via the official Notion API.

**Decision.** Build the procurement agent against **Notion as the system of record** for MVP. Stealth's write paths target the Notion API (create PO pages, append Purchase Order Event rows, update vendor properties). ERPNext + `procureops` remain the Stage 2 destination; the migration is a write-target swap inside each capability's `activity.ts`, not a redesign. Capability shape (ADR 0016), coexistence (0013), `agent_authority` (0015), tone references (0009), and the messaging service (0011) are unchanged.

## Why Notion-first for MVP

- **State already lives there.** No data seeding, no schema bootstrap. Vendor Profiles, Purchase Orders, Order Events DBs already capture the operational shape Yemi and Grace use day-to-day.
- **Faster feedback loop on the agent itself.** The risky / novel work is the capability prompts + schemas + Temporal orchestration + Slack surface — not the ERP. We shorten time-to-first-drafted-PO by months.
- **Humans keep their existing UI.** Yemi and Grace stay in Notion; the agent is felt-not-heard alongside them. No "we moved your data to a new system" change-management drag.
- **Event-sourced shape already exists.** The Purchase Order Events DB (12 event types: `Purchase Request Created`, `Purchase Order Sent`, `Delivery Received`, `Invoice Logged in QBO`, etc.) IS the activity log. Stealth appends rows there; the formula columns (`Has PR Sent`, `Has Invoice Received`, `Ready to Close`, `Latest Event`) compute state from events — exactly the pattern ADR 0003 (system-observes) and ADR 0014 (Activity log) anticipated.
- **Stage 2 migration is a write-target swap.** Each capability's deterministic-writes step changes target API (Notion API → Frappe REST). Prompts, schemas, tools, Temporal orchestration, and the messaging/Slack layer don't change.

## What this changes vs ADR 0018

- **Procurement state → Notion API**, not Frappe REST. For MVP only.
- **Vendor Profiles DB** holds the `Agent Authority` and `Default PO Owner` properties (added per this ADR) instead of those being ERPNext Supplier Custom Fields. Same semantics; different surface.
- **Purchase Orders DB** holds `Drafted By Agent` (checkbox) and `Capability Version` (text) properties instead of those being Custom Fields on ERPNext Purchase Order.
- **Activity log = Purchase Order Events DB.** No separate `LIM Activity` Custom DocType in MVP. Event types are already enumerated as a multi-select.
- **catalog-health-worker (Slice 4) is deferred** alongside ERPNext — Toast-vs-ERPNext drift isn't meaningful while ERPNext isn't the catalog source of truth.

## What does NOT change

- **Capability shape** (ADR 0016) — prompt + Zod schema + read-only tools + Temporal activity wrapper. Identical.
- **Coexistence** (ADR 0013) — agent re-reads Notion state at every decision point; workflows are idempotent; Notion webhooks (or polling for MVP) become Temporal signals.
- **`agent_authority` semantics** (ADR 0015) — `full_auto` / `draft_only` / `review_only`, default `draft_only`. Lives as a Vendor Profiles Select property.
- **Three coupled FSMs** (ADR 0001) — Place / Receive / Pay. Place is driven by Purchase Order `Status` (`Open` / `Closed` / `Cancelled`) plus the formula gates (`Has PR Sent`, `Has PO Sent`).
- **Messaging service** (`apps/messaging`) — unchanged; channel-agnostic per ADR 0011.
- **AI Gateway + Langfuse + Temporal Cloud + Vercel + Fly.io** — unchanged.
- **Tone references** (ADR 0009) — opaque message IDs; still set per vendor.

## Notion ↔ Stage 2 mapping (forward compatibility)

| Notion (MVP) | ERPNext / `procureops` (Stage 2) |
|---|---|
| `Vendor Profiles` DB | ERPNext `Supplier` |
| `Vendor Profiles.Agent Authority` | Supplier Custom Field `agent_authority` |
| `Vendor Profiles.Default PO Owner` | Supplier Custom Field `default_po_owner` (link to ERPNext User) |
| `Purchase Orders` DB | ERPNext `Purchase Order` |
| `Purchase Orders.Drafted By Agent` | PO Custom Field `agent_active` (checkbox) |
| `Purchase Orders.Capability Version` | PO Custom Field `drafted_by_capability` (data) |
| `Purchase Orders.Owner` (Person) | PO Custom Field `default_po_owner` resolved at draft time |
| `Purchase Order Events` DB | `LIM Activity` Custom DocType |
| `Bills` / `Invoices` DBs | ERPNext `Purchase Invoice` |
| `Line Items` DB | PO line items table |
| `Documents` DB | ERPNext `File` attached to PO |

Stage 2 trigger: LIM operates on Notion-via-agent for 3+ months without major incident; SaaS direction (ADR 0021) becomes near-term; ERPNext + `procureops` are stood up; per capability, write target swaps.

## Owner of a PO

`Default PO Owner` on Vendor Profiles is a per-vendor Person property. No default; configured per-vendor by whoever handles that vendor's relationship. Both Yemi and Grace are peers in the purchasing group — there's no hierarchical default. When the agent drafts a PO it copies `Default PO Owner` into `Purchase Orders.Owner`. If unset, the agent leaves Owner blank and surfaces it as a setup gap in Slack.

## Consequences

- **MVP unblocked from ERPNext provisioning.** Issues #31-#35, #37 (ERPNext-side A-plan work) close and reopen at Stage 2.
- **No Frappe Cloud dependency for MVP.** ADR 0020 (Frappe Cloud hosting) still stands as the Stage 2 hosting commitment.
- **catalog-health-worker (Slice 4) deferred to Stage 2** for the same reason.
- **Notion API rate-limits, schema drift, and webhook reliability become a known constraint.** Acceptable at LIM-only scale. Mitigations: idempotency keys per capability call (Temporal); event-append-only writes; polling fallback if webhooks lag.
- **Capability `activity.ts` files target Notion API for MVP.** Each one is structured so swapping the write target later is mechanical: deterministic prep, LLM call, schema validation, writes — only the last step changes.
- **CONTEXT.md and AGENTS.md updated** to reflect Notion-as-SOR for MVP and Stage 2 as the ERPNext destination.

## Open questions deferred to implementation

- **Notion API write idempotency** — Notion doesn't have native idempotency keys. We tag each agent-appended Event row with a stable composite key (`{workflow_id}.{capability}.{attempt_marker}`) in a hidden text property; capability activity checks for an existing row before appending.
- **Notion change notification** — webhook beta vs polling cadence. Polling at 30-60s intervals is fine for MVP given LIM volume; revisit if latency becomes a constraint.
- **Tenant_id in MVP** — Notion is single-tenant by workspace; `tenant_id` (per ADR 0022) is still baked into `apps/messaging` and `apps/procurement-agent` tables, hardcoded to a single seed UUID. Stage 2 / SaaS doesn't change.
