"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RefreshCwIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { retryIncidentConfigSync, type Incident } from "@/lib/incident-api";

/** รอสั้นๆ แล้วดึงรายการอีกรอบ: เขียนจริงทำเบื้องหลัง ถ้าสำเร็จระบบปิด Incident
 * ให้เองไม่กี่ร้อยมิลลิวินาทีหลังสั่ง รอบแรกที่ดึงทันทีจึงมักยังเห็น investigating */
const SETTLE_REFETCH_MS = 2000;

/**
 * ปุ่ม "ลองเขียนใหม่" ของ Incident เขียน Config ไม่สำเร็จ (Operation) — ต่อ
 * `POST /incidents/{id}/retry-sync` · สั่งแล้ว Incident เป็น investigating:
 * สำเร็จระบบปิดให้เอง, ล้มอีกกลับเป็น open (ตอนนี้ระบบปลายทางเป็นโหมด mock
 * จึงสำเร็จเสมอ) · 409/404 = รายการเปลี่ยนไปแล้ว ให้ผู้เรียกดึงรายการใหม่
 */
export function RetrySyncButton({
  incident,
  onChanged,
}: {
  incident: Incident;
  /** ให้ผู้เรียกดึงรายการใหม่ (เรียกทันทีหลังสั่ง และอีกครั้งหลังรอสักครู่) */
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function retry() {
    if (!session?.accessToken) return;
    setSubmitting(true);
    try {
      await retryIncidentConfigSync(session.accessToken, incident.id);
      toast.success("สั่งเขียน Config เข้าระบบปลายทางใหม่แล้ว");
      onChanged();
      timer.current = setTimeout(onChanged, SETTLE_REFETCH_MS);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "สั่งเขียนใหม่ไม่สำเร็จ";
      toast.error(message);
      if (
        err instanceof ApiError &&
        (err.statusCode === 409 || err.statusCode === 404)
      ) {
        onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button size="sm" disabled={submitting} onClick={() => void retry()}>
      <RefreshCwIcon className={submitting ? "animate-spin" : ""} />
      {submitting ? "กำลังสั่ง…" : "ลองเขียนใหม่"}
    </Button>
  );
}
