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

/** Scaffold — รอต่อ POST /config/import (สร้างได้เฉพาะ Role SW) */
export default function ConfigImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Config Import</h1>
        <p className="text-sm text-muted-foreground">
          นำเข้า Config จากไฟล์ JSON · สร้างได้เฉพาะ Role SW
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>อัปโหลดไฟล์</CardTitle>
          <CardDescription>รองรับไฟล์ .json เท่านั้น</CardDescription>
        </CardHeader>
        <CardContent>
          <ImportConfigForm />
        </CardContent>
      </Card>
    </div>
  );
}
