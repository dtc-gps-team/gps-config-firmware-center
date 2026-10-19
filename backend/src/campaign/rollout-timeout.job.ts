import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RolloutTimeoutService } from './rollout-timeout.service';

/**
 * ตัวตั้งเวลาของเวลารอเครื่องที่ไม่ตอบกลับ (docs/19 §16.5) — แยกจาก service
 * เพื่อให้ `RolloutTimeoutService.sweep()` เทสได้ตรงๆ (รูปแบบเดียวกับ
 * `ConfigDeletionJob`) ทุก 5 นาที เพียงพอเพราะเวลารอที่เล็กสุดที่ตั้งได้คือ
 * หน่วยนาที และเกณฑ์ปกติเป็นชั่วโมง
 *
 * **backend ต้องรันตัวเดียว** (docs/deploy/docker-compose.md) ถ้ารันหลายตัว
 * งานนี้จะรันซ้ำ ข้อมูลไม่พังเพราะทุกการเปลี่ยนสถานะ claim แบบ atomic แต่ log
 * จะซ้ำ และโหมด `mock` ไม่มีผลเพราะ query เฉพาะ Rollout ที่ `applyMode = real`
 */
@Injectable()
export class RolloutTimeoutJob {
  private readonly logger = new Logger(RolloutTimeoutJob.name);

  constructor(private readonly service: RolloutTimeoutService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'rollout-timeout-sweep' })
  async run(): Promise<void> {
    try {
      const result = await this.service.sweep();
      if (result.skippedOffline > 0 || result.applyTimedOut > 0) {
        this.logger.log(
          `rollout-timeout sweep: ข้ามเครื่องออฟไลน์ ${result.skippedOffline} · ดึงแล้วเงียบ ${result.applyTimedOut}`,
        );
      }
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — log ไว้ให้รอบถัดไปลองใหม่
      this.logger.error(
        `rollout-timeout sweep ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
