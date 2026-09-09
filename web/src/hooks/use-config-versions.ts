"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listConfigVersions, type ConfigVersion } from "@/lib/config-api";

type State = {
  data: ConfigVersion[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดประวัติเวอร์ชันของ Config จาก `GET /config/{id}/versions` —
 * pattern เดียวกับ `useConfig` · `[]` = Config ยังไม่เคยถูก approve (ไม่ใช่ error)
 */
export function useConfigVersions(id: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !id) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listConfigVersions(token, id);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดประวัติเวอร์ชันไม่สำเร็จ",
      }));
    }
  }, [token, id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
