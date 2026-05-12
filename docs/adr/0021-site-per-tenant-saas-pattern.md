# Site-per-tenant as the SaaS multi-tenancy pattern

When LIM productizes this platform (12-18 month horizon — confirmed by Yemi 2026-05-12), each customer gets their **own Frappe Cloud site** rather than sharing a single multi-tenant ERPNext instance. Customer A's GL, suppliers, items, POs live in their own Postgres, accessed at their own subdomain (e.g., `acme-grocer.frappe.cloud`). Customer B is fully isolated — different database, different backups, different config. The shared `procureops` Custom App is installed identically on every site, so app upgrades are uniform.

**Decision.** Adopt **site-per-tenant** when SaaS launches. Customer onboarding provisions a Frappe Cloud site via API, installs ERPNext + `procureops`, seeds initial config. Shared infrastructure (the messaging service, procurement-agent, catalog-health-worker, BI layer) is multi-tenant in the application layer and scopes per-tenant via `tenant_id` (per ADR 0022).

## Why site-per-tenant

- **Data isolation by construction.** A bug in our code can't accidentally show Customer A's supplier prices to Customer B — they live in different databases. Important for ERP data (financial GL, supplier contracts, customer pricing).
- **Independent backup/restore per tenant** — a customer asks for their data, we hand them their site export. GDPR-ish workflows just work.
- **Per-tenant compliance and audit posture** — each customer's GL is one database; an FDA inspector or auditor can be given read-only access to one site without leaking anything.
- **Independent ERPNext version per tenant** if needed — Customer A can stay on stable while Customer B opts into a beta. Frappe Cloud supports this natively.
- **Frappe Cloud handles the multi-tenancy.** We don't have to invent it; we use the platform's existing site-isolation model. Same pattern ERPNext.com itself uses.

## Why not single-site multi-company multi-tenancy

ERPNext does support multiple Companies in one site. We reject this for SaaS because:

- **Row-level permission fences are fragile.** A misconfigured Permission Rule could expose Customer A's data to Customer B's user. With site-per-tenant, this class of bug is impossible.
- **One customer's noisy-neighbor workload affects others.** Per-site = per-database = per-resource-pool.
- **Backup/restore is per-site only.** Restoring Customer A would also restore Customer B's data if they shared.

## Shared infrastructure (NOT per-tenant)

Single instances serving all tenants, with `tenant_id` scoping per ADR 0022:

- The `procureops` Custom App source code — one git repo, one versioned app, deployed identically to every tenant's site
- `apps/messaging` Fastify service — multi-tenant; every row scoped by `tenant_id`
- `apps/procurement-agent` Temporal worker — workflows tagged with `tenant_id`; per-tenant Frappe credentials loaded from a tenant-secrets table
- `catalog-health-worker` — multi-tenant per Toast restaurant + ERPNext site
- Temporal Cloud, AI Gateway, Langfuse — single accounts; per-tenant cost attribution via tags

## What changes to ship SaaS (12-18 mo)

- **Customer onboarding service** — programmatically provision a Frappe Cloud site via the Frappe Cloud API; install ERPNext + `procureops`; seed initial data; trigger their first integration auth flows (Gmail OAuth, Slack install)
- **Billing & metering** — Stripe + usage tracking (sites, AI Gateway $, message volume)
- **Customer console** — separate from raw ERPNext UI; covers signup, billing, integration auth, support handoff
- **Tenant-scoped admin tools for our team** — debugging across tenants without per-customer login
- **SLA + uptime monitoring per tenant**

## Consequences

- Per-tenant hosting costs (~$10-25/mo each via Frappe Cloud) are passed through to customers with margin
- LIM is Tenant #1 — testing the customer-onboarding flow on LIM itself happens before any external customer
- Custom App version compatibility across tenants matters — we can't deploy a breaking change to one customer's `procureops` without doing it to all (since it's the same repo). Versioned migration strategy needed when breaking changes are unavoidable.
- This decision interacts with ADR 0019 (licensing): if `procureops` becomes a sellable product, GPL v3 obligations on distribution activate.
