import type { Logger } from "@medusajs/framework/types";
import { getRedisClient } from "./redis-client";
import {
  STEALTH_GLOBAL_PAUSE_KEY,
  type GlobalPauseValue,
} from "./types";

/**
 * Compute the Redis TTL in seconds for a given pause value.
 * Returns `null` for "no expiry" (indefinite or resume).
 */
export function ttlSecondsFor(
  value: GlobalPauseValue,
  now: Date = new Date()
): number | null {
  if (!value.paused_until) return null;
  const expiresAtMs = Date.parse(value.paused_until);
  if (Number.isNaN(expiresAtMs)) return null;
  const ttlMs = expiresAtMs - now.getTime();
  if (ttlMs <= 0) return null;
  return Math.ceil(ttlMs / 1000);
}

/** Read the current pause value from Redis, or `null` if no key set. */
export async function readGlobalPause(): Promise<GlobalPauseValue | null> {
  const client = getRedisClient();
  const raw = await client.get(STEALTH_GLOBAL_PAUSE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GlobalPauseValue;
  } catch {
    return null;
  }
}

/**
 * Apply a pause-state change. Mirrors the saga in
 * `apps/procurement-agent/src/workflows/set-global-agent-pause.ts`:
 *   1. snapshot prior value
 *   2. write new value (or delete on resume)
 *   3. emit `[stealth-pause] ...` log line (stub for #34 LIM Activity write)
 *   4. on failure, restore prior snapshot
 *
 * TODO(C.0): once the procurement-agent Temporal worker is running, swap the
 * direct Redis writes for `client.workflow.execute(setGlobalAgentPauseWorkflow, ...)`
 * so the workflow's history captures every admin pause change. The shape and
 * log line stay identical — just the entry point flips.
 */
export type PauseChangeInput = {
  paused: boolean;
  paused_until?: string | null;
  reason?: string | null;
  changed_by: string;
};

export async function applyGlobalPauseChange(
  input: PauseChangeInput,
  logger: Pick<Logger, "info" | "warn">
): Promise<GlobalPauseValue | null> {
  const client = getRedisClient();
  const prior = await readGlobalPause();

  const next: GlobalPauseValue | null = input.paused
    ? {
        paused: true,
        paused_until: input.paused_until ?? null,
        reason: input.reason ?? null,
        changed_by: input.changed_by,
        paused_at: new Date().toISOString(),
      }
    : null;

  try {
    if (next) {
      const ttl = ttlSecondsFor(next);
      const payload = JSON.stringify(next);
      if (ttl === null) {
        await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload);
      } else {
        await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload, "EX", ttl);
      }
    } else {
      await client.del(STEALTH_GLOBAL_PAUSE_KEY);
    }

    // TODO(#34): replace log line with recordActivity call once LIM Activity
    // DocType ships. One structured line per state change.
    logger.info(
      `[stealth-pause] paused_until=${input.paused_until ?? "null"} reason=${
        input.reason ?? "null"
      } by=${input.changed_by}`
    );

    return next;
  } catch (err) {
    // Compensation: restore the prior snapshot, best-effort.
    try {
      if (prior) {
        const ttl = ttlSecondsFor(prior);
        const payload = JSON.stringify(prior);
        if (ttl === null) {
          await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload);
        } else {
          await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload, "EX", ttl);
        }
      } else {
        await client.del(STEALTH_GLOBAL_PAUSE_KEY);
      }
    } catch (compErr) {
      logger.warn(
        `[stealth-pause] compensation failed after write error: ${
          (compErr as Error).message
        }`
      );
    }
    throw err;
  }
}
