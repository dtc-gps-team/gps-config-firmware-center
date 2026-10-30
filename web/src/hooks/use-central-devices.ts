"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  getDeviceCentral,
  listCentralDevices,
  type CentralDeviceList,
  type DeviceCentralView,
} from "@/lib/central-device-api";
import { markDataLoaded } from "@/lib/refresh-bus";
import { usePollInterval } from "@/hooks/use-poll-interval";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

/** รีเฟรชสถานะกล่องทุก 5 วินาที (สถานะออนไลน์เปลี่ยนเร็วกว่าคิวอนุมัติ) */
export const CENTRAL_POLL_INTERVAL_MS = 5_000;

type State<T> = {
  /** กุญแจของคำขอที่ผลนี้เป็นของ (เช่น deviceId) กันผลของเครื่องเก่ามาโผล่ตอนเปลี่ยนเครื่อง */
  key: string;
  data: T | null;
  isLoading: boolean;
  error: string | null;
};

function useCentralFetch<T>(load: (token: string) => Promise<T>, key: string) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State<T>>({
    key,
    data: null,
    isLoading: true,
    error: null,
  });
  // กุญแจล่าสุดที่ผู้ใช้ขอ: คำขอที่ตอบกลับช้าและไม่ใช่ของกุญแจนี้แล้ว (เปลี่ยนเครื่องไปแล้ว)
  // ต้องไม่เขียนทับผลใหม่
  const latestKey = useRef(key);
  useEffect(() => {
    latestKey.current = key;
  }, [key]);

  const refetch = useCallback(async () => {
    if (!token) return;
    try {
      const data = await load(token);
      if (latestKey.current !== key) return;
      setState({ key, data, isLoading: false, error: null });
      markDataLoaded();
    } catch (err) {
      if (latestKey.current !== key) return;
      // รีเฟรชเบื้องหลังล้มเหลว: เก็บข้อมูลเดิมไว้ ไม่ทำให้การ์ดกระพริบเป็นว่าง
      setState((prev) => ({
        key,
        data: prev.key === key ? prev.data : null,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดสถานะจาก Server กลางไม่สำเร็จ",
      }));
    }
  }, [token, load, key]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);
  usePollInterval(() => void refetch(), CENTRAL_POLL_INTERVAL_MS);

  // เปลี่ยนกุญแจ (เช่น เปลี่ยนเครื่อง) แล้วผลที่ค้างอยู่เป็นของกุญแจเก่า: แสดงเป็นกำลังโหลดใหม่
  const current: State<T> =
    state.key === key
      ? state
      : { key, data: null, isLoading: true, error: null };
  // ไม่มี token (ยังไม่ login/session หมด) จะไม่มีอะไรโหลด ไม่ให้ค้างสถานะกำลังโหลดตลอดไป
  return {
    data: current.data,
    error: current.error,
    isLoading: token ? current.isLoading : false,
    refetch,
  };
}

/** `GET /central/devices` รีเฟรชอัตโนมัติ — ข้อมูลเสริม ล้มเหลวแล้วหน้าหลักต้องยังใช้ได้ */
export function useCentralDevices() {
  const load = useCallback(
    (token: string): Promise<CentralDeviceList> => listCentralDevices(token),
    [],
  );
  return useCentralFetch(load, "all");
}

/** `GET /devices/{deviceId}/central` รีเฟรชอัตโนมัติ */
export function useDeviceCentral(deviceId: string) {
  const load = useCallback(
    (token: string): Promise<DeviceCentralView> =>
      getDeviceCentral(token, deviceId),
    [deviceId],
  );
  return useCentralFetch(load, deviceId);
}
