import {
  CancellationScope,
  log,
  proxyActivities,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import type { GlobalPauseValue } from "../activities/global-pause.js";

/**
 * Input contract for `setGlobalAgentPauseWorkflow`.
 * - `paused: false` → resume (clears the key).
 * - `paused: true` + no `paused_until` → indefinite pause (no TTL).
 * - `paused: true` + `paused_until` (ISO ts) → bounded pause with TTL.
 */
export type SetGlobalAgentPauseInput = {
  paused: boolean;
  paused_until?: string | null;
  reason?: string | null;
  changed_by: string;
};

const proxiedActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Set the platform-wide global agent pause flag (per ADR 0015).
 *
 * Saga shape: snapshot the prior Redis value first, perform the write, and
 * if the workflow is cancelled or any downstream step fails, restore the
 * snapshot inside a non-cancellable scope. The single Redis write currently
 * has no downstream steps, but we keep the saga structure so future steps
 * (Activity emission via LIM Activity DocType per #34, Slack broadcasts,
 * etc.) drop in cleanly.
 */
export async function setGlobalAgentPauseWorkflow(
  input: SetGlobalAgentPauseInput
): Promise<GlobalPauseValue | null> {
  return runSetGlobalAgentPauseSaga(input, proxiedActivities, {
    info: (msg, ctx) => log.info(msg, ctx),
    warn: (msg, ctx) => log.warn(msg, ctx),
    nonCancellable: (fn) => CancellationScope.nonCancellable(fn),
    now: () => new Date().toISOString(),
  });
}

// --- Pure saga, factored out for unit testing ---------------------------------
//
// The workflow function above is the Temporal entry point (uses workflow-only
// imports like `proxyActivities` and `CancellationScope`). The saga body is
// extracted so it can be exercised with a fake activity object + fake logger
// in vitest without spinning a Temporal worker.

export type SagaActivities = Pick<
  typeof activities,
  "getGlobalPause" | "setGlobalPause" | "deleteGlobalPause"
>;

export type SagaDeps = {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  nonCancellable: <T>(fn: () => Promise<T>) => Promise<T>;
  now: () => string;
};

export async function runSetGlobalAgentPauseSaga(
  input: SetGlobalAgentPauseInput,
  acts: SagaActivities,
  deps: SagaDeps
): Promise<GlobalPauseValue | null> {
  const compensations: Array<() => Promise<void>> = [];
  const prior = await acts.getGlobalPause();

  try {
    const next: GlobalPauseValue | null = input.paused
      ? {
          paused: true,
          paused_until: input.paused_until ?? null,
          reason: input.reason ?? null,
          changed_by: input.changed_by,
          paused_at: deps.now(),
        }
      : null; // resume → delete key

    // Register compensation BEFORE the mutation so a failure during the
    // mutation still rolls back to the captured `prior`.
    compensations.push(async () => {
      if (prior) {
        await acts.setGlobalPause(prior);
      } else {
        await acts.deleteGlobalPause();
      }
    });

    if (next) {
      await acts.setGlobalPause(next);
    } else {
      await acts.deleteGlobalPause();
    }

    // TODO(#34): replace log line with recordActivity call once LIM Activity
    // DocType ships. Single structured log line per acceptance criteria — one
    // line per state change, ingestable by current log-shipping pipeline.
    deps.info(
      `[stealth-pause] paused_until=${input.paused_until ?? "null"} reason=${
        input.reason ?? "null"
      } by=${input.changed_by}`,
      {
        event: input.paused ? "agent_paused_globally" : "agent_resumed",
        paused: input.paused,
        paused_until: input.paused_until ?? null,
        reason: input.reason ?? null,
        changed_by: input.changed_by,
      }
    );

    return next;
  } catch (err) {
    await deps.nonCancellable(async () => {
      for (const compensate of compensations.reverse()) {
        try {
          await compensate();
        } catch (compErr) {
          deps.warn("Global pause compensation failed", { error: compErr });
        }
      }
    });
    throw err;
  }
}
