import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  getMessaging,
  type Messaging,
  type MulticastMessage,
} from 'firebase-admin/messaging';

export interface FcmSendInput {
  tokens: string[];
  notification: { type: NotificationType; payload: unknown };
}

export interface FcmSendResult {
  /** token ที่ FCM ตอบว่า invalid/ไม่ได้ลงทะเบียนแล้ว — ผู้เรียกต้องลบออกจาก
   * `DeviceToken` (ดู `NotificationService.send()`) */
  invalidTokens: string[];
}

/**
 * แยก Interface จาก Implementation ตาม Build Reference §4.3 เหมือน
 * `DeviceConnectionTester` (`device-connection-tester.ts`) — วันไหนต้องสลับ
 * ผู้ให้บริการ push (หรือ mock ตอนเทส) ค่อยเพิ่ม implementation ใหม่ ไม่ต้อง
 * แก้ `NotificationService`
 */
export interface FcmSender {
  // property function type — เหตุผลเดียวกับ `DeviceConnectionTester.testConnection`
  // (กัน `@typescript-eslint/unbound-method` ตอนเทสอ้างเมธอดตรงๆ)
  sendToTokens: (input: FcmSendInput) => Promise<FcmSendResult>;
}

/** DI token — interface ล้วนเป็น token ไม่ได้ (erase ตอน compile) */
export const FCM_SENDER = Symbol('FCM_SENDER');

/**
 * Mock implementation — ยังไม่ยิงออกจริง คืน "ส่งสำเร็จหมดทุก token" เสมอ
 * (ใช้ตอน `NOTIFICATION_MODE=mock` หรือ unit test) สถานะเดียวกับ
 * `MockDeviceConnectionTester`
 */
@Injectable()
export class MockFcmSender implements FcmSender {
  private readonly logger = new Logger(MockFcmSender.name);

  sendToTokens(input: FcmSendInput): Promise<FcmSendResult> {
    this.logger.log(
      `[mock] fcm send -> ${input.tokens.length} token(s) (${input.notification.type})`,
    );
    return Promise.resolve({ invalidTokens: [] });
  }
}

/** ชื่อ Firebase App แยกจาก default app — กันชนกับแอปอื่นถ้าวันหลังมีคนเรียก
 * `initializeApp()` ของ Firebase SDK เองในโปรเจกต์ (ยังไม่มีตอนนี้ แต่กันไว้) */
const FIREBASE_APP_NAME = 'fcm-sender';

/** FCM error code ที่แปลว่า "token นี้ใช้การไม่ได้แล้ว" — ต้องลบออกจาก DB
 * ไม่ใช่ retry (ตรงข้ามกับ error ชั่วคราวเช่น `messaging/internal-error` ที่
 * ควรปล่อยให้ token ยังอยู่แล้วลองใหม่รอบหน้า) เช็คจาก
 * `firebase-admin/lib/messaging/error.d.ts` (`MessagingErrorCode`) เวอร์ชันที่
 * ลงจริงในโปรเจกต์นี้ (14.3.0) — ไม่ได้เดาชื่อ code */
const INVALID_TOKEN_ERROR_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

/**
 * ยิง push จริงผ่าน FCM HTTP v1 API (Firebase Admin SDK, Service Account JSON
 * — ไม่ใช่ Legacy server key ที่ Google เลิกใช้แล้ว ดู `.env.example`)
 *
 * หมายเหตุ Android-only (Phase นี้): ไม่มี logic แยก platform ในนี้เลย ส่งไป
 * ทุก token ที่ query มาเหมือนกันหมด เพราะ `DeviceToken.platform` ที่ Mobile
 * ส่งขึ้นมาตอนนี้มีแต่ `"android"` (ยังไม่มีโค้ดฝั่ง iOS/Web ที่ลง token จริง
 * — PR C/D) ถ้าวันหน้ามี token แพลตฟอร์มอื่นปนมา ต้อง filter ตาม `platform`
 * ก่อนเรียกที่นี่ (ที่ `NotificationService`, ไม่ใช่ในนี้ — ตัวนี้ไม่ควรรู้จัก
 * concept "platform")
 */
export class RealFcmSender implements FcmSender {
  private readonly logger = new Logger(RealFcmSender.name);
  private readonly messaging: Messaging;

  constructor(serviceAccountPath: string) {
    // Fail fast ตอน startup (provider factory รัน) ไม่ใช่ตอนส่งจริงครั้งแรก —
    // เหมือน pattern `DEVICE_CONNECTION_TEST_MODE=real` เดิมใน device.module.ts
    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `FCM_SERVICE_ACCOUNT_PATH ไม่พบไฟล์: ${serviceAccountPath}`,
      );
    }

    const app =
      getApps().find((a) => a.name === FIREBASE_APP_NAME) ??
      this.initApp(serviceAccountPath);
    this.messaging = getMessaging(app);
  }

  private initApp(serviceAccountPath: string): App {
    try {
      // `cert()` รับ path string ตรงๆ ได้ (อ่าน + parse JSON เองข้างใน แบบ
      // synchronous) ไม่ต้อง `require()` ไฟล์เอง
      return initializeApp(
        { credential: cert(serviceAccountPath) },
        FIREBASE_APP_NAME,
      );
    } catch (err) {
      throw new Error(
        `โหลด FCM service account ไม่สำเร็จ (${serviceAccountPath}): ${
          (err as Error).message
        }`,
      );
    }
  }

  async sendToTokens({
    tokens,
    notification,
  }: FcmSendInput): Promise<FcmSendResult> {
    if (tokens.length === 0) return { invalidTokens: [] };

    // Data-only message (ไม่ใส่ `notification: {title, body}`) — ข้อความที่
    // แสดงจริงบนมือถือเป็นเรื่องของ Mobile client (PR C/D, ยังไม่ทำรอบนี้)
    // ที่นี่ส่งแค่ type + payload ดิบให้พอ mobile map เป็นข้อความเองได้ FCM
    // `data` payload ต้องเป็น `Record<string, string>` เท่านั้น
    const message: MulticastMessage = {
      tokens,
      data: {
        type: notification.type,
        payload: JSON.stringify(notification.payload ?? {}),
      },
    };

    const response = await this.messaging.sendEachForMulticast(message);

    const invalidTokens: string[] = [];
    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code;
      if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
        invalidTokens.push(tokens[index]);
      } else if (code) {
        this.logger.warn(`fcm send failed (token #${index}): ${code}`);
      }
    });

    return { invalidTokens };
  }
}
