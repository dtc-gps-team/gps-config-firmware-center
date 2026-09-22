"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { listIncidents, type Incident, type IncidentStatus } from "@/lib/incident-api";
import { ApiError } from "@/lib/api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

export type IncidentFilters = {
  status?: IncidentStatus;
};

type State = {
  data: Incident[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * `GET /incidents` (read-only rollout, Sprint 2) — เรียง createdAt desc มา
 * จาก backend อยู่แล้ว · mirror `use-audit-logs.ts`
 */
export function useIncidents(filters: IncidentFilters = {}) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const { status } = filters;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listIncidents(token, { status });
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลด Incident ไม่สำเร็จ",
      }));
    }
  }, [token, status]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
