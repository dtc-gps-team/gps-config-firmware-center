"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listAllCampaignRollouts,
  type CampaignRollout,
} from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  PENDING_QUEUE_POLL_INTERVAL_MS,
  usePollInterval,
} from "@/hooks/use-poll-interval";

type State = {
  data: CampaignRollout[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * Rollout ทุกสถานะข้ามทุกกลุ่ม — `GET /campaigns/rollouts` — ใช้คำนวณ "ผลการ Deploy" รวมบน
 * Dashboard จาก `successCount`/`failureCount` จริงของแต่ละ Rollout (mirror
 * `usePausedCampaignRollouts` แต่ไม่กรองสถานะ)
 */
export function useAllCampaignRollouts() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listAllCampaignRollouts(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลด Rollout ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);
  usePollInterval(refetch, PENDING_QUEUE_POLL_INTERVAL_MS);

  return { ...state, refetch };
}
