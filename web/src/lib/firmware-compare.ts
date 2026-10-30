import type { Firmware } from "@/lib/firmware-api";

/** สถานะพร้อมปล่อยของ Firmware รวมจากผลอัปโหลดและผลตรวจคุณภาพ (ข้อความเดียวที่ตอบ
 * "ใช้ปล่อยได้ไหม") */
export type FirmwareRelease =
  "ready" | "in_review" | "rejected" | "upload_failed" | "uploading";

export function firmwareRelease(
  f: Pick<Firmware, "uploadStatus" | "approvalStatus">,
): FirmwareRelease {
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
