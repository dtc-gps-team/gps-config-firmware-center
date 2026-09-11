"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getCampaign, type Campaign } from "@/lib/campaign-api";

type CampaignState = {
  data: Campaign | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลด Campaign ตัวเดียวจาก `GET /campaigns/{id}` — pattern เดียวกับ
 * `useConfig` (token จาก session, คืน `refetch`)
 */
export function useCampaign(id: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CampaignState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !id) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getCampaign(token, id);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดแคมเปญไม่สำเร็จ",
      }));
    }
  }, [token, id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
