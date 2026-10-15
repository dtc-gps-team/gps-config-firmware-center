"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { CloneSourceLink } from "@/components/config/clone-source-link";
import { SensitiveValue } from "@/components/sensitive-value";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useConfigVersions } from "@/hooks/use-config-versions";
import { useUserNames } from "@/hooks/use-user-names";
import { ApiError } from "@/lib/api";
import { simulateConfig, type SimulationResult } from "@/lib/config-api";
import { resolveDiffBase } from "@/lib/config-diff-base";
import {
  diffConfigFields,
  type FieldChange,
  type FieldChangeKind,
} from "@/lib/config-diff";
import { formatDateTime } from "@/lib/format-date";
import { canDecideConfigApproval } from "@/lib/permissions";
import {
  CONFIG_STATUS_TONE,
  EntityTypeTag,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { ApprovalActions } from "./approval-actions";

const CHANGE_LABEL: Record<FieldChangeKind, string> = {
  added: "เพิ่ม",
  changed: "แก้ไข",
  removed: "ลบ",
};

const UNCATEGORIZED = "อื่นๆ";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function ValueCell({ value, masked }: { value: unknown; masked: boolean }) {
  if (masked) return <SensitiveValue value={value} />;
  return (
    <span className="min-w-0 font-mono text-xs break-words">
      {valueText(value)}
    </span>
  );
}

type FieldMeta = {
  category: string;
  sensitive: boolean;
  restartRequired: boolean;
};

export function ConfigApprovalDetailView({ configId }: { configId: string }) {
  const { data, isLoading, error, refetch } = useConfig(configId);

  if (isLoading && !data) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {error ?? "ไม่พบ Config นี้"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/approvals"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไป Approval Center
          </Link>
        </div>
      </div>
    );
  }

  return <Content key={data.id} config={data} />;
}

function Content({
  config,
}: {
  config: NonNullable<ReturnType<typeof useConfig>["data"]>;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const canDecide = canDecideConfigApproval(session?.role);
  const versions = useConfigVersions(config.id);
  const definitions = useConfigDefinitions();
  const { resolveName } = useUserNames();

  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const inQueue = config.status === "testing";
  const definitionsReady = !definitions.isLoading && definitions.data !== null;
  // ต้นทางของสำเนา (clonedFromId) — ใช้เทียบเมื่อ Config นี้ยังไม่เคยอนุมัติ
  // (id เป็น null = ไม่ใช่สำเนา ผลของ hook ทั้งสองไม่ถูกใช้)
  const source = useConfig(config.clonedFromId);
  const sourceVersions = useConfigVersions(config.clonedFromId);

  const metaByField = useMemo(() => {
    const map = new Map<string, FieldMeta>();
    for (const d of definitions.data ?? []) {
      map.set(d.fieldName, {
        category: d.category ?? UNCATEGORIZED,
        sensitive: d.sensitive,
        restartRequired: d.restartRequired,
      });
    }
    return map;
  }, [definitions.data]);

  // ก่อน definitions โหลดเสร็จ treat ทุก field เป็น sensitive ไว้ก่อน กัน
  // plaintext หลุดช่วงสั้นๆ (เหมือน config-detail-view.tsx)
  const isMasked = (fieldName: string) =>
    !definitionsReady || (metaByField.get(fieldName)?.sensitive ?? false);
  const needsAttention = (fieldName: string) => {
    const m = metaByField.get(fieldName);
    return !!m && (m.sensitive || m.restartRequired);
  };

  const resolved = resolveDiffBase({
    config,
    ownVersions: versions,
    source,
    sourceVersions,
  });
  const baseFields =
    resolved.kind === "own" ||
    resolved.kind === "source-version" ||
    resolved.kind === "source-current"
      ? resolved.fields
      : null;
  const diff = useMemo(
    () => (baseFields ? diffConfigFields(baseFields, config.fields) : null),
    [baseFields, config.fields],
  );
  const baseColumnLabel =
    resolved.kind === "own"
      ? `เวอร์ชันที่ ${resolved.versionNumber}`
      : resolved.kind === "source-version"
        ? `ต้นทาง (เวอร์ชันที่ ${resolved.versionNumber})`
        : resolved.kind === "source-current"
          ? "ต้นทาง (ค่าปัจจุบัน)"
          : "ค่าเดิม";
  const changedNames = useMemo(
    () => new Set(diff?.changes.map((c) => c.fieldName) ?? []),
    [diff],
  );

  // field ที่ต้องระวัง (sensitive / ต้อง restart) ขึ้นก่อน แล้วเรียงตามชื่อ
  const orderedChanges = useMemo<FieldChange[]>(() => {
    if (!diff) return [];
    return [...diff.changes].sort((a, b) => {
      const flag =
        Number(needsAttention(b.fieldName)) -
        Number(needsAttention(a.fieldName));
      return flag !== 0 ? flag : a.fieldName.localeCompare(b.fieldName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, metaByField]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const byCategory = new Map<string, string[]>();
    for (const name of Object.keys(config.fields).sort()) {
      if (term && !name.toLowerCase().includes(term)) continue;
      if (onlyChanged && !changedNames.has(name)) continue;
      const category = metaByField.get(name)?.category ?? UNCATEGORIZED;
      byCategory.set(category, [...(byCategory.get(category) ?? []), name]);
    }
    return [...byCategory.entries()].sort(([a], [b]) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
  }, [config.fields, search, onlyChanged, changedNames, metaByField]);

  async function reSimulate() {
    if (!session?.accessToken) return;
    setSimRunning(true);
    setSimError(null);
    setSim(null);
    try {
      setSim(await simulateConfig(session.accessToken, config.id));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ";
      setSimError(message);
      toast.error(message);
    } finally {
      setSimRunning(false);
    }
  }

  const fieldCount = Object.keys(config.fields).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/approvals"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Approval Center
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <EntityTypeTag type="Config" />
              <h1 className="text-2xl font-semibold">{config.name}</h1>
              <StatusPill tone={CONFIG_STATUS_TONE[config.status] ?? "neutral"}>
                {statusLabel(config.status)}
              </StatusPill>
            </div>
            {config.description && (
              <p className="text-sm text-muted-foreground">
                {config.description}
              </p>
            )}
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">โมเดล</dt>
                <dd>{config.deviceModel}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">โปรโตคอล</dt>
                <dd>{config.protocol}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">ผู้สร้าง</dt>
                <dd>{resolveName(config.createdBy)}</dd>
              </div>
              {config.clonedFromId && (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">โคลนจาก</dt>
                  <dd>
                    <CloneSourceLink
                      sourceId={config.clonedFromId}
                      sourceName={source.data?.name ?? null}
                      unavailable={source.error !== null && source.data === null}
                    />
                  </dd>
                </div>
              )}
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">เข้าคิวเมื่อ</dt>
                <dd>{formatDateTime(config.updatedAt)}</dd>
              </div>
              {config.suggestedApproverId && (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">เจาะจงถึง</dt>
                  <dd>{resolveName(config.suggestedApproverId)}</dd>
                </div>
              )}
            </dl>
          </div>
          {inQueue && (
            <ApprovalActions
              configId={config.id}
              configName={config.name}
              canDecide={canDecide}
              onDecided={() => router.push("/approvals")}
            />
          )}
        </div>
      </div>

      {!inQueue && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Config นี้ไม่อยู่ในคิวรออนุมัติแล้ว (สถานะ{" "}
          {statusLabel(config.status)}) อาจมีคนตัดสินใจไปก่อนหน้านี้
        </div>
      )}

      <Card className="gap-3 p-4">
        <p className="text-sm font-medium">
          {resolved.kind === "source-version" ||
          resolved.kind === "source-current"
            ? `สิ่งที่ต่างจาก Config ต้นทาง: ${resolved.sourceName}`
            : "สิ่งที่เปลี่ยนจากเวอร์ชันที่อนุมัติล่าสุด"}
        </p>

        {resolved.kind === "own-error" ? (
          <p className="text-sm text-destructive">{resolved.message}</p>
        ) : resolved.kind === "loading" ? (
          <p className="text-sm text-muted-foreground">
            กำลังโหลดประวัติเวอร์ชัน
          </p>
        ) : resolved.kind === "source-unavailable" ? (
          <p className="text-sm text-muted-foreground">
            {resolved.message} ทุกค่าด้านล่างเป็นค่าใหม่ทั้งหมด ({fieldCount}{" "}
            ค่า)
          </p>
        ) : resolved.kind === "none" || !diff ? (
          <p className="text-sm text-muted-foreground">
            Config นี้ยังไม่เคยถูกอนุมัติ จึงไม่มีเวอร์ชันให้เทียบ
            ทุกค่าด้านล่างเป็นค่าใหม่ทั้งหมด ({fieldCount} ค่า)
          </p>
        ) : (
          <>
            {resolved.kind === "own" ? (
              <p className="text-sm text-muted-foreground">
                เทียบกับเวอร์ชันที่ {resolved.versionNumber}{" "}
                อนุมัติแล้วจะเป็นเวอร์ชันที่ {resolved.versionNumber + 1}
              </p>
            ) : resolved.kind === "source-version" ? (
              <p className="text-sm text-muted-foreground">
                เทียบกับเวอร์ชันที่ {resolved.versionNumber} ของต้นทาง
                Config นี้ยังไม่เคยอนุมัติ อนุมัติแล้วจะเป็นเวอร์ชันที่ 1
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                ต้นทางยังไม่เคยอนุมัติ จึงเทียบกับค่าปัจจุบันของต้นทาง
                Config นี้ยังไม่เคยอนุมัติ อนุมัติแล้วจะเป็นเวอร์ชันที่ 1
              </p>
            )}
            {(resolved.kind === "source-version" ||
              resolved.kind === "source-current") &&
              resolved.crossModel && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  ต้นทางเป็น {resolved.crossModel.deviceModel} /{" "}
                  {resolved.crossModel.protocol} ต่างจาก Config นี้ (
                  {config.deviceModel} / {config.protocol}) ค่าที่ไม่มีในโมเดลนี้
                  จะขึ้นเป็น ลบ
                </div>
              )}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                เพิ่ม {diff.counts.added}
              </span>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                แก้ไข {diff.counts.changed}
              </span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                ลบ {diff.counts.removed}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                ไม่เปลี่ยน {diff.unchangedCount}
              </span>
            </div>

            {orderedChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ค่าทุกตัวเหมือนเวอร์ชันที่อนุมัติล่าสุด
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                {/* ส่วนหัวคอลัมน์ (เฉพาะจอ sm ขึ้นไป) — ค่าเดิมกับค่าใหม่แยก
                    คอลัมน์ให้สายตาไล่ลงมาเทียบได้ ไม่ต้องอ่านทีละบรรทัด */}
                <div
                  className="hidden gap-3 border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)_4rem]"
                  role="row"
                >
                  <span>ชื่อฟิลด์</span>
                  <span>{baseColumnLabel}</span>
                  <span>Config นี้</span>
                  <span>ประเภท</span>
                </div>
                <div className="divide-y">
                  {orderedChanges.map((c) => (
                    <div
                      key={c.fieldName}
                      className="grid grid-cols-[minmax(0,1fr)] gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)_4rem] sm:items-start sm:gap-3"
                    >
                      <span className="flex items-center gap-1 font-mono text-muted-foreground">
                        {c.fieldName}
                        {needsAttention(c.fieldName) && (
                          <span
                            title={
                              metaByField.get(c.fieldName)?.restartRequired
                                ? "ต้อง Restart กล่องหลังเปลี่ยนค่านี้"
                                : "ค่าอ่อนไหว"
                            }
                          >
                            <TriangleAlertIcon className="size-3.5 text-amber-600" />
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          c.kind === "added"
                            ? "min-w-0 rounded px-1.5 py-0.5 text-muted-foreground"
                            : "min-w-0 rounded bg-rose-50 px-1.5 py-0.5 dark:bg-rose-950/40"
                        }
                      >
                        <span className="text-muted-foreground sm:hidden">
                          {baseColumnLabel}:{" "}
                        </span>
                        {c.kind === "added" ? (
                          "-"
                        ) : (
                          <ValueCell
                            value={c.before}
                            masked={isMasked(c.fieldName)}
                          />
                        )}
                      </span>
                      <span
                        className={
                          c.kind === "removed"
                            ? "min-w-0 rounded px-1.5 py-0.5 text-muted-foreground"
                            : "min-w-0 rounded bg-emerald-50 px-1.5 py-0.5 dark:bg-emerald-950/40"
                        }
                      >
                        <span className="text-muted-foreground sm:hidden">
                          Config นี้:{" "}
                        </span>
                        {c.kind === "removed" ? (
                          "-"
                        ) : (
                          <ValueCell
                            value={c.after}
                            masked={isMasked(c.fieldName)}
                          />
                        )}
                      </span>
                      <span className="font-medium">
                        {CHANGE_LABEL[c.kind]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              ไอคอนเตือนหมายถึงค่าอ่อนไหวหรือค่าที่ต้อง Restart กล่องหลังเปลี่ยน
              ขึ้นก่อนค่าอื่น
            </p>
          </>
        )}
      </Card>

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            ค่าทั้งหมด{" "}
            <span className="text-muted-foreground">({fieldCount})</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyChanged}
                disabled={!diff}
                onChange={(e) => setOnlyChanged(e.target.checked)}
              />
              แสดงเฉพาะที่เปลี่ยน
            </label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ field"
              aria-label="ค้นหาชื่อ field"
              className="h-8 max-w-56"
            />
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {fieldCount === 0
              ? "ไม่มีพารามิเตอร์"
              : "ไม่พบ field ที่ตรงกับเงื่อนไข"}
          </p>
        ) : (
          groups.map(([category, names]) => (
            <section key={category} className="flex flex-col gap-1">
              <h2 className="text-xs font-medium text-muted-foreground">
                {category} ({names.length})
              </h2>
              <div className="divide-y rounded-lg border">
                {names.map((name) => (
                  <div
                    key={name}
                    className="flex justify-between gap-4 px-3 py-1.5 text-xs"
                  >
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-muted-foreground">
                      {name}
                      {changedNames.has(name) && (
                        <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          เปลี่ยน
                        </span>
                      )}
                    </span>
                    <ValueCell
                      value={config.fields[name]}
                      masked={isMasked(name)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </Card>

      <Card className="gap-3 p-4">
        <p className="text-sm font-medium">ทดสอบซ้ำ</p>
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
            <StatusPill tone={sim.passed ? "success" : "danger"}>
              {sim.passed ? "ผ่าน" : "ไม่ผ่าน"}
            </StatusPill>
          )}
          {simError && (
            <span className="text-xs text-destructive">{simError}</span>
          )}
        </div>
        {sim && sim.details.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {sim.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
