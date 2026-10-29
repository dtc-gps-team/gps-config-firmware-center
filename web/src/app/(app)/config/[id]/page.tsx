import { RoleGuard } from "@/components/auth/role-guard";
import { canReadConfig } from "@/lib/permissions";
import { ConfigDetailView } from "../config-detail-view";

export const metadata = {
  title: "รายละเอียด Config | GPS Config Center",
};

/** รายละเอียด Config แบบหน้าเต็ม — ข้อมูล + JSON + ประวัติเวอร์ชัน
 *  ปุ่ม: คัดลอก JSON · โคลน · แก้ไข/ลบ (draft + ConfigEngineer) */
export default async function ConfigDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RoleGuard allow={canReadConfig}>
      <ConfigDetailView configId={id} />
    </RoleGuard>
  );
}
