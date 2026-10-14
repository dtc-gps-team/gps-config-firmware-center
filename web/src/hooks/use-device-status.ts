"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getDeviceStatus, type DeviceStatusInfo } from "@/lib/device-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type State = {
  data: DeviceStatusInfo | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดสถานะ Config/Firmware ของอุปกรณ์จาก `GET /devices/{deviceId}/status`
 * — แยกจาก `useDevice` โดยตั้งใจ: สถานะเป็นข้อมูลเสริม ถ้าโหลดไม่สำเร็จ หน้า
 * รายละเอียดอุปกรณ์ต้องยังแสดงข้อมูลหลักได้ตามปกติ (error อยู่เฉพาะการ์ดสถานะ)
 */
export function useDeviceStatus(deviceId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !deviceId) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getDeviceStatus(token, deviceId);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดสถานะอุปกรณ์ไม่สำเร็จ",
      }));
    }
  }, [token, deviceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
