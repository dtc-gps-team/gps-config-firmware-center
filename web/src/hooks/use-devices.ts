"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listDevices, type Device } from "@/lib/device-api";

type DevicesState = {
  data: Device[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Device จาก `GET /devices` — pattern เดียวกับ `useConfigs`
 * (token จาก session, คืน `refetch`) · ดึงทั้งหมดครั้งเดียว UI กรอง/ค้นหา
 * ฝั่ง client (planning/01 §3)
 */
export function useDevices() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<DevicesState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listDevices(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดรายการอุปกรณ์ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
