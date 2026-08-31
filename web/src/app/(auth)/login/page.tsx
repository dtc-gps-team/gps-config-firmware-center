import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = {
  title: "เข้าสู่ระบบ | GPS Config Center",
};

/**
 * Scaffold เท่านั้น — ยังไม่เรียก POST /auth/login จริง (backend #23 เสร็จ
 * แล้ว แต่ยังไม่ต่อ Web auth context/fetch client ฝั่งนี้ ไม่ใช่ scope ของ #27)
 */
export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>เข้าสู่ระบบ</CardTitle>
        <CardDescription>GPS Config &amp; Firmware Center</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" autoComplete="username" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full">
            เข้าสู่ระบบ
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <Link
          href="/"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ดูตัวอย่าง Dashboard (dev only)
        </Link>
      </CardFooter>
    </Card>
  );
}
