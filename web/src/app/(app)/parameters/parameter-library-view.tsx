"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { RoleGuard } from "@/components/auth/role-guard";
import {
  canAccessParameterLibrary,
  canCreateFieldDefinition,
} from "@/lib/permissions";
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
import { DEMO_PARAMETERS, DEMO_PARAMETERS_TOTAL } from "@/lib/demo-data";

/**
 * คลัง Parameter (Config Definition Lookup, #12/#26) — Sprint 1 นับเป็นฝั่ง
 * Backend เท่านั้น (ดู 02_GPS_Development_Plan.md) หน้านี้จึงเป็น scaffold
 * รอต่อ API ตอนถึงรอบ Sprint จริง เหมือน pattern ของหน้าอื่น (Config
 * Editor, Task Management ฯลฯ) — ตั้งใจไม่เชื่อม `GET`/`POST
 * /config-definitions` ตอนนี้ แม้ backend จะมีจริงแล้ว เพราะ (1) ยังไม่ถึง
 * Sprint ที่ต้องส่งหน้านี้ (2) กันความเสี่ยงถ้า endpoint เปลี่ยน shape ก่อน
 * ถึงรอบจริง — ดู web/src/lib/api.ts ที่ตัด listConfigDefinitions/
 * createConfigDefinition ออกไปด้วยเหตุผลเดียวกัน
 */
function ParameterLibraryContent() {
  const { session } = useAuth();
  const canCreate = canCreateFieldDefinition(session?.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">คลัง Parameter</h1>
          <p className="text-sm text-muted-foreground">
            นิยาม field ที่ใช้กรอก Config · สร้างได้เฉพาะ Role SW
          </p>
        </div>
        {canCreate ? <Button disabled>+ สร้าง Parameter ใหม่</Button> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Parameter ทั้งหมด</CardTitle>
          <CardDescription>
            เรียงตามชื่อ field · แสดง {DEMO_PARAMETERS.length} จาก{" "}
            {DEMO_PARAMETERS_TOTAL} field ที่ seed ไว้ในระบบ
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /config-definitions" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ Field</TableHead>
                <TableHead>ชนิดข้อมูล</TableHead>
                <TableHead>บังคับกรอก</TableHead>
                <TableHead>รุ่นอุปกรณ์ที่รองรับ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_PARAMETERS.map((param) => (
                <TableRow key={param.fieldName}>
                  <TableCell className="font-mono text-sm">
                    {param.fieldName}
                  </TableCell>
                  <TableCell>{param.dataType}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {param.required ? "ใช่" : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {param.models}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ParameterLibraryView() {
  return (
    <RoleGuard allow={canAccessParameterLibrary}>
      <ParameterLibraryContent />
    </RoleGuard>
  );
}
