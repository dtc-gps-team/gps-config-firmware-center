# แผนให้ระบบลองส่งเข้ากล่องใหม่เองเมื่อส่งไม่สำเร็จ (ส่งจากหน้างาน · โหมด central)

> **สถานะ:** แผน — B ตัดสินมติ §2 แล้ว (4 พ.ย. 2569) · A รีวิวรอบ 1 (4 พ.ย.) และรอบ 2 (5 พ.ย. 2569) แก้ตามรีวิวใน
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
- Campaign ปกติหลายเครื่อง — มี Auto Pause ของตัวเองอยู่แล้ว ทำทีหลังได้ถ้าต้องการ
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
- รวมสูงสุด **3 ครั้ง** · รอก่อนส่งรอบใหม่ **30 วินาที → 60 วินาที** (ให้กล่องที่เพิ่งรีบูต/เน็ตเพิ่งกลับมาตั้งตัว และให้
  Firmware ที่ rollback บูตเวอร์ชันเดิมเสร็จก่อน)
- ส่งรอบใหม่เกิดใน poll รอบแรกที่ `nextRetryAt <= now` · poll รันทุก 4 วินาที (`POLL_INTERVAL_MS = 4000` ใน
  `central-rollout-poll.job.ts`) เวลารอจริงจึงเป็น **30–34 วินาที** และ **60–64 วินาที** · เวลารอรวมไม่เกินราว
  **1 นาที 40 วินาที** บวกเวลาที่คำสั่งแต่ละรอบใช้จนจบ
- env: `FIELD_APPLY_MAX_ATTEMPTS=3`, `FIELD_APPLY_RETRY_DELAY_SEC=30` (รอบถัดไปคูณ 2) · ค่าเริ่มต้นตามนี้
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
