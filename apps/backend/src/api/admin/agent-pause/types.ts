// Wire-format type for the global agent pause Redis value.
// Mirrors `GlobalPauseValue` in apps/procurement-agent/src/activities/global-pause.ts
// — kept duplicated rather than importing across apps because the
// procurement-agent package depends on @temporalio/* (V8-isolate native bindings)
// that we don't want to pull into Medusa's bundle. When the procurement-agent
// is split into a library + worker, this type moves to a shared package.
export type GlobalPauseValue = {
  paused: boolean;
  paused_until?: string | null;
  reason?: string | null;
  changed_by?: string | null;
  paused_at: string;
};

export const STEALTH_GLOBAL_PAUSE_KEY = "stealth:global_pause";
