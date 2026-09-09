import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigDeletionService } from './config-deletion.service';

/**
 * ตัวตั้งเวลาของ flow "คำขอลบ Config อัตโนมัติ" (docs/11 §3) — แยกจาก service
 * เพื่อให้ business logic (`ConfigDeletionService.sweep()`) เทสได้ตรงๆ โดยไม่
 * ต้องยุ่งกับ `@nestjs/schedule` / SchedulerRegistry
 *
 * รันตี 1 ทุกวัน — ช่วง off-peak, หลังงาน batch เที่ยงคืนอื่น ๆ (ยังไม่มี job
 * อื่นในระบบตอนนี้ แต่กันไว้) · ปริมาณ candidate ต่อรอบน้อย (Config ที่ค้าง
 * นานพอ) ไม่ต้องแบ่ง batch
 */
@Injectable()
export class ConfigDeletionJob {
  private readonly logger = new Logger(ConfigDeletionJob.name);

  constructor(private readonly service: ConfigDeletionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'config-deletion-sweep' })
  async run(): Promise<void> {
    try {
      const created = await this.service.sweep();
      this.logger.log(
        `config-deletion sweep เสร็จ — สร้างคำขอใหม่ ${created.length} รายการ`,
      );
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — log ไว้ให้รอบถัดไปลองใหม่
      this.logger.error(
        `config-deletion sweep ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
