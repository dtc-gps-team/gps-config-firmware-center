# 05 — Mobile Notification: Push จริงผ่าน Firebase Cloud Messaging (FCM)

> เสนอโดย: kittiphong (B) — 2026-09-02 · **อัปเดตสถานะ: 2026-10-08**
> สถานะ: **implement แล้ว (Android)** — ยัง **ไม่ได้ทดสอบจริงด้วย FCM** (ดู TODO ท้ายเอกสาร)

เอกสารนี้เดิมเป็นข้อเสนอ ("ยังไม่ได้เขียนโค้ดจริง") ตอนนี้ระบบ push ทำงานในโค้ดครบแล้ว
เนื้อหาด้านล่างสรุปสิ่งที่มีอยู่จริงและสิ่งที่ยังเหลือ

## สิ่งที่มีแล้ว

### Backend (`backend/src/notification/`)

- `DeviceToken` (Prisma) — 1 token ต่อแถว, `token` เป็น unique, ผูก `userId`
- `POST /api/v1/notifications/device-tokens` — upsert ตาม token, `userId` มาจาก JWT เสมอ
  (token เดิมที่เครื่องเดียวกัน login ด้วย user ใหม่จะย้ายเจ้าของให้)
- `DELETE /api/v1/notifications/device-tokens?token=...` — ลบได้เฉพาะ token ของตัวเอง
  (IDOR-safe, 404 ถ้าไม่ใช่ของตัวเอง)
- `FcmSender` 2 โหมดตาม `NOTIFICATION_MODE`:
  - `mock` (default) — แค่ log
  - `fcm` — `RealFcmSender` ใช้ `firebase-admin` + service account จาก `FCM_SERVICE_ACCOUNT_PATH`
    (fail fast ถ้าไม่พบไฟล์) และลบ token ที่ FCM ตอบว่าใช้ไม่ได้แล้ว
- ส่งเป็น **data-only** `{ type, payload }` (`payload` เป็น JSON string) ไม่มีบล็อก `notification`
  ฝั่ง mobile จึงเป็นคนสร้างข้อความเอง

### Mobile (`mobile/lib/features/push_notification/`)

- `PushNotificationService` — ขอ permission, register token กับ backend, ฟัง token refresh
  (เรียกจาก `AuthController` ตอน login / restore / logout)
  - ตอน logout: ลบ token กับ backend (best-effort) แล้ว `FirebaseMessaging.deleteToken()`
    ทำแยกกัน — ถึงลบกับ backend ไม่สำเร็จ (offline) token เดิมบนเครื่องก็ใช้ไม่ได้แล้ว
    เครื่องจะไม่รับ push ของ user คนก่อน และ login ครั้งถัดไปได้ token ใหม่
- `PushMessageHandler` — foreground (`onMessage`) / background + terminated
  (top-level `firebaseMessagingBackgroundHandler`) แสดงเป็น local notification
  และจัดการตอนกด (`onMessageOpenedApp`, `getInitialMessage`, local notification tap)
- **Deep link** (`resolvePushDeepLink`):
  - `task_assigned` + `taskId` → `/tasks/:id`
  - `incident_report_pending|resolved|dismissed|promoted` + `incidentId` → `/incidents/:id`
  - ที่เหลือ หรือ payload ไม่ครบ → หน้ารายการแจ้งเตือน
- **ข้อความ** (`resolvePushBody`): ใช้ `title` (incident ใหม่ ส่งให้ Operation) หรือ `reviewNote`
  (ผลการตัดสิน ส่งให้ผู้แจ้ง) จาก payload ถ้ามี ไม่มีใช้ "แตะเพื่อดูรายละเอียด"
- **กดตอนที่ยังไม่ login / กำลัง restore session** (เช่น เปิดแอปจาก terminated):
  path ถูกเก็บไว้ที่ `pendingPushRouteProvider` แล้วเปิดทันทีที่ authenticated
  (ไม่เช่นนั้น router จะ redirect ไป splash/login แล้วปลายทางหาย)
- `AppConfig.pushNotificationsEnabled` (`--dart-define=PUSH_NOTIFICATIONS_ENABLED`, default `true`)
  ปิดได้ — CI และ emulator ที่ไม่มี Google Play ปิดไว้

> Push เป็นคนละระบบกับ Offline-first Sync (badge "รอซิงค์") — ไม่มีโค้ดร่วมกัน

## ขอบเขตที่ตัดสินใจแล้ว

- **Android เท่านั้น** ในเฟสนี้ (ทีมตัดสินใจ) — iOS **ยังไม่มี** APNs key / `GoogleService-Info.plist`
  และ `_platform` ใน `PushNotificationService` ถูก hardcode เป็น `android`
- Web ยังไม่ใช้ FCM (ฝั่ง Web ใช้วิธี polling ทุก 20 วินาทีสำหรับการแจ้งเตือนแทน push)
- `google-services.json` **ไม่ commit** (อยู่ใน `.gitignore`) วางเองต่อเครื่องจาก Firebase Console
  ส่วน CI ใช้ไฟล์ placeholder (`.github/workflows/mobile-integration-test.yml`)

## TODO ที่เหลือ

- [ ] **ทดสอบจริงด้วย FCM** — ยังไม่เคยทำ ต้องมี (1) service account ฝั่ง backend
  (`NOTIFICATION_MODE=fcm` + `FCM_SERVICE_ACCOUNT_PATH`) และ (2) emulator ที่มี Google Play
  หรือเครื่องจริง ที่ต้องเช็ค:
  - [ ] ได้ token และ register กับ backend หลัง login (เช็คแถวใน `DeviceToken`)
  - [ ] รับ push ตอน foreground / background / terminated แล้วแสดง local notification
  - [ ] กด notification ของ `task_assigned` ไปหน้างาน และของ `incident_report_*` ไปหน้า incident
  - [ ] เปิดแอปจาก terminated ด้วยการกด notification ตอนยังไม่ login แล้ว login → ไปหน้าปลายทาง
  - [ ] Android 13+ ขอ permission `POST_NOTIFICATIONS` ได้จริง
  - [ ] logout แล้วเครื่องไม่รับ push ของ user เดิม · login user อื่นบนเครื่องเดียวกันได้ token ใหม่
- [ ] iOS (APNs key, `GoogleService-Info.plist`, entitlements, ทดสอบบน Mac)
- [ ] ชนิด notification อื่นที่ยังไปแค่หน้ารายการ (เช่น `config_override_*`, `firmware_override_*`,
  `config_approved`) — เพิ่ม deep link เมื่อมีหน้าปลายทางบน mobile
- [ ] id ของ local notification ตอนนี้ใช้เวลา (ไม่มี id จาก backend) — ถ้าต้องการ replace/ยกเลิกรายการเดิม
  ต้องให้ backend ส่ง id มาด้วย
