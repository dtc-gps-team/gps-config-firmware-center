"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listConfigDefinitions,
  type ConfigFieldDefinition,
} from "@/lib/config-definition-api";

type State = {
  data: ConfigFieldDefinition[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลด catalog ของ Config Field Definition จาก `GET /config-definitions` —
 * pattern เดียวกับ `useConfigs` (ดึง token จาก session, คืน `refetch`)
 */
export function useConfigDefinitions() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listConfigDefinitions(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคลัง Parameter ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
