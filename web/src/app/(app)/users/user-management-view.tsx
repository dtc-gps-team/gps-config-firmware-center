"use client";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessUserManagement } from "@/lib/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_USERS } from "@/lib/demo-data";

/**
 * เนื้อหาจริงของหน้า User / Role Management — แยกเป็น client component
 * ต่างหากจาก page.tsx (server component ที่ export metadata) เพราะ RoleGuard
 * ต้องใช้ useAuth() ซึ่งเป็น client-only hook
 */
export function UserManagementView() {
  return (
    <RoleGuard allow={canAccessUserManagement}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">User / Role Management</h1>
            <p className="text-sm text-muted-foreground">
              Admin เท่านั้น (RBAC_Matrix.md Section 2)
            </p>
          </div>
          <Button disabled>+ เพิ่มผู้ใช้</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายชื่อผู้ใช้</CardTitle>
            <CardDescription>ทั้งหมดในระบบ</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DemoNote endpoint="GET /users (ยังไม่มีใน spec)" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>ชื่อเต็ม</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEMO_USERS.map((user) => (
                  <TableRow key={user.username}>
                    <TableCell className="font-mono text-sm">
                      {user.username}
                    </TableCell>
                    <TableCell>{user.fullName}</TableCell>
                    <TableCell>{user.role}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
