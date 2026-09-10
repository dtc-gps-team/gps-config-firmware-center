"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { canDecideConfigApproval } from "@/lib/permissions";
import { getTokenSubject } from "@/lib/jwt";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { ApprovalCard } from "./approval-card";

export function ApprovalCenterView() {
  const { session } = useAuth();
  const canDecide = canDecideConfigApproval(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;
  const { data, isLoading, error, refetch } = usePendingApprovals();
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine">("all");

  const allItems = useMemo(() => data ?? [], [data]);
  const mineCount = useMemo(
    () =>
      myUserId
        ? allItems.filter((i) => i.suggestedApprover?.id === myUserId).length
        : 0,
    [allItems, myUserId],
  );
  const items =
    tab === "mine" && myUserId
      ? allItems.filter((i) => i.suggestedApprover?.id === myUserId)
      : allItems;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <p className="text-sm text-muted-foreground">
          Config ที่ผ่านการทดสอบแล้ว รอ Operation อนุมัติ ·{" "}
          {canDecide
            ? "คุณอนุมัติ/ปฏิเสธได้"
            : "เฉพาะ Operation ที่อนุมัติ/ปฏิเสธได้ — คุณดูได้อย่างเดียว"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            รออนุมัติ{" "}
            <span className="text-muted-foreground">({allItems.length})</span>
          </CardTitle>
          <CardDescription>
            สถานะ Config = testing (ผ่าน simulation + SW ปักผลผ่านแล้ว)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canDecide && myUserId && (
            <div className="flex gap-1 border-b pb-2 text-sm">
              <button
                type="button"
                onClick={() => setTab("all")}
                className={
                  "rounded-md px-3 py-1 " +
                  (tab === "all"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                ทั้งหมด ({allItems.length})
              </button>
              <button
                type="button"
                onClick={() => setTab("mine")}
                className={
                  "rounded-md px-3 py-1 " +
                  (tab === "mine"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                เจาะจงถึงฉัน ({mineCount})
              </button>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {notice}
            </div>
          )}

          {isLoading && data === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              กำลังโหลด…
            </p>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                ลองใหม่
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tab === "mine"
                ? "ไม่มี Config ที่เจาะจงถึงคุณ"
                : "ไม่มี Config รออนุมัติ"}
            </p>
          ) : (
            items.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                canDecide={canDecide}
                onDecided={(action) => {
                  setNotice(
                    action === "approve"
                      ? `อนุมัติ "${item.name}" แล้ว`
                      : `ปฏิเสธ "${item.name}" แล้ว`,
                  );
                  void refetch();
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
