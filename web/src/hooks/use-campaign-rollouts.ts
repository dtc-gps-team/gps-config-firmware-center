"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listCampaignRollouts, type CampaignRollout } from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CampaignRolloutsState = {
  data: CampaignRollout[] | null;
  isLoading: boolean;
  error: string | null;
};

/** โหลดประวัติ Rollout ของกลุ่มจาก `GET /campaigns/{id}/rollouts` (Campaign
 * Monitor #22) — pattern เดียวกับ `useCampaigns` */
export function useCampaignRollouts(campaignId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CampaignRolloutsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !campaignId) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listCampaignRollouts(token, campaignId);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดประวัติ Rollout ไม่สำเร็จ",
      }));
    }
  }, [token, campaignId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
