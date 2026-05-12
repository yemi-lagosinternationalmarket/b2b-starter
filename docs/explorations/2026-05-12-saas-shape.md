# SaaS shape (exploration — for the 12-18 month horizon)

**Status:** Exploration accompanying ADRs 0020, 0021, 0022. Not a slice. Not actionable yet.
**Trigger to revisit:** When at least one of: (a) LIM is fully operational on the platform (Slices 1-4 shipped), (b) 2-3 paying-customer conversations validate willingness, (c) FSVP exploration becomes ready for productization. Yemi indicated 12-18 month horizon 2026-05-12.

## What "the SaaS" looks like

A multi-tenant platform serving diaspora grocers (African / Caribbean focus initially per the FSVP exploration), each on their own isolated ERPNext site plus shared agent / messaging / catalog-health services.

Per tenant:
- Their own Frappe Cloud site (`acme.frappe.cloud` or custom domain)
- Their own Supplier / Item / PO / GL / Inventory data
- The shared `procureops` Custom App installed on their site
- Their own integration auth: Gmail OAuth, Slack workspace, Toast restaurant credentials, QBO migration (or replaced by ERPNext Accounts)
- Per-tenant LIM Activity log entries (filtered by `tenant_id` per ADR 0022)

Shared infrastructure (one instance, multi-tenant via tenant_id):
- `apps/messaging` — inbound/outbound across channels for all tenants
- `apps/procurement-agent` — Temporal workers serving all tenants
- `catalog-health-worker` — daily audit per tenant's Toast + ERPNext
- BI / observability layer
- AI Gateway + Langfuse + Temporal Cloud accounts (cost-tagged per tenant)

## How LIM becomes Tenant #1

LIM is the canary tenant. By the time SaaS opens to customer #2, LIM has been running on this platform for months and we've learned every operational sharp edge.

Steps from "LIM-only" to "SaaS-ready":
1. **Slice 1-4 ship** — LIM operates entirely on the platform
2. **Customer-onboarding service built** — programmatic Frappe Cloud site provisioning, ERPNext + `procureops` install, integration auth wizards
3. **Billing + metering** — Stripe integration, usage-based pricing model
4. **Customer console** — signup, plan management, integration auth, support
5. **Per-tenant admin tools** — internal team can debug tenant issues without per-customer login
6. **SLA + uptime + status page**
7. **First external customer onboarded** — likely a diaspora grocer Yemi knows personally; the validating tenant before broader launch
8. **GTM** — landing page, demos, content (food-safety + FSVP angle per the FSVP exploration)

## Pricing model sketch (early guess)

| Tier | Monthly | What's included |
|---|---|---|
| **Starter** | $99-149 | Small grocer; up to N suppliers / month; basic agent capabilities; community support |
| **Growth** | $299-499 | Mid-sized; more capabilities; priority support; bring-your-own-Slack |
| **FSVP-Compliance** | $599-999 | Adds FSVP module per the FSVP exploration; templates, verification activities, audit-readiness |
| **Custom / Enterprise** | $$$ | Bespoke onboarding, dedicated support, custom integrations |

Pass-through costs (Frappe Cloud per-site, AI Gateway usage) priced in with margin. Most diaspora grocers in our target segment have $1M-$20M revenue; $99-999/mo is comfortably within software budget.

## What we'd build between v0 and v1 SaaS

Roughly mapped to future slices (numbering hypothetical until we get there):

| Slice | What |
|---|---|
| Slice 5 (Wholesale storefront) | Medusa-side: B2B online ordering for wholesale customers buying from LIM. ERPNext Item → Medusa Product sync. |
| Slice 6 (FSVP module) | Per the FSVP exploration; adds Foreign Supplier Profile, Hazard Analysis, FSVP Plan, Verification Activity DocTypes + agent capabilities. The compliance wedge. |
| Slice 7 (SaaS foundation) | Tenant model in the customer console; first external customer onboarding flow; Frappe Cloud site provisioning automation. |
| Slice 8 (Billing) | Stripe + metering + invoicing. |
| Slice 9 (Customer console) | Signup, plan, integration auth, support handoff. |
| Slice 10 (GTM + first customer) | Landing page, demo data, first paid customer onboarded. |

These are not committed; just the shape.

## Where the architecture serves SaaS cleanly

Per the existing ADRs:
- **ADR 0011** — external integrations abstracted by enum → new channels / POS / accounting integrations don't require schema changes; SaaS customers get them all
- **ADR 0014** — polymorphic activity log → already tenant-friendly with the addition of tenant_id per ADR 0022
- **ADR 0016** — capability shape (prompts + schemas + tools + Temporal activity) → activities take tenant context via input; same capability serves all tenants
- **ADR 0019** — Custom App pattern → one shared codebase, installed identically per tenant
- **ADR 0021** — site-per-tenant for ERPNext data isolation
- **ADR 0022** — tenant_id from day zero in shared services

The platform we're building IS the SaaS substrate. No mid-stream re-architecture needed.

## Where we still have gaps for SaaS

- **Customer onboarding flow** — programmatic Frappe Cloud site provisioning is doable via Frappe Cloud's API but we haven't built it
- **Per-tenant secrets** — encrypted storage of each tenant's Gmail OAuth / Slack tokens / Toast credentials / Frappe API keys; pattern is established in messaging service but needs extension
- **Per-tenant cost tracking** — AI Gateway and Langfuse support tags; we haven't wired tag emission per tenant yet
- **Multi-tenant Temporal workflow routing** — workflows take tenant_id as input; need to verify Temporal namespace strategy (one namespace + tenant_id tags, vs namespace per tenant)
- **GDPR / data export / deletion** — per-tenant data export endpoints + deletion workflows
- **Audit / compliance for the SaaS itself** — SOC 2 considerations for handling customer financial data

## Caveats

- **Operational maturity required.** Don't open SaaS to a paying customer until LIM has run on the platform for 3+ months without incident. Operational confidence is earned.
- **Food-safety adjacency (per FSVP exploration)** — careful ToS; tool not legal advice; food safety consultant for templates.
- **Frappe Cloud lock-in.** ADR 0020 commits us to Frappe Cloud. Migration to self-hosted is possible but real (data export + new bench setup). Acceptable at our scale; revisit at 50+ tenants.
- **Pricing model is a guess.** Validate with 2-3 paying-customer conversations before locking it in.

## When to revisit each piece

| Topic | Trigger to revisit |
|---|---|
| Whole SaaS plan | LIM Slices 1-4 shipped + 3+ months of operational confidence |
| Customer-onboarding service | When the 2nd tenant (LIM + one) is going to land |
| Pricing model | 2-3 conversations with target customers |
| Frappe Cloud commitment (ADR 0020) | 50+ tenants — economics of self-hosted start to matter |
| Multi-company multi-tenancy (rejected in ADR 0021) | A customer requires shared inventory across sub-businesses; revisit then, not before |
| FSVP module commercial rollout | Per FSVP exploration's revisit triggers |
