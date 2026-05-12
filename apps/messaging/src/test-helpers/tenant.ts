import { randomUUID } from "node:crypto";
import { resetTenantCache } from "../tenant.js";

/**
 * Test helper for the ADR 0022 tenant_id wiring. Mints a fresh UUID, sets
 * the env var, and clears the tenant cache so the next `resolveTenantId()`
 * call picks it up. Returns both the UUID and a cleanup function.
 *
 * Tests that need to simulate cross-tenant isolation can call this twice
 * to obtain two distinct tenant IDs and swap between them.
 */
export function withTenant(tenantId: string = randomUUID()): {
  tenantId: string;
  restore: () => void;
} {
  const previous = process.env.MESSAGING_DEFAULT_TENANT_ID;
  process.env.MESSAGING_DEFAULT_TENANT_ID = tenantId;
  resetTenantCache();
  return {
    tenantId,
    restore: () => {
      if (previous === undefined) {
        delete process.env.MESSAGING_DEFAULT_TENANT_ID;
      } else {
        process.env.MESSAGING_DEFAULT_TENANT_ID = previous;
      }
      resetTenantCache();
    },
  };
}

/** Mint a fresh UUID without touching env state. */
export function newTenantId(): string {
  return randomUUID();
}
