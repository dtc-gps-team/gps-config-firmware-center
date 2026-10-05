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
  "approved",
  "active",
  "paused",
  "rejected",
  "completed",
  "cancelled",
] as const;

export type CampaignRolloutStatus = (typeof CAMPAIGN_ROLLOUT_STATUSES)[number];

/** ค่ายังไม่จบของ Rollout หนึ่งรอบ — กลุ่มที่มี Rollout สถานะเหล่านี้ค้างอยู่
 * สร้างรอบใหม่ไม่ได้ (409) — mirror `OPEN_CAMPAIGN_ROLLOUT_STATUSES` ฝั่ง
 * backend · รวม `paused` ด้วย (Incident & Rollback #28 — Auto Pause) ·
 * รวม `approved` ด้วย (แก้ครั้งที่ 63 — อนุมัติแล้วแต่ยังไม่ปล่อยก็ยังถือว่า
 * "ค้างอยู่") */
export const OPEN_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ["pending_approval", "approved", "active", "paused"];

/** สถานะที่ `releaseCampaignRollout` ทำได้ (แก้ครั้งที่ 63 — แยก "อนุมัติ"
 * ออกจาก "ปล่อยเข้าอุปกรณ์" เป็น 2 ขั้นตอน) — mirror
 * `RELEASABLE_CAMPAIGN_ROLLOUT_STATUS` ฝั่ง backend */
export const RELEASABLE_CAMPAIGN_ROLLOUT_STATUS: CampaignRolloutStatus =
  "approved";

/** สถานะที่ `resumeCampaignRollout` ทำได้ — mirror
 * `RESUMABLE_CAMPAIGN_ROLLOUT_STATUS` ฝั่ง backend */
export const RESUMABLE_CAMPAIGN_ROLLOUT_STATUS: CampaignRolloutStatus =
  "paused";

/** สถานะที่ `rollbackCampaignRollout` ทำได้ — mirror
 * `ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES` ฝั่ง backend */
export const ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ["active", "paused", "completed"];

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
  /** true = รอบนี้เป็น Rollback ที่สร้างจาก `rollbackCampaignRollout` —
   * payload คัดลอกมาจากรอบก่อนหน้าที่ `completed` ล่าสุดของ payloadType
   * เดียวกันโดยระบบเอง (Incident & Rollback #28) */
  isRollback: boolean;
  /** id ของ Rollout รอบที่มีปัญหาซึ่งรอบนี้ถูกสร้างมาเพื่อย้อนกลับ — null ถ้า
   * `isRollback` เป็น false */
  rollbackOfId: string | null;
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

/**
 * `GET /campaigns/rollouts` — ข้าม Campaign ทุกกลุ่ม (แก้ไข 2026-09-24 —
 * ใช้กับ Approval Center รวม Campaign Rollout เข้ากับ Config) ต่างจาก
 * `listCampaignRollouts` ด้านบนที่ scope แค่กลุ่มเดียว
 */
export function listAllCampaignRollouts(
  token: string,
  params?: { status?: CampaignRolloutStatus },
): Promise<CampaignRollout[]> {
  const query = params?.status
    ? `?status=${encodeURIComponent(params.status)}`
    : "";
  return apiJson<CampaignRollout[]>(`/campaigns/rollouts${query}`, { token });
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
 * `pending_approval` → `approved` เท่านั้น (409 ถ้าไม่ใช่) **ไม่แตะอุปกรณ์เลย**
 * (แก้ครั้งที่ 63 — แยก "อนุมัติ" ออกจาก "ปล่อยเข้าอุปกรณ์" เป็น 2 ขั้นตอน
 * ต้องเรียก `releaseCampaignRollout` ต่อถึงจะ auto-apply เข้าเครื่องจริง) ·
 * 403 ถ้าผู้กดเป็นผู้สร้าง Rollout เดียวกันเอง (Separation of Duty — backend
 * เช็คจริง ฝั่งนี้แค่ซ่อน/ปิดปุ่มไว้ล่วงหน้าด้วย `getTokenSubject`)
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
 * `POST /campaigns/{id}/rollouts/{rolloutId}/release` — Operation เท่านั้น
 * (resource เดียวกับ approve/reject/resume) · `approved` → `active` เท่านั้น
 * (409 ถ้าไม่ใช่) แล้ว auto-apply Config/Firmware เข้าทุกเครื่องทันที **ไม่เช็ค
 * Separation of Duty** mirror `resumeCampaignRollout` — การอนุมัติเช็ค SoD
 * ไปแล้วก่อนหน้านี้ ผู้อนุมัติเดิมเป็นคนกด release เองก็ได้ (แก้ครั้งที่ 63)
 */
export function releaseCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/release`,
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

/**
 * `POST /campaigns/{id}/rollouts/{rolloutId}/resume` — Operation เท่านั้น
 * (resource เดียวกับ approve/reject) · `paused` → `active` เท่านั้น (409 ถ้า
 * ไม่ใช่) **ไม่เช็ค Separation of Duty** ต่างจาก approve/reject โดยตั้งใจ —
 * ผู้สร้าง Rollout เองก็ resume ได้ (Incident & Rollback #28 — Auto Pause)
 */
export function resumeCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/resume`,
    { method: "POST", token },
  );
}

export type CreateCampaignRollbackInput = {
  /** `Device.deviceId` ที่ต้องการเอาออกจากรอบ rollback นี้ — ทุกตัวต้องเป็น
   * เครื่องที่ได้รับ payload ของรอบที่มีปัญหาสำเร็จจริงแล้ว ไม่งั้น 400 —
   * ไม่ส่งมา = rollback ทุกเครื่องที่เคยได้รับสำเร็จ */
  excludeDeviceIds?: string[];
};

/**
 * `POST /campaigns/{id}/rollouts/{rolloutId}/rollback` — Operation เท่านั้น
 * (resource `campaign` action `Create` เดียวกับ `createCampaignRollout` —
 * เป็นการสร้าง Rollout ใหม่ในทางปฏิบัติ) · **คืน Rollout ใหม่ ไม่ใช่ตัวเดิม**
 * (`isRollback: true`, `rollbackOfId` ชี้กลับไปรอบที่มีปัญหา) ต้องผ่าน
 * approve อีกครั้งตามปกติก่อนเริ่มทำงานจริง (Incident & Rollback #28)
 */
export function rollbackCampaignRollout(
  token: string,
  campaignId: string,
  rolloutId: string,
  input: CreateCampaignRollbackInput,
): Promise<CampaignRollout> {
  return apiJson<CampaignRollout>(
    `/campaigns/${campaignId}/rollouts/${rolloutId}/rollback`,
    { method: "POST", token, body: JSON.stringify(input) },
  );
}
