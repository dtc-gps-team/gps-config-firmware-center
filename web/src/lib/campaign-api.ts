import { apiJson } from "@/lib/api";

/**
 * Campaign API client — ตรงกับ `docs/api/openapi.yaml` tag `campaign`
 * (Sprint 3 #21 Campaign Wizard) — `POST /campaigns` สร้าง Campaign+
 * CampaignTarget[] ใน transaction เดียว, active ทันที ("ส่งพร้อมกันหมด" —
 * v1 ไม่มี draft/rollout strategy) ใช้สำหรับติดตาม/บำรุงรักษาอุปกรณ์เป็นกลุ่ม
 *
 * **แก้ไข 2026-09-14:** เดิม `POST /campaigns` สร้าง `Task` ต่ออุปกรณ์พร้อม
 * มอบหมายผู้รับผิดชอบหน้างานด้วย — หัวหน้าแก้ scope ว่า Campaign ไม่ใช่
 * เครื่องมือมอบหมายงาน (เป็นหน้าที่ของระบบแยกที่บริษัทมีอยู่แล้ว) จึงตัด
 * แนวคิด assignedTo ออกจาก `CampaignTargetInput` ทั้งหมด (ดู backend PR #152)
 */

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "completed",
  "cancelled",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** `Firmware` มีอยู่ใน enum ตาม Data Dictionary แต่ยังไม่รองรับผ่าน API เลย
 * (createCampaign คืน 400) — ยังไม่มี backend firmware module ให้เลือก
 * (รอ Sprint 3 #23) — UI นี้จึงล็อกไว้ที่ "Config" เท่านั้น */
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
  /** บังคับเมื่อ payloadType เป็น Config (ตัวเดียวที่รองรับตอนนี้) */
  configId?: string;
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
 * `POST /campaigns` — Operation เท่านั้น · 404 ถ้าไม่พบ Config · 409 ถ้า Config
 * ยังไม่อนุมัติ หรืออุปกรณ์เป้าหมายบางเครื่องยังไม่ installed/รุ่นไม่ตรง
 * (backend รวมทุกปัญหาไว้ใน `message` เดียว) · 400 ถ้า targets ว่าง/deviceId
 * ซ้ำ หรือ payloadType Firmware
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
