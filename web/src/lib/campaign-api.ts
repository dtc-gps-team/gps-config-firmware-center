import { apiJson } from "@/lib/api";

/**
 * Campaign API client — ตรงกับ `docs/api/openapi.yaml` tag `campaign`
 * (Sprint 3 #21 Campaign Wizard) — `POST /campaigns` สร้าง Campaign+
 * CampaignTarget[] ใน transaction เดียว ใช้สำหรับติดตาม/บำรุงรักษาอุปกรณ์
 * เป็นกลุ่ม
 *
 * **แก้ไข 2026-09-14 (1):** เดิม `POST /campaigns` สร้าง `Task` ต่ออุปกรณ์พร้อม
 * มอบหมายผู้รับผิดชอบหน้างานด้วย — หัวหน้าแก้ scope ว่า Campaign ไม่ใช่
 * เครื่องมือมอบหมายงาน (เป็นหน้าที่ของระบบแยกที่บริษัทมีอยู่แล้ว) จึงตัด
 * แนวคิด assignedTo ออกจาก `CampaignTargetInput` ทั้งหมด (ดู backend PR #152)
 *
 * **แก้ไข 2026-09-14 (2):** `payloadType: Firmware` เปิดใช้งานแล้ว (backend
 * PR #154) — เพิ่ม `firmwareId` เข้า `CreateCampaignInput` คู่กับ `configId`
 *
 * **แก้ไข 2026-09-18 (Campaign Approval, PR #186):** `createCampaign` สร้าง
 * เป็น `pending_approval` แทน `active` ทันที — ต้องรอ Operation อีกคน
 * (ไม่ใช่ผู้สร้างเอง — Separation of Duty) กด `approveCampaign`/
 * `rejectCampaign` ก่อนถึงจะ `active`/`rejected` เพิ่ม `approvedBy`/
 * `approvedAt` เข้า response shape ด้วย
 */

export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "active",
  "rejected",
  "completed",
  "cancelled",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_PAYLOAD_TYPES = ["Config", "Firmware"] as const;

export type CampaignPayloadType = (typeof CAMPAIGN_PAYLOAD_TYPES)[number];

/** response shape — `Campaign` ใน openapi.yaml */
export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  payloadType: CampaignPayloadType;
  configId: string | null;
  firmwareId: string | null;
  status: CampaignStatus;
  targetCount: number;
  /** ยังไม่มี logic ไหนอัปเดตค่านี้ตอนนี้ (0 เสมอหลังสร้าง) — รอ Campaign
   * Monitor (#22) กลไกจริงยังไม่ระบุ (เดิมตั้งใจผูกกับผล apply-config ของ
   * Task ต่อเป้าหมาย แต่ Campaign ไม่สร้าง Task แล้วตั้งแต่แก้ไข 2026-09-14
   * — ต้องออกแบบใหม่ตอนทำ Campaign Monitor จริง) */
  successCount: number;
  failureCount: number;
  createdBy: string;
  /** user id ของ Operation ที่กด `approveCampaign` — null จนกว่าจะอนุมัติ
   * (`rejectCampaign` ไม่ตั้งค่านี้ คงเป็น null เสมอ) */
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** เป้าหมาย 1 เครื่อง — body ของ `createCampaign` */
export type CampaignTargetInput = {
  /** `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` UUID ภายใน */
  deviceId: string;
};

export type CreateCampaignInput = {
  name: string;
  description?: string;
  payloadType: CampaignPayloadType;
  /** บังคับเมื่อ payloadType เป็น Config */
  configId?: string;
  /** บังคับเมื่อ payloadType เป็น Firmware */
  firmwareId?: string;
  targets: CampaignTargetInput[];
};

export function listCampaigns(
  token: string,
  params?: { status?: CampaignStatus },
): Promise<Campaign[]> {
  const query = params?.status
    ? `?status=${encodeURIComponent(params.status)}`
    : "";
  return apiJson<Campaign[]>(`/campaigns${query}`, { token });
}

export function getCampaign(token: string, id: string): Promise<Campaign> {
  return apiJson<Campaign>(`/campaigns/${id}`, { token });
}

/**
 * `POST /campaigns` — Operation เท่านั้น · 404 ถ้าไม่พบ Config/Firmware ตาม
 * payloadType · 409 ถ้า Config ยังไม่อนุมัติ, Firmware ยัง `uploadStatus` ไม่
 * `stored`, หรืออุปกรณ์เป้าหมายบางเครื่องยังไม่ installed/ไม่เข้ากันกับ
 * payload (backend รวมทุกปัญหาไว้ใน `message` เดียว) · 400 ถ้า targets ว่าง/
 * deviceId ซ้ำ/ไม่ระบุ configId-firmwareId ให้ตรงกับ payloadType
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

/**
 * `POST /campaigns/{id}/approve` — Operation เท่านั้น · `pending_approval` →
 * `active` เท่านั้น (409 ถ้าไม่ใช่) · 403 ถ้าผู้กดเป็นผู้สร้าง Campaign
 * เดียวกันเอง (Separation of Duty — backend เช็คจริง, ฝั่งนี้แค่ซ่อน/ปิดปุ่ม
 * ไว้ล่วงหน้าด้วย `getTokenSubject`)
 */
export function approveCampaign(token: string, id: string): Promise<Campaign> {
  return apiJson<Campaign>(`/campaigns/${id}/approve`, {
    method: "POST",
    token,
  });
}

/**
 * `POST /campaigns/{id}/reject` — resource/เงื่อนไขเดียวกับ `approveCampaign`
 * แต่เปลี่ยนเป็น `rejected` แทน ไม่ตั้ง `approvedBy`/`approvedAt` · Operation
 * แก้ไขแล้วส่งอนุมัติใหม่ได้ผ่าน `createCampaign` อีกครั้ง
 */
export function rejectCampaign(token: string, id: string): Promise<Campaign> {
  return apiJson<Campaign>(`/campaigns/${id}/reject`, {
    method: "POST",
    token,
  });
}
