import { validateAndTransformBody } from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import { AdminSetAgentPause } from "./validators";

export const adminAgentPauseMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/admin/agent-pause",
    middlewares: [validateAndTransformBody(AdminSetAgentPause)],
  },
];
