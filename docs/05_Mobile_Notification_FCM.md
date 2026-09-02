# 05 — Mobile/Web Notification: เปลี่ยนเป็น Push จริงผ่าน Firebase Cloud Messaging (FCM)

> ตัดสินใจโดย: kittiphong (B) — 2026-09-02
> สถานะ: **เอกสารเสนอ ยังไม่ได้เขียนโค้ดจริง** — รอ A รีวิวก่อนเริ่ม implement

## สรุปข้อเสนอ

เดิมวางแผนไว้ว่า Notification จะเป็น in-app inbox ธรรมดา (poll จาก backend ตอนแอปเปิดอยู่) ไม่ต้องใช้ Firebase — ตอนนี้ **B ตัดสินใจเปลี่ยนเป็น push notification จริงผ่าน Firebase Cloud Messaging (FCM) ซึ่งฟรี** ครอบคลุมทั้ง 3 แพลตฟอร์ม:

- Android
- iPhone (iOS)
- Web Browser

หมายเหตุ: `backend/src/notification/notification.service.ts` มี branch `NOTIFICATION_MODE=fcm` เตรียม skeleton ไว้อยู่แล้วตั้งแต่แรก (คอมเมนต์เดิมในโค้ดระบุ "FCM mobile + WebSocket web — ยังไม่ implement จนถึง Phase 4") แต่ปัจจุบัน branch นี้ยัง `throw new Error('NOTIFICATION_MODE=fcm ยังไม่รองรับ')` อยู่ — เอกสารนี้คือการยืนยันเดินหน้าตามแผนเดิมที่วางไว้ ไม่ใช่ scope ใหม่ที่เพิ่งคิด

## งานที่ต้องทำเพิ่ม (ยังไม่มีของพวกนี้ในระบบเลย ณ ตอนนี้)

1. **Schema ใหม่ — เก็บ FCM registration token ต่ออุปกรณ์/ผู้ใช้**
   ยังไม่มีตารางนี้ใน `schema.prisma` เลย (ไม่มี `DeviceToken`/`FcmToken` หรือ field ใน `User`) ข้อเสนอเบื้องต้น (ยัง**ไม่ fix** รอ A ออกแบบจริง):

   ```prisma
   model DeviceToken {
     id        String   @id @default(uuid())
     userId    String
     user      User     @relation(fields: [userId], references: [id])
     token     String   @unique
     platform  String   // "android" | "ios" | "web"
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt

     @@index([userId])
   }
   ```

   เหตุผลที่ต้องแยกตาราง ไม่ใช่ field เดียวใน `User`: **1 user อาจ login พร้อมกันหลายอุปกรณ์** (เช่น มือถือ + เปิดเว็บพร้อมกัน) ต้องส่ง push ไปทุก token ที่ยัง valid อยู่ ไม่ใช่แค่ตัวล่าสุด

2. **Backend — endpoint ลงทะเบียน/ลบ token**
   - `POST /notifications/device-token` — client ส่ง token ใหม่ขึ้นมาบันทึก (ตอน login หรือตอน token refresh)
   - `DELETE /notifications/device-token` — ลบ token ตอน logout (กัน push ไปเครื่องที่ออกจากระบบแล้ว)
   - เขียน implementation จริงใน `NotificationService.send()` branch `fcm` ให้เรียก Firebase Admin SDK ส่งไปทุก token ของ `userId` นั้น (แทนที่จะ throw error เหมือนตอนนี้)

3. **Firebase Project** — ต้องสร้างจริง (ฟรี ไม่มีค่าใช้จ่ายสำหรับตัว FCM เอง) แล้วเตรียม credential:
   - Backend: Service Account key (Firebase Admin SDK)
   - Android: `google-services.json`
   - iOS: `GoogleService-Info.plist`
   - Web: Firebase config object + VAPID key (สำหรับ Web Push)

4. **iOS ต้องมี APNs (Apple Push Notification service) คู่กับ FCM ด้วย** — FCM บน iOS ส่งผ่าน APNs ไม่ได้ยิงตรงแบบ Android ต้องมี **Apple Developer Program account (มีค่าใช้จ่ายรายปี)** เพื่อสร้าง APNs key/certificate ผูกกับ FCM — เป็นข้อกำหนดของ Apple ไม่ใช่ค่าใช้จ่ายของ FCM

5. **Mobile (Flutter)**: เพิ่ม `firebase_messaging` SDK, ขอ permission แจ้งเตือนจากผู้ใช้, ดึง token แล้วยิงขึ้น endpoint ข้อ 2, จัดการ token refresh/rotation

6. **Web (Next.js)**: ตั้งค่า Firebase Web SDK + Service Worker (`firebase-messaging-sw.js`) เพื่อรับ push ตอนแท็บไม่ได้เปิดอยู่ ต้องขอ permission แจ้งเตือนจาก browser ด้วย

## ยังไม่เปลี่ยน

- ตาราง `Notification` เดิมยังใช้เก็บ record/ประวัติเหมือนเดิม (ตามที่ `NotificationService.send()` ทำอยู่แล้ว) — FCM เป็นแค่ "ช่องทางส่ง" เพิ่มเติม ไม่ได้แทนที่ระบบเก็บ record ใน DB
- หน้า "การแจ้งเตือน" (in-app list) ยังคงอยู่เหมือนเดิม สำหรับดูประวัติย้อนหลัง — push แค่ทำให้เห็น**ทันที**แม้แอปปิดอยู่ ไม่ใช่แทนที่หน้านี้

## ต้องรอ A รีวิวเรื่องอะไรบ้างก่อนเริ่มทำจริง

- โครง `DeviceToken` ข้างบนตรงกับที่ A จะออกแบบไหม (field, index, ความสัมพันธ์กับ `User`)
- ใครเป็นเจ้าของงานนี้ (module `notification` เดิม A เป็นคน scaffold ไว้ — จะให้ A ทำต่อ หรือแบ่งงานกับ B/Mobile)
- Timeline: งานนี้จะเริ่มตอนไหน (ตามที่ B บอกไว้คือ "รอ backend เสร็จดีก่อน" ไม่ใช่ทำตอนนี้ทันที)
