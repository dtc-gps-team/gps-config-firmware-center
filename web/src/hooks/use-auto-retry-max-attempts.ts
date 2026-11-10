"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getCampaignAutoRetrySettings,
  DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
} from "@/lib/campaign-api";

/**
 * จำนวนครั้งสูงสุดของการลองส่งใหม่อัตโนมัติ (รวมครั้งแรก) จาก `GET /campaigns/auto-retry-settings`
 * ให้ป้าย "รอบ N/M" และข้อความสวิตช์ตรงกับค่าที่ backend ตั้งจริง (docs/31 §7.6) ·
 * ระหว่างโหลดหรือโหลดไม่สำเร็จใช้ค่าเริ่มต้นของ backend (3) ไม่ทำให้หน้าพัง
 */
export function useAutoRetryMaxAttempts(): number {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [maxAttempts, setMaxAttempts] = useState(
    DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getCampaignAutoRetrySettings(token)
      .then((s) => {
        if (
          !cancelled &&
          Number.isInteger(s.maxAttempts) &&
          s.maxAttempts > 0
        ) {
          setMaxAttempts(s.maxAttempts);
        }
      })
      .catch(() => {
        // ใช้ค่าเริ่มต้นต่อ
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return maxAttempts;
}
