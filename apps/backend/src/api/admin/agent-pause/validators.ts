import { z } from "zod";

export const AdminSetAgentPause = z
  .object({
    paused: z.boolean(),
    paused_until: z.string().datetime().optional().nullable(),
    reason: z.string().max(500).optional().nullable(),
  })
  .strict();

export type AdminSetAgentPauseType = z.infer<typeof AdminSetAgentPause>;
