import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Toaster } from "@medusajs/ui";
import { AgentPauseToggle } from "../components/agent-pause";
import { useAgentPause } from "../hooks/api";

/**
 * Banner widget that surfaces global agent pause state at the top of
 * high-traffic list pages. Medusa Admin v2 has no first-class header injection
 * zone, so we render this only when actually paused — keeps the noise low
 * while making the state visible everywhere operators land.
 */
const AgentPauseBanner = () => {
  const { data } = useAgentPause();
  if (!data?.pause?.paused) return null;
  return (
    <>
      <AgentPauseToggle variant="banner" />
      <Toaster />
    </>
  );
};

export const config = defineWidgetConfig({
  zone: ["order.list.before", "product.list.before"],
});

export default AgentPauseBanner;
