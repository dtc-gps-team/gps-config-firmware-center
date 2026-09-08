"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listConfigs, type Config } from "@/lib/config-api";

type ConfigsState = {
  data: Config[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายการ Config จาก `GET /config` (ทุก status) — ดึง token จาก session
 * · คืน `refetch` ให้เรียกซ้ำหลัง mutation (สร้าง/แก้/ลบ)
 */
export function useConfigs() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<ConfigsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listConfigs(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายการ Config ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
