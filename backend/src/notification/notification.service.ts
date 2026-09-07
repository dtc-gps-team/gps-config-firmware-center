import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeviceToken,
  Notification,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FCM_SENDER, type FcmSender } from './fcm-sender';

export type NotificationMode = 'mock' | 'fcm';

/**
 * ขอบเขต Phase นี้ (PR B) — เปิด push จริงให้แค่ type เดียวก่อน `task_assigned`
 * เป็น type ที่ B คุมเองทั้ง flow (สร้างจาก `TaskService` ตอนมอบหมายงาน) จึง
 * ทดสอบ end-to-end ได้ครบวงจรโดยไม่ต้องรอ module อื่น ส่วน type ที่เหลือ
 * (`config_approved`/`config_rejected`/`firmware_ready`/`incident_alert` —
 * ของ A) จะเปิดทีละตัวใน PR ถัดไปหลังยืนยันกับ A ว่าข้อความที่ mobile
 * แสดงผลของแต่ละ type พร้อมแล้ว
 */
export const FCM_ENABLED_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'task_assigned',
];

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  payload?: Prisma.InputJsonValue;
}

/**
 * Notification module (ดู 01_GPS_Build_Reference.md Section 3 +
 * docs/05_Mobile_Notification_FCM.md)
 *
 * ควบคุมด้วย env `NOTIFICATION_MODE`:
 *   - `mock` (ค่าเริ่มต้น) — บันทึก record ลง DB แล้ว log อย่างเดียว ไม่ยิงออกจริง
 *   - `fcm` — ส่งจริงผ่าน FCM (Android เท่านั้นตอนนี้ — ดู `RealFcmSender`)
 *     แต่เฉพาะ type ใน `FCM_ENABLED_NOTIFICATION_TYPES` เท่านั้น type อื่น
 *     fallback เป็น mock เงียบๆ (PR B, ขยายทีละ type ใน PR ถัดไป) เว็บ
 *     (WebSocket) ยังไม่ implement
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
    @Inject(FCM_SENDER) private readonly fcmSender: FcmSender,
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

    // mode === 'fcm' แต่ type นี้ยังไม่อยู่ใน FCM_ENABLED_NOTIFICATION_TYPES —
    // ต้อง fallback เงียบๆ เหมือน mode=mock ไม่ throw เด็ดขาด เพราะ send()
    // ถูกเรียกจากหลาย module (task/config/incident) อยู่แล้วสำหรับ type อื่นๆ
    // ด้วย ถ้า throw ตรงนี้จะทำให้ module ที่ยังไม่ถึงคิวเปิด push จริง error
    // ทั้งที่โค้ดของเขาไม่ได้ทำอะไรผิด
    if (!FCM_ENABLED_NOTIFICATION_TYPES.includes(input.type)) {
      this.logger.log(
        `[fcm] type "${input.type}" ยังไม่เปิด push จริง (fallback เหมือน mock) notification ${notification.id}`,
      );
      return notification;
    }

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: input.userId },
    });

    if (tokens.length === 0) {
      this.logger.log(
        `[fcm] user ${input.userId} ไม่มี device token ที่ลงทะเบียนไว้ — ข้าม notification ${notification.id}`,
      );
      return notification;
    }

    // Android-only (Phase นี้): ไม่ filter ตาม DeviceToken.platform ก่อนส่ง —
    // Mobile ยังไม่มีโค้ดฝั่ง iOS/Web ที่ลงทะเบียน token จริง (PR C/D) token
    // ที่มีอยู่ใน DB ตอนนี้จึงเป็น Android ทั้งหมดโดยพฤตินัย วันที่มี platform
    // อื่นเข้ามาจริงต้องกรองตรงนี้ก่อนส่ง (ดูคอมเมนต์ที่หัว RealFcmSender ด้วย)
    const { invalidTokens } = await this.fcmSender.sendToTokens({
      tokens: tokens.map((t) => t.token),
      notification: { type: input.type, payload: input.payload ?? {} },
    });

    if (invalidTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      });
      this.logger.log(
        `[fcm] ลบ device token ที่ invalid ${invalidTokens.length} ตัว (user ${input.userId})`,
      );
    }

    return this.markSent(notification.id);
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
