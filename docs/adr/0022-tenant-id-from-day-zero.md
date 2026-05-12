# `tenant_id` baked into every cross-system table from day zero

Per ADR 0021, the SaaS multi-tenancy pattern is site-per-tenant for ERPNext data — but the **shared services** (messaging, procurement-agent, catalog-health-worker, BI) serve all tenants from single instances. They must scope every row by tenant. Adding a tenant column to a table after it's in production is a painful migration: data has to be backfilled, every query needs updating, indexes get rebuilt. Adding it from day zero is one extra column on every table.

**Decision.** Every cross-system table (messaging service, agent state, catalog-health audit records, anything outside ERPNext that holds per-tenant data) includes a **`tenant_id uuid NOT NULL`** column from day zero of its schema. In v0 / LIM-only, it's a single hardcoded UUID seeded as a config value (`MESSAGING_DEFAULT_TENANT_ID` env var or equivalent). In SaaS, it identifies the customer site this row belongs to. Indexes that include channel/entity/timestamp lead with `tenant_id` when it's a frequent filter dimension.

## Where this applies

- **`apps/messaging` Drizzle schema** — `channel_account`, `message_thread`, `inbound_message`, `outbound_message`, `attachment`, `channel_secret` — every table
- **`LIM Activity` Custom DocType** in `procureops` — yes, even though ERPNext data is site-isolated, the Activity log is the cross-system audit surface and gets read by the agent across tenants
- **Future agent state tables** — workflow idempotency keys, capability cost-tracking rows, retry counters
- **Future catalog-health audit records** — they reference both Toast credentials and ERPNext docnames, both of which are tenant-scoped

## Where this does NOT apply

- **ERPNext-side tables** (Supplier, Item, Purchase Order, etc.) — per ADR 0021, ERPNext data is site-isolated; the site IS the tenant boundary. Adding tenant_id to ERPNext DocTypes would be redundant + fights the framework.
- **Source code in `procureops` repo** — code is shared across tenants; tenant_id matters at runtime (in Activity log rows) but not in the codebase itself.
- **Stateless services' in-memory state** — temporary worker memory doesn't need it; only persisted rows do.

## Implementation rules

1. **Every consumer endpoint takes `tenant_id` from the auth context** — never trust a client-supplied tenant_id without auth verification. Per-tenant API keys (issued at onboarding) carry the tenant_id claim.
2. **Every list/read endpoint scopes by tenant_id** before returning results. Cross-tenant queries are forbidden at the application layer.
3. **Indexes lead with `tenant_id`** where it's a frequent filter (it almost always is).
4. **Cross-tenant single-resource reads return 404, not 403.** Returning 403 leaks the existence of resources owned by other tenants ("this ID exists, just not yours"); 404 doesn't. Same posture as GitHub for private repos.
5. **Unique constraints that should be tenant-scoped include tenant_id in the constraint.** E.g., content-addressed dedup like `attachment.sha256` is `UNIQUE(tenant_id, sha256)` — cross-tenant content sharing is a privacy issue regardless of intent.
6. **Tests cover the negative case**: an attempt to read another tenant's data returns 404 (single-resource) or zero rows (list).
7. **In v0**: the hardcoded LIM tenant_id is loaded from env. Code reads it once at startup. Every persistence call passes it.

## Consequences

- **Future SaaS migration is data-only**, not schema. The day we add Customer #2, we generate a new UUID, configure their integrations to write with that tenant_id, and the existing tables Just Work.
- **One extra column per table** — trivial schema overhead.
- **Every query is one extra WHERE clause** — trivial query overhead with the right index.
- **Tests must explicitly cover tenant isolation** — small but real test surface increase.
- **Cost attribution is natural** — AI Gateway / Langfuse / Temporal Cloud costs can be tagged by tenant_id and rolled up per customer for billing.
