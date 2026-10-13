import type { DevicePayloadStatus } from "@/lib/device-api";
import type { PillTone } from "@/lib/status-pill";

/**
 * ป้ายและสีของสถานะ Config/Firmware ที่ `GET /devices/{id}/status` คืนมา
 * (หน้ารายละเอียดอุปกรณ์) — แยกจาก `STATUS_LABEL` กลางใน status-pill.tsx
 * โดยตั้งใจ เพราะคำว่า "pending" ของสถานะอื่นในระบบ (Task, Rollout target)
 * ความหมายต่างกัน ไม่ควรเปลี่ยนป้ายร่วมทั้งเว็บ
 */
export type PayloadKind = "config" | "firmware";

export const DEVICE_PAYLOAD_STATUS_TONE: Record<DevicePayloadStatus, PillTone> =
  {
    up_to_date: "success",
    pending: "progress",
    failed: "danger",
    unknown: "neutral",
  };

export function devicePayloadStatusLabel(
  kind: PayloadKind,
  status: DevicePayloadStatus,
): string {
  switch (status) {
    case "up_to_date":
      return "เป็นปัจจุบัน";
    case "pending":
      return kind === "config" ? "รอรับ Config" : "รอติดตั้ง Firmware";
    case "failed":
      return "ล้มเหลว";
    case "unknown":
      return "ยังไม่เคยอยู่ใน Rollout";
  }
}

/** คำอธิบายสั้นใต้ป้าย — บอกว่าสถานะนี้มาจากอะไร */
export function devicePayloadStatusHint(
  kind: PayloadKind,
  status: DevicePayloadStatus,
): string {
  const noun = kind === "config" ? "Config" : "Firmware";
  switch (status) {
    case "up_to_date":
      return `Rollout ${noun} ล่าสุดของเครื่องนี้สำเร็จแล้ว`;
    case "pending":
      return `เครื่องนี้อยู่ใน Rollout ${noun} ที่กำลังทำงาน ยังรอผล`;
    case "failed":
      return `Rollout ${noun} ล่าสุดของเครื่องนี้ไม่สำเร็จ`;
    case "unknown":
      return `ปกติสำหรับเครื่องที่ยังไม่เคยถูกอัปเดต ${noun} ผ่าน Campaign`;
  }
}
