import Redis, { type Redis as RedisClient, type RedisOptions } from "ioredis";

// Direct ioredis use — per AGENTS.md guidance for the global-pause work,
// no cross-cutting Redis abstraction is justified for a single key.
//
// One process-level singleton (lazy) for the worker. Tests inject their own
// client via `createRedisClient` so they can swap in `ioredis-mock`.

let cached: RedisClient | undefined;

export function createRedisClient(opts?: RedisOptions | string): RedisClient {
  if (typeof opts === "string") {
    return new Redis(opts);
  }
  return new Redis(opts ?? {});
}

export function getRedisClient(): RedisClient {
  if (!cached) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    cached = createRedisClient(url);
  }
  return cached;
}

// Test/teardown helper — clears the singleton so a new client can be installed.
export function resetRedisClientForTests(client?: RedisClient): void {
  cached = client;
}
