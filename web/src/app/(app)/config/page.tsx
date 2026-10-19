import { PageHeader } from "@/components/page-header";
import { ConfigTableCard } from "./config-table";

export const metadata = {
  title: "Config Editor | GPS Config Center",
};

/**
 * Config Editor — list Config จาก `GET /config` จริง + คลิกแถวไปหน้า
 * รายละเอียดเต็ม `/config/{id}` · ปุ่ม "สร้าง Config ใหม่" พาไปหน้า wizard
 * `/config/new` (แก้ที่ `/config/{id}/edit`) — สร้าง/แก้ได้เฉพาะ Role ConfigEngineer
 */
export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Config Editor"
        description="ร่าง ทดสอบ และส่ง Config ของแต่ละโมเดลให้ Operation อนุมัติ"
      />

      <ConfigTableCard justSavedId={saved ?? null} />
    </div>
  );
}
