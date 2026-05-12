import { FetchError } from "@medusajs/js-sdk";
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from "@tanstack/react-query";
import { sdk } from "../../lib/client";

export type GlobalPauseValue = {
  paused: boolean;
  paused_until?: string | null;
  reason?: string | null;
  changed_by?: string | null;
  paused_at?: string;
};

export type AgentPauseResponse = { pause: GlobalPauseValue };

export type SetAgentPauseInput = {
  paused: boolean;
  paused_until?: string | null;
  reason?: string | null;
};

export const agentPauseQueryKey = ["agent-pause"] as const;

export const useAgentPause = (
  options?: UseQueryOptions<AgentPauseResponse, FetchError>
) =>
  useQuery({
    queryKey: agentPauseQueryKey,
    queryFn: () =>
      sdk.client.fetch<AgentPauseResponse>("/admin/agent-pause", {
        method: "GET",
      }),
    // Pause state changes infrequently; refetch on window focus is enough.
    refetchInterval: 60_000,
    ...options,
  });

export const useSetAgentPause = (
  options?: UseMutationOptions<
    AgentPauseResponse,
    FetchError,
    SetAgentPauseInput
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      sdk.client.fetch<AgentPauseResponse>("/admin/agent-pause", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentPauseQueryKey });
    },
    ...options,
  });
};
