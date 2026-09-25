"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listCampaignRolloutTargets,
  type CampaignRolloutTarget,
} from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CampaignRolloutTargetsState = {
  data: CampaignRolloutTarget[] | null;
  isLoading: boolean;
  error: string | null;
};

/** โหลดผลของ Rollout ต่อเครื่องจาก
 * `GET /campaigns/{id}/rollouts/{rolloutId}/targets` (Campaign Monitor #22
 * — Failure Rate จริง) — pattern เดียวกับ `useCampaigns` */
export function useCampaignRolloutTargets(
  campaignId: string | null,
  rolloutId: string | null,
) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CampaignRolloutTargetsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !campaignId || !rolloutId) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listCampaignRolloutTargets(
        token,
        campaignId,
        rolloutId,
      );
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดผล Rollout ไม่สำเร็จ",
      }));
    }
  }, [token, campaignId, rolloutId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
