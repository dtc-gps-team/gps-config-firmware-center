import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationMode = 'mock' | 'fcm';

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  payload?: Prisma.InputJsonValue;
}

/**
 * Skeleton ของ notification module (ดู 01_GPS_Build_Reference.md Section 3)
 *
 * ควบคุมด้วย env `NOTIFICATION_MODE`:
 *   - `mock` (ค่าเริ่มต้น) — บันทึก record ลง DB แล้ว log อย่างเดียว ไม่ยิงออกจริง
 *   - `fcm` — ช่องทางส่งจริง (FCM mobile + WebSocket web) ยังไม่ implement จนถึง Phase 4
 *
 * module ฝั่ง A (config-sync-writer / incident) จะ inject service นี้เพื่อยิง Alert
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly mode: NotificationMode;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.mode =
      config.get<string>('NOTIFICATION_MODE', 'mock') === 'fcm'
        ? 'fcm'
        : 'mock';
    this.logger.log(`notification mode = ${this.mode}`);
  }

  getMode(): NotificationMode {
    return this.mode;
  }

  /** สร้าง notification record แล้ว "ส่ง" ตามโหมดที่ตั้งไว้ */
  async send(input: SendNotificationInput): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        payload: input.payload ?? {},
      },
    });

    if (this.mode === 'mock') {
      this.logger.log(
        `[mock] notification ${notification.id} -> user ${input.userId} (${input.type})`,
      );
      return notification;
    }

    // TODO(Phase 4): ส่งจริงผ่าน FCM (mobile) + WebSocket (web) แล้วเรียก markSent()
    throw new Error(`NOTIFICATION_MODE=${this.mode} ยังไม่รองรับ`);
  }

  /** ทำเครื่องหมายว่าส่งออกไปแล้ว (บันทึกเวลา sentAt) */
  markSent(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { sentAt: new Date() },
    });
  }
}
