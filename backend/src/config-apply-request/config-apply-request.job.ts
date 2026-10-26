import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigApplyRequestService } from './config-apply-request.service';

/**
 * ปิดคำขอส่ง Config ที่ค้าง `pending` เกินเวลา (docs/25 §3.9) — แยกจาก service
 * เพื่อให้ `expireOverdue()` เทสได้ตรงๆ (รูปแบบเดียวกับ `RolloutTimeoutJob`)
 * ทุก 5 นาที เพียงพอเพราะอายุคำขอเป็นหลักชั่วโมง
 */
@Injectable()
export class ConfigApplyRequestExpiryJob {
  private readonly logger = new Logger(ConfigApplyRequestExpiryJob.name);

  constructor(private readonly service: ConfigApplyRequestService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'config-apply-request-expiry' })
  async run(): Promise<void> {
    try {
      const expired = await this.service.expireOverdue();
      if (expired > 0) {
        this.logger.log(`คำขอส่ง Config หมดอายุ ${expired} รายการ`);
      }
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — log ไว้ให้รอบถัดไปลองใหม่
      this.logger.error(
        `config-apply-request expiry ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
