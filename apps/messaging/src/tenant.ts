/**
 * Tenant resolution for the messaging service.
 *
 * Per ADR 0022 (forthcoming) / issue #7 SaaS-readiness amendment, every
 * messaging table carries `tenant_id uuid NOT NULL`. In v0 (LIM-only)
 * the tenant is a single hardcoded UUID sourced from the
 * `MESSAGING_DEFAULT_TENANT_ID` env var. In SaaS mode (12-18mo, B.3+
 * onwards), this accessor will be swapped to read the tenant from the
 * authenticated request — that's why it's a single function: one place
 * to change.
 *
 * Resolution is lazy, mirroring `db/client.ts` — the env var is read on
 * first use so that `/health` keeps responding when the service boots
 * unconfigured (B.0's pattern).
 *
 * Validation: a basic UUID regex check. We don't pull in a runtime UUID
 * lib; a malformed default tenant should fail loudly at first request,
 * not silently produce broken inserts.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let _cachedDefault: string | undefined;

/**
 * Resolve the tenant_id for the current request. For B.1 this returns the
 * single `MESSAGING_DEFAULT_TENANT_ID` env value. B.3 will replace this
 * with auth-header extraction.
 *
 * Throws (HTTP 500-shaped) if the env var is unset or malformed. We throw
 * on first use rather than at module import to preserve the lazy-config
 * behavior that lets `/health` reply on a config-less boot.
 */
export function resolveTenantId(): string {
  if (_cachedDefault) return _cachedDefault;
  const raw = process.env.MESSAGING_DEFAULT_TENANT_ID;
  if (!raw || raw.length === 0) {
    throw new Error(
      "MESSAGING_DEFAULT_TENANT_ID is not set. " +
        "Configure it in apps/messaging/.env (see .env.example). " +
        "v0 ships single-tenant; SaaS multi-tenant lands later.",
    );
  }
  if (!UUID_REGEX.test(raw)) {
    throw new Error(
      `MESSAGING_DEFAULT_TENANT_ID is not a valid UUID (got: ${JSON.stringify(raw)}).`,
    );
  }
  _cachedDefault = raw;
  return _cachedDefault;
}

/**
 * Test/internal helper: reset the cached tenant so a test can swap the env
 * var between cases. Not exported from any public surface.
 */
export function resetTenantCache(): void {
  _cachedDefault = undefined;
}
