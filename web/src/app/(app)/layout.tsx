import { AppShell } from "@/components/app-shell/app-shell";
import { AuthGuard } from "@/components/auth/auth-guard";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      {/* ผู้ถือข้อมูลแจ้งเตือนจุดเดียว ต้องอยู่ใต้ AuthGuard (ใช้ token) */}
      <NotificationsProvider>
        <AppShell>{children}</AppShell>
      </NotificationsProvider>
    </AuthGuard>
  );
}
