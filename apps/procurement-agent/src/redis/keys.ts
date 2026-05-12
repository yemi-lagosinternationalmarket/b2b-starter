// Canonical Redis key names for the stealth agent layer.
// Single source of truth — referenced by both the procurement-agent worker
// and the Medusa admin API routes that read/write the same key.
export const STEALTH_GLOBAL_PAUSE_KEY = "stealth:global_pause";
