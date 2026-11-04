# แผนให้ระบบลองส่งเข้ากล่องใหม่เองเมื่อส่งไม่สำเร็จ (ส่งจากหน้างาน · โหมด central)

> **สถานะ:** แผน — B ตัดสินมติ §2 แล้ว (4 พ.ย. 2569) · ขอ A (paveekornkwork-dev) รีวิว เพราะแตะโมดูล `campaign`
> (`CentralRolloutPollService`, `CampaignRolloutService`) และ schema ที่ใช้ร่วมกัน
>
> **ต่อจาก:** docs/25 (คำขอส่ง Config จากหน้างาน), docs/27 (อนุมัติแล้วช่างกดส่งเอง + Firmware) · ไม่แก้มติเดิมของสองฉบับนั้น
>
> **ที่มาของข้อมูล:** `main` ที่ `1e70e13` + ผลส่ง Firmware เข้า BOX-0001 จริง 2–4 พ.ย. 2569 (§1.1)

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

ฟังก์ชันตัดสินอยู่ที่ `central-config.ts` คู่กับ `classifyCentralCommand()` เดิม (`isRetryableCentralOutcome()`)

### 3.2 จังหวะการลอง
- รวมสูงสุด **3 ครั้ง** · รอก่อนส่งรอบใหม่ **30 วินาที → 60 วินาที** (ให้กล่องที่เพิ่งรีบูต/เน็ตเพิ่งกลับมาตั้งตัว และให้
  Firmware ที่ rollback บูตเวอร์ชันเดิมเสร็จก่อน)
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
- `CampaignRolloutTarget` เพิ่ม `attemptCount Int @default(1)` และ `nextRetryAt DateTime?`
- `NotificationType` (enum DB) เพิ่มค่า `config_apply_retrying`
- ไม่มี FK ใหม่บนข้อมูลเดิม → ไม่มีความเสี่ยง orphan · target เดิมถือว่าส่งไปแล้ว 1 ครั้ง (default)

### 3.4 การทำงาน (backend)

```
poll ได้ผลจบของ target (field apply เท่านั้น — เช็คชื่อ Campaign ระบบแบบเดิม)
 ├─ success → ปิด attempt ล่าสุด succeeded → recordTargetResult(true) ตามเดิม
 ├─ ล้ม + ลองใหม่ได้ + attemptCount < MAX
 │     → ปิด attempt ล่าสุด failed (errorCode, detail)
 │     → target: centralCommandId = null, nextRetryAt = now + delay (ยัง pending)
 │     → emit FIELD_APPLY_RETRY_EVENT { rolloutId, attemptNo, maxAttempts, detail, nextRetryAt }
 └─ ล้ม + (ลองไม่ได้ หรือครบ MAX)
       → ปิด attempt ล่าสุด → recordTargetResult(false, สรุปทุกรอบ) ตามเดิม (Incident เปิดครั้งเดียวตรงนี้)

poll รอบเดียวกัน: target pending ที่ centralCommandId = null และ nextRetryAt <= now
       → attemptCount += 1 แบบ claim (updateMany where attemptCount = เดิม กันส่งซ้ำ 2 ครั้ง)
       → pushToCentral / pushFirmwareToCentral เดิม → สร้าง attempt ใหม่
```
- **Override ใช้ครั้งเดียว (#432 `consumedAt`)** — mark ตอนส่งครั้งแรกที่ Server กลางรับ รอบถัดไปต้อง merge
  Override **ตัวเดิมของ Rollout นี้** ไม่ใช่หา "ตัวที่ยังไม่ใช้" ใหม่ → เก็บ `overrideId` ที่ใช้ไว้กับ target/attempt
- **คำขอหมดอายุ 24 ชม.** — นับถึงตอนกดส่ง คำขอที่ปล่อยแล้วลองต่อจนจบแม้เลยเวลา (รวมไม่เกิน ~2 นาที + เวลาคำสั่ง)
- **AuditLog** — ทุกรอบที่ส่งใหม่ลง `apply-config` / `apply-firmware` พร้อม `attemptNo` (การนำค่าไปใช้เกิดทุกรอบ)

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

`ConfigApplyRequest.resultDetail` ตอนจบเขียนสรุปทุกรอบ (Web แสดงได้ทันทีโดยไม่ต้องแก้) · อัปเดต openapi + RBAC_Matrix

### 3.7 Mobile
- หน้าความคืบหน้าการส่ง: ป้าย **"รอบ 2/3"** · ช่วงรอรอบใหม่แสดง "จะลองใหม่ในอีก 0:45" · แอนิเมชันเริ่มรอบใหม่
- ใต้ภาพ: **ประวัติการส่ง** แต่ละรอบ เวลา + สาเหตุที่ล้ม
- หน้าแจ้งเตือน: รู้จัก `configApplyRetrying` (หมวด "ส่งเข้ากล่อง", โทน action สีเหลือง, แตะไปหน้างาน)

---

## 4. แบ่งงาน

| PR | เจ้าของ | เนื้อหา |
|---|---|---|
| R1 | A (หรือ B ถ้า A ยกให้) | migration §3.3 · retry ใน `CentralRolloutPollService` + re-push ใน `CampaignRolloutService` · `FIELD_APPLY_RETRY_EVENT` · unit + integration |
| R2 | B | รับ event → แจ้งเตือน `config_apply_retrying` + payload ใหม่ของ succeeded/failed · progress API `attempts[]` · openapi/RBAC |
| R3 | B | Mobile: หน้าความคืบหน้า + หน้าแจ้งเตือน |

## 5. ทดสอบ
- unit: ตาราง §3.1 ครบทุกแถว · ครบ 3 ครั้งแล้วจบ · claim กันส่งซ้ำเมื่อ poll ซ้อน · Override ตัวเดิมทุกรอบ
- integration: ล้ม → retrying 2 ครั้ง → failed 1 ครั้ง (Incident 1 อัน) · ล้ม 1 ครั้งแล้วสำเร็จ
- กล่องจริง BOX-0001: ส่ง Config แล้วปิด Wi-Fi ของกล่อง ~1 นาที (`DEVICE_DISCONNECTED`) → เปิดกลับ → ต้องสำเร็จในรอบ 2
