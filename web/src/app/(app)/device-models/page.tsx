import { DeviceModelManagementView } from "./device-model-management-view";

export const metadata = {
  title: "Device Model Management | GPS Config Center",
};

/**
 * DeviceModel Management (`GET /device-models`, `POST /device-models`,
 * `PATCH /device-models/{id}`) — ดู/อ่านได้ทุก Role แต่สร้าง/แก้ได้แค่
 * Admin/SuperAdmin (RBAC_Matrix.md ตาราง 4.1) gate ปุ่ม Create/Update ผ่าน
 * DeviceModelManagementView (ดูไฟล์นั้น) — mirror `/users` + `/users/new`
 */
export default async function DeviceModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;

  return <DeviceModelManagementView justCreatedId={created ?? null} />;
}
