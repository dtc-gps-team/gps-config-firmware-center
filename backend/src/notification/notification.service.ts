import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeviceToken,
  Notification,
  NotificationType,
  Prisma,
} from '@prisma/client';
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

  /** ดึงรายการ notification ของ user คนเดียว กรองเฉพาะ unread ได้ */
  findByUser(userId: string, unread?: boolean): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unread === true ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** ทำเครื่องหมายว่า user อ่านแล้ว (read = true)
   * กรอง where: { id, userId } ป้องกัน IDOR — throw NotFoundException ถ้าไม่พบ
   */
  async markRead(id: string, userId: string): Promise<Notification> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });

    if (result.count === 0) {
      throw new NotFoundException(`Notification not found`);
    }

    // updateMany ไม่คืน record — ดึงใหม่แยก
    return this.prisma.notification.findUnique({
      where: { id },
    }) as Promise<Notification>;
  }

  // -------------------------------------------------------------------------
  // Device tokens (Push Notification groundwork — Sprint 3 #17, PR A)
  // ยังไม่มีโค้ดส่ง push จริง (PR B) — รอบนี้แค่เก็บ token
  // -------------------------------------------------------------------------

  /**
   * ลงทะเบียน / อัปเดต FCM device token ของ user — upsert ตาม `token`
   *
   * FCM token = identifier ของ "แอป+เครื่อง" 1 ตัว ถ้า token เดิมส่งเข้ามาอีก
   * (เครื่องเดิม แต่คนละ user เช่นผู้ใช้ล็อกอินใหม่บนเครื่องเดิม) ให้ทับ
   * `userId`/`platform` — `updatedAt` Prisma bump ให้เอง
   *
   * `userId` มาจาก JWT (`req.user.sub`) เสมอ ไม่รับจาก client
   */
  registerDeviceToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<DeviceToken> {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  /**
   * ถอนทะเบียน device token (เรียกตอน logout)
   *
   * IDOR Prevention Pattern (CLAUDE.md): `deleteMany({ where: { token, userId } })`
   * + เช็ค `count === 0` → 404 — ลบ token ของ user อื่นไม่ได้
   */
  async removeDeviceToken(userId: string, token: string): Promise<void> {
    const result = await this.prisma.deviceToken.deleteMany({
      where: { token, userId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Device token not found');
    }
  }
}
