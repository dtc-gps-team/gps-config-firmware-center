"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  getDeviceCentral,
  listCentralDevices,
  type CentralDeviceList,
  type DeviceCentralView,
} from "@/lib/central-device-api";
import { usePollInterval } from "@/hooks/use-poll-interval";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

/** รีเฟรชสถานะกล่องทุก 5 วินาที (สถานะออนไลน์เปลี่ยนเร็วกว่าคิวอนุมัติ) */
export const CENTRAL_POLL_INTERVAL_MS = 5_000;

type State<T> = { data: T | null; isLoading: boolean; error: string | null };

function useCentralFetch<T>(load: (token: string) => Promise<T>) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State<T>>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    try {
      const data = await load(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      // รีเฟรชเบื้องหลังล้มเหลว: เก็บข้อมูลเดิมไว้ ไม่ทำให้การ์ดกระพริบเป็นว่าง
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดสถานะจาก Server กลางไม่สำเร็จ",
      }));
    }
  }, [token, load]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);
  usePollInterval(() => void refetch(), CENTRAL_POLL_INTERVAL_MS);

  return { ...state, refetch };
}

/** `GET /central/devices` รีเฟรชอัตโนมัติ — ข้อมูลเสริม ล้มเหลวแล้วหน้าหลักต้องยังใช้ได้ */
export function useCentralDevices() {
  const load = useCallback(
    (token: string): Promise<CentralDeviceList> => listCentralDevices(token),
    [],
  );
  return useCentralFetch(load);
}

/** `GET /devices/{deviceId}/central` รีเฟรชอัตโนมัติ */
export function useDeviceCentral(deviceId: string) {
  const load = useCallback(
    (token: string): Promise<DeviceCentralView> =>
      getDeviceCentral(token, deviceId),
    [deviceId],
  );
  return useCentralFetch(load);
}
