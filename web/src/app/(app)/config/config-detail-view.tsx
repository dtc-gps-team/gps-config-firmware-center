"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { canUpdateConfig } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  deleteConfig,
  type Config,
  type ConfigVersion,
} from "@/lib/config-api";
import { CONFIG_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useConfig } from "@/hooks/use-config";
import { useConfigVersions } from "@/hooks/use-config-versions";

/** value ของ field อาจเป็น object/array — โชว์เป็น JSON indent, string โชว์ตรงๆ */
function renderFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** JSON รูปที่ import กลับได้ (`ConfigWriteInput`) — ใช้กับปุ่มคัดลอก */
function toImportJson(config: Config): string {
  return JSON.stringify(
    {
      name: config.name,
      ...(config.description ? { description: config.description } : {}),
      deviceModel: config.deviceModel,
      protocol: config.protocol,
      fields: config.fields,
    },
    null,
    2,
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}

export function ConfigDetailView({ configId }: { configId: string }) {
  const { data, isLoading, error, refetch } = useConfig(configId);
  const versions = useConfigVersions(configId);

  if (isLoading && !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลด Config…
      </p>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{error ?? "ไม่พบ Config นี้"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/config"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ConfigDetailContent
      key={data.id}
      config={data}
      versions={versions.data ?? []}
    />
  );
}

function ConfigDetailContent({
  config,
  versions,
}: {
  config: Config;
  versions: ConfigVersion[];
}) {
  const router = useRouter();
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canModify =
    config.status === "draft" && canUpdateConfig(session?.role);
  const fieldEntries = Object.entries(config.fields);
  const importJson = useMemo(() => toImportJson(config), [config]);
  const latestVersion = versions[0]?.versionNumber ?? null;

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(importJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleDelete() {
    if (!session?.accessToken) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConfig(session.accessToken, config.id);
      router.push("/config");
      router.refresh();
    } catch (err) {
      setDeleting(false);
      setDeleteError(
        err instanceof ApiError ? err.message : "ลบ Config ไม่สำเร็จ",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/config"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการ Config
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-words">{config.name}</h1>
          <span
            className={pillClass(
              CONFIG_STATUS_TONE[config.status] ?? "neutral",
            )}
          >
            {config.status}
          </span>
          {latestVersion != null && (
            <span className="text-sm text-muted-foreground">
              เวอร์ชัน {latestVersion}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copyJson}>
          {copied ? (
            <>
              <CheckIcon /> คัดลอกแล้ว
            </>
          ) : (
            <>
              <CopyIcon /> คัดลอก JSON
            </>
          )}
        </Button>
        <Link
          href={`/config/new?from=${encodeURIComponent(config.id)}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          โคลน Config
        </Link>
        {canModify && (
          <>
            <Link
              href={`/config/${config.id}/edit`}
              className={buttonVariants({ size: "sm" })}
            >
              แก้ไข
            </Link>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              ลบ
            </Button>
          </>
        )}
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm">
            ลบ Config &ldquo;{config.name}&rdquo; ถาวร? กู้คืนไม่ได้
          </p>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "กำลังลบ…" : "ยืนยันลบ"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex flex-col gap-6">
          {config.description?.trim() && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {config.description}
            </p>
          )}

          <div className="rounded-xl border bg-card p-4">
            <div className="divide-y">
              <InfoRow label="รุ่นอุปกรณ์">{config.deviceModel}</InfoRow>
              <InfoRow label="โปรโตคอล">{config.protocol}</InfoRow>
              <InfoRow label="สร้างโดย">
                <span className="font-mono text-xs">{config.createdBy}</span>
              </InfoRow>
              <InfoRow label="ผู้อนุมัติ">
                {config.approvedBy ? (
                  <span className="font-mono text-xs">{config.approvedBy}</span>
                ) : (
                  "-"
                )}
              </InfoRow>
              <InfoRow label="สร้างเมื่อ">
                {formatDateTime(config.createdAt)}
              </InfoRow>
              <InfoRow label="แก้ไขล่าสุด">
                {formatDateTime(config.updatedAt)}
              </InfoRow>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              พารามิเตอร์{" "}
              <span className="text-muted-foreground">
                ({fieldEntries.length})
              </span>
            </p>
            {fieldEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ยังไม่ได้ตั้งค่าพารามิเตอร์
              </p>
            ) : (
              <div className="divide-y rounded-lg border">
                {fieldEntries.map(([key, value]) => {
                  const rendered = renderFieldValue(value);
                  const multiline = rendered.includes("\n");
                  return (
                    <div
                      key={key}
                      className="flex justify-between gap-4 px-3 py-2 text-sm"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {key}
                      </span>
                      <span
                        className={
                          "min-w-0 font-mono text-xs break-words whitespace-pre-wrap " +
                          (multiline ? "text-left" : "text-right")
                        }
                      >
                        {rendered}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {versions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">ประวัติเวอร์ชัน</p>
              <ul className="divide-y rounded-lg border text-sm">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                  >
                    <span>เวอร์ชัน {v.versionNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      อนุมัติ {formatDateTime(v.approvedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">Config JSON</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
            <code>{importJson}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
