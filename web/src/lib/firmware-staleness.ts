import type { Firmware } from "@/lib/firmware-api";

/**
 * เทียบเวอร์ชันแบบตัวเลขทีละส่วน (`1.10.0` > `1.9.2`) ตัด `v` นำหน้า ส่วนที่
 * ไม่ใช่ตัวเลขเทียบเป็นข้อความ คืนค่าลบ/0/บวกแบบ `Array.sort`
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split(/[.\-+]/);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x.localeCompare(y);
    }
  }
  return 0;
}

/** Firmware ล่าสุดที่ผ่าน QA และอัปโหลดสำเร็จ ต่อโมเดลอุปกรณ์ที่ระบุใน compatibility */
export function latestApprovedByModel(
  firmware: Firmware[],
): Map<string, Firmware> {
  const latest = new Map<string, Firmware>();
  for (const f of firmware) {
    if (f.approvalStatus !== "approved" || f.uploadStatus !== "stored") continue;
    for (const model of f.deviceModelCompatibility) {
      const current = latest.get(model);
      if (!current || compareVersions(f.version, current.version) > 0) {
        latest.set(model, f);
      }
    }
  }
  return latest;
}

/** true เมื่อกล่องรายงานเวอร์ชันต่ำกว่า Firmware ล่าสุดที่อนุมัติของโมเดลนั้น
 * (ไม่รู้เวอร์ชันที่กล่องรายงาน หรือไม่มี Firmware อนุมัติ = ไม่ตัดสิน) */
export function isFirmwareOutdated(
  reportedVersion: string | null | undefined,
  latest: Firmware | undefined,
): boolean {
  if (!reportedVersion || !latest) return false;
  return compareVersions(reportedVersion, latest.version) < 0;
}
