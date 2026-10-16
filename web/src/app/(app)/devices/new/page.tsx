
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader
        title="ลงทะเบียนอุปกรณ์ใหม่"
        description="ระบบจะออก API key ให้อุปกรณ์ใช้เชื่อมต่อ และแสดงได้ครั้งเดียวตอนลงทะเบียนสำเร็จเท่านั้น"
        breadcrumb={[{ label: "ลงทะเบียนอุปกรณ์ใหม่" }]}
      />

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
