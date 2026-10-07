import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { INCIDENT_DECISION_OUTCOMES } from '../incident-status';
import type { IncidentDecisionOutcome } from '../incident-status';

/**
 * Body ของ `POST /incidents/:id/decide` (issue #236) — Operation ตัดสินใจ
 * field report ที่ยังเป็น `open`:
 *   - `resolve`  → ปัญหาจริง แก้แล้วนอกเหนือ Campaign (เช่น เปลี่ยนฮาร์ดแวร์
 *     หน้างาน) → `status: resolved`
 *   - `dismiss`  → ไม่ใช่ปัญหาจริง/ซ้ำ → `status: dismissed`
 *   - `promote`  → ต้องแก้ด้วย Campaign → `status: investigating` คืน
 *     `deviceId`/`deviceModel`/`protocol` ให้ Operation เอาไปสร้าง Campaign
 *     เองต่อ (`POST /campaigns` พร้อม `sourceIncidentId`) — **ไม่เดา
 *     Config/Firmware ให้** เพราะ report มีแค่คำอธิบายอิสระ ระบบไม่รู้จริงว่า
 *     ปัญหาคืออะไร
 *
 * `note` บังคับเสมอไม่ว่า outcome ไหน (mirror pattern "ทุก override/decision
 * ต้องมีเหตุผล" ของ CLAUDE.md/Design PDF §19 ข้อ 24)
 */
export class DecideIncidentDto {
  @IsIn(INCIDENT_DECISION_OUTCOMES)
  outcome!: IncidentDecisionOutcome;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}
