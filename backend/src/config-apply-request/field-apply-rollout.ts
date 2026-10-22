import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * สัญญาระหว่างโมดูล `config-apply-request` (B) กับ `campaign` (A) ของ docs/25
 * §3.2 ทาง ค. + §3.5 — **ฝั่ง campaign ยังไม่ implement** (รอ A หลัง #362 merge)
 *
 * ไฟล์นี้อยู่ในโมดูลของ B เพื่อไม่แตะไฟล์ของ A: ฝั่ง A แค่ implement
 * `FieldApplyRolloutStarter` ใน `CampaignRolloutService` แล้วผูก provider
 * `FIELD_APPLY_ROLLOUT_STARTER` แทน `PendingFieldApplyRolloutStarter` ด้านล่าง
 * และส่ง event `FIELD_APPLY_RESULT_EVENT` ผ่าน `RolloutEvents` ตอนได้ผลจากกล่อง
 *
 * Campaign ระบบตัวเดียวที่ Rollout เครื่องเดียวผูกอยู่ (มติ Q2) เป็นของ A ทั้งหมด:
 * `FIELD_APPLY_SYSTEM_CAMPAIGN_NAME` + `getOrCreateFieldApplySystemCampaign()` ใน
 * `campaign/field-apply-system-campaign.ts` (#362) หาด้วยชื่อ ไม่มีก็สร้างตอนอนุมัติ
 * ครั้งแรก (ใช้ได้ทั้ง dev และ production) — ฝั่ง B ไม่ seed และไม่อ้างถึง Campaign นี้
 */

export interface FieldApplyRolloutInput {
  /** `ConfigApplyRequest.id` ที่ Rollout นี้ถูกสร้างมาให้ */
  requestId: string;
  /** `Device.deviceId` เครื่องเดียวของ Rollout */
  deviceId: string;
  configId: string;
  /** ช่างผู้ขอ → `CampaignRollout.createdBy` (§3.2) */
  requestedBy: string;
  /** Operation ผู้อนุมัติคำขอ (ผ่าน SoD แล้ว) → `CampaignRollout.approvedBy` */
  approvedBy: string;
}

export interface FieldApplyRolloutStarter {
  /**
   * สร้าง Rollout เครื่องเดียวใต้ Campaign ระบบ (หา/สร้างด้วย `tx` เดียวกัน) สถานะ
   * `active` (ข้าม `pending_approval` เพราะอนุมัติแล้วที่คำขอ) ปิด Auto Pause
   * และไม่สร้าง Incident (มติ Q4) · `applyMode` ตาม env เดิม
   * `DEVICE_CONFIG_APPLY_MODE` (§3.5 ข้อ 6) — **เรียกในทรานแซกชันของผู้เรียก**
   * (`tx`) ถ้า throw คำขอจะไม่เปลี่ยนสถานะเลย (ยัง `pending`)
   */
  createFieldApplyRollout(
    tx: Prisma.TransactionClient,
    input: FieldApplyRolloutInput,
  ): Promise<{ rolloutId: string }>;

  /**
   * เริ่มส่งหลัง commit แล้ว (`autoApplyConfig()` → `pushToCentral()`/mock) —
   * ผลส่งไม่ได้ให้จบผ่าน `recordTargetResult()` ตามเดิม แล้วส่งผลกลับด้วย
   * `FIELD_APPLY_RESULT_EVENT` · ผู้เรียกห่อ try/catch ไว้แล้ว
   */
  startFieldApplyRollout(rolloutId: string, actorId: string): Promise<void>;
}

export const FIELD_APPLY_ROLLOUT_STARTER = Symbol(
  'FIELD_APPLY_ROLLOUT_STARTER',
);

/**
 * ตัวแทนชั่วคราวจนกว่า A จะ implement (docs/25 §6 แถว "เมธอด public ใน
 * `CampaignRolloutService`") — ปฏิเสธทุกครั้งด้วย 503 ทำให้การอนุมัติ rollback
 * ทั้งทรานแซกชัน คำขอยัง `pending` ไม่มีสถานะครึ่งๆ กลางๆ (fail closed)
 *
 * TODO(A, docs/25 §3.5 ข้อ 2-3): แทนด้วย implementation จริงใน
 * `CampaignRolloutService` แล้วลบคลาสนี้
 */
@Injectable()
export class PendingFieldApplyRolloutStarter implements FieldApplyRolloutStarter {
  createFieldApplyRollout(): Promise<{ rolloutId: string }> {
    return Promise.reject(
      new ServiceUnavailableException(
        'ยังส่ง Config เข้ากล่องจากคำขอไม่ได้: รอ CampaignRolloutService สร้าง Rollout เครื่องเดียว (docs/25 §3.5) — คำขอยังรออนุมัติอยู่',
      ),
    );
  }

  startFieldApplyRollout(): Promise<void> {
    return Promise.reject(
      new ServiceUnavailableException(
        'ยังเริ่มส่ง Rollout ของคำขอไม่ได้: รอ CampaignRolloutService (docs/25 §3.5)',
      ),
    );
  }
}

/**
 * event ที่ฝั่ง campaign ส่งเมื่อ target ของ Rollout เครื่องเดียวจบ (docs/25 §3.5
 * ข้อ 5) — ส่งผ่าน `RolloutEvents` ตัวเดิม (โมดูลนี้ subscribe ไว้แล้ว) จึงไม่
 * ต้องให้ campaign import โมดูลนี้ (กัน circular dependency)
 *
 * TODO(A, docs/25 §3.5 ข้อ 5): emit จาก hook ใน `recordTargetResult()` /
 * `markTargetSkippedOffline()` เมื่อ Rollout มี `configApplyRequest` ผูกอยู่
 */
export const FIELD_APPLY_RESULT_EVENT = 'field-apply-result';

export type FieldApplyOutcome = 'succeeded' | 'failed' | 'skipped_offline';

export interface FieldApplyResultEvent {
  rolloutId: string;
  outcome: FieldApplyOutcome;
  /** `CampaignRolloutTarget.resultDetail` */
  detail: string;
}
