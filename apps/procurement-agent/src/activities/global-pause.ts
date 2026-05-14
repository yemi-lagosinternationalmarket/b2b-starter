import type { Redis as RedisClient } from "ioredis";
import { getRedisClient } from "../redis/client.js";
import { STEALTH_GLOBAL_PAUSE_KEY } from "../redis/keys.js";

/**
 * Stored shape of the `stealth:global_pause` Redis value.
 * Per ADR 0015 — global pause as the trust gradient.
 */
export type GlobalPauseValue = {
  paused: boolean;
  /** ISO timestamp; absent or null = indefinite when `paused` is true. */
  paused_until?: string | null;
  reason?: string | null;
  changed_by?: string | null;
  /** ISO timestamp of when this state was written. */
  paused_at: string;
};

/**
 * Compute the Redis TTL (in seconds) for a given pause value.
 * Returns `null` for "no expiry" (indefinite pause OR resume).
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

// --- Activities --------------------------------------------------------------
// Activities are normal async functions; they MUST be allowed to do I/O.
// They are registered with the Temporal worker and called from workflows
// via `proxyActivities`.

/** Read the current pause value from Redis, or `null` if no key set. */
export async function getGlobalPause(
  client: RedisClient = getRedisClient()
): Promise<GlobalPauseValue | null> {
  const raw = await client.get(STEALTH_GLOBAL_PAUSE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GlobalPauseValue;
  } catch {
    // Corrupt value — treat as "no pause" rather than crash the worker.
    return null;
  }
}

/**
 * Write a pause value to Redis with the appropriate TTL.
 * Idempotent: writing the same value twice produces the same end state.
 *
 * Compensation note: callers that need to roll back should snapshot the
 * prior value via `getGlobalPause` BEFORE calling this, then call
 * `setGlobalPause` again with the snapshot (or `deleteGlobalPause` if the
 * snapshot was `null`).
 */
export async function setGlobalPause(
  value: GlobalPauseValue,
  client: RedisClient = getRedisClient()
): Promise<void> {
  const payload = JSON.stringify(value);
  const ttl = ttlSecondsFor(value);
  if (ttl === null) {
    await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload);
  } else {
    await client.set(STEALTH_GLOBAL_PAUSE_KEY, payload, "EX", ttl);
  }
}

/** Delete the pause key. Used during compensation when prior state was empty. */
export async function deleteGlobalPause(
  client: RedisClient = getRedisClient()
): Promise<void> {
  await client.del(STEALTH_GLOBAL_PAUSE_KEY);
}
