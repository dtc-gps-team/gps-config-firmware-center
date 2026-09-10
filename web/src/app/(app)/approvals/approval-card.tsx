"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { simulateConfig, type SimulationResult } from "@/lib/config-api";
import { Button } from "@/components/ui/button";
import { pillClass } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useConfigVersions } from "@/hooks/use-config-versions";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import { ApprovalActions } from "./approval-actions";

function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function ApprovalCard({
  item,
  canDecide,
  onDecided,
}: {
  item: PendingApproval;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">
              {item.deviceModel} · {item.protocol}
            </span>
          </div>
          {item.description && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            ผู้สร้าง{" "}
            <span className="font-mono">{item.createdBy}</span> · เข้าคิว{" "}
            {formatDateTime(item.queuedAt)}
          </p>
          {item.suggestedApprover && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              เจาะจงถึง: {item.suggestedApprover.fullName}
            </span>
          )}
        </div>
        <ApprovalActions
          configId={item.id}
          configName={item.name}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      </div>

      <div className="border-t px-4 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronUpIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
          ดูค่า Config ({Object.keys(item.fields).length}) · ทดสอบซ้ำ
        </button>
        {expanded && <ApprovalDetail item={item} />}
      </div>
    </div>
  );
}

function ApprovalDetail({ item }: { item: PendingApproval }) {
  const { session } = useAuth();
  const versions = useConfigVersions(item.id);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const latestVersion = versions.data?.[0]?.versionNumber ?? null;
  const fieldEntries = Object.entries(item.fields);

  async function reSimulate() {
    if (!session?.accessToken) return;
    setSimRunning(true);
    setSimError(null);
    setSim(null);
    try {
      setSim(await simulateConfig(session.accessToken, item.id));
    } catch (err) {
      setSimError(
        err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ",
      );
    } finally {
      setSimRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-3 pb-1">
      <p className="text-xs text-muted-foreground">
        {latestVersion != null
          ? `อนุมัติแล้วจะเป็นเวอร์ชันที่ ${latestVersion + 1} (เวอร์ชันล่าสุด ${latestVersion})`
          : "อนุมัติแล้วจะเป็นเวอร์ชันแรก"}
      </p>

      {fieldEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">ไม่มีพารามิเตอร์</p>
      ) : (
        <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
          {fieldEntries.map(([key, value]) => (
            <div
              key={key}
              className="flex justify-between gap-4 px-3 py-1.5 text-xs"
            >
              <span className="shrink-0 font-mono text-muted-foreground">
                {key}
              </span>
              <span className="min-w-0 font-mono break-words">
                {fieldValueText(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={simRunning}
          onClick={() => void reSimulate()}
        >
          {simRunning ? "กำลังทดสอบ…" : "ทดสอบซ้ำ"}
        </Button>
        {sim && (
          <span
            className={pillClass(sim.passed ? "success" : "danger")}
          >
            {sim.passed ? "ผ่าน" : "ไม่ผ่าน"}
          </span>
        )}
        {simError && <span className="text-xs text-destructive">{simError}</span>}
      </div>

      {sim && sim.details.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {sim.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
