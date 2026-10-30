import type { Incident, IncidentSeverity } from "@/lib/incident-api";
import { incidentType } from "@/lib/incident-display";

/** กลุ่ม Incident ที่เป็นเรื่องเดียวกัน (เกิดซ้ำหลายครั้ง) เรียงล่าสุดก่อนในกลุ่ม */
export type IncidentGroup = {
  key: string;
  /** ตัวแทนของกลุ่ม = รายการล่าสุด */
  latest: Incident;
  items: Incident[];
};

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** คีย์ "เรื่องเดียวกัน": ประเภท + หัวข้อ + อุปกรณ์ + Rollout ต้นทาง (Config/Firmware ที่เกี่ยวข้องด้วย) */
export function incidentGroupKey(incident: Incident): string {
  const rolloutId =
    typeof incident.metadata?.rolloutId === "string"
      ? incident.metadata.rolloutId
      : "";
  return [
    incidentType(incident),
    incident.title.trim(),
    incident.deviceId ?? "",
    rolloutId,
    incident.relatedConfigId ?? "",
    incident.relatedFirmwareId ?? "",
  ].join("|");
}

/**
 * รวม Incident ที่เป็นเรื่องเดียวกันเป็นกลุ่ม แล้วเรียงกลุ่มตามความรุนแรงสูงสุดในกลุ่มก่อน
 * จากนั้นล่าสุดก่อน (ไม่สนใจ status: ผู้เรียกแยกที่ปิดแล้ว/ยังไม่ปิดออกจากกันก่อนเรียก)
 */
export function groupIncidents(incidents: Incident[]): IncidentGroup[] {
  const byKey = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const key = incidentGroupKey(incident);
    byKey.set(key, [...(byKey.get(key) ?? []), incident]);
  }
  const groups = [...byKey.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return { key, latest: sorted[0], items: sorted };
  });
  const rank = (g: IncidentGroup) =>
    Math.min(...g.items.map((i) => SEVERITY_RANK[i.severity] ?? 9));
  return groups.sort(
    (a, b) =>
      rank(a) - rank(b) || b.latest.createdAt.localeCompare(a.latest.createdAt),
  );
}

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

export function severityLabel(severity: IncidentSeverity): string {
  return SEVERITY_LABEL[severity] ?? severity;
}
