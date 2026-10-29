"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { dashboardView } from "@/lib/dashboard-view";
import { DashboardPanelRow } from "./dashboard-role-panels";
import { DashboardSummary } from "./dashboard-summary";

/**
 * ประกอบ Dashboard ตามมุมมองของ Role (ดู `lib/dashboard-view.ts`): แถวเฉพาะ Role
 * → การ์ดความเสี่ยง/แผงกลางหน้า (DashboardSummary) → แผงท้ายหน้า
 */
export function DashboardRoleLayout() {
  const { session } = useAuth();
  const view = dashboardView(session?.role);

  return (
    <>
      <DashboardPanelRow panels={view.focus} />
      <DashboardSummary />
      <DashboardPanelRow panels={view.lower} />
    </>
  );
}
