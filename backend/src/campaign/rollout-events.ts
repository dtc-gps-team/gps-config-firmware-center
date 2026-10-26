import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { IncidentSeverity } from '@prisma/client';

/**
 * Event ของ Campaign Rollout ที่โมดูลอื่นฟัง (docs/19 §15.5) — รูปแบบเดียวกับ
 * `ConfigSyncWriterQueue` (`'sync-failed'`): campaign ส่ง event แล้วโมดูล incident
 * (A) กับโมดูล notification (B) ต่างฟังเองคนละ PR โดยไม่แตะไฟล์ของกันและกัน
 *
 * **listener ต้อง self-contain error handling เอง** — `emit()` เป็น sync ไม่ await
 * ผล listener แบบ async ที่ reject จะกลายเป็น unhandledRejection (review #131)
 * ฝั่งส่งห่อ `emit()` ด้วย try/catch กัน listener ที่ throw แบบ sync ไม่ให้ทำให้
 * การบันทึกผล Rollout ล้ม
 */
export const ROLLOUT_FAILED_EVENT = 'rollout-failed';
export const ROLLOUT_STATUS_CHANGED_EVENT = 'rollout-status-changed';
export const ROLLOUT_RESULT_UPDATED_EVENT = 'rollout-result-updated';
/**
 * `field-apply-result` (docs/25 §3.5 ข้อ 5, #370) — ผลของ Rollout เครื่องเดียวที่
 * สร้างจากคำขอส่ง Config หน้างาน (`CampaignRolloutService.startFieldApplyRollout()`)
 * โมดูล `config-apply-request` ของ B ฟัง event นี้เพื่ออัปเดตสถานะ
 * `ConfigApplyRequest` **ชื่อ event/ชนิดข้อมูลตรงกับ
 * `config-apply-request/field-apply-rollout.ts` ของ B โดยตั้งใจซ้ำกันตรงๆ ไม่
 * import ข้ามมา** — กันไม่ให้ `campaign` ต้อง import โมดูลของ B (ทิศทางเดียว
 * ตามที่ B ออกแบบไว้ในไฟล์นั้น) ถ้าแก้ชื่อ field ฝั่งใดฝั่งหนึ่งต้องแก้อีกฝั่งด้วย
 */
export const FIELD_APPLY_RESULT_EVENT = 'field-apply-result';
export type FieldApplyOutcome = 'succeeded' | 'failed' | 'skipped_offline';
export interface FieldApplyResultEvent {
  rolloutId: string;
  outcome: FieldApplyOutcome;
  /** `CampaignRolloutTarget.resultDetail` */
  detail: string;
}

export type RolloutFailureKind =
  'auto-pause' | 'completed-with-failures' | 'completed-with-skipped';

/** `rollout-failed` — Auto Pause หรือ Rollout จบแต่มีเครื่องที่ไม่สำเร็จ/ถูกข้าม
 * (incident และ notification ฟัง) ตรงกับ docs/19 §15.5 ที่ B ขอปรับแล้ว:
 * `configId`/`firmwareId` nullable, `sampleErrors` ไม่เกิน 3 รายการ,
 * ไม่มี `deviceModel`/`protocol` (หาจาก `configId` ได้) */
export interface RolloutFailedEvent {
  rolloutId: string;
  campaignId: string;
  campaignName: string;
  configId: string | null;
  firmwareId: string | null;
  kind: RolloutFailureKind;
  /** คำนวณที่ campaign ครั้งเดียว ทั้ง incident และ notification ใช้ค่าเดียวกัน */
  severity: IncidentSeverity;
  failureCount: number;
  /** เครื่องที่ถูกข้ามเพราะออฟไลน์ (docs/19 §16) */
  skippedCount: number;
  targetCount: number;
  /** ไม่เกิน 20 เครื่อง */
  failedDeviceIds: string[];
  /** ไม่เกิน 3 รายการ จาก `CampaignRolloutTarget.resultDetail` */
  sampleErrors: string[];
}

/** `rollout-status-changed` — ให้ incident ปรับสถานะตามการตัดสินใจของ
 * Operation / ผลของ Rollout (docs/19 §15.4) เฉพาะ incident ฟัง */
export interface RolloutStatusChangedEvent {
  rolloutId: string;
  campaignId: string;
  /** `resumed` Operation กด Resume · `rolled-back` Operation กด Rollback ·
   * `completed-clean` Rollout จบโดยไม่มีเครื่องล้ม/ถูกข้ามในรอบหลัง Resume */
  action: 'resumed' | 'rolled-back' | 'completed-clean';
}

/** `rollout-result-updated` — ผลของเครื่องในรอบที่จบหรือหยุดไปแล้วเปลี่ยน (เช่น
 * เครื่องที่ถูกข้ามกลับมารายงานผลล่าช้า docs/19 §16.4) ให้ incident อัปเดต
 * **ตัวเลขใน Incident เดิมอย่างเดียว** ไม่เปลี่ยนสถานะ ไม่สร้างใหม่ และ
 * **notification ไม่ฟัง** จึงไม่แจ้งเตือนซ้ำต่อเครื่อง (docs/19 §15.4 แถวสุดท้าย) */
export interface RolloutResultUpdatedEvent {
  rolloutId: string;
  campaignId: string;
  campaignName: string;
  /** ใช้ตอนอัปเดตเท่านั้นเลือกค่าที่สูงกว่าเดิม ไม่ลดระดับ Incident */
  severity: IncidentSeverity;
  failureCount: number;
  skippedCount: number;
  targetCount: number;
  /** ไม่เกิน 20 เครื่อง */
  failedDeviceIds: string[];
  /** ไม่เกิน 3 รายการ */
  sampleErrors: string[];
}

export const MAX_EVENT_FAILED_DEVICE_IDS = 20;
export const MAX_EVENT_SAMPLE_ERRORS = 3;

@Injectable()
export class RolloutEvents extends EventEmitter {
  /** ส่ง event โดยไม่ให้ listener ที่ throw แบบ sync ทำให้ผู้เรียกล้ม */
  safeEmit(
    event: typeof ROLLOUT_FAILED_EVENT,
    payload: RolloutFailedEvent,
  ): void;
  safeEmit(
    event: typeof ROLLOUT_STATUS_CHANGED_EVENT,
    payload: RolloutStatusChangedEvent,
  ): void;
  safeEmit(
    event: typeof ROLLOUT_RESULT_UPDATED_EVENT,
    payload: RolloutResultUpdatedEvent,
  ): void;
  safeEmit(
    event: typeof FIELD_APPLY_RESULT_EVENT,
    payload: FieldApplyResultEvent,
  ): void;
  safeEmit(event: string, payload: unknown): void {
    try {
      this.emit(event, payload);
    } catch {
      // listener ต้องจัดการ error เอง — ที่นี่ไม่ปล่อยให้ทะลุกลับไปผู้เรียก
    }
  }
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** เลือก severity ที่สูงกว่า (ใช้ตอนอัปเดต Incident เดิมของ Rollout เดียวกัน) */
export function maxSeverity(
  a: IncidentSeverity,
  b: IncidentSeverity,
): IncidentSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * ความรุนแรงของ Incident จากผลของ Rollout (docs/19 §15.2 ถึง §16.3)
 *   - critical: มีเครื่อง "ดึงงานแล้วเงียบ" จนหมดเวลาอย่างน้อย 1 เครื่อง (PDF §11.2)
 *   - high:     Auto Pause หรืออัตราล้มเหลวเกินเกณฑ์ (> `threshold`)
 *   - medium:   มีเครื่องล้มแต่ไม่เกินเกณฑ์
 *   - low:      ไม่มีเครื่องล้ม แต่มีเครื่องถูกข้ามเพราะออฟไลน์
 */
export function rolloutFailureSeverity(input: {
  autoPaused: boolean;
  timeoutFailureCount: number;
  windowFailureCount: number;
  skippedCount: number;
  targetCount: number;
  threshold: number;
}): IncidentSeverity {
  if (input.timeoutFailureCount > 0) return 'critical';
  if (input.autoPaused) return 'high';
  if (input.windowFailureCount > 0) {
    const rate =
      input.targetCount > 0 ? input.windowFailureCount / input.targetCount : 0;
    return rate > input.threshold ? 'high' : 'medium';
  }
  return 'low';
}
