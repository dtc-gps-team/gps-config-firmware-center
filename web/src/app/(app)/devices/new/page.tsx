import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RegisterDeviceForm } from "./register-device-form";

export const metadata = {
  title: "ลงทะเบียนอุปกรณ์ | GPS Config Center",
};

/**
 * ลงทะเบียนอุปกรณ์ใหม่ (`POST /devices`, issue #157 PR 1) · Admin/SuperAdmin
 * เท่านั้น — endpoint ฝั่ง staff ไม่ใช่อุปกรณ์เรียกเอง mirror `/device-models/new`
 * (หน้าเต็มแทน Dialog — ยังไม่มี Dialog component ในโปรเจกต์)
 */
export default function NewDevicePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/devices"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไป Device Search
        </Link>
        <h1 className="text-2xl font-semibold">ลงทะเบียนอุปกรณ์ใหม่</h1>
        <p className="text-sm text-muted-foreground">
          เฉพาะ Role Admin/SuperAdmin · ระบบจะออก API key ให้อุปกรณ์ใช้เชื่อมต่อ
          — โชว์ได้ครั้งเดียวตอนลงทะเบียนสำเร็จเท่านั้น
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลอุปกรณ์</CardTitle>
          <CardDescription>Device ID ต้องไม่ซ้ำกับที่มีอยู่แล้ว</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterDeviceForm />
        </CardContent>
      </Card>
    </div>
  );
}
