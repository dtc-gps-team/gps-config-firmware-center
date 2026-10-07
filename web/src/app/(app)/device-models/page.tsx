import { DeviceModelManagementView } from "./device-model-management-view";

export const metadata = {
  title: "Device Model Management | GPS Config Center",
};

/**
 * DeviceModel Management (`GET /device-models`, `POST /device-models`,
 * `PATCH /device-models/{id}`) — ดู/อ่านได้ทุก Role แต่สร้าง/แก้ได้แค่
 * Admin/SuperAdmin (RBAC_Matrix.md ตาราง 4.1) gate ปุ่ม Create/Update ผ่าน
 * DeviceModelManagementView (ดูไฟล์นั้น) — "เพิ่มรุ่นอุปกรณ์" เป็น Dialog
 * ในตัวแล้ว (แก้ครั้งที่ 71) ไม่มี route `/device-models/new` แยกอีกต่อไป
 */
export default function DeviceModelsPage() {
  return <DeviceModelManagementView />;
}
