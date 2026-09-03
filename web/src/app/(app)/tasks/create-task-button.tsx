"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canManageTask } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้าง/มอบหมาย Task" — Operation เท่านั้น (RBAC_Matrix.md ตาราง 4.3
 * — ปิด open question: Task creator = Operation) ST/OT ไม่เห็นปุ่มนี้เลย
 * (ห้ามสร้าง Task เอง — ดูเฉพาะ Task ที่ตัวเองถูก assign)
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ POST /tasks จริง — component นี้
 * คุมแค่ว่า "ควรเห็นปุ่มนี้ไหม" (UX-level gate เท่านั้น)
 */
export function CreateTaskButton() {
  const { session } = useAuth();

  if (!canManageTask(session?.role)) return null;

  return <Button disabled>+ สร้าง/มอบหมาย Task</Button>;
}
