import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { applyGlobalPauseChange, readGlobalPause } from "./pause-service";
import type { AdminSetAgentPauseType } from "./validators";

/**
 * GET /admin/agent-pause
 * Returns the current global pause state, or `{ paused: false }` if no key.
 */
export const GET = async (
  _req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const value = await readGlobalPause();
  res.json({ pause: value ?? { paused: false } });
};

/**
 * POST /admin/agent-pause
 * Set or clear the global agent pause. Body: `{ paused, paused_until?, reason? }`.
 * `changed_by` is taken from the authenticated admin actor — never trusted
 * from the request body.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminSetAgentPauseType>,
  res: MedusaResponse
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const actorId = req.auth_context?.actor_id ?? "unknown";

  const value = await applyGlobalPauseChange(
    {
      paused: req.validatedBody.paused,
      paused_until: req.validatedBody.paused_until ?? null,
      reason: req.validatedBody.reason ?? null,
      changed_by: actorId,
    },
    logger
  );

  res.json({ pause: value ?? { paused: false } });
};
