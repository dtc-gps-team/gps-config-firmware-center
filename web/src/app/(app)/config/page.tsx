import { ConfigTableCard } from "./config-table";

export const metadata = {
  title: "Config Editor | GPS Config Center",
};

/**
 * Config Editor — list Config จาก `GET /config` จริง + คลิกแถวดูรายละเอียด
 * (แผง `ConfigDetailSheet`) + ฟอร์มสร้าง/แก้/ลบ Config สถานะ draft
 * (`ConfigFormSheet` — field editor สร้างจาก `GET /config-definitions`)
 * ปุ่ม "สร้าง Config ใหม่" + การ gate ตาม Role อยู่ใน `ConfigTableCard`
 */
export default function ConfigPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Config Editor</h1>
        <p className="text-sm text-muted-foreground">
          สร้าง/แก้ Draft · สร้างได้เฉพาะ Role SW
        </p>
      </div>

      <ConfigTableCard />
    </div>
  );
}
