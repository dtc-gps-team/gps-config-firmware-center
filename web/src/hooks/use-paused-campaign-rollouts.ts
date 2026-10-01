"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listAllCampaignRollouts, type CampaignRollout } from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type PausedCampaignRolloutsState = {
  data: CampaignRollout[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * Rollout ที่ `paused` (Auto Pause) ข้ามทุกกลุ่ม —
 * `GET /campaigns/rollouts?status=paused` — ใช้กับการ์ด "Rollout หยุดชั่วคราว
 * (Auto Pause)" บน Dashboard Risk Dashboard (§12.1 PDF "Failure สูง" — ตั้งชื่อ
 * การ์ดใหม่ให้ตรงกับ metric ที่วัดได้จริง คือนับ "Rollout ที่ paused" ไม่ใช่
 * "จำนวนเครื่องที่ failure" — #238 review comment ข้อ 6) mirror
 * `usePendingCampaignRollouts` แต่ตอนนี้แค่ต้องการนับจำนวน ไม่ต้อง resolve
 * ชื่อกลุ่มเพิ่ม
 */
export function usePausedCampaignRollouts() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<PausedCampaignRolloutsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listAllCampaignRollouts(token, { status: "paused" });
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลด Rollout ที่ paused ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
