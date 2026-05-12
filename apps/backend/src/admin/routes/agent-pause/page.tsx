import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CircleStack } from "@medusajs/icons";
import { Toaster } from "@medusajs/ui";
import { AgentPauseToggle } from "../../components/agent-pause";

const AgentPausePage = () => (
  <>
    <AgentPauseToggle variant="panel" />
    <Toaster />
  </>
);

export const config = defineRouteConfig({
  label: "Agent pause",
  icon: CircleStack,
});

export default AgentPausePage;
