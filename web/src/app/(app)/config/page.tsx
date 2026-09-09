import { ConfigTableCard } from "./config-table";

export const metadata = {
  title: "Config Editor | GPS Config Center",
};

/**
 * Config Editor — list Config จาก `GET /config` จริง + คลิกแถวดูรายละเอียด
 * (แผง `ConfigDetailSheet`) · ปุ่ม "สร้าง Config ใหม่" พาไปหน้า wizard
 * `/config/new` (แก้ที่ `/config/{id}/edit`) — สร้าง/แก้ได้เฉพาะ Role SW
 */
export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Config Editor</h1>
        <p className="text-sm text-muted-foreground">
          สร้าง/แก้ Draft · สร้างได้เฉพาะ Role SW
        </p>
      </div>

      <ConfigTableCard justSavedId={saved ?? null} />
    </div>
  );
}
