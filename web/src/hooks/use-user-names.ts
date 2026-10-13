"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listUsers } from "@/lib/users-api";

type State = {
  nameById: Map<string, string>;
  isLoading: boolean;
  error: string | null;
};

/**
 * resolve userId -> ชื่อเต็ม สำหรับหน้าที่โชว์ "สร้างโดย"/"อนุมัติโดย"/
 * "อัปโหลดโดย" (เช่น Config/Firmware Detail) — mirror pattern เดียวกับที่
 * `usePendingApprovals` ใช้ resolve `suggestedApproverId` (`GET /users` เปิด
 * ให้ทุก role ที่ login แล้วเรียกได้ ไม่ต้องมีสิทธิ์ User Management)
 *
 * ไม่ filter role เพราะไม่รู้ล่วงหน้าว่า creator/approver เป็น role ไหน (ต่าง
 * จาก `usePendingApprovals` ที่ filter แค่ Operation เพราะรู้ขอบเขตแน่นอน)
 *
 * `listUsers` คืนเฉพาะ user ที่ยัง active — id ที่ resolve ไม่เจอ (บัญชีถูกปิด
 * ใช้งานไปแล้ว) ให้ fallback เป็น id เดิมที่ฝั่งเรียกใช้เอง (ดู `resolveName`)
 */
export function useUserNames() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    nameById: new Map(),
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const users = await listUsers(token);
      setState({
        nameById: new Map(users.map((u) => [u.id, u.fullName])),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      // พังไม่ block หน้า — แค่แสดง id ดิบต่อไปเหมือนเดิม (ดู resolveName) เก็บ
      // error ไว้เผื่อ debug เท่านั้น ไม่มี UI ไหนโชว์ตอนนี้
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ",
      }));
    }
  }, [token]);

  const resolveName = useCallback(
    (userId: string) => state.nameById.get(userId) ?? userId,
    [state.nameById],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { resolveName, isLoading: state.isLoading, refetch };
}
