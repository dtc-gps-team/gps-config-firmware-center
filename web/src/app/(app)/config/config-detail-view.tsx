"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  Trash2Icon,
  EyeIcon,
  EyeOffIcon,
  UserCheckIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DiffCounts, DiffViewer } from "@/components/diff-viewer";
import { ErrorState } from "@/components/error-state";
import { UrlTabs } from "@/components/url-tabs";
import { ConfigLifecycleSteps } from "@/components/config/lifecycle-steps";
import { RelativeTime } from "@/components/relative-time";
import { diffConfigFields } from "@/lib/config-diff";
import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig, canUpdateConfig } from "@/lib/permissions";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";
import { ApiError } from "@/lib/api";
import {
  deleteConfig,
  updateConfig,
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
      <div className="flex flex-col gap-3 py-8">
        <ErrorState
          message={error ?? "ไม่พบ Config นี้"}
          onRetry={() => void refetch()}
        />
        <Link
          href="/config"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}
        >
          กลับไปรายการ
        </Link>
      </div>
    );
  }

  return (
    <ConfigDetailContent
      key={data.id}
      config={data}
      versions={versions.data ?? []}
      onChanged={() => {
        void refetch();
        void versions.refetch();
      }}
    />
  );
}

function ConfigDetailContent({
  config,
  versions,
  onChanged,
}: {
  config: Config;
  versions: ConfigVersion[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const definitions = useConfigDefinitions();
  const { resolveName } = useUserNames();
  const [confirming, setConfirming] = useState(false);
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

  const [restoring, setRestoring] = useState<ConfigVersion | null>(null);

  /** ใส่ค่าจากเวอร์ชันที่อนุมัติแล้วกลับเข้า draft นี้ (ใช้ PUT เดิม แก้ได้เฉพาะ draft) */
  async function restoreVersion(v: ConfigVersion) {
    if (!session?.accessToken) return;
    try {
      await updateConfig(session.accessToken, config.id, { fields: v.fields });
      toast.success(`ใส่ค่าจากเวอร์ชัน ${v.versionNumber} กลับเข้า draft แล้ว`);
      onChanged();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "ใส่ค่ากลับไม่สำเร็จ";
      toast.error(message);
    }
  }

  async function handleDelete() {
    if (!session?.accessToken) return;
    setDeleteError(null);
    try {
      await deleteConfig(session.accessToken, config.id);
      toast.success(`ลบ "${config.name}" แล้ว`);
      router.push("/config");
      router.refresh();
    } catch (err) {
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
            ]}
          />
        }
        actions={
          <>
            <Button variant="outline" onClick={copyJson}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก JSON"}
            </Button>
            {canModify && (
              <Button
                variant="outline"
                size="icon"
                aria-label="ลบ Config นี้"
                title="ลบ Config นี้"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2Icon />
              </Button>
            )}
            {/* โคลน = คัดลอกชุดนี้ไปเป็น Config ใหม่แล้วแก้เฉพาะบางค่า ไม่ต้องใส่พารามิเตอร์ใหม่ทั้งหมด
                เป็นปุ่มหลักเมื่อแก้ชุดนี้ตรงๆ ไม่ได้ (อนุมัติแล้ว/อยู่ในคิว) */}
            {canCreateConfig(session?.role) && (
              <Link
                href={`/config/new?from=${encodeURIComponent(config.id)}`}
                title="คัดลอกค่าทั้งหมดไปเป็น Config ใหม่ แล้วแก้เฉพาะค่าที่ต้องการ"
                className={buttonVariants({ variant: canModify ? "outline" : "default" })}
              >
                <CopyIcon />
                โคลนไปสร้างชุดใหม่
              </Link>
            )}
            {canModify && (
              <Link
                href={`/config/${config.id}/edit`}
                className={buttonVariants()}
              >
                แก้ไข
              </Link>
            )}
          </>
        }
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="ลบ Config นี้?"
        description={
          <>
            ลบ &ldquo;{config.name}&rdquo; ถาวร กู้คืนไม่ได้
            {deleteError && (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันลบ"
        destructive
        onConfirm={handleDelete}
      />

      <ConfigLifecycleSteps status={config.status} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="พารามิเตอร์" value={String(fieldEntries.length)} hint="ค่าที่ตั้งใน Config นี้" />
        <StatTile
          label="เวอร์ชันที่อนุมัติ"
          value={latestVersion !== null ? `v${latestVersion}` : "ยังไม่มี"}
          hint={latestVersion !== null ? "ล่าสุด" : "เกิดเมื่อ Operation อนุมัติ"}
        />
        <StatTile
          label="แก้ไขล่าสุด"
          value={<RelativeTime iso={config.updatedAt} />}
          hint={formatDateTime(config.updatedAt)}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          {canModify && <ConfigReviewPanel config={config} />}
          {config.description?.trim() && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {config.description}
            </p>
          )}

          <UrlTabs
            tabs={[
              {
                id: "params",
                label: "พารามิเตอร์",
                count: fieldEntries.length,
                content: (
                  <ParamGroups
                    config={config}
                    definitions={definitions.data ?? []}
                    isMasked={(name) => effectiveSensitiveFieldNames.has(name)}
                  />
                ),
              },
              {
                id: "versions",
                label: "ประวัติเวอร์ชัน",
                count: versions.length,
                content: (
                  <VersionHistory
                    config={config}
                    versions={versions}
                    isMasked={(name) => effectiveSensitiveFieldNames.has(name)}
                    onRestore={canModify ? setRestoring : undefined}
                  />
                ),
              },
            ]}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
          <Card className="p-4">
            <div className="divide-y">
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
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Config JSON</p>
              {effectiveSensitiveFieldNames.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSensitiveJson((v) => !v)}
                  className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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
            <pre className="max-h-[28rem] overflow-auto rounded-lg border bg-surface-sunken p-3 font-instrument text-xs">
              <code>{displayedJson}</code>
            </pre>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title={`ใส่ค่าจากเวอร์ชัน ${restoring?.versionNumber ?? ""} กลับเข้า draft?`}
        description="ค่าทุกช่องใน draft นี้จะถูกแทนที่ด้วยค่าของเวอร์ชันนั้น ค่าที่แก้ค้างอยู่จะหายไป ส่งขออนุมัติใหม่อีกครั้งหลังตรวจ"
        confirmLabel="ใส่ค่ากลับ"
        onConfirm={async () => {
          if (restoring) await restoreVersion(restoring);
        }}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-4 py-3">
      <span className="label-caps text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

const UNCATEGORIZED = "อื่นๆ";

/** พารามิเตอร์จัดกลุ่มตามหมวดจากคลัง Parameter (ยังไม่รู้หมวด/โหลดไม่ได้ = กลุ่ม "อื่นๆ") */
function ParamGroups({
  config,
  definitions,
  isMasked,
}: {
  config: Config;
  definitions: ConfigFieldDefinition[];
  isMasked: (name: string) => boolean;
}) {
  const defByName = useMemo(() => new Map(definitions.map((d) => [d.fieldName, d])), [definitions]);
  const groups = useMemo(() => {
    const category = new Map(definitions.map((d) => [d.fieldName, d.category ?? UNCATEGORIZED]));
    const out = new Map<string, [string, unknown][]>();
    for (const entry of Object.entries(config.fields)) {
      const key = category.get(entry[0]) ?? UNCATEGORIZED;
      out.set(key, [...(out.get(key) ?? []), entry]);
    }
    return [...out.entries()].sort(([a], [b]) =>
      a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b),
    );
  }, [config.fields, definitions]);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่ได้ตั้งค่าพารามิเตอร์ กด &ldquo;แก้ไข&rdquo; เพื่อเพิ่ม
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([name, entries]) => (
        <section key={name} aria-label={name} className="flex flex-col gap-1.5">
          <h2 className="label-caps text-muted-foreground">
            {name} <span className="tabular-nums">({entries.length})</span>
          </h2>
          <div className="divide-y rounded-lg border bg-card">
            {entries.map(([key, value]) => {
              const rendered = renderFieldValue(value);
              const multiline = rendered.includes("\n");
              const def = defByName.get(key);
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-instrument text-xs font-medium">{key}</span>
                      {def?.restartRequired && (
                        <span className="rounded-full bg-warning-subtle px-1.5 text-[0.65rem] whitespace-nowrap text-warning-foreground">
                          ต้อง Restart
                        </span>
                      )}
                    </span>
                    {def?.description && (
                      <span className="text-xs text-muted-foreground">{def.description}</span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    {isMasked(key) ? (
                      <SensitiveValue value={value} />
                    ) : (
                      <span
                        className={
                          "min-w-0 rounded bg-surface-sunken px-2 py-0.5 font-instrument text-xs break-words whitespace-pre-wrap " +
                          (multiline ? "text-left" : "text-right")
                        }
                      >
                        {rendered}
                      </span>
                    )}
                    {def?.unit && (
                      <span className="text-xs text-muted-foreground">{def.unit}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** ประวัติเวอร์ชันที่อนุมัติ (ใหม่ไปเก่า) กดดูส่วนต่างเทียบค่าปัจจุบันได้ · draft ใส่ค่าจากเวอร์ชันเก่ากลับได้ */
function VersionHistory({
  config,
  versions,
  isMasked,
  onRestore,
}: {
  config: Config;
  versions: ConfigVersion[];
  isMasked: (name: string) => boolean;
  onRestore?: (v: ConfigVersion) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { resolveName } = useUserNames();

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่มีเวอร์ชันที่อนุมัติ เวอร์ชันแรกเกิดเมื่อ Operation อนุมัติ
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border text-sm">
      {versions.map((v) => {
        const open = openId === v.id;
        const diff = open ? diffConfigFields(v.fields, config.fields) : null;
        return (
          <li key={v.id} className="flex flex-col gap-3 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <HistoryIcon className="size-3.5 text-muted-foreground" />
                <span className="font-medium">เวอร์ชัน {v.versionNumber}</span>
                <span className="text-xs text-muted-foreground">
                  อนุมัติ {formatDateTime(v.approvedAt)} โดย {resolveName(v.approvedBy)}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : v.id)}
                >
                  {open ? "ซ่อนส่วนต่าง" : "เทียบกับค่าปัจจุบัน"}
                </Button>
                {onRestore && (
                  <Button size="sm" variant="outline" onClick={() => onRestore(v)}>
                    ใส่ค่ากลับเข้า draft
                  </Button>
                )}
              </span>
            </div>
            {diff && (
              <div className="flex flex-col gap-2">
                <DiffCounts counts={diff.counts} unchangedCount={diff.unchangedCount} />
                {diff.changes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    ค่าปัจจุบันเหมือนเวอร์ชันนี้ทุกช่อง
                  </p>
                ) : (
                  <DiffViewer
                    changes={diff.changes}
                    beforeLabel={`เวอร์ชัน ${v.versionNumber}`}
                    afterLabel="ค่าปัจจุบัน"
                    isMasked={isMasked}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
