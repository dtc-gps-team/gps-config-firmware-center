import { Prisma } from '@prisma/client';

/**
 * สัญญาระหว่างโมดูล `config-apply-request` (B) กับ `campaign` (A) ของ docs/25
 * §3.2 ทาง ค. + §3.5 — ฝั่ง A implement ใน `CampaignRolloutService`
 * (`createFieldApplyRollout()` / `startFieldApplyRollout()`, #362) และผูก provider
 * ไว้ที่ `config-apply-request.module.ts`
 *
 * ผลจากกล่องกลับมาทาง `FIELD_APPLY_RESULT_EVENT` ผ่าน `RolloutEvents` (นิยามอยู่ที่
 * `campaign/rollout-events.ts` ไฟล์นี้ re-export ให้ใช้ชื่อเดียวกันทั้งโมดูล) —
 * campaign จึงไม่ต้อง import โมดูลนี้ (กัน circular dependency)
 *
 * Campaign ระบบตัวเดียวที่ Rollout เครื่องเดียวผูกอยู่ (มติ Q2) เป็นของ A ทั้งหมด:
 * `FIELD_APPLY_SYSTEM_CAMPAIGN_NAME` + `getOrCreateFieldApplySystemCampaign()` ใน
 * `campaign/field-apply-system-campaign.ts` (#362) หาด้วยชื่อ ไม่มีก็สร้างตอนอนุมัติ
 * ครั้งแรก (ใช้ได้ทั้ง dev และ production) — ฝั่ง B ไม่ seed และไม่อ้างถึง Campaign นี้
 */

export {
  FIELD_APPLY_RESULT_EVENT,
  type FieldApplyOutcome,
  type FieldApplyResultEvent,
} from '../campaign/rollout-events';

/** payload ของ Rollout เครื่องเดียว (docs/27 §6) — `kind` ไม่ส่ง = Config
 * (ผู้เรียกเดิมก่อน B2) · Firmware: `allowDowngrade` = คำขอถอยเวอร์ชันที่
 * Operation อนุมัติแล้ว → `CampaignRollout.allowDowngrade` */
export type FieldApplyRolloutPayload =
  | { kind?: 'config'; configId: string }
  | { kind: 'firmware'; firmwareId: string; allowDowngrade: boolean };

export type FieldApplyRolloutInput = FieldApplyRolloutPayload & {
  /** `ConfigApplyRequest.id` ที่ Rollout นี้ถูกสร้างมาให้ */
  requestId: string;
  /** `Device.deviceId` เครื่องเดียวของ Rollout */
  deviceId: string;
  /** ช่างผู้ขอ → `CampaignRollout.createdBy` (§3.2) */
  requestedBy: string;
  /** Operation ผู้อนุมัติคำขอ (ผ่าน SoD แล้ว) → `CampaignRollout.approvedBy` */
  approvedBy: string;
};

export interface FieldApplyRolloutStarter {
  /**
   * สร้าง Rollout เครื่องเดียวใต้ Campaign ระบบ (หา/สร้างด้วย `tx` เดียวกัน) สถานะ
   * `active` (ข้าม `pending_approval` เพราะอนุมัติแล้วที่คำขอ) ปิด Auto Pause
   * (เครื่องเดียวไม่มี % ให้ pause — ยังปิดตาม docs/25) · Incident ตอน `failed`
   * เปิดกลับตาม docs/27 §2.1 Q4 (งาน A1) · `applyMode` ตาม env เดิม
   * `DEVICE_CONFIG_APPLY_MODE` (§3.5 ข้อ 6) — **เรียกในทรานแซกชันของผู้เรียก**
   * (`tx`) ถ้า throw คำขอจะไม่เปลี่ยนสถานะเลย (ยัง `approved` — เรียกตอนช่างกดส่ง docs/27)
   */
  createFieldApplyRollout(
    tx: Prisma.TransactionClient,
    input: FieldApplyRolloutInput,
  ): Promise<{ rolloutId: string }>;

  /**
   * เริ่มส่งหลัง commit แล้ว (`autoApplyConfig()` / `autoApplyFirmware()` ตาม
   * `payloadType` → Server กลาง/mock) —
   * ผลส่งไม่ได้ให้จบผ่าน `recordTargetResult()` ตามเดิม แล้วส่งผลกลับด้วย
   * `FIELD_APPLY_RESULT_EVENT` · ผู้เรียกห่อ try/catch ไว้แล้ว · ค่าที่คืนไม่ได้ใช้
   */
  startFieldApplyRollout(rolloutId: string, actorId: string): Promise<unknown>;
}

export const FIELD_APPLY_ROLLOUT_STARTER = Symbol(
  'FIELD_APPLY_ROLLOUT_STARTER',
);
