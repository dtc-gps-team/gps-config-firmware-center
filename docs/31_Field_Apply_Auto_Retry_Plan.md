# แผนให้ระบบลองส่งเข้ากล่องใหม่เองเมื่อส่งไม่สำเร็จ (ส่งจากหน้างาน · โหมด central)

> **สถานะ:** R1–R3 และ C1–C3 merge ครบแล้ว · **สรุปพฤติกรรมจริงและงานเว็บที่ยังขาดอยู่ที่ §7** (9 พ.ย. 2569)
>
> **เดิม:** แผน — B ตัดสินมติ §2 แล้ว (4 พ.ย. 2569) · A รีวิวรอบ 1 (4 พ.ย.) และรอบ 2 (5 พ.ย. 2569) แก้ตามรีวิวใน
> §3.1, §3.3, §3.4, §3.6, §4, §5 · แตะโมดูล `campaign` (`CentralRolloutPollService`, `CampaignRolloutService`) และ schema ที่ใช้ร่วมกัน
>
> **#432 merge แล้ว (5 พ.ย. 2569, `d10a38a`):** ส่วน Override ใช้ครั้งเดียวของ Config (§3.4) อิง
> `DeviceConfigOverride.consumedAt` ที่มากับ #432 · R1 เริ่มได้
>
> **ต่อจาก:** docs/25 (คำขอส่ง Config จากหน้างาน), docs/27 (อนุมัติแล้วช่างกดส่งเอง + Firmware) · ไม่แก้มติเดิมของสองฉบับนั้น
>
> **ที่มาของข้อมูล:** `main` ที่ `d10a38a` + ผลส่ง Firmware เข้า BOX-0001 จริง 2–4 พ.ย. 2569 (§1.1)

---

## 1. ปัญหา

### 1.1 สิ่งที่เจอ
1. **ส่งไม่สำเร็จครั้งเดียวก็จบเลย** — `CentralRolloutPollService` ได้ผล `failed` จาก Server กลางแล้วเรียก
   `recordTargetResult(false)` ทันที → คำขอเป็น `failed` → แจ้ง `config_apply_failed` → เปิด Incident ช่างต้องเริ่มขอใหม่
   ตั้งแต่ต้น และ **Operation ต้องอนุมัติใหม่อีกรอบ** ทั้งที่ของที่ส่งไม่ได้ผิด
2. **สาเหตุส่วนใหญ่เป็นเรื่องชั่วคราว** — กล่องหลุด Wi-Fi (`DEVICE_DISCONNECTED`), ไม่ตอบ (`DEVICE_NO_RESPONSE`),
   ดาวน์โหลดค้าง (`DOWNLOAD_TIMEOUT`), ออฟไลน์ (`DEVICE_OFFLINE` / `TTL_EXPIRED`) ส่งใหม่อีกครั้งมักผ่าน
3. **Firmware rollback เกิดแบบสุ่ม** — 1.1.0 → BOX-0001 rollback 3/3 ครั้งเมื่อ 3 พ.ย. แต่ผ่านเมื่อ 4 พ.ย. (crash
   `pbuf_free` ระหว่าง trial boot) ลองใหม่จึงมีโอกาสผ่าน

**ตรวจแล้ว:** Server กลาง (ws-gateway) ไม่ลองส่งคำสั่งซ้ำเอง (retry ที่มีอยู่เป็นแค่การเขียนไฟล์ store) จึงไม่ซ้อนกัน 2 ชั้น

### 1.2 เป้าหมาย
- ช่างกดส่งครั้งเดียว ถ้าล้มด้วยสาเหตุที่ลองใหม่ได้ **ระบบส่งซ้ำเองอัตโนมัติ** ไม่ต้องกดอะไรและไม่ต้องอนุมัติใหม่
- **ทุกรอบที่ล้มแจ้งช่าง** ว่ารอบไหน ล้มเพราะอะไร กำลังลองรอบที่เท่าไร
- จบแล้ว (สำเร็จก่อน หรือครบรอบ) แจ้งผลพร้อมสรุปทุกรอบ และ **เก็บประวัติทุกรอบ** ไว้ดูย้อนหลัง

### 1.3 ไม่ใช่เป้าหมาย
- Campaign ปกติหลายเครื่อง — มี Auto Pause ของตัวเองอยู่แล้ว ทำทีหลังได้ถ้าต้องการ → **ร่างส่วนต่อขยายอยู่ที่ §6**
- โหมด mock / real — มีแค่โหมด central ที่มีผลจากกล่องจริงให้ตัดสิน
- ให้ช่างกด "ส่งใหม่" เอง — ยังทำได้ตามเดิมหลังล้มครบ (ขอใหม่ตาม docs/27)

---

## 2. มติ (B ตัดสิน 4 พ.ย. 2569)

| ข้อ | คำถาม | มติ |
|---|---|---|
| Q1 | ส่งได้กี่ครั้ง | **รวม 3 ครั้ง** — ครั้งแรก 1 + ลองซ้ำ 2 |
| Q2 | Firmware `ROLLED_BACK` ลองใหม่ไหม | **ลองใหม่** ไม่ผ่านครบ 3 ครั้งค่อยแจ้งล้มเหลว |
| Q3 | แจ้งเตือนเมื่อไร | **ทุกรอบที่ล้ม** + ตอนจบ |
| Q4 | ขอบเขต | **เฉพาะส่งจากหน้างาน** (Rollout เครื่องเดียวใต้ Campaign ระบบของ docs/25) |
| Q5 | ใครสั่งลองใหม่ | **ระบบทำเองอัตโนมัติ** ช่างไม่ต้องกด · จบแล้วแจ้งผู้ใช้และบันทึก log |

---

## 3. การออกแบบ

### 3.1 ผลแบบไหนลองใหม่

| ผลจาก Server กลาง / ตอนส่ง | วันนี้ | หลังแผนนี้ |
|---|---|---|
| `DEVICE_DISCONNECTED`, `DEVICE_NO_RESPONSE`, `DOWNLOAD_TIMEOUT` | failed | **ลองใหม่** |
| `ROLLED_BACK`, `NEW_FIRMWARE_FAILED_HEALTH_CHECK` | failed | **ลองใหม่** (มติ Q2) |
| `DEVICE_OFFLINE`, `TTL_EXPIRED` | skipped_offline | **ลองใหม่** |
| ติดต่อ Server กลางไม่ได้ตอนส่ง (`unavailable`) | failed | **ลองใหม่** |
| รหัส failed อื่นที่ไม่รู้จัก | failed | **ลองใหม่** (ไม่รู้ = ให้โอกาส · ครบ 3 ครั้งก็จบเหมือนกัน) |
| Server กลางปฏิเสธคำสั่ง (`rejected`: ไม่รู้จักกล่อง, ไม่ผ่าน schema) | failed | **ไม่ลอง** — ส่งซ้ำก็ผิดซ้ำ |
| `SUPERSEDED`, `CANCELLED` | skipped_offline | **ไม่ลอง** — มีคนสั่งทับหรือยกเลิก |
| กล่องรายงานว่ารับของชุดนี้ไม่ได้เลย (R1.1): `SCHEMA_NOT_SUPPORTED`, `SETTINGS_MISSING`, `HARDWARE_MISMATCH`, `VERSION_MISMATCH`, `UNSIGNED_FIRMWARE`, `SIGNATURE_INVALID`, `NO_OTA_PARTITION`, `SIZE_NOT_SUPPORTED`, `DOWNLOAD_URL_INVALID`, `UNSUPPORTED_ACTION` และรหัสที่ขึ้นต้น `UNSUPPORTED_PARAMETER:` / `INVALID_VALUE:` / `INVALID_GROUP:` | failed | **ไม่ลอง** — ส่งซ้ำก็ผิดซ้ำ (§6.3 ข้อ 4) |

**จุดที่แก้ (ไม่เปลี่ยนความหมายของโค้ดเดิม):**
- **ไม่แก้ `classifyCentralCommand()`** — ยังคืน `skipped` สำหรับ `DEVICE_OFFLINE` / `TTL_EXPIRED` / `SUPERSEDED` /
  `CANCELLED` และ `failed` สำหรับที่เหลือเหมือนเดิม เพราะ Campaign ปกติใช้อยู่
- ฟังก์ชันใหม่ `isRetryableCentralOutcome(command)` อยู่ที่ `central-config.ts` คู่กัน เขียนเป็น **denylist ของ "ไม่ลอง"**
  (`rejected` ตอนส่ง, `SUPERSEDED`, `CANCELLED`) · นอกนั้นลองใหม่ทั้งหมด รหัสใหม่ที่ gateway เพิ่มในอนาคตจึงได้ลองใหม่
  โดยไม่ต้องแก้โค้ด · มี test ครบทุกแถวของตารางนี้ + รหัสที่ไม่รู้จัก
- มี **2 จุดดัก** เพราะผลล้มมาได้ 2 ทาง:
  - **ทางที่ 1 — ผลจบจาก poll:** ดักใน `CentralRolloutPollService` **ก่อน**ถึง `markTargetSkippedOffline()` /
    `recordTargetResult(false)`
  - **ทางที่ 2 — ส่งไม่ถึง Server กลาง (`unavailable` / throw):** target ยังไม่มี `centralCommandId` จึงไม่เคยเข้า poll ·
    ดักใน `pushToCentral()` / `pushFirmwareToCentral()` ของ `CampaignRolloutService` ตรงที่วันนี้เรียก
    `recordTargetResult(false)` เมื่อ `outcome.kind !== 'sent'` และใน try/catch รอบลูป auto-apply ที่นับ throw เป็น failed
    (เฉพาะช่วงส่งให้ Server กลาง) · ทั้งรอบแรก (ตอน release) และรอบลองใหม่ผ่านสองฟังก์ชันนี้เหมือนกัน จึงครอบทุกรอบ
  - ทั้งสองทางเรียก helper เดียวกัน `scheduleFieldApplyRetryOrFinish()`: ถ้าเป็น Rollout ส่งจากหน้างาน + ลองใหม่ได้ +
    `attemptCount < MAX` → ตั้งรอบใหม่ (§3.4) · ไม่เข้าเงื่อนไข → เรียก `markTargetSkippedOffline()` /
    `recordTargetResult()` เดิมตรงๆ · ส่วน `rejected` (Server กลางปฏิเสธ) ไม่ลองใหม่ทั้งสองทาง
- **ครบ 3 รอบแล้วรอบสุดท้ายเป็น `DEVICE_OFFLINE` / `TTL_EXPIRED`** → จบเป็น `skipped_offline` เหมือนวันนี้ ไม่นับเป็น
  failure ไม่ Auto Pause ไม่เปิด Incident · ฝั่งผู้ขอได้ `config_apply_failed` เหมือนเดิม (`config-apply-request.service.ts`
  แจ้งแบบนี้อยู่แล้ว) แค่ payload มี `attempts[]` เพิ่ม · รอบสุดท้ายที่เป็น failed จบเป็น failed + Incident ตามเดิม

### 3.2 จังหวะการลอง
- รวมสูงสุด **3 ครั้ง** · รอก่อนส่งรอบใหม่ **20 วินาทีเท่ากันทุกรอบ** (**แก้ 10 พ.ย. 2569 โดย B** เดิม 30 → 60 วินาที ดู §8)
- ส่งรอบใหม่เกิดใน poll รอบแรกที่ `nextRetryAt <= now` · poll รันทุก 4 วินาที (`POLL_INTERVAL_MS = 4000` ใน
  `central-rollout-poll.job.ts`) เวลารอจริงจึงเป็น **20–24 วินาที** ทุกรอบ · เวลารอรวมไม่เกินราว
  **50 วินาที** บวกเวลาที่คำสั่งแต่ละรอบใช้จนจบ
- env: `FIELD_APPLY_MAX_ATTEMPTS=3`, `FIELD_APPLY_RETRY_DELAY_SEC=20` (เท่ากันทุกรอบ) · ค่าเริ่มต้นตามนี้
- ส่ง**ของเดิมทุกรอบ** — Config ตัวเดิม + Override ที่ merge ไว้ (`mergeApprovedOverride()`) หรือ Firmware ตัวเดิม +
  `allowDowngrade` เดิม · ไม่สร้าง Rollout ใหม่ ไม่เปลี่ยน `ConfigApplyRequest`

### 3.3 ข้อมูล (migration แบบ additive)

```prisma
/// ประวัติการส่งแต่ละครั้งของ target (docs/31) — แถวแรกสร้างตอนส่งครั้งแรก
model CampaignRolloutTargetAttempt {
  id               String    @id @default(uuid())
  targetId         String
  attemptNo        Int       // 1, 2, 3
  centralCommandId String?   // null = ส่งไม่ถึง Server กลาง
  status           String    // sent | succeeded | failed | skipped
  errorCode        String?   // DEVICE_DISCONNECTED, ROLLED_BACK, ...
  detail           String?   // ข้อความอ่านง่าย (describeCentralFailure)
  startedAt        DateTime  @default(now())
  finishedAt       DateTime?
  target CampaignRolloutTarget @relation(fields: [targetId], references: [id], onDelete: Cascade)
  @@unique([targetId, attemptNo])
}
```
- `CampaignRolloutTarget` เพิ่ม
  - `attemptCount Int @default(1)` — target เดิมถือว่าส่งไปแล้ว 1 ครั้ง
  - `nextRetryAt DateTime?` — null = ไม่ได้รอรอบใหม่ · เพิ่ม `@@index([nextRetryAt])` (ตามรีวิว A) ให้ query รอบใหม่ไม่ scan ทั้งตาราง
  - `appliedConfigOverrideId String?` — แถว `DeviceConfigOverride` ที่ merge ไปในรอบแรก (§3.4) · relation แบบ nullable
    `onDelete: Restrict` เหมือน FK อื่นของ Override · null = รอบแรกไม่มี Override หรือเป็น Firmware
- `NotificationType` (enum DB) เพิ่มค่า `config_apply_retrying`
- FK ใหม่มีแค่ `appliedConfigOverrideId` และ `CampaignRolloutTargetAttempt.targetId` ซึ่งเป็นคอลัมน์/ตารางใหม่ (ค่าเริ่มเป็น
  null / ยังไม่มีแถว) → ไม่มีความเสี่ยง orphan บนข้อมูลเดิม

### 3.4 การทำงาน (backend)

```
poll ได้ผลจบของ target (field apply เท่านั้น — rollout.campaign.name === FIELD_APPLY_SYSTEM_CAMPAIGN_NAME)
 ├─ success → ปิด attempt ล่าสุด succeeded → recordTargetResult(true) ตามเดิม
 ├─ ล้ม + ลองใหม่ได้ + attemptCount < MAX
 │     → ปิด attempt ล่าสุด failed (errorCode, detail)
 │     → target: centralCommandId = null, nextRetryAt = now + delay (ยัง pending)
 │     → emit FIELD_APPLY_RETRY_EVENT { rolloutId, attemptNo, maxAttempts, detail, nextRetryAt }
 └─ ล้ม + (ลองไม่ได้ หรือครบ MAX)
       → ปิด attempt ล่าสุด → markTargetSkippedOffline() หรือ recordTargetResult(false, สรุปทุกรอบ) ตามผล
         classifyCentralCommand() เดิม (Incident เปิดครั้งเดียวตรงนี้ เฉพาะ failed)

pushToCentral / pushFirmwareToCentral ได้ผลไม่ใช่ sent (unavailable / rejected) หรือ throw ช่วงส่ง
 └─ helper เดียวกับข้างบน: unavailable/throw + attemptCount < MAX → ตั้งรอบใหม่ · นอกนั้น recordTargetResult(false) เดิม

poll รอบเดียวกัน (query แยกจาก query เดิมที่หยิบ centralCommandId ไม่ null):
  where status = pending AND centralCommandId IS NULL AND nextRetryAt IS NOT NULL AND nextRetryAt <= now
        AND rollout.campaign.name = FIELD_APPLY_SYSTEM_CAMPAIGN_NAME
   ├─ attemptCount < MAX
   │    → claim แบบ lease: updateMany where { id, attemptCount: เดิม, nextRetryAt: เดิม }
   │      set { attemptCount: เดิม + 1, nextRetryAt: now + LEASE } · count = 0 → poll อื่นหยิบไปแล้ว ข้าม
   │    → pushToCentral / pushFirmwareToCentral เดิม → สร้าง attempt ใหม่
   │      · sent → บันทึก centralCommandId + nextRetryAt = null ใน update เดียวกัน (ปลด lease)
   │      · ไม่ sent / throw → helper ตั้ง nextRetryAt รอบถัดไป หรือจบ (ปลด lease เช่นกัน)
   └─ attemptCount >= MAX (lease ของรอบสุดท้ายหมดโดยไม่มีผล = process ตายกลางทาง)
        → claim แบบเดียวกัน → ปิด attempt ค้างเป็น failed "ส่งไม่ถึง Server กลาง (ค้างหลังเริ่มส่ง)"
        → recordTargetResult(false, สรุปทุกรอบ)
```
- **lease กันค้างหลัง claim (รีวิว A รอบ 2):** claim ไม่ตั้ง `nextRetryAt = null` แต่ตั้งเป็น `now + LEASE`
  (`FIELD_APPLY_CLAIM_LEASE_SEC`, ค่าเริ่ม **60 วินาที** — ต้องมากกว่าเวลาส่งหนึ่งครั้ง: `CENTRAL_TIMEOUT_MS` ค่าเริ่ม
  5 วินาทีต่อคำขอ) · ถ้า process ตาย/throw หลุดหลัง claim แต่ก่อนบันทึก `centralCommandId` → พอ lease หมด query รอบใหม่
  หยิบ target นั้นอีกครั้งเอง ไม่ค้างถาวร · รอบที่ค้างนับเป็น 1 ครั้ง (ปิด attempt เป็น failed) แล้วลองต่อถ้ายังไม่ครบ
  ถ้าครบแล้วจบเป็น failed · claim ใช้ `nextRetryAt: เดิม` ใน where จึงไม่มีสอง poll หยิบ lease เดียวกัน
- **ข้อจำกัดที่รู้:** ถ้า process ตาย**หลัง** Server กลางรับคำสั่งแต่**ก่อน**บันทึก `centralCommandId` พอ lease หมดจะส่งซ้ำ
  1 ครั้ง (กล่องได้ของเดิมซ้ำ ไม่ผิดค่า แต่เสียรอบ) · ยอมรับได้เพราะเป็นของเดิมทุกรอบ (§3.2)
- poll service เพิ่ม `campaign: { select: { name: true } }` ใต้ `rollout` ใน include เพื่อเช็คชื่อ Campaign ระบบ (แบบเดียวกับที่
  `campaign-rollout.service.ts` ใช้ `FIELD_APPLY_SYSTEM_CAMPAIGN_NAME` อยู่)
- target เดิมทั้งหมดมี `nextRetryAt = null` จึงไม่มีทางถูกหยิบไปลองใหม่ (เงื่อนไข `IS NOT NULL` เขียนไว้ชัด ไม่พึ่งแค่ `<= now`)
- **Override ใช้ครั้งเดียว (#432)** — #432 เพิ่ม `consumedAt` ที่ `DeviceConfigOverride` (แบบเดียวกับ
  `DeviceFirmwareOverride.consumedAt` ที่มีบน main) และ mark เมื่อส่งสำเร็จ · รอบแรก merge ตามกติกาของ #432 แล้วเก็บ
  id ของแถวที่ merge ไว้ที่ `appliedConfigOverrideId` · **รอบลองใหม่ merge จาก id นี้เท่านั้น** ไม่ query หาแถว approved
  ล่าสุดใหม่ และไม่สน `consumedAt` ของแถวนั้น → Override ใหม่ที่ถูกอนุมัติระหว่างรอรอบใหม่ไม่ถูกดึงเข้า Rollout นี้
  แต่ไปใช้กับการส่งครั้งถัดไปตามปกติ · Firmware ไม่เกี่ยว (ส่ง `allowDowngrade` เดิม)
- **คำขอหมดอายุ 24 ชม.** — นับถึงตอนกดส่ง คำขอที่ปล่อยแล้วลองต่อจนจบแม้เลยเวลา (รอรวมไม่เกินราว 1 นาที 40 วินาที
  + เวลาคำสั่ง ตาม §3.2)
- **ไม่เปลี่ยนความหมายของ `recordTargetResult()` / `markTargetSkippedOffline()`** — Campaign ปกติเรียกแบบเดิมทุกกรณี
- **AuditLog** — ทุกรอบที่ส่งใหม่ลง action เดิมของแต่ละทาง (`apply-config` / `confirm-firmware-install` ตามที่
  `pushToCentral()` / `pushFirmwareToCentral()` เขียนอยู่) พร้อม `attemptNo` (การนำค่าไปใช้เกิดทุกรอบ)

### 3.5 การแจ้งเตือน (โมดูล config-apply-request / notification ของ B)

| เมื่อ | type | ข้อความบนการ์ด (หัวข้อสั้นตามหน้ารายการ) |
|---|---|---|
| ล้มและจะลองใหม่ | `config_apply_retrying` (ใหม่) | "ส่ง Firmware รอบ 1/3 ไม่สำเร็จ" · รายละเอียด: สาเหตุ + "กำลังลองใหม่ รอบ 2/3" |
| สำเร็จหลังลองใหม่ | `config_apply_succeeded` (เดิม) | payload เพิ่ม `attemptNo` → "ส่งสำเร็จในรอบที่ 2/3" |
| ล้มครบ / ลองไม่ได้ | `config_apply_failed` (เดิม) | payload เพิ่ม `attempts[]` → สรุปสาเหตุทุกรอบ |

ส่งให้ช่างผู้ขอ (`requestedBy`) เหมือน type เดิมของ docs/25 §3.6 · push FCM ตามเดิม

### 3.6 API

`GET /tasks/{taskId}/config-apply-requests/{id}/progress` (มีอยู่แล้ว) เพิ่มใน `central`:
- `attemptNo`, `maxAttempts`, `nextRetryAt` (null เมื่อไม่ได้รอรอบใหม่)
- `attempts[]`: `{ attemptNo, status, errorCode, detail, startedAt, finishedAt }`

`ConfigApplyRequest.resultDetail` ตอนจบเขียนสรุปทุกรอบ (Web แสดงได้ทันทีโดยไม่ต้องแก้)
- **IDOR:** endpoint นี้ยังกรองตามผู้ขอ / Task เหมือนเดิม (`requestedBy` + `taskId`) · `attempts[]` อ่านผ่าน target ของ
  Rollout ของคำขอนั้นเท่านั้น ไม่รับ id ของ target/attempt จาก client
- อัปเดต `openapi.yaml` + `RBAC_Matrix` คู่กันใน R2 (สิทธิ์ไม่เปลี่ยน แค่ field ใหม่)

### 3.7 Mobile
- หน้าความคืบหน้าการส่ง: ป้าย **"รอบ 2/3"** · ช่วงรอรอบใหม่แสดง "จะลองใหม่ในอีก 0:45" · แอนิเมชันเริ่มรอบใหม่
- ใต้ภาพ: **ประวัติการส่ง** แต่ละรอบ เวลา + สาเหตุที่ล้ม
- หน้าแจ้งเตือน: รู้จัก `configApplyRetrying` (หมวด "ส่งเข้ากล่อง", โทน action สีเหลือง, แตะไปหน้างาน)

> **ตอนทำจริง (R2 #442, R3):** หน้าแจ้งเตือนทำใน R2 แล้ว ใช้โทน **`info`** ไม่ใช่ action — โทน action ขึ้นป้าย
> "ต้องดำเนินการ" แต่ช่างไม่ต้องทำอะไร ระบบลองเอง · ป้ายรอบแสดงเฉพาะตั้งแต่รอบที่ 2 (ช่วงรอ = เลขรอบที่กำลังจะส่ง)
> และเด้งเข้ามาเมื่อเลขรอบเปลี่ยน · ประวัติการส่งแสดงเมื่อมีมากกว่า 1 รอบหรือรอบเดียวที่ไม่สำเร็จ · ล้มครบ = การ์ดผล
> "ส่ง N ครั้งไม่สำเร็จ" + สาเหตุรอบสุดท้าย และยังมีปุ่มส่งใหม่เอง

---

## 4. แบ่งงาน

| PR | เจ้าของ | เนื้อหา |
|---|---|---|
| R1 | B (A ตกลง 4 พ.ย. 2569 · A รีวิว) | migration §3.3 · retry ใน `CentralRolloutPollService` + re-push ใน `CampaignRolloutService` · `FIELD_APPLY_RETRY_EVENT` · unit + integration · 2 จุดดัก + lease (§3.1, §3.4) |
| R2 | B | รับ event → แจ้งเตือน `config_apply_retrying` + payload ใหม่ของ succeeded/failed · progress API `attempts[]` · openapi/RBAC |
| R3 | B | Mobile: หน้าความคืบหน้า + หน้าแจ้งเตือน |

ข้อตกลง R1 (จากรีวิว A): `git pull origin main` ก่อนแตะ `schema.prisma` · ไม่เปลี่ยนความหมายของ `recordTargetResult()` /
`markTargetSkippedOffline()` · A ดูเป็นพิเศษที่การ claim กันส่งซ้ำและ query ของ poll

## 5. ทดสอบ
- unit: ตาราง §3.1 ครบทุกแถว + รหัสที่ไม่รู้จัก (denylist) · ครบ 3 ครั้งแล้วจบ · claim กันส่งซ้ำเมื่อ poll ซ้อน
  · Override ตัวเดิมทุกรอบ แม้มี Override ใหม่ถูกอนุมัติระหว่างรอ
- unit: target ที่ `centralCommandId = null` + `nextRetryAt = null` (ข้อมูลเดิม) ไม่ถูกหยิบไปลองใหม่ · Campaign ปกติ (ไม่ใช่
  Campaign ระบบ) ที่ล้มยังเรียก `recordTargetResult()` / `markTargetSkippedOffline()` แบบเดิมทันที
- unit: ครบ 3 รอบแล้วรอบสุดท้ายเป็น `DEVICE_OFFLINE` → `skipped_offline` ไม่ Auto Pause ไม่เปิด Incident
- unit (ทางที่ 2): `pushToCentral()` / `pushFirmwareToCentral()` ได้ `unavailable` หรือ throw → ตั้ง `nextRetryAt` ไม่เรียก
  `recordTargetResult(false)` · ครบ 3 รอบแล้วยัง `unavailable` → failed · `rejected` → failed ทันที · Campaign ปกติ →
  `recordTargetResult(false)` ทันทีเหมือนเดิม
- unit (lease): claim แล้วไม่บันทึกผล (จำลอง process ตาย) → lease หมด → ถูกหยิบใหม่และนับรอบ · lease ของรอบสุดท้ายหมด →
  failed · สอง poll แย่ง lease เดียวกัน → ส่งครั้งเดียว
- integration: ล้ม → retrying 2 ครั้ง → failed 1 ครั้ง (Incident 1 อัน) · ล้ม 1 ครั้งแล้วสำเร็จ
- กล่องจริง BOX-0001: ส่ง Config แล้วปิด Wi-Fi ของกล่อง ~1 นาที (`DEVICE_DISCONNECTED`) → เปิดกลับ → ต้องสำเร็จในรอบ 2

---

## 6. ส่วนต่อขยาย: ลองส่งใหม่ให้ Campaign ปกติ (B รีวิวผ่านแล้วใน #449 · **C1 backend ทำแล้ว** · **C2 API รายเครื่องทำแล้ว** · **C3 เว็บทำแล้ว**)

> **สถานะ:** ร่างโดย A (5 พ.ย. 2569) · ขยายสิ่งที่ §1.3 เลื่อนไว้ ("Campaign ปกติหลายเครื่อง ... ทำทีหลังได้ถ้าต้องการ")
> ไม่แก้มติ Q1–Q5 ของ §2 เพราะทุกข้อยังใช้เหมือนเดิม (Q4 ขอบเขตเดิม "เฉพาะส่งจากหน้างาน" เป็นขอบเขตของ R1–R3 ซึ่งเสร็จแล้ว)
> · ส่วนนี้เพิ่มขอบเขตใหม่ ไม่ย้อนแก้ของเดิม · **เจ้าของงาน: A** (โมดูล `campaign`) · B ตรวจแผนและ PR
>
> **ที่มา:** Operation ปล่อย Rollout หลายเครื่องจากเว็บ แล้วเครื่องหนึ่งหลุด Wi-Fi หรือ Firmware rollback ตอนนี้ถูกนับเป็นล้มทันที
> ดัน Auto Pause เข้าใกล้เกณฑ์หยุด ทั้งที่สาเหตุแบบเดียวกันกับ §1.1 และส่งซ้ำมักผ่าน

### 6.1 มติ (A ตัดสิน 5 พ.ย. 2569)

| ข้อ | คำถาม | มติ |
|---|---|---|
| C1 | นับเครื่องเข้า Auto Pause / Incident เมื่อไร | **เมื่อส่งครบ 3 ครั้งแล้วยังล้ม** เท่านั้น ระหว่างรอรอบใหม่ไม่นับ |
| C2 | Rollout จบเมื่อไร | **ยังไม่จบ** ตราบที่ยังมีเครื่องรอลองใหม่ |
| C3 | Operation Pause / Cancel ระหว่างรอรอบใหม่ | **หยุดส่งรอบใหม่** (รายละเอียด §6.3) |
| C4 | แจ้งเตือน Operation | **แจ้งรวมครั้งเดียวตอน Rollout จบ** ไม่แจ้งทุกรอบ · Incident ยัง 1 รายการต่อ Rollout |
| C5 | เปิดเสมอหรือเลือกได้ | **เลือกได้ต่อ Campaign** ค่าเริ่มต้นเปิด · เหตุผล: Operation บางคนไม่อยากให้ระบบส่งซ้ำเองเพื่อกันความเสียหาย · งานส่งจากหน้างานของช่างยังเปิดเสมอ ไม่ผูกกับสวิตช์นี้ · **Campaign ใหม่เปิดเป็นค่าเริ่มต้น แต่ Campaign ที่มีอยู่ก่อน deploy เป็น `false`** (รีวิว B ข้อ 2 · A รับ — ดู §6.3 ข้อมูล) |

จำนวนครั้ง (3), เวลารอ (30 วินาที แล้ว 60 วินาที), ตารางสาเหตุที่ลอง/ไม่ลอง (§3.1), ตารางประวัติรายรอบ (§3.3),
lease (§3.4) และ AuditLog **ใช้ของ R1 ตัวเดิมทั้งหมด** ไม่เขียนใหม่

### 6.2 สิ่งที่อ่านจากโค้ดจริงแล้ว (main ที่ `f1087ab` หลัง #446)

1. **Auto Pause และการจบ Rollout ทำงานถูกต้องกับ retry อยู่แล้ว** (`recordTargetResult()` ใน `campaign-rollout.service.ts`):
   `shouldAutoPause` ต้องมี `pendingCount > 0` และนับเฉพาะ target ที่ `status = failed` · ตัวที่รอลองใหม่ยังเป็น `pending`
   (R1 ตั้งแค่ `centralCommandId = null` + `nextRetryAt`) จึง **ไม่นับเป็นล้ม (C1) และ Rollout ไม่จบ (C2)** โดยไม่ต้องแก้ตรรกะนี้
2. **เส้นทางส่งใช้ร่วมกันอยู่แล้ว:** `autoApplyConfig()` / `autoApplyFirmware()` / `pushToCentral()` รับ `retryTargetId` และ
   กรอง `nextRetryAt: null` ให้ `approve()` / `resume()` ไม่หยิบตัวที่รอรอบใหม่ไปส่งก่อนเวลา (ทำไว้ใน R1 ครอบคลุม Campaign ปกติด้วย)
3. **ตัวกั้นเดียวที่ทำให้ Campaign ปกติไม่ลองใหม่คือการเช็คชื่อ Campaign ระบบ** ซึ่งอยู่ 3 จุด:
   `CampaignRolloutService.fieldApplyRetryFor()` · `FieldApplyRetryService.claimDueRetries()` (`campaign: { name: ... }`) ·
   `CentralRolloutPollService.poll()` (ตัวแปร `retry`) · ต่อยอดโดยแทนเงื่อนไขนี้ด้วยเงื่อนไขเดียว (§6.3)
4. **โหมด `real`/`mock` ไม่เกี่ยว:** retry ใช้เฉพาะ `applyMode = central` (ส่งคำสั่งให้ Server กลาง) เหมือน R1 · `RolloutTimeoutService`
   (เฉพาะ `real`) ไม่แตะ target ที่รอรอบใหม่
5. **Cancel (ผ่าน rollback)** ทำ target ที่ยัง `pending` เป็น `failed` ("rollout cancelled by rollback") อยู่แล้ว · target ที่รอรอบใหม่
   เปลี่ยนสถานะแล้วจึงไม่ถูก `claimDueRetries()` หยิบอีก (query ต้อง `status = pending`) จึงครอบ C3 ฝั่ง Cancel โดยไม่ต้องแก้

### 6.3 การออกแบบ

**เงื่อนไขเปิด retry (จุดแก้เดียว)** ฟังก์ชันใหม่ `isAutoRetryEnabled(rollout)`:
`applyMode = central` และ (เป็น Campaign ระบบส่งจากหน้างาน **หรือ** `Campaign.autoRetry = true`) · ใช้แทนการเช็คชื่อ Campaign ทั้ง 3 จุดใน §6.2 ข้อ 3
โดยดึง `campaign: { select: { name, autoRetry } }` มาพร้อมกัน

**ข้อมูล (migration แบบ additive):**
```prisma
model Campaign {
  /// ลองส่งใหม่อัตโนมัติเมื่อส่งเข้ากล่องไม่สำเร็จ (docs/31 §6) · ค่าเริ่มต้นเปิด ·
  /// Campaign ระบบของคำขอจากหน้างานไม่ใช้ค่านี้ (เปิดเสมอ)
  autoRetry Boolean @default(true)
}
```
- ไม่มี FK ใหม่ จึงไม่มีความเสี่ยง orphan
- **Campaign ที่มีอยู่แล้วเป็น `false` ส่วนใหม่เป็น `true` (รีวิว B ข้อ 2):** migration เดียว
  `ALTER TABLE "Campaign" ADD COLUMN "autoRetry" BOOLEAN NOT NULL DEFAULT true;` ตามด้วย `UPDATE "Campaign" SET "autoRetry" = false;`
  (schema ยัง `@default(true)` ทำให้ Campaign ที่สร้างหลังจากนี้เปิดอัตโนมัติ) · เหตุผล: Operation อนุมัติ Rollout ที่ค้างอยู่ (โดยเฉพาะ Firmware)
  ตอนที่ระบบยังไม่มีการส่งซ้ำ ถ้าเปิดให้ทีหลังโดยไม่บอกคือเปลี่ยนสิ่งที่อนุมัติไปแล้ว ซึ่งขัดกับเหตุผลของ C5 เอง · Campaign ระบบของคำขอจากหน้างานไม่อ่านค่านี้ จึงไม่กระทบ
  · Operation เปิดสวิตช์ของ Campaign เดิมเองได้ทีหลังที่หน้า Campaign
- **ผลตอน deploy:** ไม่มี Rollout ที่กำลังทำงานอยู่เปลี่ยนพฤติกรรม (Campaign เดิมเป็น `false`) · Campaign ที่เปิดสวิตช์เองภายหลังมีผลกับเครื่องที่ล้มหลังจากนั้น
  (target เดิมมี `attemptCount = 1`, `nextRetryAt = null` ตาม §3.3 จึงเข้ากติกาปกติ) · target ที่จบไปแล้วไม่ถูกแตะ

**C3 Pause:** `claimDueRetries()` วันนี้เมื่อ Rollout ไม่ `active` จะ **จบ target ด้วยผลรอบล่าสุด** (`NOT_ACTIVE_DETAIL`) ซึ่งเหมาะกับ Rollout เครื่องเดียว
แต่ไม่เหมาะกับหลายเครื่อง: Auto Pause หรือ Pause มือทำให้ทุกเครื่องที่รอรอบใหม่กลายเป็น `failed` ทันทีที่ถึงเวลา · แก้เฉพาะ Campaign ปกติ:
- Rollout `paused` → **ไม่ claim** ปล่อย target รอ (ยัง `pending`, `nextRetryAt` ผ่านเวลาแล้ว) · พอ `resume()` กลับเป็น `active` poll รอบถัดไปหยิบเองตามปกติ
  (ไม่ต้องแก้ `resume()` เพราะ query ของ `autoApply*` ข้าม target ที่มี `nextRetryAt` อยู่แล้ว ตาม §6.2 ข้อ 2)
- Rollout ไม่ใช่ `active`/`paused` (เช่น `cancelled`, `completed`) → target ไม่ใช่ `pending` แล้ว ไม่ถูกหยิบ
- Campaign ระบบ (หน้างาน) คงพฤติกรรมเดิม ไม่เปลี่ยน

**ปิดสวิตช์ระหว่างทำงาน:** อ่าน `autoRetry` สดทุกครั้งที่ตัดสิน (ไม่ snapshot) · ถ้า Operation ปิดระหว่าง Rollout ยังรันอยู่ การล้มรอบถัดไปจบทันที และเครื่องที่รอรอบใหม่อยู่จบด้วยผลรอบล่าสุดในรอบ poll ถัดไป (ไม่รอถึงเวลา · Rollout ที่ `paused` ปล่อยรอจน Resume · เครื่องที่กำลังส่งอยู่ให้ผู้ส่งจบเอง)
และ target ที่รอรอบใหม่ถึงเวลา claim แล้ว **จบด้วยผลรอบล่าสุด** (เหมือนทาง `notActive` ของ R1) ไม่ส่งรอบใหม่ → ใช้หยุดความเสียหายได้

**C4 แจ้งเตือน:** ไม่ต้องเพิ่ม type ใหม่ · `rollout-failed` เดิมที่โมดูล notification ฟังอยู่ส่งตอน Rollout จบอยู่แล้ว ซึ่งตรงกับ "แจ้งรวมตอนจบ" ·
`FIELD_APPLY_RETRY_EVENT` ที่ R1 ส่งต่อทุกรอบมีผู้ฟังคือ `ConfigApplyRequestService.notifyRetrying()` ซึ่งหาคำขอจาก `rolloutId` และ **คืน `false`
เงียบๆ เมื่อไม่ใช่ Rollout หน้างาน** (ไม่มีคำขอ) จึงไม่แจ้งทุกรอบของ Campaign ปกติโดยไม่ต้องแก้โค้ดของ B · ที่ต้องทำ: ข้อความสรุปใน `sampleErrors` /
Incident ให้บอก "ล้มหลังลอง 3 ครั้ง" และสาเหตุรอบสุดท้าย (ใช้ `resultDetail` ที่ R1 สรุปทุกรอบไว้แล้ว · ตรวจแล้ว: `sampleErrors` ใน `loadRolloutOutcome()` อ่านจาก `resultDetail` ของ target ที่ `failed` จึงได้ข้อความสรุปเองโดยไม่ต้องแก้)

**ความเสี่ยงที่ต้องแก้ตอนขยายเป็นหลายเครื่อง (ไม่มีใน R1 เพราะเครื่องเดียว) — ปรับตามรีวิว B ข้อ 1:**
1. **รอบ poll ที่ยาว (ไม่ใช่การส่งซ้ำ):** `CentralRolloutPollJob` กันรอบซ้อนอยู่แล้ว (flag `running`) และ deploy รัน backend ตัวเดียว ต่อให้ lease ของตัวท้ายๆ หมดระหว่างรอบ
   ก็ไม่มี poller อื่นมาหยิบไปส่งซ้ำ (ส่งซ้ำได้เฉพาะกรณีมี backend หลายตัว หรือ process ตายกลางรอบ) · **ปัญหาจริงคือ** ถ้ามี 100 เครื่องรอส่งใหม่ รอบนั้นส่งต่อกันไปเรื่อยๆ
   ระหว่างนั้นการถามผลของ Rollout อื่นทั้งหมดต้องรอ เพราะรอบ poll ถัดไปถูกข้าม · ที่ `claimDueRetries(now)` ใช้ `now` เดียวกันทั้งชุด ทำให้ lease ของทุกตัวนับจากต้นรอบ
   **แก้ 2 อย่างร่วมกัน:**
   - (ก) **claim ทีละตัวตอนจะส่ง:** `findMany` หาผู้สมัคร แล้ว `claimOne(target, new Date())` → ส่ง → ตัวถัดไป · lease ของแต่ละตัวเริ่มนับตอนส่งจริง (ช่วยแม้ในกรณีมี backend หลายตัว)
   - (ข) **จำกัดต่อรอบ:** ไม่เกิน 20 ตัว (หรือจำกัดเวลา 2–3 วินาทีต่อรอบ) ตัวที่เหลือไปรอบถัดไป (ทุก 4 วินาที) · เทสที่ตรวจว่า "ตัวที่ไม่ได้ claim ไม่ถูกแตะ" มีอยู่แล้วใน R1 ใช้ต่อได้
2. **ล้มพร้อมกันหมดจะลองใหม่พร้อมกันหมด:** `nextRetryAt` เท่ากันทุกเครื่อง · จำกัด claim ต่อรอบ (ข้อ 1) กระจายโหลดไป Server กลางอยู่แล้ว จึง **ไม่เสนอเพิ่ม jitter**
   เว้นแต่ B เห็นว่าจำเป็น
3. **Firmware:** ส่ง Firmware ซ้ำเป็นความเสี่ยงสูงกว่า Config ถ้ากล่อง rollback แล้วลองใหม่ (มติ Q2 ของ §2 ยอมรับแล้วสำหรับงานของช่าง) · สวิตช์ C5 ต่อ Campaign คือทางออกของ Operation ที่ไม่อยากเสี่ยง
4. **รหัสที่ส่งซ้ำแล้วไม่มีทางผ่าน (รีวิว B ข้อ 3):** วันนี้ไม่ลองใหม่แค่ `SUPERSEDED` / `CANCELLED` (`central-config.ts` — ตาราง §3.1) งานของช่างทีละเครื่องยังรับได้
   แต่ Campaign 100 เครื่องที่ส่งของผิดชุดเดียวกันจะยิงซ้ำ 300 ครั้งเปล่าๆ และ Rollout ค้างนานขึ้นราว 2 นาทีก่อนนับเข้า Auto Pause · B เสนอขยายรายการที่ **ไม่ลอง** ด้วยรหัสที่ผลไม่น่าเปลี่ยนเมื่อส่งซ้ำ
   (ที่ B เจอใน ws-gateway / delivery-server / firmware): `UNKNOWN_SCHEMA`, `HARDWARE_MISMATCH`, `INVALID_HARDWARE_MODEL`, `DOWNGRADE_NOT_ALLOWED`, `RELEASE_NOT_FOUND`, `INVALID_JSON`,
   `PAYLOAD_TOO_LARGE`, `INVALID_VERSION` · **แยกเป็น PR เล็กของ B (R1.1) ก่อน C1** เพราะ `central-config.ts` เป็นงาน R1 และการขยายนี้มีผลกับงานส่งของช่างด้วย (ไม่ใช่เฉพาะ Campaign) ·
   ยังคงหลักเดิมของ §3.1 คือ denylist ของ "ไม่ลอง" รหัสที่ไม่รู้จักยังได้ลองใหม่ · รายการรหัสข้างบนมาจากการอ่านโค้ดของ B A ยังไม่ได้ตรวจเอง ให้ตรวจใน PR นั้น

   > **ผลตรวจใน R1.1 (B, 6 พ.ย. 2569):** รายการข้างบน**ส่วนใหญ่ไม่ใช่ `error_code` ของคำสั่ง** แต่เป็น error ที่ delivery-server ตอบ HTTP
   > 4xx ตอนสั่ง (`UNKNOWN_SCHEMA`, `INVALID_HARDWARE_MODEL`, `DOWNGRADE_NOT_ALLOWED` ฝั่ง admin, `RELEASE_NOT_FOUND`, `INVALID_JSON`,
   > `PAYLOAD_TOO_LARGE`, `INVALID_VERSION`) ซึ่ง backend จัดเป็น `rejected` และ **ไม่ลองซ้ำอยู่แล้ว** (`decideAfterFailure()`) ·
   > รายการที่ใส่จริงมาจาก `ws-gateway/src/errors.js` + `finishCommand()` ของ firmware คือรหัสที่กล่องรายงานว่ารับของชุดนี้ไม่ได้เลย
   > (ดูตาราง §3.1 แถวใหม่) · รหัสที่ล้มเพราะข้อมูลเสียระหว่างทาง (`SHA256_MISMATCH`, `SIZE_MISMATCH`, `*_INVALID_JSON`), Server เปลี่ยนระหว่างส่ง
   > (`CONFIG_VERSION_MISMATCH`), เขียน flash ไม่ผ่าน และ HTTP ของกล่อง (`CONFIG_HTTP_n` ฯลฯ) **ยังลองใหม่** · `DOWNGRADE_NOT_ALLOWED` ที่กล่องได้ตอนขอ
   > manifest มาเป็น `MANIFEST_HTTP_409` (ใส่ชื่อจริงไว้ใน `error_message`) ยังลองใหม่ เพราะแยกจาก 409 แบบอื่นด้วยรหัสอย่างเดียวไม่ได้ · ครบ 3 ครั้งก็จบเหมือนกัน

### 6.4 ฝั่งเว็บ
- **ฟอร์มสร้าง/แก้ Campaign:** สวิตช์ "ลองส่งใหม่อัตโนมัติ (สูงสุด 3 ครั้ง)" เปิดเป็นค่าเริ่มต้น พร้อมคำอธิบายว่าปิดแล้วเครื่องที่ส่งไม่สำเร็จจะนับเป็นล้มทันที
  (**แก้ 9 พ.ย.:** หมายถึงเครื่องที่ล้มรอบแรกหลังปิดสวิตช์ · เครื่องที่รอรอบใหม่อยู่แล้วจบด้วยผลรอบล่าสุด ดู §7.4 และ §7.6 W3)
- **หน้ารายละเอียด Rollout:** เครื่องที่รอรอบใหม่ขึ้นป้าย "รอบ 2/3" + "จะลองใหม่ในอีก 0:45" + เหตุผลของรอบก่อน · แถบความคืบหน้านับตัวเหล่านี้เป็น "รอผล" พร้อมหมายเหตุ
  "กำลังลองใหม่ N เครื่อง" · กดแถวดูประวัติรายรอบ (แสดงเฉพาะเมื่อมากกว่า 1 รอบ หรือรอบเดียวที่ไม่สำเร็จ ตามกติกาเดียวกับ Mobile §3.7)
- **นับถอยหลังถึงศูนย์ (ผลทดสอบกล่องจริง BOX-0001 รอบ 5 พ.ย. โดย B):** รอบใหม่อาจค้าง `PENDING` นานเกือบ 1 นาทีหลังกล่องเพิ่งกลับจาก rollback ก่อนจะเริ่มดาวน์โหลด จึงไม่ควรถือว่า
  พอถึง `nextRetryAt` เครื่องจะเริ่มส่งทันที · เมื่อนับถอยหลังเป็น 0 ให้ขึ้น **"ส่งรอบใหม่แล้ว รอกล่องตอบ"** แทนการนับต่อหรือค้างที่ 0:00
- **กล่องออฟไลน์ตอนปล่อย:** งานของช่างที่กดส่งตอนกล่องออฟไลน์ได้ 409 จึงไม่เข้ารอบลองใหม่ แต่ Campaign ปกติจะถูกข้ามเป็น `skipped` ซึ่ง R1 นับเป็นผลล้มที่ลองใหม่ได้ ·
  ถ้าไฟดับทั้งไซต์ การลองภายในราว 90 วินาทีมักไม่ช่วยแต่ไม่เสียหาย (ครบ 3 ครั้งแล้วจบเป็น `skipped` ไม่ Auto Pause ตาม §3.1) · ข้อความบนหน้ารายละเอียด Rollout ควรบอกว่ากล่องออฟไลน์
  เพื่อให้ Operation รู้ว่าลองใหม่ไปก็อาจไม่ผ่าน
- **API:** `GET .../targets` เพิ่ม `attemptCount`, `nextRetryAt` ในรายการ · ประวัติเต็มดึงตอนกดขยายแถว (endpoint รายเครื่อง) ไม่ใส่ในรายการเพื่อไม่ให้ตอบหนักเมื่อมีหลายร้อยเครื่อง ·
  `POST/PATCH /campaigns` รับ `autoRetry` · อัปเดต `openapi.yaml` + `RBAC_Matrix` (สิทธิ์ไม่เปลี่ยน ใช้ `campaign` Update/Create เดิม)

### 6.5 แบ่งงาน

| PR | เจ้าของ | เนื้อหา |
|---|---|---|
| R1.1 | B | ขยายรายการรหัสที่ไม่ลองใหม่ (§6.3 ข้อ 4) ใน `central-config.ts` + เทสทุกรหัส · ทำก่อน C1 |
| C1 | A | migration `Campaign.autoRetry` (แถวเดิม `false`) · `isAutoRetryEnabled()` แทนเช็คชื่อ 3 จุด · Pause ไม่ claim · claim ทีละตัว + จำกัดต่อรอบ (§6.3 ข้อ 1) · `POST/PATCH /campaigns` รับ `autoRetry` · openapi/RBAC |
| C2 | A | `GET .../targets` เพิ่ม `attemptCount`/`nextRetryAt` + endpoint ประวัติรายเครื่อง · openapi/RBAC |
| C3 | A | เว็บ: สวิตช์ในฟอร์ม Campaign + ป้ายรอบ/นับถอยหลัง/ประวัติในหน้ารายละเอียด Rollout |

B ตรวจทุก PR · จุดที่ขอให้ B ดูเป็นพิเศษ: การ claim ทีละตัวแบบจำกัดจำนวน (ความเสี่ยงข้อ 1), การไม่ claim ตอน `paused`, และการเปลี่ยนจากเช็คชื่อ Campaign เป็นเงื่อนไขเดียว (ต้องไม่ทำให้ Campaign ปกติที่ปิดสวิตช์เปลี่ยนพฤติกรรมจากวันนี้)

### 6.6 ทดสอบ (เพิ่มจาก §5)
- unit: `isAutoRetryEnabled()` ครบตาราง (central/ไม่ใช่ central × Campaign ระบบ/ปกติ × `autoRetry` เปิด/ปิด) · ปิดสวิตช์ = ล้มแล้วจบทันทีเหมือนวันนี้
- unit: Campaign ปกติ เครื่อง A ล้มครั้งที่ 1 → `pending` + `nextRetryAt` ไม่นับเป็น `failed` ไม่ Auto Pause · ครบ 3 ครั้งแล้วล้ม → `failed` นับเข้า Auto Pause และ Incident ครั้งเดียว
- unit: Rollout `paused` → `claimDueRetries()` ไม่หยิบ target ปกติ (ต่างจาก Campaign ระบบที่จบเหมือนเดิม) · `resume()` แล้ว poll ถัดไปหยิบ
- unit: claim ทีละตัว — lease ของแต่ละตัวนับจากตอนส่ง ไม่ใช่ต้นรอบ · จำกัดต่อรอบ ตัวที่เหลือไม่ถูกแตะและไม่เสีย lease
- **unit/integration (รีวิว B ข้อ 5): Auto Pause ขณะมีเครื่องรอรอบใหม่** — เครื่องอื่นล้มครบ 3 ครั้งจน Auto Pause → เครื่องที่รออยู่ต้องยัง `pending` ไม่ถูกจบเป็น `failed` →
  `resume()` แล้วรอบ poll ถัดไปหยิบทุกตัวที่เลยเวลา โดยติดเพดานการ claim · เคสเดียวนี้ครอบทั้งการไม่ claim ตอน `paused`, `resume` และการจำกัด claim
- unit: เครื่องที่รอรอบใหม่ทำให้ Rollout ไม่ `completed` จนกว่าจะจบ · Cancel (rollback) ทำให้เป็น `failed` และไม่ถูกหยิบ
- integration (Postgres จริง): Rollout 3 เครื่อง ล้ม/ลองใหม่สำเร็จ/ล้มครบ 3 ครั้งปนกัน → Incident 1 อัน นับเฉพาะเครื่องที่ล้มครบ · mutation check: ถอดเงื่อนไข `paused` แล้วเทสต้องล้ม
- เว็บ: vitest ป้าย/นับถอยหลัง/ประวัติ/สวิตช์ · นับถอยหลังถึงศูนย์ขึ้น "ส่งรอบใหม่แล้ว รอกล่องตอบ" (§6.4)
- **กล่องจริง:** ใช้ BOX-0001 เหมือน §5 แต่ปล่อยผ่าน Campaign ปกติ · B ทดสอบ R1–R3 กับ BOX-0001 แล้ว (5 พ.ย.) ด้วย Firmware ทดสอบ 1.2.9 ที่ตั้งใจให้ rollback 2 ครั้งแรกแล้วติดครั้งที่ 3:
  ช่วงรอ 30/60 วินาทีและแจ้งเตือนรายรอบถูกต้อง · Firmware ทดสอบนั้นเก็บไว้ในระบบแล้ว (`6c2c4c2f`, TEST ONLY) ใช้เป็นเคสกล่องจริงของหัวข้อนี้ได้เลย

### 6.7 คำถามถึง B และคำตอบจากรีวิวรอบ 1 (5 พ.ย. 2569)
1. **จำกัด claim ต่อรอบ poll** — B เห็นด้วย และเสนอวิธีที่ดีกว่า: claim ทีละตัวตอนจะส่ง ร่วมกับจำกัดต่อรอบ · A รับ · แก้ §6.3 ความเสี่ยงข้อ 1 แล้ว (ความเสี่ยง "ส่งซ้ำ" ที่ A เขียนไว้เดิมเกินจริง)
2. **ค่าเริ่มต้นของ Campaign เดิมตอน deploy** — B ขอให้แถวเดิมเป็น `false` เฉพาะ Campaign ใหม่เป็น `true` · A รับ · แก้ §6.1 และ §6.3 ข้อมูลแล้ว
3. **เพิ่มจากรีวิว:** ขยายรายการที่ไม่ลองใหม่ (R1.1 โดย B ก่อน C1) · ผลทดสอบกล่องจริงและพฤติกรรมนับถอยหลังถึงศูนย์/กล่องออฟไลน์ (§6.4, §6.6) · เทสต์ Auto Pause ขณะมีเครื่องรอรอบใหม่ (§6.6) — A รับทั้งหมด

---

## 7. สรุปพฤติกรรมที่ใช้งานจริง และส่วนที่เว็บยังขาด (B · 9 พ.ย. 2569)

> **สถานะ:** สรุปจาก `main` ที่ `65d0985` หลัง #454–#463 merge ครบ · ส่วน 7.1–7.5 คือพฤติกรรมที่ใช้งานอยู่จริง ไว้ให้ทีม (และรายงาน) อ้างอิงที่เดียว
> แทนการไล่อ่าน §3 กับ §6 ที่มีประวัติการแก้ปนอยู่ · ส่วน 7.6 คือแผนงานเว็บที่ยังขาด ขอให้ A รีวิวและรับไปทำ

### 7.1 ใช้กับงานไหน

| งาน | ยิงซ้ำไหม |
|---|---|
| คำขอส่งเข้ากล่องจากหน้างาน (ช่างกดส่งบน Mobile · Campaign ระบบ) | **เปิดเสมอ** |
| Rollout ของ Campaign ปกติ | ตามสวิตช์ `Campaign.autoRetry` · Campaign ใหม่เปิดเป็นค่าเริ่มต้น · Campaign ที่มีอยู่ก่อน #457 ถูกตั้งเป็นปิด |
| Rollout ที่ `applyMode` ไม่ใช่ `central` (เช่น `mock`, `real`) | ไม่ยิงซ้ำ |

การยิงซ้ำส่ง **ของชุดเดิม** (Config/Firmware และค่าที่แก้ซึ่งอนุมัติไว้แล้ว) ไม่ต้องขออนุมัติใหม่ และไม่สร้างคำขอใหม่

### 7.2 จังหวะเวลา

```
รอบ 1  ส่ง ──> ไม่สำเร็จ
          รอ 20 วินาที      (pending + nextRetryAt · ป้าย "รอบ 2/3" + นับถอยหลัง)
รอบ 2  ส่งของเดิม ──> ไม่สำเร็จ
          รอ 20 วินาที      (ป้าย "รอบ 3/3")
รอบ 3  ส่งของเดิม ──> ไม่สำเร็จ
          จบ: "ส่ง 3 ครั้งไม่สำเร็จ ได้แก่ รอบ 1: ..., รอบ 2: ..., รอบ 3: ..."
```

- เวลารอ = `FIELD_APPLY_RETRY_DELAY_SEC` เท่ากันทุกรอบ (แก้ 10 พ.ย. 2569 เดิมคูณ 2 ทุกรอบ ดู §8) · รอบไหนสำเร็จก็จบเป็นสำเร็จทันที
- **คำขอจากหน้างาน:** ทุกรอบที่ล้ม ช่างได้แจ้งเตือน `config_apply_retrying` · จบแล้วได้ `config_apply_succeeded` หรือ `config_apply_failed` (มีประวัติรายรอบใน payload)
- **Campaign ปกติ:** ไม่มีแจ้งเตือนรายรอบ Operation ดูจากป้ายรอบและประวัติรายรอบในหน้า Rollout
- ข้อความรายรอบใช้ข้อความภาษาไทยของรหัส error (`FAILED_ERROR_CODE_MESSAGES` ใน `central-config.ts`) ซึ่งเทสต์บังคับว่าไม่มีขีดยาวหรือจุดคั่นกลาง (#460)

### 7.3 ผลแบบไหนยิงซ้ำ

เป็น **denylist ของ "ไม่ยิงซ้ำ"** (`isRetryableCentralOutcome()` ใน `backend/src/central-device/central-config.ts`): ผล `failed`/`skipped` ทุกแบบยิงซ้ำ
ยกเว้นรหัสในรายการ · รหัสใหม่ที่ gateway เพิ่มในอนาคตจึงยิงซ้ำได้โดยไม่ต้องแก้โค้ด (ครบ 3 ครั้งก็จบ)

| ยิงซ้ำ (น่าจะเป็นปัญหาชั่วคราว) | ไม่ยิงซ้ำ (ส่งกี่ครั้งก็ผิดเหมือนเดิม) |
|---|---|
| `DEVICE_DISCONNECTED`, `DEVICE_NO_RESPONSE` | `SCHEMA_NOT_SUPPORTED`, `SETTINGS_MISSING`, `UNSUPPORTED_PARAMETER:*`, `INVALID_VALUE:*`, `INVALID_GROUP:*` |
| `DOWNLOAD_TIMEOUT`, `SHA256_MISMATCH`, `SIZE_MISMATCH` | `HARDWARE_MISMATCH`, `VERSION_MISMATCH` |
| `UPDATE_BEGIN_FAILED`, `FLASH_WRITE_FAILED`, `UPDATE_END_FAILED` | `UNSIGNED_FIRMWARE`, `SIGNATURE_INVALID` |
| `ROLLED_BACK`, `NEW_FIRMWARE_FAILED_HEALTH_CHECK` | `NO_OTA_PARTITION`, `SIZE_NOT_SUPPORTED` |
| `CONFIG_VERSION_MISMATCH`, `*_HTTP_<code>` ของกล่อง | `DOWNLOAD_URL_INVALID` (ต้องแก้ที่ Server) |
| `skipped` (กล่องออฟไลน์ถูกข้าม) | `UNSUPPORTED_ACTION` |
| ส่งไม่ถึง Server กลาง (`unavailable` / throw ตอนส่ง) | `SUPERSEDED`, `CANCELLED`, และ Server กลางปฏิเสธตอนรับคำสั่ง (`rejected`) |

กรณีไม่ยิงซ้ำ ระบบจบตั้งแต่รอบแรกพร้อมสาเหตุภาษาไทย ไม่ต้องรอเปล่าอีกราว 90 วินาที

### 7.4 กลไกกันส่งซ้ำซ้อนและผลต่อ Rollout

- **claim + lease:** ก่อนส่งแต่ละรอบ claim เครื่องแบบ atomic และตั้ง lease (`FIELD_APPLY_CLAIM_LEASE_SEC`) · claim ทีละตัวตอนจะส่ง lease จึงนับจากตอนส่งจริง · backend ดับกลางทาง lease หมดแล้วรอบ poll ถัดไปหยิบต่อเอง (รอบที่ค้างนับเป็น 1 ครั้ง)
- **รอบ poll ทุก 4 วินาที:** หยิบเครื่องที่ถึงเวลาได้ไม่เกิน `FIELD_APPLY_MAX_DUE_PER_POLL` ตัว ที่เหลือไปรอบถัดไป
- **Pause:** Rollout ปกติที่ `paused` ไม่ถูก claim เครื่องที่รอยังเป็น `pending` · Resume แล้วรอบ poll ถัดไปหยิบเอง
- **ปิดสวิตช์ระหว่างทาง:** เครื่องที่รอรอบใหม่จบด้วย **ผลของรอบล่าสุด** ในรอบ poll ถัดไป (ล้มเป็น `failed` · ถูกข้ามเพราะออฟไลน์เป็น `skipped`) ไม่ใช่ "นับเป็นล้มเหลวทันที"
- **Auto Pause / Incident:** นับเป็นล้มเฉพาะเครื่องที่ครบทุกรอบแล้ว เครื่องที่รอรอบใหม่ยังไม่นับ และทำให้ Rollout ยังไม่ `completed`
- **ยกเลิก Rollout (rollback):** เครื่องที่ `pending` (รวมที่รอรอบใหม่) เป็น `failed` และไม่ถูกหยิบอีก

### 7.5 ค่าที่ปรับได้ (env ของ backend)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `FIELD_APPLY_MAX_ATTEMPTS` | 3 | จำนวนครั้งทั้งหมดรวมครั้งแรก |
| `FIELD_APPLY_RETRY_DELAY_SEC` | 20 | รอก่อนส่งรอบใหม่ เท่ากันทุกรอบ (เดิม 30 และคูณ 2) |
| `FIELD_APPLY_CLAIM_LEASE_SEC` | 60 | อายุ lease ระหว่างกำลังส่ง ต้องมากกว่าเวลาส่งหนึ่งครั้ง |
| `FIELD_APPLY_MAX_DUE_PER_POLL` | 20 | จำนวนเครื่องที่หยิบได้ต่อรอบ poll |

**ผลกล่องจริง:** BOX-0001 กับ Firmware ทดสอบ 1.2.9 (`6c2c4c2f`, TEST ONLY · rollback 2 ครั้งแรกแล้วติดครั้งที่ 3) ช่วงรอ 30/60 วินาที แจ้งเตือนรายรอบ และผลสุดท้ายถูกต้อง (5 พ.ย. 2569)

### 7.6 ส่วนที่เว็บยังขาด (แผนงานสำหรับ A)

การ์ด "การส่งเข้ากล่อง" บนหน้าอุปกรณ์ (#456) อ่าน `retry.maxAttempts` จาก progress API อยู่แล้ว และ Mobile ก็อ่านค่าจาก API เหมือนกัน · ส่วนที่ขาดอยู่ที่หน้า Campaign/Rollout (#459) ทั้งหมด:

| # | ส่วนที่ขาด | ที่เกิด | ทำอะไร | โมดูล |
|---|---|---|---|---|
| W1 | หน้า Rollout เขียนเลข 3 ไว้ตายตัว (`ROLLOUT_MAX_ATTEMPTS`) และข้อความสวิตช์บอก "สูงสุด 2 ครั้ง" ถ้าตั้ง `FIELD_APPLY_MAX_ATTEMPTS` เป็นค่าอื่น ป้ายจะผิด | `web/src/lib/rollout-retry-display.ts`, `campaigns/auto-retry-field.tsx` | backend: `GET .../targets` (หรือ `GET /campaigns/{id}`) คืน `maxAttempts` จาก `FIELD_APPLY_RETRY_SETTINGS` · เว็บใช้ค่านั้นแทนค่าคงที่ · openapi | campaign (backend + เว็บ) |
| W2 | การ์ดความคืบหน้า Rollout ไม่บอกว่ามีกี่เครื่องที่กำลังรอรอบใหม่ (§6.4 วางไว้ว่าแสดง "กำลังลองใหม่ N เครื่อง") และกรองตารางดูเฉพาะกลุ่มนี้ไม่ได้ | `campaigns/rollout-progress-card.tsx`, `campaign-rollout-detail-view.tsx` | นับจาก `nextRetryAt != null` ในรายการ targets ที่โหลดอยู่แล้ว (ไม่ต้องแก้ API) · เพิ่มตัวกรอง "รอส่งรอบใหม่" / "ล้มครบทุกรอบ" | เว็บ |
| W3 | กล่องยืนยันตอนปิดสวิตช์บอกว่า "เครื่องที่กำลังรอส่งซ้ำจะนับเป็นล้มเหลวทันที" ไม่ตรงกับ §7.4 (ข้อความต้นทางมาจาก §6.4 ข้อแรก) | `campaigns/rollout-auto-retry-control.tsx` | เปลี่ยนเป็น "เครื่องที่กำลังรอส่งซ้ำจะจบด้วยผลของรอบล่าสุดภายในไม่กี่วินาที" · ถ้าเครื่องเหล่านั้นทำให้ถึงเกณฑ์ อาจทำให้ Rollout หยุดอัตโนมัติ | เว็บ |
| W4 | ฟอร์มสร้าง Rollout: ถ้าโหลด Campaign ไม่สำเร็จ สวิตช์แสดงเป็นเปิด และค่าที่ผู้ใช้เลือกจะไม่ถูกบันทึกโดยไม่มีคำเตือน | `campaigns/campaign-rollout-create-form.tsx` (`groupAutoRetry === undefined`) | disable สวิตช์จนกว่า `campaignQuery.data` มา หรือแจ้งเตือนเมื่อบันทึกไม่ได้ | เว็บ |

**ลำดับที่เสนอ:** W3 กับ W4 เป็นงานเว็บเล็ก ทำรวมใบเดียวได้ · W2 ใช้ข้อมูลที่มีอยู่แล้ว · W1 ต้องแก้ backend + openapi ก่อน แยกใบ

**เทสต์ที่ควรมี:**
- W1: unit ว่า `maxAttempts` ตามค่า env · vitest ป้าย "รอบ N/M" ตาม `maxAttempts` จาก API
- W2: vitest จำนวน "กำลังลองใหม่" และตัวกรอง (ใช้ fixture ที่มีทั้ง `nextRetryAt` และ `null`)
- W3: vitest ข้อความในกล่องยืนยัน
- W4: vitest เมื่อ `useCampaign` error สวิตช์ disable หรือมีคำเตือน

**ไม่อยู่ในแผนนี้:** ปุ่ม "ส่งใหม่" บนเว็บ (การส่งเป็นหน้าที่ช่างบน Mobile ตาม docs/27) · การยิงซ้ำในโหมดที่ไม่ใช่ central

---

## 8. ปรับจังหวะการลองใหม่และเวลารอกล่องพร้อม (B · 10 พ.ย. 2569)

**มติ:** ลดเวลาให้ช่างรู้ผลเร็วขึ้น หลังทดสอบระบบจริงพบว่าการรอรวมราว 1 นาที 40 วินาทีนานเกินไปสำหรับช่างที่ยืนรอหน้ากล่อง

| ค่า | เดิม | ใหม่ | อยู่ที่ |
|---|---|---|---|
| รอก่อนส่งรอบใหม่ | 30 → 60 วินาที (คูณ 2) | 20 วินาทีเท่ากันทุกรอบ | backend `FIELD_APPLY_RETRY_DELAY_SEC` + `retryDelayMs()` |
| รอกล่องพร้อมก่อนส่งงาน Firmware (นับจากกล่องต่อ Gateway หรืองาน Firmware ก่อนหน้าจบ) | 60 วินาที | 15 วินาที | Server กลาง (ws-gateway) `FIRMWARE_SETTLE_SEC` · ไม่ใช่โค้ดของ repo นี้ |

**ทำไมสองค่านี้ต้องไปด้วยกัน:** กล่องที่ rollback จะรีบูตแล้วต่อกลับราว 10 วินาที จากนั้น Server กลางรอ `FIRMWARE_SETTLE_SEC` ก่อนส่งงาน Firmware
ถ้ายังรอ 60 วินาที รอบใหม่ที่ส่งตอน 20 วินาทีจะค้าง `PENDING` ที่ Server กลางเกือบ 1 นาที · ลดเหลือ 15 วินาที กล่องพร้อมราววินาทีที่ 25 รอบใหม่จึงค้างแค่ไม่กี่วินาที
(หน้าจอรองรับอยู่แล้ว: ถึงเวลาแล้วขึ้น "ส่งรอบใหม่แล้ว รอกล่องตอบ" ตาม §6.4)

**ข้อแลกเปลี่ยนที่ยอมรับ:**
- กล่องที่หลุดนานกว่าราว 40 วินาที (เน็ตมือถือ / ไฟดับชั่วคราว) จะใช้ครบ 3 รอบก่อนกลับมา การเพิ่มเวลารอทีละรอบแบบเดิมตั้งใจไว้รับกรณีนี้ · ช่างกด "ส่งใหม่อีกครั้ง" ได้เมื่อกล่องกลับมา
- `FIRMWARE_SETTLE_SEC` เดิมตั้ง 60 วินาทีเพราะเจอ rollback เมื่อสั่งเร็วหลังรีบูต · ภายหลังพิสูจน์ได้ว่าต้นเหตุคือบั๊กในเฟิร์มแวร์ 1.1.0 (แก้แล้วตั้งแต่ 1.2.1)
  กล่องที่ยังใช้รุ่นก่อน 1.2.1 จึงเสี่ยง rollback มากขึ้น · การยิงซ้ำช่วยรับส่วนนี้ได้บางส่วน

**ทดสอบที่ต้องทำ:** BOX-0001 กับ Firmware ทดสอบ 1.2.9 (rollback 2 ครั้งแรก) ยืนยันช่วงรอ 20/20 วินาที และดูว่า rollback ไม่บ่อยขึ้นเมื่อ `FIRMWARE_SETTLE_SEC=15`
