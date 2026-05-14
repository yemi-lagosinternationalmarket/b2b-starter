import { describe, it, expect, vi } from "vitest";
import {
  runSetGlobalAgentPauseSaga,
  type SagaActivities,
  type SagaDeps,
} from "./set-global-agent-pause.js";
import type { GlobalPauseValue } from "../activities/global-pause.js";

function makeDeps(overrides: Partial<SagaDeps> = {}): SagaDeps {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    nonCancellable: async (fn) => fn(),
    now: () => "2026-05-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("setGlobalAgentPause saga", () => {
  it("writes a fresh pause when no prior value exists", async () => {
    const setGlobalPause = vi.fn().mockResolvedValue(undefined);
    const deleteGlobalPause = vi.fn().mockResolvedValue(undefined);
    const acts: SagaActivities = {
      getGlobalPause: vi.fn().mockResolvedValue(null),
      setGlobalPause,
      deleteGlobalPause,
    };

    const out = await runSetGlobalAgentPauseSaga(
      {
        paused: true,
        paused_until: "2026-05-11T01:00:00.000Z",
        reason: "audit prep",
        changed_by: "user_123",
      },
      acts,
      makeDeps()
    );

    expect(setGlobalPause).toHaveBeenCalledTimes(1);
    expect(setGlobalPause.mock.calls[0]![0]).toMatchObject({
      paused: true,
      paused_until: "2026-05-11T01:00:00.000Z",
      reason: "audit prep",
      changed_by: "user_123",
      paused_at: "2026-05-11T00:00:00.000Z",
    });
    expect(out?.paused).toBe(true);
    expect(deleteGlobalPause).not.toHaveBeenCalled();
  });

  it("emits the stealth-pause log line at the recordActivity stub site", async () => {
    const info = vi.fn();
    const acts: SagaActivities = {
      getGlobalPause: vi.fn().mockResolvedValue(null),
      setGlobalPause: vi.fn().mockResolvedValue(undefined),
      deleteGlobalPause: vi.fn().mockResolvedValue(undefined),
    };
    await runSetGlobalAgentPauseSaga(
      {
        paused: true,
        paused_until: "2026-05-11T01:00:00.000Z",
        reason: "audit prep",
        changed_by: "user_123",
      },
      acts,
      makeDeps({ info })
    );
    expect(info).toHaveBeenCalledTimes(1);
    const [msg, ctx] = info.mock.calls[0]!;
    expect(msg).toBe(
      "[stealth-pause] paused_until=2026-05-11T01:00:00.000Z reason=audit prep by=user_123"
    );
    expect(ctx).toMatchObject({
      event: "agent_paused_globally",
      paused: true,
    });
  });

  it("resume (paused: false) deletes the key and emits agent_resumed", async () => {
    const info = vi.fn();
    const deleteGlobalPause = vi.fn().mockResolvedValue(undefined);
    const acts: SagaActivities = {
      getGlobalPause: vi.fn().mockResolvedValue({
        paused: true,
        paused_until: null,
        changed_by: "prev_user",
        paused_at: "2026-05-10T23:00:00.000Z",
      } satisfies GlobalPauseValue),
      setGlobalPause: vi.fn().mockResolvedValue(undefined),
      deleteGlobalPause,
    };

    const out = await runSetGlobalAgentPauseSaga(
      { paused: false, changed_by: "user_999" },
      acts,
      makeDeps({ info })
    );

    expect(out).toBeNull();
    expect(deleteGlobalPause).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![1]).toMatchObject({ event: "agent_resumed" });
  });

  it("compensates by restoring the prior value when the write fails", async () => {
    const prior: GlobalPauseValue = {
      paused: true,
      paused_until: null,
      reason: "earlier reason",
      changed_by: "prev_user",
      paused_at: "2026-05-10T23:00:00.000Z",
    };
    const setGlobalPause = vi
      .fn()
      // First call (the mutation) fails.
      .mockRejectedValueOnce(new Error("redis down"))
      // Second call (the compensation) succeeds.
      .mockResolvedValueOnce(undefined);
    const acts: SagaActivities = {
      getGlobalPause: vi.fn().mockResolvedValue(prior),
      setGlobalPause,
      deleteGlobalPause: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      runSetGlobalAgentPauseSaga(
        {
          paused: true,
          paused_until: "2026-05-11T01:00:00.000Z",
          reason: "new reason",
          changed_by: "user_xyz",
        },
        acts,
        makeDeps()
      )
    ).rejects.toThrow("redis down");

    // Compensation invoked with the prior snapshot exactly.
    expect(setGlobalPause).toHaveBeenCalledTimes(2);
    expect(setGlobalPause.mock.calls[1]![0]).toEqual(prior);
  });

  it("compensates by deleting the key when there was no prior value", async () => {
    const acts: SagaActivities = {
      getGlobalPause: vi.fn().mockResolvedValue(null),
      setGlobalPause: vi.fn().mockRejectedValue(new Error("redis down")),
      deleteGlobalPause: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      runSetGlobalAgentPauseSaga(
        { paused: true, changed_by: "user_xyz" },
        acts,
        makeDeps()
      )
    ).rejects.toThrow("redis down");
    expect(acts.deleteGlobalPause).toHaveBeenCalledTimes(1);
  });
});
