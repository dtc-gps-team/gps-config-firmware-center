import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportConfigForm } from "./import-config-form";

export const metadata = {
  title: "Config Import | GPS Config Center",
};

/**
 * Config Import — นำเข้า Config จากไฟล์ JSON (`POST /config/import`) · SW เท่านั้น
 * Config ที่ได้เป็นสถานะ draft เข้า flow ทดสอบ/อนุมัติเดียวกับการสร้างผ่านฟอร์ม
 */
export default function ConfigImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/config"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการ Config
        </Link>
        <h1 className="text-2xl font-semibold">Config Import</h1>
        <p className="text-sm text-muted-foreground">
          นำเข้า Config จากไฟล์ JSON · เฉพาะ Role SW · ไฟล์ที่นำเข้าจะกลายเป็น
          Config สถานะ draft ต้องทดสอบและให้ Operation อนุมัติเหมือนสร้างผ่านฟอร์ม
        </p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>อัปโหลดไฟล์</CardTitle>
          <CardDescription>
            รองรับไฟล์ .json ขนาดไม่เกิน 1MB · โครงสร้าง:{" "}
            <code>{`{ name, deviceModel, protocol, fields, description? }`}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportConfigForm />
        </CardContent>
      </Card>
    </div>
  );
}
