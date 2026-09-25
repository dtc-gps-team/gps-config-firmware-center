"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getCampaignRollout, type CampaignRollout } from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CampaignRolloutState = {
  data: CampaignRollout | null;
  isLoading: boolean;
  error: string | null;
};

/** โหลด Rollout ตัวเดียวจาก `GET /campaigns/{id}/rollouts/{rolloutId}`
 * (Campaign Monitor #22) — pattern เดียวกับ `useCampaign` */
export function useCampaignRollout(
  campaignId: string | null,
  rolloutId: string | null,
) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CampaignRolloutState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !campaignId || !rolloutId) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getCampaignRollout(token, campaignId, rolloutId);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลด Rollout ไม่สำเร็จ",
      }));
    }
  }, [token, campaignId, rolloutId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
