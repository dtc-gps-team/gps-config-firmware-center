import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfigSyncFailure,
  ConfigSyncWriterQueue,
} from '../config-sync-writer/config-sync-writer-queue.service';
import { NotificationService } from './notification.service';

const OPERATION_ROLE_CODE = 'Operation';

/**
 * ฟัง event `'sync-failed'` จาก `ConfigSyncWriterQueue` (PR #131) แล้วยิง
 * notification `incident_alert` ให้ทุก user role Operation ที่ active — ตาม
 * docs/07 §6/§7 ("Alert เข้า notification — งาน B") + มติ #32 §9.5 Q3 (reuse
 * `incident_alert` ไม่เพิ่ม NotificationType ใหม่)
 *
 * Subscribe ผ่าน `OnModuleInit` แทนการฉีดผ่าน constructor ของ queue เอง —
 * ตาม design ของ `ConfigSyncWriterQueue` (ดู comment ในไฟล์นั้น) ที่ตั้งใจให้
 * A (Incident) และ B (notification) ต่างคน `.on()` ในโมดูลของตัวเอง โดยไม่ต้อง
 * แก้ไฟล์ queue เลย
 *
 * **Never throws จาก handler** — `EventEmitter.emit()` เป็น sync ไม่ await
 * ผล listener (ดู comment ที่ B เพิ่มใน `ConfigSyncFailure` doc — PR #131
 * review #2) reject ที่ไม่ครอบจะกลายเป็น unhandledRejection ระดับ process
 * ครอบทั้งฟังก์ชันด้วย try/catch เสมอ — pattern เดียวกับ
 * `ConfigDeletionService.notifySuperAdmins()`
 */
@Injectable()
export class ConfigSyncFailureAlertListener implements OnModuleInit {
  private readonly logger = new Logger(ConfigSyncFailureAlertListener.name);

  constructor(
    private readonly queue: ConfigSyncWriterQueue,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit(): void {
    this.queue.on('sync-failed', (failure: ConfigSyncFailure) => {
      void this.handleSyncFailed(failure);
    });
  }

  private async handleSyncFailed(failure: ConfigSyncFailure): Promise<void> {
    try {
      const operations = await this.prisma.user.findMany({
        where: { role: { code: OPERATION_ROLE_CODE }, isActive: true },
        select: { id: true },
      });

      if (operations.length === 0) {
        this.logger.warn(
          `sync-failed config ${failure.configId} — ไม่มี user role Operation ที่ active ให้แจ้งเตือน`,
        );
        return;
      }

      for (const operation of operations) {
        try {
          await this.notificationService.send({
            userId: operation.id,
            type: 'incident_alert',
            payload: {
              configId: failure.configId,
              versionNumber: failure.versionNumber,
              deviceModel: failure.deviceModel,
              protocol: failure.protocol,
              attempts: failure.attempts,
              lastError: failure.lastError,
            },
          });
        } catch (err) {
          // 1 user ส่งไม่สำเร็จไม่ควรทำให้ Operation คนอื่นไม่ได้รับ — log แล้วไปต่อ
          this.logger.warn(
            `แจ้งเตือน incident_alert (sync-failed config ${failure.configId}) ไม่สำเร็จ ` +
              `user ${operation.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `handleSyncFailed พังทั้งฟังก์ชัน (config ${failure.configId}): ${(err as Error).message}`,
      );
    }
  }
}
