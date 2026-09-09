"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getConfig, type Config } from "@/lib/config-api";

type ConfigState = {
  data: Config | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลด Config ตัวเดียวจาก `GET /config/{id}` — ใช้กับหน้าแก้ไข (ต้องมีค่าเดิม
 * มา prefill ฟอร์ม) · pattern เดียวกับ `useConfigs` (token จาก session, คืน
 * `refetch`)
 */
export function useConfig(id: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<ConfigState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !id) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getConfig(token, id);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลด Config ไม่สำเร็จ",
      }));
    }
  }, [token, id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
