import type { Firmware } from "@/lib/firmware-api";
import { diffConfigFields, type ConfigDiff } from "@/lib/config-diff";

/** สถานะพร้อมปล่อยของ Firmware รวมจากผลอัปโหลดและผลตรวจคุณภาพ (ข้อความเดียวที่ตอบ
 * "ใช้ปล่อยได้ไหม") */
export type FirmwareRelease = "ready" | "in_review" | "rejected" | "upload_failed" | "uploading";

export function firmwareRelease(f: Pick<Firmware, "uploadStatus" | "approvalStatus">): FirmwareRelease {
  if (f.uploadStatus === "failed") return "upload_failed";
  if (f.uploadStatus === "pending") return "uploading";
  if (f.approvalStatus === "rejected") return "rejected";
  if (f.approvalStatus === "approved") return "ready";
  return "in_review";
}

export const FIRMWARE_RELEASE_LABEL: Record<FirmwareRelease, string> = {
  ready: "พร้อมปล่อย",
  in_review: "รอ QA ตรวจ",
  rejected: "QA ไม่ผ่าน",
  upload_failed: "อัปโหลดล้มเหลว",
  uploading: "กำลังอัปโหลด",
};

/** ค่าที่ใช้เทียบ 2 เวอร์ชัน (ชื่อ field เป็นข้อความที่แสดงในตารางเทียบ) */
function snapshot(f: Firmware): Record<string, unknown> {
  return {
    "โมเดลที่รองรับ": [...f.deviceModelCompatibility].sort().join(", "),
    "สถานะพร้อมปล่อย": FIRMWARE_RELEASE_LABEL[firmwareRelease(f)],
    "ขนาดไฟล์ (ไบต์)": f.fileSizeBytes,
    "SHA-256": f.checksumSha256 ?? "-",
    "ชื่อไฟล์": f.originalFilename,
    "อัปโหลดเมื่อ": f.uploadedAt,
  };
}

/** เทียบ Firmware สองตัว: `before` = ตัวที่เลือกก่อน (เก่ากว่า), `after` = อีกตัว */
export function compareFirmware(before: Firmware, after: Firmware): ConfigDiff {
  return diffConfigFields(snapshot(before), snapshot(after));
}
