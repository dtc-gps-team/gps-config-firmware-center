import { apiJson } from "@/lib/api";

/**
 * Campaign API client — ตรงกับ `docs/api/openapi.yaml` tag `campaign`
 *
 * **แก้ไข 2026-09-24 (Campaign Monitor #22 — แยกกลุ่มออกจากรอบ push):** เดิม
 * `Campaign` ผูก payload+approval+target ไว้ก้อนเดียว ยิงได้ครั้งเดียวจบ —
 * แยกเป็น `Campaign` (กลุ่มอุปกรณ์ถาวร) + `CampaignRollout` (1 รอบ push
 * Config/Firmware เข้ากลุ่ม รับ field ที่เคยอยู่บน `Campaign` เดิมมาทั้งหมด)
 * + `CampaignRolloutTarget` (ผลต่อเครื่องของแต่ละรอบ — Failure Rate จริง)
 * ดู comment เหนือ `model Campaign` ใน `backend/prisma/schema.prisma`
 */

export const CAMPAIGN_PAYLOAD_TYPES = ["Config", "Firmware"] as const;

export type CampaignPayloadType = (typeof CAMPAIGN_PAYLOAD_TYPES)[number];

export const CAMPAIGN_ROLLOUT_STATUSES = [
  "pending_approval",
  "active",
  "rejected",
  "completed",
  "cancelled",
] as const;

export type CampaignRolloutStatus = (typeof CAMPAIGN_ROLLOUT_STATUSES)[number];

/** ค่ายังไม่จบของ Rollout หนึ่งรอบ — กลุ่มที่มี Rollout สถานะเหล่านี้ค้างอยู่
 * สร้างรอบใหม่ไม่ได้ (409) — mirror `OPEN_CAMPAIGN_ROLLOUT_STATUSES` ฝั่ง
 * backend */
export const OPEN_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ["pending_approval", "active"];

export const CAMPAIGN_ROLLOUT_TARGET_STATUSES = [
  "pending",
  "success",
  "failed",
] as const;

export type CampaignRolloutTargetStatus =
  (typeof CAMPAIGN_ROLLOUT_TARGET_STATUSES)[number];

/** response shape — `Campaign` ใน openapi.yaml (กลุ่มอุปกรณ์ถาวร ไม่มี
 * payload/status ติดตัวอีกต่อไป) */
export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** สมาชิกกลุ่ม 1 เครื่อง — `CampaignTarget` ใน openapi.yaml */
export type CampaignTarget = {
  id: string;
  campaignId: string;
  deviceId: string;
  createdAt: string;
};

/** เป้าหมาย 1 เครื่อง — body ของ `createCampaign` */
export type CampaignTargetInput = {
  /** `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` UUID ภายใน */
  deviceId: string;
};

export type CreateCampaignInput = {
  name: string;
  description?: string;
  targets: CampaignTargetInput[];
};

/** response shape — `CampaignRollout` ใน openapi.yaml */
export type CampaignRollout = {
  id: string;
  campaignId: string;
  payloadType: CampaignPayloadType;
  configId: string | null;
  firmwareId: string | null;
  status: CampaignRolloutStatus;
  targetCount: number;
  /** นับจาก `CampaignRolloutTarget.status = success` จริง — อัปเดตทุกครั้งที่
   * apply-config/confirm-firmware-install รายงานผลเข้ามา (Campaign Monitor
   * #22) */
  successCount: number;
  failureCount: number;
  createdBy: string;
  /** user id ของ Operation ที่กด `approveCampaignRollout` — null จนกว่าจะ
   * อนุมัติ (`rejectCampaignRollout` ไม่ตั้งค่านี้ คงเป็น null) */
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCampaignRolloutInput = {
  payloadType: CampaignPayloadType;
  /** บังคับเมื่อ payloadType เป็น Config */
  configId?: string;
  /** บังคับเมื่อ payloadType เป็น Firmware */
  firmwareId?: string;
  /** `Device.deviceId` ของสมาชิกกลุ่มที่ต้องการเอาออกจาก rollout รอบนี้ —
   * ไม่ส่ง = push ทั้งกลุ่ม */
  excludeDeviceIds?: string[];
};

/** ผลของ Rollout ต่อเครื่อง — `CampaignRolloutTarget` ใน openapi.yaml */
export type CampaignRolloutTarget = {
  id: string;
  rolloutId: string;
  deviceId: string;
  status: CampaignRolloutTargetStatus;
  resultDetail: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listCampaigns(token: string): Promise<Campaign[]> {
  return apiJson<Campaign[]>("/campaigns", { token });
}

export function getCampaign(token: string, id: string): Promise<Campaign> {
  return apiJson<Campaign>(`/campaigns/${id}`, { token });
}

export function listCampaignTargets(
  token: string,
  campaignId: string,
): Promise<CampaignTarget[]> {
  return apiJson<CampaignTarget[]>(`/campaigns/${campaignId}/targets`, {
    token,
  });
}

/**
 * `POST /campaigns` — Operation เท่านั้น · สร้างกลุ่มอุปกรณ์เปล่าๆ เท่านั้น
 * ไม่มี payload/approval ในคำขอนี้แล้ว (ย้ายไป `createCampaignRollout`) ·
 * 409 ถ้าอุปกรณ์เป้าหมายบางเครื่องไม่พบหรือยังไม่ installed · 400 ถ้า
 * targets ว่าง/deviceId ซ้ำ
 */
export function createCampaign(
  token: string,
  input: CreateCampaignInput,
): Promise<Campaign> {
  return apiJson<Campaign>("/campaigns", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export function listCampaignRollouts(
  token: string,
  campaignId: string,
): Promise<CampaignRollout[]> {
  return apiJson<CampaignRollout[]>(`/campaigns/${campaignId}/rollouts`, {
    token,
  });
}

export function getCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}`,
    { token },
  );
}

/**
 * `POST /campaigns/{id}/rollouts` — Operation เท่านั้น · เกณฑ์ payload
 * เดียวกับ `createCampaign` เดิม (404 ไม่พบ Config/Firmware, 409 ยังไม่ผ่าน
 * เกณฑ์หรืออุปกรณ์ไม่เข้ากัน) · **409 เพิ่มเติม** ถ้ากลุ่มนี้มี Rollout
 * ที่ยังไม่จบค้างอยู่ (`pending_approval`/`active`) — รันได้ทีละรอบเท่านั้น
 */
export function createCampaignRollout(
  token: string,
  campaignId: string,
  input: CreateCampaignRolloutInput,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(`/campaigns/${campaignId}/rollouts`, {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

/**
 * `POST /campaigns/{id}/rollouts/{rolloutId}/approve` — Operation เท่านั้น ·
 * `pending_approval` → `active` เท่านั้น (409 ถ้าไม่ใช่) · 403 ถ้าผู้กดเป็น
 * ผู้สร้าง Rollout เดียวกันเอง (Separation of Duty — backend เช็คจริง ฝั่งนี้
 * แค่ซ่อน/ปิดปุ่มไว้ล่วงหน้าด้วย `getTokenSubject`)
 */
export function approveCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/approve`,
    { method: "POST", token },
  );
}

/**
 * `POST /campaigns/{id}/rollouts/{rolloutId}/reject` — resource/เงื่อนไข
 * เดียวกับ `approveCampaignRollout` แต่เปลี่ยนเป็น `rejected` แทน ไม่ตั้ง
 * `approvedBy`/`approvedAt` · เปิดรอบใหม่ในกลุ่มเดิมได้ทันทีผ่าน
 * `createCampaignRollout` (rejected ไม่นับเป็น "ค้างอยู่")
 */
export function rejectCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/reject`,
    { method: "POST", token },
  );
}

export function listCampaignRolloutTargets(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRolloutTarget[]> {
  return apiJson<CampaignRolloutTarget[]>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/targets`,
    { token },
  );
}
