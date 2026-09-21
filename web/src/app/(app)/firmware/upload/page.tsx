import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadFirmwareForm } from "./upload-firmware-form";

export const metadata = {
  title: "อัปโหลด Firmware | GPS Config Center",
};

/**
 * อัปโหลด Firmware ใหม่ (`POST /firmware`) · FirmwareEngineer เท่านั้น — ไฟล์อัปโหลดขึ้น
 * Object Storage จริงทันที (ไม่มี draft/mock mode — ต่างจาก Config)
 */
export default function UploadFirmwarePage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/firmware"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการ Firmware
        </Link>
        <h1 className="text-2xl font-semibold">อัปโหลด Firmware</h1>
        <p className="text-sm text-muted-foreground">
          เฉพาะ Role FirmwareEngineer · ไฟล์จะถูกอัปโหลดขึ้น Object Storage ทันที · เพิ่ม/แก้
          รุ่นอุปกรณ์ที่รองรับเพิ่มเติมได้ทีหลังในหน้ารายละเอียด
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ไฟล์ Firmware</CardTitle>
          <CardDescription>ขนาดไม่เกิน 50MB</CardDescription>
        </CardHeader>
        <CardContent>
          <UploadFirmwareForm />
        </CardContent>
      </Card>
    </div>
  );
}
