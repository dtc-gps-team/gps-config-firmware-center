import Link from "next/link";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** กรอบแผงบน Dashboard — สูงเต็มช่อง grid (แผงข้างกันสูงเท่ากัน) · `href`
 *  ทำให้ชื่อแผงเป็นลิงก์ · `action` คือลิงก์/ปุ่มมุมขวาบน */
export function Panel({
  title,
  href,
  description,
  action,
  children,
  className,
}: {
  title: string;
  href?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {href ? (
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/** ข้อความสถานะว่างของแผง (ไม่มีรายการ / ยังไม่มีข้อมูล) */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
