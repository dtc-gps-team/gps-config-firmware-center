"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listDevices, type Device } from "@/lib/device-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type DevicesState = {
  data: Device[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Device จาก `GET /devices` — pattern เดียวกับ `useConfigs`
 * (token จาก session, คืน `refetch`) · ดึงทั้งหมดครั้งเดียว UI กรอง/ค้นหา
 * ฝั่ง client (planning/01 §3)
 *
 * เครื่องที่ปลดระวางแล้วซ่อนเป็นค่าเริ่มต้น (มติ A 2026-11-05) — `includeDecommissioned` รวมไว้ด้วย
 * (หน้า Device Search มีตัวสลับ · ฟอร์มลงทะเบียนต้องรวมเพื่อไม่ให้เสนอ Device ID ของเครื่องที่ปลดระวางซ้ำ)
 */
export function useDevices(options?: { includeDecommissioned?: boolean }) {
  const includeDecommissioned = options?.includeDecommissioned ?? false;
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
      const data = await listDevices(token, { includeDecommissioned });
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดรายการอุปกรณ์ไม่สำเร็จ",
      }));
    }
  }, [token, includeDecommissioned]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
