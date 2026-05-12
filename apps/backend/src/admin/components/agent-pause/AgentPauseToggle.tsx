import { useState } from "react";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useAgentPause, useSetAgentPause } from "../../hooks/api";

const DURATION_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
  { label: "Indefinite", minutes: null },
];

function fmt(iso?: string | null): string {
  if (!iso) return "indefinite";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Global agent-pause control. Renders the current state and exposes a small
 * inline form to pause / resume.
 *
 * Per ADR 0015 the original spec called for an "admin header toggle". Medusa
 * Admin v2 doesn't expose a header injection zone, so this component is used
 * in two places: as a dedicated sidebar route page (`/app/agent-pause`), and
 * embedded as a banner widget at the top of high-traffic list views via the
 * widget exports.
 */
export const AgentPauseToggle = ({
  variant = "panel",
}: {
  variant?: "panel" | "banner";
}) => {
  const { data, isPending } = useAgentPause();
  const setPause = useSetAgentPause({
    onSuccess: () => toast.success("Agent pause updated"),
    onError: (err) =>
      toast.error(`Failed to update pause: ${(err as Error).message}`),
  });

  const [duration, setDuration] = useState<string>("60"); // minutes as string
  const [reason, setReason] = useState<string>("");

  const pause = data?.pause;
  const isPaused = !!pause?.paused;

  const handlePause = () => {
    const minutes = duration === "null" ? null : Number(duration);
    const paused_until =
      minutes === null
        ? null
        : new Date(Date.now() + minutes * 60 * 1000).toISOString();
    setPause.mutate({
      paused: true,
      paused_until,
      reason: reason.trim() || null,
    });
  };

  const handleResume = () => {
    setPause.mutate({ paused: false });
  };

  if (isPending) {
    return (
      <Container className="p-4">
        <Text>Loading agent pause state…</Text>
      </Container>
    );
  }

  return (
    <Container
      className={
        variant === "banner"
          ? `p-4 ${
              isPaused ? "border-l-4 border-orange-500 bg-orange-50" : ""
            }`
          : "p-6"
      }
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Heading level="h2">Global agent pause</Heading>
          {isPaused ? (
            <Badge color="orange">Paused</Badge>
          ) : (
            <Badge color="green">Active</Badge>
          )}
        </div>
        {isPaused && (
          <Button
            variant="primary"
            size="small"
            onClick={handleResume}
            isLoading={setPause.isPending}
          >
            Resume
          </Button>
        )}
      </div>

      {isPaused ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <Text className="text-ui-fg-subtle">Paused until</Text>
            <Text weight="plus">{fmt(pause?.paused_until)}</Text>
          </div>
          <div>
            <Text className="text-ui-fg-subtle">Reason</Text>
            <Text weight="plus">{pause?.reason ?? "—"}</Text>
          </div>
          <div>
            <Text className="text-ui-fg-subtle">Changed by</Text>
            <Text weight="plus">{pause?.changed_by ?? "—"}</Text>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Text className="text-ui-fg-subtle">
            All agents auto-fire freely (subject to per-vendor authority). Pause
            below to suppress all auto-fires platform-wide.
          </Text>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="agent-pause-duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <Select.Trigger id="agent-pause-duration">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {DURATION_OPTIONS.map((opt) => (
                    <Select.Item
                      key={opt.label}
                      value={opt.minutes === null ? "null" : String(opt.minutes)}
                    >
                      {opt.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label htmlFor="agent-pause-reason">Reason (optional)</Label>
              <Input
                id="agent-pause-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. board meeting, audit prep"
              />
            </div>
          </div>
          <Button
            variant="danger"
            onClick={handlePause}
            isLoading={setPause.isPending}
          >
            Pause all agents
          </Button>
        </div>
      )}
    </Container>
  );
};

export default AgentPauseToggle;
