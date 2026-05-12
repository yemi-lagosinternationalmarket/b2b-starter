import { describe, it, expect, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";
import type { Redis as RedisClient } from "ioredis";
import {
  getGlobalPause,
  setGlobalPause,
  deleteGlobalPause,
  ttlSecondsFor,
  type GlobalPauseValue,
} from "./global-pause.js";
import { STEALTH_GLOBAL_PAUSE_KEY } from "../redis/keys.js";

// `ioredis-mock` is API-compatible with ioredis. Justification (PR body):
// keeps the test hermetic + fast in CI without a side-running redis-server.
// Real-Redis behavior we rely on (SET / GET / DEL / EX TTL) is exercised
// faithfully by the mock per its README.

function newClient(): RedisClient {
  return new (RedisMock as unknown as typeof import("ioredis").Redis)() as RedisClient;
}

describe("global-pause activities", () => {
  let client: RedisClient;
  beforeEach(() => {
    client = newClient();
  });

  it("returns null when no pause is set", async () => {
    expect(await getGlobalPause(client)).toBeNull();
  });

  it("round-trips a value: set then get returns the same JSON", async () => {
    const value: GlobalPauseValue = {
      paused: true,
      paused_until: new Date(Date.now() + 60_000).toISOString(),
      reason: "audit prep",
      changed_by: "user_01HABC",
      paused_at: new Date().toISOString(),
    };
    await setGlobalPause(value, client);
    const got = await getGlobalPause(client);
    expect(got).toEqual(value);
  });

  it("applies TTL when paused_until is in the future", async () => {
    const value: GlobalPauseValue = {
      paused: true,
      paused_until: new Date(Date.now() + 30_000).toISOString(),
      reason: null,
      changed_by: "user_01HABC",
      paused_at: new Date().toISOString(),
    };
    await setGlobalPause(value, client);
    const ttl = await client.ttl(STEALTH_GLOBAL_PAUSE_KEY);
    // Allow a small drift between value-construction and the SET call.
    expect(ttl).toBeGreaterThan(25);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it("does NOT set a TTL when paused_until is null (indefinite)", async () => {
    const value: GlobalPauseValue = {
      paused: true,
      paused_until: null,
      reason: "indefinite — manual resume only",
      changed_by: "user_01HABC",
      paused_at: new Date().toISOString(),
    };
    await setGlobalPause(value, client);
    const ttl = await client.ttl(STEALTH_GLOBAL_PAUSE_KEY);
    // ioredis returns -1 for "no expire", -2 for "key missing".
    expect(ttl).toBe(-1);
  });

  it("deleteGlobalPause clears the key (resume path)", async () => {
    const value: GlobalPauseValue = {
      paused: true,
      paused_until: null,
      reason: null,
      changed_by: "user_01HABC",
      paused_at: new Date().toISOString(),
    };
    await setGlobalPause(value, client);
    await deleteGlobalPause(client);
    expect(await getGlobalPause(client)).toBeNull();
  });

  it("returns null on corrupt JSON rather than throwing", async () => {
    await client.set(STEALTH_GLOBAL_PAUSE_KEY, "{not-json");
    expect(await getGlobalPause(client)).toBeNull();
  });
});

describe("ttlSecondsFor", () => {
  it("returns null for indefinite pause", () => {
    expect(
      ttlSecondsFor({
        paused: true,
        paused_until: null,
        changed_by: "u",
        paused_at: new Date().toISOString(),
      })
    ).toBeNull();
  });

  it("returns null for a paused_until in the past", () => {
    expect(
      ttlSecondsFor(
        {
          paused: true,
          paused_until: new Date(Date.now() - 10_000).toISOString(),
          changed_by: "u",
          paused_at: new Date().toISOString(),
        },
        new Date()
      )
    ).toBeNull();
  });

  it("rounds up sub-second remainders so we never under-set TTL", () => {
    const now = new Date("2026-05-11T00:00:00.000Z");
    const ttl = ttlSecondsFor(
      {
        paused: true,
        paused_until: "2026-05-11T00:00:00.500Z",
        changed_by: "u",
        paused_at: now.toISOString(),
      },
      now
    );
    expect(ttl).toBe(1);
  });
});
