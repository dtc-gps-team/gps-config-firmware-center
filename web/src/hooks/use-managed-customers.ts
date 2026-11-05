"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listManagedCustomers,
  type ManagedCustomer,
} from "@/lib/customer-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type ManagedCustomersState = {
  data: ManagedCustomer[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดลูกค้าแบบเต็ม + จำนวนเครื่องที่ผูกจาก `GET /customers/managed` (Admin/SuperAdmin) —
 * ใช้ที่หน้าจัดการลูกค้า · mirror `useDeviceModels`
 */
export function useManagedCustomers() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<ManagedCustomersState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listManagedCustomers(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดรายชื่อลูกค้าไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
