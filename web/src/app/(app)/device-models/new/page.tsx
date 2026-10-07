import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateDeviceModelForm } from "./create-device-model-form";

export const metadata = {
  title: "เพิ่มรุ่นอุปกรณ์ | GPS Config Center",
};

/**
 * สร้างรุ่นอุปกรณ์ใหม่ (`POST /device-models`) · Admin/SuperAdmin เท่านั้น
 * mirror `/users/new` (หน้าเต็มแทน Dialog — ยังไม่มี Dialog component ใน
 * โปรเจกต์)
 */
export default function NewDeviceModelPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/device-models"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการรุ่นอุปกรณ์
        </Link>
        <h1 className="text-2xl font-semibold">เพิ่มรุ่นอุปกรณ์ใหม่</h1>
        <p className="text-sm text-muted-foreground">
          เฉพาะ Role Admin/SuperAdmin · ชื่อรุ่นต้องตรงกับที่ใช้อยู่แล้วเป๊ะ
          (ถ้ามี) เพราะเปลี่ยนชื่อทีหลังไม่ได้
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลรุ่นอุปกรณ์</CardTitle>
          <CardDescription>ชื่อรุ่นต้องไม่ซ้ำกับที่มีอยู่แล้ว</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateDeviceModelForm />
        </CardContent>
      </Card>
    </div>
  );
}
