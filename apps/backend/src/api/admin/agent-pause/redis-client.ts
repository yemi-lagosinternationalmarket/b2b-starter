import Redis, { type Redis as RedisClient } from "ioredis";

// Single process-wide ioredis client for the agent-pause routes.
//
// Direct ioredis use (no abstraction) per AGENTS.md guidance for the
// single-key A.7 work. Falls back to localhost in dev.
//
// We deliberately do NOT reuse Medusa's Cache module because (a) cache values
// are advisory and may be evicted; (b) we need a stable, tunable TTL exactly
// matching `paused_until - now`.

let cached: RedisClient | undefined;

export function getRedisClient(): RedisClient {
  if (!cached) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    cached = new Redis(url, {
      // Lazy connect so test runs and admin builds without a Redis server
      // don't crash on module import.
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }
  return cached;
}
