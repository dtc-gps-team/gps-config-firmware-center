"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listCampaigns, type Campaign } from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CampaignsState = {
  data: Campaign[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Campaign จาก `GET /campaigns` (ทุก status) — pattern เดียวกับ
 * `useConfigs`/`useDevices` (token จาก session, คืน `refetch`)
 *
 * `enabled` (default true) — ตั้ง false ให้ข้ามการยิงเลย (รีวิว #373:
 * FirmwareEngineer/QAEngineer ไม่มีสิทธิ์ `campaign:Read` ยิงไปก็ได้ 403 เปล่าๆ)
 * — หน้า Campaign list เองใช้ค่า default เดิมต่อไป เพราะหน้านั้น role ที่เข้า
 * ได้ก็มีสิทธิ์อ่านอยู่แล้ว
 */
export function useCampaigns(enabled = true) {
  const { session } = useAuth();
  const token = enabled ? session?.accessToken ?? null : null;
  const [state, setState] = useState<CampaignsState>({
    data: null,
    isLoading: enabled,
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
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
