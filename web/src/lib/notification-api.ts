import { apiJson } from "@/lib/api";

/**
 * Notification API client — `GET /notifications`, `PATCH /notifications/{id}/read`
 * (openapi `listNotifications` / `markNotificationRead`) · ทุก Role ที่ login
 * แล้วเรียกได้ backend กรองตาม userId จาก JWT เสมอ (กัน IDOR)
 */

/** `Notification` ใน openapi.yaml · `type` เก็บเป็น string เพราะ backend เพิ่ม
 * ชนิดใหม่ได้โดยไม่ต้องแก้เว็บ — ชนิดที่ไม่รู้จักแสดงเป็นข้อความกลาง (ดู
 * `describeNotification`) */
export type AppNotification = {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  sentAt: string | null;
  createdAt: string;
};

/** ใหม่สุดก่อน · endpoint นี้ยังไม่แบ่งหน้า คืนทุกแถวของผู้ใช้ — ฝั่งเว็บตัด
 * แสดงเฉพาะส่วนต้น (ดู `NOTIFICATION_PANEL_LIMIT`) */
export function listNotifications(token: string): Promise<AppNotification[]> {
  return apiJson<AppNotification[]>("/notifications", { token });
}

/** ทำเครื่องหมายอ่านแล้ว · 404 ถ้าไม่ใช่ของผู้ใช้คนนี้หรือไม่มีอยู่ */
export function markNotificationRead(
  token: string,
  id: string,
): Promise<AppNotification> {
  return apiJson<AppNotification>(
    `/notifications/${encodeURIComponent(id)}/read`,
    { method: "PATCH", token },
  );
}
