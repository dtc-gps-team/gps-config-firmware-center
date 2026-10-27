import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TaskService } from './task.service';

/**
 * ปิดงานที่ไม่มีความเคลื่อนไหวเกิน 24 ชม. (docs/28 D4, §5.4) — แยกจาก service
 * เพื่อให้ `autoCloseIdle()` เทสได้ตรงๆ (รูปแบบเดียวกับ
 * `ConfigApplyRequestExpiryJob`) · ทุก 15 นาที เพียงพอเพราะเกณฑ์เป็นหลักชั่วโมง
 */
@Injectable()
export class TaskAutoCloseJob {
  private readonly logger = new Logger(TaskAutoCloseJob.name);

  constructor(private readonly service: TaskService) {}

  @Cron('*/15 * * * *', { name: 'task-auto-close' })
  async run(): Promise<void> {
    try {
      const closed = await this.service.autoCloseIdle();
      if (closed > 0) {
        this.logger.log(`ปิดงานที่ไม่มีความเคลื่อนไหวให้ ${closed} งาน`);
      }
    } catch (err) {
      // job ไม่ควรทำให้ process ล้ม — log ไว้ให้รอบถัดไปลองใหม่
      this.logger.error(
        `task auto-close ล้มเหลว: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
