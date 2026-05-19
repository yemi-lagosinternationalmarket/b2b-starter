# AGENTS.md

Guidance for AI coding agents working in this repo. `CLAUDE.md` is a symlink to this file.

## Architecture in three sentences

LIM's commerce + procurement platform is a **service-oriented architecture across multiple runtimes**. **For MVP (Stage 1) per ADR 0023, the procurement system of record is Notion** — the existing `Vendor Profiles`, `Purchase Orders`, and `Purchase Order Events` databases. **Medusa** is scoped to commerce primitives (B2B Company/Employee/Quote/Approval + future wholesale storefront); **stealth** is the agent layer (Temporal worker + AI capabilities) that reads/writes Notion via the Notion API; **`apps/messaging`** is a multi-channel inbound/outbound communications peer service. **Stage 2 (per ADR 0018) swaps the procurement write target from Notion to ERPNext + `procureops`** once LIM has run on Notion-via-agent for 3+ months without major incident.

The first big call before reading anything else: **does the work touch procurement data (Vendor / PO / PO Event / Line Item / Bill / Document)? For MVP it lives in Notion.** Read **ADR 0023** (MVP shape) and **ADR 0018** (Stage 2 destination) before doing any architectural work.

## Repo at a glance

Turborepo monorepo. The `b2b-starter` repo holds the Medusa side + monorepo coordination. Peer services live in this repo or in adjacent repos:

| Path / repo | What it is | Runtime |
|---|---|---|
| `apps/backend` (this repo) | Medusa.js v2 — commerce primitives, B2B starter modules (Company, Employee, Quote, Approval), future wholesale storefront support | Node, Postgres, Redis |
| `apps/storefront` (this repo) | Next.js 15 storefront | Next.js |
| `apps/messaging` (this repo) | Fastify + Drizzle messaging service — channel-agnostic inbound/outbound (email/SMS/Slack/WhatsApp/voice/manual) | Node, Postgres `messaging` schema |
| `apps/procurement-agent` (this repo) | Temporal worker — stealth's AI capabilities, capability shape per ADR 0016. Procurement write target: **Notion API** for MVP; Frappe REST for Stage 2. | Node, Temporal Cloud |
| Notion workspace (MVP procurement SoR per ADR 0023) | Vendor Profiles DB (`collection://2ab90680-51d2-806c-bd84-000bc7f84a33`), Purchase Orders DB (`collection://5bccc26b-1992-4691-a7ed-11f3ecd8cff0`), Purchase Order Events DB (`collection://2c3fd6b3-b299-443c-a01c-b7677905eeb8`), Line Items / Bills / Documents | Notion API |
| `procureops` ([separate repo](https://github.com/yemi-lagosinternationalmarket/procureops)) — **Stage 2** | LIM-specific Frappe Custom App — Custom Fields + Custom DocTypes + whitelisted REST methods on top of ERPNext | Python (Frappe) |
| `catalog-health-worker` (separate repo) — **Stage 2** | Vercel Workflow DevKit — daily Toast catalog audit; pivots to audit Toast vs ERPNext Item drift | Vercel Workflows + Upstash |
| `stealth` (separate repo) | Archive reference for the prior Temporal+Drizzle+AI-Gateway design; not deployed; capability prompts/schemas/tools are being ported into `apps/procurement-agent` | — |

## Decisions of record (`docs/adr/`)

23 ADRs total. Read them when in doubt:

- **0001–0009** — imported from stealth: three coupled FSMs (Place/Receive/Pay), runtime stack, system-observes pattern, auto-fire with downstream gates, QBO retirement plan, seeded item catalog, workflow-driven agentic architecture, model selection matrix, pinned tone references
- **0010, 0012** — SUPERSEDED by 0018
- **0011** — external system integrations abstracted by `system` / `channel` enum (still active)
- **0013** — coexistence over takeover (agent reads state, never claims it)
- **0014** — platform-wide Activity + Attachment patterns (design intent carries forward as the Purchase Order Events DB for MVP; `LIM Activity` Custom DocType for Stage 2)
- **0015** — per-supplier `agent_authority` + global pause as the trust gradient (lives as `Vendor Profiles.Agent Authority` Select for MVP; Supplier Custom Field for Stage 2)
- **0016** — capability shape (prompt + Zod schema + read-only tools + Temporal activity wrapper) — unchanged across Stage 1/2
- **0017** — considered Conductor OSS; staying with Temporal
- **0018** — ERPNext as ERP system of record, Medusa scoped to commerce — **Stage 2 destination**
- **0019** — LIM Custom App licensing posture — Stage 2
- **0020** — Frappe Cloud as ERPNext hosting — Stage 2
- **0021** — Site-per-tenant SaaS multi-tenancy pattern — Stage 2 / SaaS
- **0022** — `tenant_id` from day zero in shared services (active now in `apps/messaging` + agent; hardcoded UUID for MVP)
- **0023** — **MVP pivot** — Notion as procurement system of record for Stage 1; ERPNext deferred to Stage 2

## Domain language

The canonical glossary lives at `apps/backend/CONTEXT.md`. Read it for: phase vocabulary (Place / Receive / Pay), Supplier vs Item vs Purchase Order semantics, agent-side terms (`agent_authority`, tone reference, global pause, placeholder, coexistence), flagged ambiguities. When this doc and the code disagree, fix the code.

The archived design spec at `docs/superpowers/specs/2026-05-11-...` is historical only — frozen snapshot of brainstorming output. Do not add to it. The ADRs + CONTEXT.md + GitHub Issues are the source of truth going forward.

## Working with each stack

### Medusa.js (commerce only)

Medusa now holds **B2B commerce primitives + storefront**, not procurement. When planning, researching, or implementing Medusa-side work, invoke the relevant medusa-dev skill BEFORE writing code:

- `medusa-dev:building-with-medusa` — backend modules, workflows, API routes, module links (REQUIRED for any Medusa backend work)
- `medusa-dev:building-admin-dashboard-customizations` — admin UI work
- `medusa-dev:building-storefronts` — storefront integration with the JS SDK
- `medusa-dev:db-generate` / `db-migrate` — migrations
- `medusa-dev:new-user` — admin users

For framework learning end-to-end: `learn-medusa:learning-medusa`. Fall back to the Medusa MCP server (`mcp__medusa__ask_medusa_question`) for specific method signatures after consulting the skill.

### Notion (MVP procurement system of record per ADR 0023)

Stealth reads/writes procurement state via the **Notion API**. Use the Notion MCP server (`mcp__claude_ai_Notion__*`) for schema inspection and ad-hoc data work; capability `activity.ts` files use the official Notion SDK (`@notionhq/client`) at runtime.

Three databases hold MVP procurement state:

| DB | ID | Purpose |
|---|---|---|
| Vendor Profiles | `collection://2ab90680-51d2-806c-bd84-000bc7f84a33` | Vendor master — includes `Agent Authority` (Select: `full_auto`/`draft_only`/`review_only`) and `Default PO Owner` (Person) for the agent |
| Purchase Orders | `collection://5bccc26b-1992-4691-a7ed-11f3ecd8cff0` | PO header — agent-drafted POs have `Drafted By Agent`=true and `Capability Version`=<version> |
| Purchase Order Events | `collection://2c3fd6b3-b299-443c-a01c-b7677905eeb8` | Append-only event log — 12 event types enumerated as multi-select; formulas on Purchase Orders compute state from these |

Writes are append-only on the Events DB; PO header updates are limited to property patches (`Owner`, `Status`, `Drafted By Agent`, `Capability Version`, etc.). Idempotency: tag each agent-appended Event row with a stable composite key derived from `{workflow_id}.{capability}.{attempt}`; check before append.

### ERPNext / Frappe (procurement, inventory, accounting, BOMs) — Stage 2

LIM-specific extensions live in the **`procureops` Custom App** in its own repo. Rules from ADR 0019:

- **Don't fork ERPNext.** Use hooks, Custom Fields, whitelisted REST methods.
- **Don't import private ERPNext modules** — use documented Frappe Framework primitives (`frappe.get_doc`, `frappe.db.get_value`, `@frappe.whitelist`, hooks).
- **Custom Fields go in Fixtures** (`procureops/procureops/fixtures/custom_field.json`) — versioned in git, portable across environments.
- **Custom DocTypes only when ERPNext has no native equivalent** (e.g., `LIM Activity` for cross-system audit log; `LIM Vendor Tag` if Supplier Group doesn't cover it).
- **Tests in pytest** under `procureops/tests/`. Use Frappe's test runner.

No first-class Frappe skill is installed yet. Lean on ERPNext docs (https://docs.erpnext.com), Frappe Framework docs (https://frappeframework.com), and adapt patterns from existing Custom Apps in the ERPNext ecosystem.

### Temporal + stealth (the agent layer)

The procurement-agent is a Temporal worker running capability-shaped activities (ADR 0016). Skills installed:

- **`temporal-developer`** — Temporal patterns across languages; deterministic workflow rules; activity patterns; testing with `@temporalio/testing`; versioning; non-determinism debugging. Triggers on Temporal-related work.
- **`temporal-cloud`** — connection / auth / config issues, x509/TLS, namespace mismatches, "no pollers", PrivateLink. Triggers on Temporal Cloud connectivity issues.
- **`temporal-docs` MCP server** (`mcp__temporal-docs__search_temporal_knowledge_sources`) — real-time access to Temporal docs + community forum + Slack archives. Anonymous Google auth via `/mcp`; run once per environment.

Capability shape (ADR 0016): one folder per capability under `apps/procurement-agent/src/agents/<name>/`:
- `prompt.ts` — system prompt + interpolation, exports `VERSION` constant
- `schema.ts` — Zod schema for structured output (the activity's return type)
- `tools.ts` — typed read-only tools (`searchSuppliers`, `queryRecentPOs`, etc.) — never write from inside tool calls
- `activity.ts` — Temporal activity wrapper: deterministic prep → LLM call via AI Gateway → schema validation → writes (Frappe REST / Medusa SDK / messaging API)
- `activity.test.ts` — Vitest with `@temporalio/testing`, fixture-driven, golden snapshots

Write paths target three systems:
- **Procurement state** → **Notion API** for MVP (create PO pages, append Purchase Order Events, patch Vendor Profiles); Frappe REST (`procureops.api.create_po_draft`) for Stage 2
- **Commerce state** → Medusa SDK (`sdk.admin.workflows.<name>.run`)
- **Messaging state** → `apps/messaging` HTTP API

### Messaging service

Channel-agnostic. Per ADR 0011, channels are an enum (`email` / `sms` / `whatsapp` / `slack` / `voice` / `manual` / `photo`), not separate modules. Drizzle ORM, own Postgres `messaging` schema. Stealth + Medusa admin widgets are consumers.

### Catalog-health-worker (Stage 2)

Deferred to Stage 2 alongside ERPNext per ADR 0023. Vercel Workflow DevKit service. Audits Toast Catalog (read-only) vs ERPNext Item (canonical) and surfaces drift as `LIM Activity` rows + Slack alerts. No auto-write to Toast — humans resolve via Toast's web UI or Bulk Import CSV.

## Issue tracker

GitHub Issues — use the `gh` CLI (with `--repo yemi-lagosinternationalmarket/b2b-starter` if it picks up the wrong target).

Canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent` (AFK), `ready-for-human` (HITL), `wontfix`. See `docs/agents/triage-labels.md`.

When closing a superseded or pivoted issue, leave a comment explaining the supersession + linking the new replacement issue (we did this on 2026-05-12 for the ERPNext pivot — see the closed issues for the pattern).

## Working agreement

- **CONTEXT.md is the glossary. ADRs are the decisions. Issues are the work.** Don't add to the archived spec at `docs/superpowers/specs/`.
- **Matt Pocock ADR format** (`~/.claude/skills/grill-with-docs/ADR-FORMAT.md`): 1-3 sentences for the decision; optional sections only when they add genuine value; sequential numbering.
- **Pre-commit**: run `pnpm build` + `pnpm typecheck` before pushing. CI runs `turbo typecheck test` with per-app path filters.
- **Don't commit `workflow_comparison.md`** (research artifact, deleted; ignore if it reappears).
- **For Temporal work**: invoke `temporal-developer` skill before writing workflows or activities.
- **For Medusa work**: invoke the relevant `medusa-dev` skill before writing modules, workflows, or API routes.
- **For procurement work (MVP)**: read ADR 0023. Write target is the Notion API. Use the Notion MCP for schema inspection; `@notionhq/client` at runtime.
- **For ERPNext work (Stage 2)**: read ADR 0019 first. Stay in the `procureops` repo. Use Fixtures, not patches. Not active until Stage 2 trigger.
- **Pivot communication**: when an architectural shift lands (like ADR 0018 or 0023), update CONTEXT.md, write/supersede ADRs, re-cut affected issues (close old + create new), update this file.

## Skills inventory (relevant to this repo)

- `temporal-developer`, `temporal-cloud`, `medusa-dev:*`, `learn-medusa:learning-medusa`
- `temporal-docs` MCP server (live Temporal docs)
- `mcp__medusa__ask_medusa_question` MCP (Medusa docs)
- General-purpose: `grill-with-docs`, `to-issues`, `triage` (Matt Pocock); brainstorming and writing-plans (superpowers — we now prefer Matt Pocock's pattern)
