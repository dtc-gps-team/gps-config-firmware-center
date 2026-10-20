import {
  FIELD_REPORT_SOURCE,
  type Incident,
  type IncidentStatus,
} from "@/lib/incident-api";

/**
 * ข้อความอ่านง่ายของ `Incident.source` — ใช้คำเดียวกับ Mobile
 * (`IncidentStyle.sourceLabel`) · `source` เป็น free string ใน schema จึงต้อง
 * รองรับค่าที่ไม่รู้จัก: คืน null ให้ผู้เรียกซ่อนแถวไปเลย ไม่เดาคำอธิบายให้
 */
export function incidentSourceLabel(source: string | null): string | null {
  switch (source) {
    case "field-report":
      return "แจ้งจากหน้างาน";
    case "config-sync-writer":
      return "ตรวจพบอัตโนมัติ";
    case "mobile-simulator-test":
      return "ผลทดสอบจากมือถือ";
    default:
      return null;
  }
}

/** เฉพาะ key ที่ backend ระบุไว้ใน `IncidentMetadata` และเป็นประโยชน์ต่อ
 * การตรวจสอบ — ค่าอื่นใน metadata ไม่แสดง (ไม่รู้โครงสร้างแน่นอน) */
export type IncidentTechnicalDetails = {
  versionNumber: number | null;
  attempts: number | null;
  lastError: string | null;
};

export function incidentTechnicalDetails(
  metadata: Record<string, unknown> | null,
): IncidentTechnicalDetails {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  return {
    versionNumber: num(metadata?.versionNumber),
    attempts: num(metadata?.attempts),
    lastError: str(metadata?.lastError),
  };
}

/**
 * ตัวช่วยแสดงผลหน้ารายการ Incident — แปลง `source` / `metadata` ที่ backend
 * ส่งมา (ค่าที่ระบบสร้างเอง ดู `incident-metadata.ts` ฝั่ง backend) เป็นข้อความ
 * ที่คนอ่านรู้เรื่อง · ไม่แตะ API: ใช้เฉพาะฟิลด์ที่ `GET /incidents` ส่งมาอยู่แล้ว
 */

export type IncidentType =
  | "rollout-failure"
  | "config-sync-writer"
  | "field-report"
  | "other";

export const INCIDENT_TYPE_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: "rollout-failure", label: "Rollout ล้มเหลว" },
  { value: "config-sync-writer", label: "เขียน Config ไม่สำเร็จ" },
  { value: "field-report", label: "แจ้งจากหน้างาน" },
  { value: "other", label: "อื่นๆ" },
];

/** ประเภทของ Incident จากต้นทางที่สร้าง — ค่า `source` ที่ไม่รู้จัก (หรือ null)
 * เป็น "other" แทนที่จะพังหรือหายจากรายการ */
export function incidentType(incident: Pick<Incident, "source">): IncidentType {
  switch (incident.source) {
    case "rollout-failure":
    case "config-sync-writer":
    case FIELD_REPORT_SOURCE:
      return incident.source;
    default:
      return "other";
  }
}

export function incidentTypeLabel(type: IncidentType): string {
  return INCIDENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? "อื่นๆ";
}

const ROLLOUT_KIND_LABEL: Record<string, string> = {
  "auto-pause": "หยุดอัตโนมัติ",
  "completed-with-failures": "จบแต่มีเครื่องล้มเหลว",
  "completed-with-skipped": "จบแต่มีเครื่องถูกข้าม",
};

/** ชนิดย่อยของ Incident จาก Rollout (`metadata.kind`) — null ถ้าไม่ใช่หรือไม่รู้จัก */
export function rolloutKindLabel(
  incident: Pick<Incident, "source" | "metadata">,
): string | null {
  if (incidentType(incident) !== "rollout-failure") return null;
  const kind = incident.metadata?.kind;
  return typeof kind === "string" ? (ROLLOUT_KIND_LABEL[kind] ?? null) : null;
}

function numberField(
  metadata: Incident["metadata"],
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** เปอร์เซ็นต์ทศนิยมไม่เกิน 1 ตำแหน่ง ไม่มี .0 ท้ายถ้าเป็นจำนวนเต็ม (20 ไม่ใช่ 20.0) */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 1000) / 10}%`;
}

export type IncidentImpact = {
  /** บรรทัดหลัก เช่น "ล้มเหลว 20 จาก 100 เครื่อง (20%)" */
  summary: string;
  /** บรรทัดรอง (ถ้ามี) เช่น "ข้ามเพราะออฟไลน์ 5 เครื่อง" */
  detail: string | null;
};

/**
 * ผลกระทบของ Incident — จำนวนเครื่องที่ได้รับผลกระทบ:
 *   - Rollout: ล้มเหลว X จาก Y เครื่อง (Z%) และจำนวนที่ถูกข้ามเพราะออฟไลน์
 *   - แจ้งจากหน้างาน: อุปกรณ์ที่ช่างรายงาน (1 เครื่อง)
 *   - อื่นๆ (เช่น เขียน Config ไม่สำเร็จ): ไม่มีข้อมูลจำนวนเครื่อง → null
 */
export function incidentImpact(
  incident: Pick<Incident, "source" | "metadata" | "deviceId">,
): IncidentImpact | null {
  const type = incidentType(incident);

  if (type === "rollout-failure") {
    const failure = numberField(incident.metadata, "failureCount");
    const target = numberField(incident.metadata, "targetCount");
    const skipped = numberField(incident.metadata, "skippedCount") ?? 0;
    if (failure === null || target === null) return null;
    const detail = skipped > 0 ? `ข้ามเพราะออฟไลน์ ${skipped} เครื่อง` : null;
    return {
      summary:
        failure > 0
          ? `ล้มเหลว ${failure} จาก ${target} เครื่อง (${formatPercent(failure, target)})`
          : `ไม่มีเครื่องล้มเหลว จาก ${target} เครื่อง`,
      detail,
    };
  }

  if (type === "field-report" && incident.deviceId) {
    return { summary: `อุปกรณ์ ${incident.deviceId}`, detail: null };
  }

  return null;
}

/** สถานะที่ถือว่าปิดแล้ว (จบ ไม่ต้องตามต่อ): แก้แล้ว, ไม่ต้องดำเนินการ,
 * Rollback แล้ว · `open` และ `investigating` ยังค้างอยู่ */
const CLOSED_INCIDENT_STATUSES: readonly IncidentStatus[] = [
  "resolved",
  "dismissed",
  "rolled_back",
];

export function isIncidentClosed(status: IncidentStatus): boolean {
  return CLOSED_INCIDENT_STATUSES.includes(status);
}

function stringArrayField(metadata: Incident["metadata"], key: string): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
}

export type FailedDeviceSample = {
  /** รหัสเครื่องที่แสดง (ตามลำดับที่ backend เก็บ) */
  shown: string[];
  /** จำนวนเครื่องที่ล้มเหลวที่ไม่ได้แสดง — backend เก็บรหัสไว้สูงสุด 20 เครื่อง
   * จึงนับจาก `failureCount` ไม่ใช่ความยาวรายการ */
  remaining: number;
};

/**
 * ตัวอย่างเครื่องที่ล้มเหลวของ Incident จาก Rollout — `limit` จำกัดจำนวนที่
 * แสดง (หน้ารายการใช้ 3 หน้ารายละเอียดใช้ทั้งหมดที่เก็บไว้) · null ถ้าไม่ใช่
 * Rollout หรือไม่มีรหัสเครื่องเก็บไว้เลย
 */
export function failedDeviceSample(
  incident: Pick<Incident, "source" | "metadata">,
  limit = Number.POSITIVE_INFINITY,
): FailedDeviceSample | null {
  if (incidentType(incident) !== "rollout-failure") return null;
  const ids = stringArrayField(incident.metadata, "failedDeviceIds");
  if (ids.length === 0) return null;
  const shown = ids.slice(0, limit);
  const total = Math.max(
    numberField(incident.metadata, "failureCount") ?? 0,
    ids.length,
  );
  return { shown, remaining: total - shown.length };
}

/** ข้อผิดพลาดตัวอย่างของเครื่องที่ล้มเหลว (backend เก็บไว้ไม่เกิน 3 รายการ) */
export function incidentSampleErrors(
  incident: Pick<Incident, "source" | "metadata">,
): string[] {
  if (incidentType(incident) !== "rollout-failure") return [];
  return stringArrayField(incident.metadata, "sampleErrors");
}

/** ลิงก์ไปหน้ารายละเอียด Rollout ต้นทางของ Incident — null ถ้าไม่ใช่ Rollout
 * หรือ metadata ไม่มี campaignId/rolloutId ครบ */
export function incidentRolloutHref(
  incident: Pick<Incident, "source" | "metadata">,
): string | null {
  if (incidentType(incident) !== "rollout-failure") return null;
  const campaignId = incident.metadata?.campaignId;
  const rolloutId = incident.metadata?.rolloutId;
  if (typeof campaignId !== "string" || typeof rolloutId !== "string") {
    return null;
  }
  return `/campaigns/${encodeURIComponent(campaignId)}/rollouts/${encodeURIComponent(rolloutId)}`;
}

export type RolloutImpactBar = {
  /** สัดส่วนเครื่องที่ล้มเหลว (0 ถึง 100) ของเครื่องเป้าหมายทั้งหมด */
  failedPct: number;
  /** สัดส่วนเครื่องที่ถูกข้ามเพราะออฟไลน์ (0 ถึง 100) */
  skippedPct: number;
};

/** ข้อมูลวาดแถบสัดส่วนของ Incident จาก Rollout — null ถ้าไม่ใช่ Rollout หรือ
 * metadata ไม่ครบ (ไม่เดาตัวเลข) · รวมกันไม่เกิน 100 */
export function rolloutImpactBar(
  incident: Pick<Incident, "source" | "metadata">,
): RolloutImpactBar | null {
  if (incidentType(incident) !== "rollout-failure") return null;
  const failure = numberField(incident.metadata, "failureCount");
  const target = numberField(incident.metadata, "targetCount");
  if (failure === null || target === null || target <= 0) return null;
  const skipped = numberField(incident.metadata, "skippedCount") ?? 0;
  const failedPct = Math.min(100, (failure / target) * 100);
  const skippedPct = Math.min(100 - failedPct, (skipped / target) * 100);
  return { failedPct, skippedPct };
}

/** Incident ที่ยังต้องตาม (ยังไม่ปิด): open หรือ investigating */
export function isIncidentActive(status: IncidentStatus): boolean {
  return !isIncidentClosed(status);
}

/**
 * สั่งลองเขียน Config ใหม่ได้ไหม: ต้องเป็น Incident เขียน Config ที่ยัง **เปิดอยู่เท่านั้น**
 * (`open`) และมี Config + เวอร์ชันที่ต้องเขียนซ้ำครบ (ตรงกับเงื่อนไขที่ backend `retrySync` รับ
 * ไม่งั้นกดแล้วได้ 400/409) · `investigating` คือสั่งไปแล้วและกำลังรอผล ไม่ให้กดซ้ำ เพราะ
 * จะเข้าคิวเขียนซ้ำ (ดู `isConfigSyncRetrying`)
 */
export function canRetryConfigSync(
  incident: Pick<Incident, "source" | "status" | "relatedConfigId" | "metadata">,
): boolean {
  return (
    incidentType(incident) === "config-sync-writer" &&
    incident.status === "open" &&
    Boolean(incident.relatedConfigId) &&
    typeof incident.metadata?.versionNumber === "number"
  );
}

/** Incident เขียน Config ที่สั่งลองเขียนไปแล้วและกำลังรอผล (ล้มอีกจะกลับเป็น `open`) */
export function isConfigSyncRetrying(
  incident: Pick<Incident, "source" | "status">,
): boolean {
  return (
    incidentType(incident) === "config-sync-writer" &&
    incident.status === "investigating"
  );
}
