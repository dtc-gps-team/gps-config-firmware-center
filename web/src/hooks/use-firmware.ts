"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listFirmware, type Firmware } from "@/lib/firmware-api";

type FirmwareState = {
  data: Firmware[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Firmware ทั้งหมดจาก `GET /firmware` — ใช้เป็น dropdown เลือก
 * payload ใน Campaign Wizard (mirror `useConfigs`)
 */
export function useFirmwareList() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<FirmwareState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listFirmware(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายการ Firmware ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
