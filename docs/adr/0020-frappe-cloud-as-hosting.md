# Frappe Cloud as hosting for ERPNext

Per ADR 0018, ERPNext is the system of record. We evaluated hosting paths: **Frappe Cloud managed** (~$10-25/mo Site Plan, ~$20/mo Server Plan), **self-hosted bench on Fly.io / Railway** (server + Postgres + Redis + worker management ourselves), or **Frappe Cloud Private/Enterprise** (premium-managed, custom pricing). Self-hosting Frappe is operationally non-trivial — multi-service, separate worker fleets, backup/restore plumbing, version upgrades — and Frappe Cloud handles all of that for a small monthly fee at LIM's scale.

**Decision.** Host ERPNext on **Frappe Cloud Site Plan (AWS region, $10/mo starter)** via the 14-day free trial, sized to upgrade to $25/mo when storage approaches limits (~9-12 months in). Production site: `https://lagosinternationalmarket.v.frappe.cloud/`. The `procureops` Custom App is added via Frappe Cloud's "Bring your own app" flow pointing at the GitHub repo.

## Why not self-host

- Frappe bench is a multi-service Python+Redis+Postgres setup that needs production care (zero-downtime upgrades, backups with verified restore, supervisord/systemd management, log aggregation). LIM is solo-dev; ops cycles cost capability.
- Frappe Cloud handles version upgrades safely; staying current on ERPNext security patches matters when GL/AP data lives there.
- The cost difference ($10-25/mo vs ~$5/mo bare VPS) is dwarfed by the operational labor difference.

## When to reconsider

- LIM-as-SaaS reaches enough tenants that per-site hosting cost compounds (~50+ tenants is when self-hosting starts to look cost-effective at scale)
- Frappe Cloud pricing changes materially
- Compliance requirement forces self-hosted (rare; not in scope for diaspora-grocer use cases)

## Consequences

- Operational responsibility for ERPNext upgrades + backups + security patches sits with Frappe Cloud, not us.
- Custom App deployment goes through GitHub-pull (public repo required, or paid private-app feature). `procureops` is currently public (per ADR 0019).
- For staging / preview environments later, we'd create additional Frappe Cloud sites (e.g., `lim-staging.frappe.cloud`) on the same account — site plans are per-site.
- Customer sites in the SaaS direction (per ADR 0021) are also Frappe Cloud sites, programmatically provisioned via Frappe Cloud's API at customer-onboarding time.
