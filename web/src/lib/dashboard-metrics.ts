import type { CampaignRollout } from "@/lib/campaign-api";
import type { CentralDevice } from "@/lib/central-device-api";
import type { Device } from "@/lib/device-api";
import type { Incident } from "@/lib/incident-api";

/**
 * ตัวเลขบน Dashboard คำนวณจากข้อมูลจริงล้วน (ไม่มีตัวเลขตายตัว) แยกเป็นฟังก์ชันล้วนเพื่อเทสได้
 * และให้ทุกการ์ดอ่านจากกฎเดียวกัน
 */

export type DeployTotals = {
  /** จำนวนเครื่องที่ได้ผลสำเร็จ รวมทุก Rollout ที่ปล่อยแล้ว */
  success: number;
  /** จำนวนเครื่องที่ล้มเหลว รวมทุก Rollout ที่ปล่อยแล้ว */
  failed: number;
};

/** ผลการ Deploy รวม: นับเฉพาะ Rollout ที่ปล่อยแล้ว (ไม่นับที่รออนุมัติ/ถูกปฏิเสธ ซึ่งยังไม่แตะอุปกรณ์) */
export function deployTotals(rollouts: CampaignRollout[]): DeployTotals {
  const released = rollouts.filter(
    (r) => r.status === "active" || r.status === "paused" || r.status === "completed",
  );
  return {
    success: released.reduce((sum, r) => sum + r.successCount, 0),
    failed: released.reduce((sum, r) => sum + r.failureCount, 0),
  };
}

export type ConnectionSummary = {
  online: number;
  offline: number;
  /** อุปกรณ์ในระบบเราที่ Server กลางไม่รู้จัก จึงไม่ทราบสถานะ (ไม่เดาว่าออฟไลน์) */
  unknown: number;
};

/** สถานะการเชื่อมต่อของ "อุปกรณ์ในระบบเรา" โดยจับคู่ด้วย deviceId กับที่ Server กลางรายงาน */
export function connectionSummary(
  devices: Pick<Device, "deviceId">[],
  central: Pick<CentralDevice, "deviceId" | "online">[],
): ConnectionSummary {
  const byId = new Map(central.map((c) => [c.deviceId, c]));
  const summary: ConnectionSummary = { online: 0, offline: 0, unknown: 0 };
  for (const d of devices) {
    const c = byId.get(d.deviceId);
    if (!c) summary.unknown += 1;
    else if (c.online) summary.online += 1;
    else summary.offline += 1;
  }
  return summary;
}

/**
 * จำนวนอุปกรณ์ในระบบเราที่ Config ที่กล่องรายงานไม่ตรงกับเวอร์ชันที่ Server กลางตั้งเป้าไว้
 * (drift) · ไม่นับเครื่องที่ยังไม่เคยตั้งเป้า (`desiredConfigVersion` เป็น null) หรือที่ Server
 * กลางไม่รู้จัก
 */
export function configDriftCount(
  devices: Pick<Device, "deviceId">[],
  central: Pick<
    CentralDevice,
    "deviceId" | "desiredConfigVersion" | "reportedConfigVersion"
  >[],
): number {
  const ours = new Set(devices.map((d) => d.deviceId));
  return central.filter(
    (c) =>
      ours.has(c.deviceId) &&
      c.desiredConfigVersion !== null &&
      c.reportedConfigVersion !== c.desiredConfigVersion,
  ).length;
}

/** Incident ที่ยังต้องตาม (เปิดอยู่หรือกำลังตรวจสอบ) */
export function activeIncidentCount(
  incidents: Pick<Incident, "status">[],
): number {
  return incidents.filter(
    (i) => i.status === "open" || i.status === "investigating",
  ).length;
}

/** Rollout ที่อนุมัติแล้วแต่ยังไม่ปล่อยเข้าอุปกรณ์ — เก่าสุดก่อน (ค้างนานสุดควรเห็นก่อน) */
export function rolloutsAwaitingRelease(
  rollouts: CampaignRollout[],
): CampaignRollout[] {
  return rollouts
    .filter((r) => r.status === "approved")
    .sort(
      (a, b) =>
        new Date(a.approvedAt ?? a.createdAt).getTime() -
        new Date(b.approvedAt ?? b.createdAt).getTime(),
    );
}

/** Rollout ที่ปล่อยแล้วและกำลังส่งให้อุปกรณ์ */
export function activeRollouts(rollouts: CampaignRollout[]): CampaignRollout[] {
  return rollouts.filter((r) => r.status === "active");
}

/** เกณฑ์ "เงียบ": ออฟไลน์และไม่เคยรายงานเข้ามาเกินกี่ชั่วโมง */
export const SILENT_THRESHOLD_HOURS = 24;

export type SilentDevice = {
  deviceId: string;
  deviceModel: string;
  /** null = Server กลางไม่เคยเห็นเครื่องนี้รายงาน */
  lastSeenAt: string | null;
};

/**
 * อุปกรณ์ในระบบเราที่ออฟไลน์และเงียบเกิน `thresholdMs` (ไม่เคยเห็น = เงียบที่สุด) —
 * เรียงเงียบนานสุดก่อน · ไม่นับเครื่องที่ Server กลางไม่รู้จัก (ไม่เดาว่าเงียบ)
 * และเครื่องที่ยังออนไลน์
 */
export function silentDevices(
  devices: Pick<Device, "deviceId" | "deviceModel">[],
  central: Pick<CentralDevice, "deviceId" | "online" | "lastSeenAt">[],
  thresholdMs: number = SILENT_THRESHOLD_HOURS * 3_600_000,
  nowMs: number = Date.now(),
): SilentDevice[] {
  const byId = new Map(central.map((c) => [c.deviceId, c]));
  const result: SilentDevice[] = [];
  for (const d of devices) {
    const c = byId.get(d.deviceId);
    if (!c || c.online) continue;
    const seen = c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : null;
    if (seen !== null && (Number.isNaN(seen) || nowMs - seen < thresholdMs)) {
      continue;
    }
    result.push({
      deviceId: d.deviceId,
      deviceModel: d.deviceModel,
      lastSeenAt: c.lastSeenAt,
    });
  }
  return result.sort(
    (a, b) =>
      (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0) -
      (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0),
  );
}
