"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  RadioIcon,
  SlidersHorizontalIcon,
  UserCheckIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { canUpdateConfig } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  deleteConfig,
  type Config,
  type ConfigVersion,
} from "@/lib/config-api";
import {
  CONFIG_STATUS_TONE,
  getConfigNextStepMessage,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { nestFields } from "@/lib/config-fields";
import { useConfig } from "@/hooks/use-config";
import { useConfigVersions } from "@/hooks/use-config-versions";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useUserNames } from "@/hooks/use-user-names";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { CloneSourceLinkLoader } from "@/components/config/clone-source-link";
import { ConfigFieldLabel } from "@/components/config/config-field-label";
import { useDescriptionByField } from "@/components/config/use-description-by-field";
import { SensitiveValue } from "@/components/sensitive-value";
import { PageHeader, PageHeaderMeta } from "@/components/page-header";
import { ConfigReviewPanel } from "./config-review-panel";

const MASKED_JSON_PLACEHOLDER = "••••••••";

/** value ของ field อาจเป็น object/array — โชว์เป็น JSON indent, string โชว์ตรงๆ */
function renderFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** โครง object ที่ import กลับได้ ร่วมกันทั้งของจริงและของ mask — รับ `fields`
 * (คีย์แบบมีจุด) เป็น parameter แยก กันโครงสร้างสองฟังก์ชันเพี้ยนออกจากกันใน
 * อนาคต (JSON preview ที่ mask กับที่คัดลอกจริงต้องตรงกันเป๊ะยกเว้นค่า field)
 * — ส่งออกเป็น `settings` ซ้อนชั้น (ไม่ใช่ `fields` แบนเหมือนเดิม) ให้ตรงกับ
 * JSON ที่ส่งเข้า Server กลางจริงของพี่เลี้ยง เพราะ JSON นี้มีคนเอาไป import
 * ใช้งานจริง ไม่ใช่แค่ดูเฉยๆ (รีวิวพี่เลี้ยง 27 ต.ค. 2569) — `POST /config/import`
 * (v3.67) รองรับทั้ง `settings` ซ้อนชั้นนี้และ `fields` แบนแบบเดิม (ไฟล์เก่า) */
function buildImportPayload(config: Config, fields: Record<string, unknown>) {
  return {
    name: config.name,
    ...(config.description ? { description: config.description } : {}),
    deviceModel: config.deviceModel,
    protocol: config.protocol,
    settings: nestFields(fields),
  };
}

/** JSON รูปที่ import กลับได้ (`settings` ซ้อนชั้น, v3.67) — ใช้กับปุ่มคัดลอก */
function toImportJson(config: Config): string {
  return JSON.stringify(buildImportPayload(config, config.fields), null, 2);
}

/** เหมือน `toImportJson()` แต่แทนค่า field ที่อยู่ใน `sensitiveFieldNames`
 * ด้วย placeholder (issue #200 — จอแสดงผล/JSON preview ห้ามโชว์ plain text)
 * ใช้แค่ตอนแสดงผลเท่านั้น — ปุ่ม "คัดลอก JSON" ยังคงคัดลอกค่าจริงเสมอ เพราะ
 * เจตนาของ JSON นี้คือเอาไป import กลับ ถ้าคัดลอก placeholder ไปจะเขียนทับ
 * ค่าจริงในระบบเงียบๆ (เสียหายกว่าแค่โชว์บนจอ)  */
function toMaskedImportJson(
  config: Config,
  sensitiveFieldNames: Set<string>,
): string {
  const maskedFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.fields)) {
    maskedFields[key] = sensitiveFieldNames.has(key)
      ? MASKED_JSON_PLACEHOLDER
      : value;
  }
  return JSON.stringify(buildImportPayload(config, maskedFields), null, 2);
}

export function ConfigDetailView({ configId }: { configId: string }) {
  const { data, isLoading, error, refetch } = useConfig(configId);
  const versions = useConfigVersions(configId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
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
  const definitions = useConfigDefinitions();
  const { resolveName } = useUserNames();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSensitiveJson, setShowSensitiveJson] = useState(false);

  const canModify =
    config.status === "draft" && canUpdateConfig(session?.role);
  const fieldEntries = Object.entries(config.fields);
  const definitionsReady = !definitions.isLoading;
  const sensitiveFieldNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  const descriptionByField = useDescriptionByField(definitions.data);
  /** ก่อน `useConfigDefinitions()` โหลดเสร็จ ยังไม่รู้จริงๆ ว่า field ไหน
   * sensitive — treat ทุก field เป็น sensitive ไว้ก่อน (safe default) แทนที่
   * จะ default เป็น "ไม่ sensitive" ซึ่งจะเผย plaintext ไปก่อนช่วงสั้นๆ ถ้า
   * `useConfig`/`useConfigVersions` resolve เร็วกว่า (race condition) */
  const effectiveSensitiveFieldNames = useMemo(() => {
    if (!definitionsReady) {
      return new Set(Object.keys(config.fields));
    }
    return sensitiveFieldNames;
  }, [definitionsReady, sensitiveFieldNames, config.fields]);
  const importJson = useMemo(() => toImportJson(config), [config]);
  const displayedJson = useMemo(
    () =>
      showSensitiveJson
        ? importJson
        : toMaskedImportJson(config, effectiveSensitiveFieldNames),
    [config, importJson, effectiveSensitiveFieldNames, showSensitiveJson],
  );
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
      toast.success(`ลบ "${config.name}" แล้ว`);
      router.push("/config");
      router.refresh();
    } catch (err) {
      setDeleting(false);
      const message =
        err instanceof ApiError ? err.message : "ลบ Config ไม่สำเร็จ";
      setDeleteError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={config.name}
        breadcrumb={[{ label: config.name }]}
        status={
          <StatusPill tone={CONFIG_STATUS_TONE[config.status] ?? "neutral"}>
            {statusLabel(config.status)}
          </StatusPill>
        }
        description={getConfigNextStepMessage(config.status, session?.role)}
        meta={
          <PageHeaderMeta
            items={[
              { label: "โมเดล", value: config.deviceModel },
              { label: "โปรโตคอล", value: config.protocol },
              ...(latestVersion != null
                ? [{ label: "เวอร์ชัน", value: String(latestVersion) }]
                : []),
            ]}
          />
        }
        actions={
          <>
            <Button variant="outline" onClick={copyJson}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก JSON"}
            </Button>
            <Link
              href={`/config/new?from=${encodeURIComponent(config.id)}`}
              className={buttonVariants({ variant: "outline" })}
            >
              โคลน Config
            </Link>
            {canModify && (
              <>
                <Button variant="destructive" onClick={() => setConfirming(true)}>
                  ลบ
                </Button>
                <Link
                  href={`/config/${config.id}/edit`}
                  className={buttonVariants()}
                >
                  แก้ไข
                </Link>
              </>
            )}
          </>
        }
      />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบ Config นี้?</AlertDialogTitle>
            <AlertDialogDescription>
              ลบ Config &ldquo;{config.name}&rdquo; ถาวร? กู้คืนไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "กำลังลบ…" : "ยืนยันลบ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canModify && <ConfigReviewPanel config={config} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex flex-col gap-6">
          {config.description?.trim() && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {config.description}
            </p>
          )}

          <Card className="p-4">
            <div className="divide-y">
              <InfoRow label="โมเดล" icon={SlidersHorizontalIcon}>
                {config.deviceModel}
              </InfoRow>
              <InfoRow label="โปรโตคอล" icon={RadioIcon}>
                {config.protocol}
              </InfoRow>
              <InfoRow label="สร้างโดย" icon={UserIcon}>
                {resolveName(config.createdBy)}
              </InfoRow>
              {config.clonedFromId && (
                <InfoRow label="โคลนจาก" icon={CopyIcon}>
                  <CloneSourceLinkLoader sourceId={config.clonedFromId} />
                </InfoRow>
              )}
              <InfoRow label="ผู้อนุมัติ" icon={UserCheckIcon}>
                {config.approvedBy ? resolveName(config.approvedBy) : "-"}
              </InfoRow>
              <InfoRow label="สร้างเมื่อ" icon={CalendarIcon}>
                {formatDateTime(config.createdAt)}
              </InfoRow>
              <InfoRow label="แก้ไขล่าสุด" icon={ClockIcon}>
                {formatDateTime(config.updatedAt)}
              </InfoRow>
            </div>
          </Card>

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
                      className="flex items-start justify-between gap-4 px-3 py-2 text-sm"
                    >
                      <ConfigFieldLabel
                        className="min-w-0 max-w-[60%]"
                        fieldName={key}
                        description={descriptionByField.get(key)}
                      />
                      {effectiveSensitiveFieldNames.has(key) ? (
                        <SensitiveValue value={value} />
                      ) : (
                        <span
                          className={
                            "min-w-0 font-mono text-xs break-words whitespace-pre-wrap " +
                            (multiline ? "text-left" : "text-right")
                          }
                        >
                          {rendered}
                        </span>
                      )}
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Config JSON</p>
            {effectiveSensitiveFieldNames.size > 0 && (
              <button
                type="button"
                onClick={() => setShowSensitiveJson((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showSensitiveJson ? (
                  <>
                    <EyeOffIcon className="size-3.5" /> ซ่อนค่าอ่อนไหว
                  </>
                ) : (
                  <>
                    <EyeIcon className="size-3.5" /> แสดงค่าอ่อนไหว
                  </>
                )}
              </button>
            )}
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
            <code>{displayedJson}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
