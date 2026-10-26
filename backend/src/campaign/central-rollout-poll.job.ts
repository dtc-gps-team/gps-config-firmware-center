import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CentralRolloutPollService } from './central-rollout-poll.service';

/** ถามผลคำสั่งที่สั่ง Server กลางไว้ทุก 4 วินาที (ผู้ใช้เฝ้าดูผลบนหน้าเว็บที่รีเฟรชทุก 5 วินาที) */
const POLL_INTERVAL_MS = 4000;

/**
 * ตัวตั้งเวลาของ `CentralRolloutPollService` (รูปแบบเดียวกับ `RolloutTimeoutJob`)
 * - ไม่มี Rollout โหมด central ที่รอผลอยู่ = query ว่างหนึ่งครั้ง ไม่ยิง Server กลาง
 * - กันรอบซ้อน: ถ้ารอบก่อนยังไม่จบ (Server กลางช้า) ข้ามรอบนี้
 * - backend ต้องรันตัวเดียว (docs/deploy/docker-compose.md) · ทุกการบันทึกผล claim แบบ
 *   atomic ถ้ารันซ้ำข้อมูลไม่พัง
 */
@Injectable()
export class CentralRolloutPollJob {
  private readonly logger = new Logger(CentralRolloutPollJob.name);
  private running = false;

  constructor(private readonly service: CentralRolloutPollService) {}

  @Interval('central-rollout-poll', POLL_INTERVAL_MS)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.service.poll();
      if (r.success + r.failed + r.skipped > 0) {
        this.logger.log(
          `central poll: สำเร็จ ${r.success}, ล้มเหลว ${r.failed}, ข้าม ${r.skipped}`,
        );
      }
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — รอบถัดไปลองใหม่
      this.logger.error(
        `central poll ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }
}
