import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateUserForm } from "./create-user-form";

export const metadata = {
  title: "เพิ่มผู้ใช้ | GPS Config Center",
};

/**
 * สร้างบัญชีทั่วไปใหม่ (`POST /users`) · Admin เท่านั้น — จัดการได้แค่บัญชี
 * ทั่วไป ไม่รวม Admin/SuperAdmin (RBAC_Matrix.md §2) mirror
 * `/firmware/upload` (หน้าเต็มแทน Dialog — ยังไม่มี Dialog component ในโปรเจกต์)
 */
export default function NewUserPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/users"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายชื่อผู้ใช้
        </Link>
        <h1 className="text-2xl font-semibold">เพิ่มผู้ใช้ใหม่</h1>
        <p className="text-sm text-muted-foreground">
          เฉพาะ Role Admin · เลือก role ได้แค่บัญชีทั่วไป (ไม่รวม
          Admin/SuperAdmin) · ตั้งรหัสผ่านเริ่มต้นให้ผู้ใช้เองที่นี่
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลผู้ใช้</CardTitle>
          <CardDescription>Username ต้องไม่ซ้ำกับที่มีอยู่แล้ว</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>
    </div>
  );
}
