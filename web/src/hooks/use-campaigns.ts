"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listCampaigns, type Campaign } from "@/lib/campaign-api";

type CampaignsState = {
  data: Campaign[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Campaign จาก `GET /campaigns` (ทุก status) — pattern เดียวกับ
 * `useConfigs`/`useDevices` (token จาก session, คืน `refetch`)
 */
export function useCampaigns() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CampaignsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listCampaigns(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายการแคมเปญไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
