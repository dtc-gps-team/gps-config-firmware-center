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
