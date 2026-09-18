"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listManagedUsers, type ManagedUser } from "@/lib/users-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type ManagedUsersState = {
  data: ManagedUser[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายชื่อบัญชีทั่วไปจาก `GET /users/managed` — ใช้ในหน้า User / Role
 * Management (Admin เท่านั้น) mirror `useFirmwareList`
 */
export function useManagedUsers() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<ManagedUsersState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listManagedUsers(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
