"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getDevice, type Device } from "@/lib/device-api";

type DeviceState = {
  data: Device | null;
  isLoading: boolean;
  /** true = ได้ 404 (ไม่พบ deviceId นี้) — แยกจาก error อื่นเพื่อโชว์ข้อความต่างกัน */
  notFound: boolean;
  error: string | null;
};

/**
 * โหลด Device ตัวเดียวจาก `GET /devices/{deviceId}` — pattern เดียวกับ
 * `useConfig` · แยก `notFound` (404) ออกจาก `error` ทั่วไป
 */
export function useDevice(deviceId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<DeviceState>({
    data: null,
    isLoading: true,
    notFound: false,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !deviceId) return;
    setState((prev) => ({
      ...prev,
      isLoading: true,
      notFound: false,
      error: null,
    }));
    try {
      const data = await getDevice(token, deviceId);
      setState((prev) => ({
        ...prev,
        data,
        isLoading: false,
        notFound: false,
        error: null,
      }));
    } catch (err) {
      const is404 = err instanceof ApiError && err.statusCode === 404;
      setState((prev) => ({
        ...prev,
        data: null,
        isLoading: false,
        notFound: is404,
        error: is404
          ? null
          : err instanceof ApiError
            ? err.message
            : "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ",
      }));
    }
  }, [token, deviceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
