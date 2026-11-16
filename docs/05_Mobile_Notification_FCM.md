# 05 — Mobile Notification: Push จริงผ่าน Firebase Cloud Messaging (FCM)

> เสนอโดย: kittiphong (B) — 2026-09-02 · **อัปเดตสถานะ: 2026-11-16**
> สถานะ: **implement แล้วและทดสอบกับ FCM จริงแล้ว (Android)** — ผลทดสอบ:
> [`docs/testing/FCM_Push_Test_Report_2026-10-12.md`](testing/FCM_Push_Test_Report_2026-10-12.md) ·
> งานที่ยังเหลือดูหัวข้อ "งานที่ยังเหลือ" ท้ายเอกสาร

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
- **Deep link** (`resolvePushDeepLink`) ใช้กฎเดียวกับการแตะการ์ดในหน้ารายการแจ้งเตือน
  (`NotificationTypeStyle.route`) — แก้ที่เดียวมีผลทั้งสองทาง:
  - `task_assigned`, `config_apply_*` + `taskId` → `/tasks/:id`
  - `incident_report_pending|resolved|dismissed|promoted` + `incidentId` → `/incidents/:id`
  - `config_override_*`, `firmware_override_*` + `deviceId` → `/devices/:deviceId`
  - ที่เหลือ หรือ payload ไม่ครบ → หน้ารายการแจ้งเตือน
- **ข้อความ** (`resolvePushBody`): ใช้ `title` (incident ใหม่ ส่งให้ Operation) หรือ `reviewNote`
  (ผลการตัดสิน ส่งให้ผู้แจ้ง) จาก payload ถ้ามี ไม่มีใช้ "แตะเพื่อดูรายละเอียด"
- **กดตอนที่ยังไม่ login / กำลัง restore session** (เช่น เปิดแอปจาก terminated):
  path ถูกเก็บไว้ที่ `pendingPushRouteProvider` แล้วเปิดทันทีที่ authenticated
  (ไม่เช่นนั้น router จะ redirect ไป splash/login แล้วปลายทางหาย)
- `AppConfig.pushNotificationsEnabled` (`--dart-define=PUSH_NOTIFICATIONS_ENABLED`, default `true`)
  ปิดได้ — CI และ emulator ที่ไม่มี Google Play ปิดไว้

### type ที่ส่ง push จริง (`FCM_ENABLED_NOTIFICATION_TYPES` ใน `notification.service.ts`)

| กลุ่ม | type | ผู้รับ |
|---|---|---|
| งาน | `task_assigned` | ช่างที่ได้รับมอบหมาย |
| Incident | `incident_report_pending` / `resolved` / `dismissed` / `promoted` | Operation / ผู้แจ้ง |
| คำขอส่งเข้ากล่อง | `config_apply_approved` / `rejected` / `succeeded` / `failed` / `expired` / `retrying` | ช่างที่ถืองาน |
| คำขอแก้ค่าเฉพาะเครื่อง | `config_override_approved` / `rejected`, `firmware_override_approved` / `rejected` | ช่างผู้ขอ |

type อื่นยังบันทึกลงตาราง `Notification` ตามปกติ (เห็นในหน้ารายการแจ้งเตือน) แค่ไม่ยิง push —
`*_pending` ที่ไปหา Operation ไม่ส่ง เพราะ Operation ตัดสินบน Web · Config Override ที่ผูกคำขอส่ง
เข้ากล่อง (docs/30 โหมด central) แจ้งผลผ่าน `config_apply_*` ไม่ได้ push ซ้ำ

> Push เป็นคนละระบบกับ Offline-first Sync (badge "รอซิงค์") — ไม่มีโค้ดร่วมกัน

## ขอบเขตที่ตัดสินใจแล้ว

- **Android เท่านั้น** ในเฟสนี้ (ทีมตัดสินใจ) — iOS **ยังไม่มี** APNs key / `GoogleService-Info.plist`
  และ `_platform` ใน `PushNotificationService` ถูก hardcode เป็น `android`
- Web ยังไม่ใช้ FCM (ฝั่ง Web ใช้วิธี polling ทุก 20 วินาทีสำหรับการแจ้งเตือนแทน push)
- `google-services.json` **ไม่ commit** (อยู่ใน `.gitignore`) วางเองต่อเครื่องจาก Firebase Console
  ส่วน CI ใช้ไฟล์ placeholder (`.github/workflows/mobile-integration-test.yml`)

## งานที่ยังเหลือ

ทดสอบกับ FCM จริงแล้ว (Firebase project dev, 12 ต.ค. 2569 — ผ่านทุกข้อ: รับ push ตอน foreground/background,
กดเปิดจาก terminated, logout แล้วไม่รับ push ของ user เดิม · ดูรายงานผลทดสอบ) ที่ยังไม่ได้ทำ:

- [ ] **iOS** — APNs key, `GoogleService-Info.plist`, entitlements และทดสอบบน Mac (`_platform` ใน
  `PushNotificationService` ยัง hardcode เป็น `android`)
- [ ] **Firebase project production** — ตอนนี้ทดสอบกับ project dev เท่านั้น deploy จริงต้องตั้ง
  `FCM_SERVICE_ACCOUNT_PATH` ชี้ไฟล์ของ production และ `FCM_ALLOW_NON_DEV_PROJECT=true` (ดู CLAUDE.md)
  และ build แอป flavor `prod` ด้วย `google-services.json` ของ production
- [ ] กรณีที่ยังไม่ได้ทดสอบ: กด push ตอนยังไม่ login จริง, logout ตอนเครื่องออฟไลน์, ปิดแอปด้วยการปัดทิ้งจาก recents
- [ ] id ของ local notification ตอนนี้ใช้เวลา (backend ไม่ส่ง id มา) — ถ้าต้องการแทนที่/ยกเลิกรายการเดิม
  ต้องให้ backend ส่ง id มาด้วย
