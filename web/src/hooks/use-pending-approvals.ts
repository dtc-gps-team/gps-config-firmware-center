"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listConfigs, type Config } from "@/lib/config-api";
import { listUsers } from "@/lib/users-api";

/**
 * View-model ของ 1 รายการในคิว Approval Center — ตั้งใจ decouple จาก `Config`
 * ดิบ เพราะ data source อาจย้ายไป `GET /approval-requests` ในอนาคต (เมื่อ
 * Approval Center รองรับ Firmware/Campaign ด้วย — ดู docs/13 proposal) ·
 * ตอนสลับ source แก้แค่ mapping ในไฟล์นี้ component ไม่ต้องแตะ
 */
export type PendingApproval = {
  id: string;
  name: string;
  deviceModel: string;
  protocol: string;
  /** user id ของ SW ที่สร้าง — context สำหรับ Separation of Duty */
  createdBy: string;
  description: string | null;
  fields: Record<string, unknown>;
  /** เวลาที่ SW ปักผลผ่าน (`decide`) แล้ว Config เข้าสถานะ testing */
  queuedAt: string;
  /** ผู้อนุมัติที่ SW เจาะจง (resolve ชื่อจาก GET /users) · null = ไม่เจาะจง */
  suggestedApprover: { id: string; fullName: string } | null;
};

type State = {
  data: PendingApproval[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คิว Config ที่รอ Operation อนุมัติ — `GET /config?status=testing`
 * (ผ่าน simulation + SW ปักผ่านแล้ว) · เรียง queued ใหม่สุดก่อน · แนบชื่อ
 * ผู้อนุมัติที่เจาะจงจาก `GET /users?role=Operation` · คืน `refetch`
 */
export function usePendingApprovals() {
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
      const [configs, operators] = await Promise.all([
        listConfigs(token, { status: "testing" }),
        // ชื่อ Operation ไว้ resolve badge "เจาะจงถึง" — พังไม่ block คิว
        listUsers(token, { role: "Operation" }).catch(() => []),
      ]);
      const nameById = new Map(operators.map((u) => [u.id, u.fullName]));
      const data = configs
        .map(
          (config: Config): PendingApproval => ({
            id: config.id,
            name: config.name,
            deviceModel: config.deviceModel,
            protocol: config.protocol,
            createdBy: config.createdBy,
            description: config.description,
            fields: config.fields,
            queuedAt: config.updatedAt,
            suggestedApprover: config.suggestedApproverId
              ? {
                  id: config.suggestedApproverId,
                  fullName:
                    nameById.get(config.suggestedApproverId) ??
                    config.suggestedApproverId,
                }
              : null,
          }),
        )
        .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคิวรออนุมัติไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
