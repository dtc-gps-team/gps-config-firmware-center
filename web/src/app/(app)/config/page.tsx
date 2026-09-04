import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateConfigButton } from "./create-config-button";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_CONFIGS, CONFIG_STATUS_TONE, pillClass } from "@/lib/demo-data";

export const metadata = {
  title: "Config Editor | GPS Config Center",
};

/** Scaffold — รอต่อ GET/POST /config (โมดูล Config CRUD คือ #26)
 *  ตารางแสดง DEMO_CONFIGS (ดู web/src/lib/demo-data.ts) แทนแถวว่างสำหรับ demo */
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

      <Card>
        <CardHeader>
          <CardTitle>รายการ Config</CardTitle>
          <CardDescription>ทุก Role ที่ login แล้วดูได้</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /config (#26)" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ Config</TableHead>
                <TableHead>อุปกรณ์เป้าหมาย</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>แก้ไขล่าสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_CONFIGS.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">{config.name}</TableCell>
                  <TableCell>
                    {config.deviceModel}/{config.protocol}
                  </TableCell>
                  <TableCell>
                    <span
                      className={pillClass(CONFIG_STATUS_TONE[config.status])}
                    >
                      {config.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {config.updatedAt}
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
