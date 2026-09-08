import { CreateConfigButton } from "./create-config-button";
import { ConfigTableCard } from "./config-table";

export const metadata = {
  title: "Config Editor | GPS Config Center",
};

/**
 * Config Editor — list Config จาก `GET /config` จริง (Sprint 2 #12)
 * ฟอร์มสร้าง/แก้ยังเป็น scaffold (`CreateConfigButton` disabled) — ต่อ POST/PUT
 * ใน PR ถัดไป
 */
export default function ConfigPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Config Editor</h1>
          <p className="text-sm text-muted-foreground">
            สร้าง/แก้ Draft · สร้างได้เฉพาะ Role SW
          </p>
        </div>
        <CreateConfigButton />
      </div>

      <ConfigTableCard />
    </div>
  );
}
