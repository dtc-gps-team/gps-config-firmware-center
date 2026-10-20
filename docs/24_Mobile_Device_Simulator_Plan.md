# แผนฟีเจอร์ "กล่องจำลอง" ในแอป Mobile

> **สถานะ:** แผนเพื่อขอความเห็น — **ยังไม่มีโค้ดใน PR นี้** · ร่าง 20 ต.ค. 2569 โดย B (kittiphong)
> · รอ A (paveekornkwork-dev — เจ้าของ `device` / `device-sync` module) ตอบคำถามเปิดใน §9 ก่อนเริ่ม implement
>
> **ต่อยอดจาก `docs/19_Device_Pull_Test_Proposal.md` §8 "แอปจำลองกล่อง (B)"** ซึ่งตกลงไว้แล้ว (B ตอบ 15 ต.ค.) ว่าเป็น
> **โหมดหนึ่งในแอปเดิม** ให้ผู้ทดสอบกรอก URL / Device ID / API key เอง แล้วดึงงาน Config และกดผลเอง (หรืออัตโนมัติ)
> เอกสารนี้ขยายจากตรงนั้นเป็นฟีเจอร์ที่ ST/OT ใช้ได้จริง: สร้างกล่องจำลองเองหลายตัว มีป้าย "จำลอง" และแสดงขั้นตอน
> การติดตั้งแบบละเอียด
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `cec3779` — `backend/src/device-sync/*`, `backend/src/device/*`,
> `backend/src/campaign/campaign-rollout.service.ts`, `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`,
> `docs/architecture/RBAC_Matrix.md`, `mobile/lib/core/api/api_client.dart`, `mobile/lib/core/auth/*`

---

## 1. บริบทและเป้าหมาย

- ตอนนี้มีกล่อง ESP32 จริงแค่ **ตัวเดียว** แต่ flow ที่ต้องทดสอบต้องใช้หลายเครื่องพร้อมกัน: Campaign Rollout ที่มีเครื่อง
  สำเร็จ/ล้มเหลวปนกัน, Auto Pause (> 5%), Rollback, เครื่องออฟไลน์/หมดเวลารอ (`docs/19` §11 วางแผนไว้ 8 กรณี)
- **เป้าหมาย:** ST/OT สร้าง "กล่องจำลอง" ได้หลายตัวจากในแอป แต่ละตัวทำตัวเป็นกล่องจริง — ดึงงานจาก backend ผ่านช่องทาง
  เดียวกับกล่องจริง (`/device-sync/*`) แสดงขั้นตอนการติดตั้ง แล้วรายงานผลกลับ — ทดสอบได้โดยไม่ต้องมีฮาร์ดแวร์
- เป็นฟีเจอร์ใช้งานจริง ไม่ใช่เครื่องมือ debug — แต่ต้องแยกจากกล่องจริงให้ชัดทุกที่ที่คนเห็น (§4.2)

## 2. ข้อเท็จจริงจากโค้ดปัจจุบัน (สิ่งที่แผนต้องอิง)

| เรื่อง | ของจริงตอนนี้ | ผลต่อแผน |
|---|---|---|
| endpoint ฝั่งกล่อง | `GET /device-sync/:deviceId/jobs` (คืน `serverTime`, `pollAfterSeconds = 30`, `jobs[]`) และ `POST /device-sync/:deviceId/jobs/:jobId/result` body `{ result: 'success' \| 'failed', detail?: string ≤ 500 }` ตอบ 200 `{ accepted }` · ทั้ง controller ใช้ `DeviceApiKeyGuard` | แอปจำลองเรียก 2 ตัวนี้ตรงๆ ไม่ต้องมี endpoint ใหม่สำหรับดึงงาน/รายงานผล |
| ชนิดงาน | `listJobs` คืนเฉพาะ **`payloadType: 'Config'`** · Firmware ยังไม่มาทาง device-sync (`docs/19` ขั้นที่ 2 "ออกแบบเผื่อไว้" ยังไม่ทำ) | **จำลอง OTA Firmware จริงยังทำไม่ได้** (§5) |
| สถานะงานใน backend | `CampaignRolloutTargetStatus` = `pending` / `success` / `failed` / `skipped_offline` + `pulledAt` (เว็บแสดง Waiting = ยังไม่ดึง, Applying = ดึงแล้วรอผล) | ขั้นระหว่างทางแบบ DOWNLOADING / INSTALLING ฯลฯ **ไม่มีที่เก็บใน backend** (§4.4) |
| งานถูกแจกเมื่อไร | เฉพาะ Rollout ที่ `applyMode = 'real'` — โหมดถูกบันทึกตอนปล่อยจาก env `DEVICE_CONFIG_APPLY_MODE` (ทั้งระบบ, ค่าเริ่มต้น `mock`) | backend ต้องอยู่โหมด `real` ตอนปล่อย Rollout กล่องจำลองถึงจะได้งาน (§9 Q5) |
| สถานะเครื่องที่รับงานได้ | ต้อง `installed` (`TARGETABLE_DEVICE_STATUS`) ไม่งั้นงานถูกบันทึก `failed` ทันที | ดูแถวถัดไป |
| เปลี่ยนสถานะเครื่อง | `POST /devices` สร้างเป็น **`registered`** เสมอ และ **ไม่มี endpoint ไหนเปลี่ยนเป็น `installed` หรือ `decommissioned`** (ไม่มี PATCH/DELETE `/devices/*` เลย) | กล่องที่สร้างใหม่ (จำลองหรือจริง) **รับงานไม่ได้** ถ้าไม่แก้ (§9 Q1) |
| สร้างกล่อง | `POST /devices` สิทธิ์ `device-registration` **Create: Admin / SuperAdmin เท่านั้น** (`seed.ts` ระบุชัดว่าไม่ใช่ ST/OT เพราะเป็นงาน fleet management) · บังคับ `deviceId`, `simNumber`, `modelId`, `protocol`, `imei`, `serialNumber`, `blackboxId` · `simNumber` ห้ามซ้ำกับเครื่องที่ยังไม่ decommission (partial unique index) | **ST/OT ไม่มีสิทธิ์** และ Admin/SuperAdmin **ล็อกอิน Mobile ไม่ได้** (`webOnlyRoles`) — ตอนนี้ไม่มีใครสร้างกล่องจากแอปได้เลย (§4.1) |
| API key | ออก**ครั้งเดียว**ใน response ของ `POST /devices` หรือ `POST /devices/:id/rotate-key` (Admin) — ไม่มีทางอ่านซ้ำ | แอปต้องเก็บ key เอง ถ้าหาย (ลบแอป/ล้างข้อมูล) ต้องหมุน key ใหม่ (§4.3) |
| field "จำลอง" | `Device` **ไม่มี** field บอกว่าเป็นกล่องจำลอง | ต้องเพิ่ม (§4.2) |
| ลบกล่อง | ไม่มี endpoint ลบ และ `DeviceConfigOverride` / `DeviceFirmwareOverride` อ้าง `Device.deviceId` แบบ `onDelete: Restrict` | cleanup ต้องออกแบบใหม่ (§9 Q3) |
| เวอร์ชัน Firmware | ไม่มีการเทียบเวอร์ชันที่ไหนเลย (ไม่มี `ALLOW_FIRMWARE_DOWNGRADE` หรือกฎเทียบเท่า) — Campaign / override / ยืนยันติดตั้ง เลือก Firmware ที่อนุมัติแล้วตัวไหนก็ได้ | "downgrade" ไม่ถูกบล็อกอยู่แล้ว แต่ก็ไม่มีกติกา (§6) |
| Mobile ApiClient | Dio ตัวเดียว ตั้ง `Authorization: Bearer <staff JWT>` แบบ global + interceptor ที่ถือว่า 401 ของคำขอที่มี `Authorization` = session หมดอายุ | คำขอฝั่งกล่องต้องใช้ client แยก (§4.3) |
| Audit Log | ผลจากเครื่องไม่ลง AuditLog (`docs/19` §14 ข้อ 1) | การดึงงาน/รายงานผลของกล่องจำลองก็ไม่ลง แต่**การสร้างกล่อง**ลง (เหมือน `POST /devices`) |

## 3. แบ่งเป็น Phase

| Phase | ทำอะไร | พึ่งใคร |
|---|---|---|
| **1** | กล่องจำลองหลายตัว + ป้าย "จำลอง" + ดึงงาน **Config** ผ่าน device-sync + แสดงขั้นตอนในแอป + รายงานผล | **ต้องมีงาน backend เล็กๆ ของ A ก่อน** (§4.1, §4.2) ฝั่ง mobile เริ่มโครงได้ขนานกัน |
| **1b** | จำลอง OTA **Firmware** (ดาวน์โหลด / ตรวจ checksum / ติดตั้ง) | `docs/19` ขั้นที่ 2 (A) — งาน `"Firmware"` ใน `jobs` ยังไม่มี (§5) |
| **2** | จำลองส่ง GPS telemetry | `docs/23` (PR #356) — backend ยังไม่มี endpoint (§7) |

> หมายเหตุ: ขอบเขตที่ B ตั้งไว้ตอนแรกคือ "จำลอง OTA เต็มรูปแบบ (PENDING → … → SUCCESS / FAILED / ROLLED_BACK รวม
> downgrade) ด้วย device-sync ที่มีอยู่ เริ่มได้เลยไม่ต้องรอใคร" — ตรวจกับโค้ดแล้ว **ทำได้เฉพาะงาน Config** และยังต้องมี
> งาน backend ของ A 2 จุด (§4.1–4.2) ส่วน Firmware OTA ต้องรอ `docs/19` ขั้นที่ 2 จึงแยกเป็น Phase 1b

## 4. Phase 1 — กล่องจำลอง (Config)

### 4.1 สร้างกล่องจำลองหลายตัว

ST/OT ไม่มีสิทธิ์ `POST /devices` (§2) → ต้องตัดสินใจกับ A (§9 Q1):

- **(ก) เปิดสิทธิ์ `device-registration` Create ให้ ST/OT** — ใช้ endpoint เดิม แต่ ST/OT จะลงทะเบียน**กล่องจริง**ได้ด้วย
  (ขัดกับเหตุผลใน `seed.ts`) และยังต้องกรอก IMEI / Serial / Blackbox / SIM ซึ่งกล่องจำลองไม่มี
- **(ข) endpoint แยกเฉพาะกล่องจำลอง (เสนอ)** เช่น `POST /devices/simulated` resource ใหม่ (เช่น `simulated-device`
  Create ให้ ST/OT) ที่:
  - บังคับ `isSimulated = true` เสมอ (สร้างกล่องจริงผ่านทางนี้ไม่ได้)
  - ให้ผู้ใช้เลือกแค่ `modelId` + `protocol` (+ ชื่อเล่น) backend สร้าง `deviceId` (เช่น `SIM-0001`) และค่า identity
    ปลอม (`simNumber` / `imei` / `serialNumber` / `blackboxId`) ที่ไม่ชนกับของจริงเอง
  - สร้างเป็น **`installed`** ทันที (กล่องจำลองไม่มีขั้นติดตั้งหน้างาน) — ไม่งั้นรับงานไม่ได้ (§2)
  - คืน API key ครั้งเดียวเหมือน `register()` · บันทึก `createdBy` (ใครสร้าง — ใช้กับโควตา/cleanup)
  - เขียน AuditLog เหมือน `register()`

**ข้อสังเกตที่เจอระหว่างตรวจ (กระทบกล่องจริงด้วย):** ไม่มี endpoint เปลี่ยนเครื่องเป็น `installed` เลย — กล่อง ESP32
จริงที่จะลงทะเบียนตาม `docs/23` ก็จะค้าง `registered` และรับงานไม่ได้เช่นกัน ควรตัดสินเรื่องนี้พร้อมกัน

### 4.2 field `isSimulated` + ป้าย "จำลอง"

```prisma
// ร่าง — additive (คอลัมน์ใหม่มี default จึงไม่กระทบแถวเดิม)
model Device {
  // ...
  isSimulated  Boolean  @default(false)
  createdBy    String?  // ผู้สร้างกล่องจำลอง (null = กล่องจริง/ของเดิม) — FK ไป User หรือไม่ ตาม §9 Q2
}
```

- **migration additive** ตาม CLAUDE.md · แตะตาราง `Device` → ต้องเช็ค diff ไม่ให้มี `DROP INDEX "Device_simNumber_active_key"`
  หลุดมา (คำเตือนใน `schema.prisma`) · `schema.prisma` ไฟล์ร่วม → `git pull origin main` ก่อนแก้
- เพิ่ม `isSimulated` ใน schema `Device` ของ `openapi.yaml` (`GET /devices`, `GET /devices/:id`) + `redocly lint`
- **ป้าย "จำลอง"** ทุกที่ที่แสดงกล่อง: Device Search / Device Detail ทั้ง Mobile และ **Web** (A) · รายชื่อเครื่องใน
  Campaign / Rollout (Web) · Mobile ใช้ `AppBadge` tone `info` ข้อความ "จำลอง" ข้างเลขเครื่อง (คำไทยเพราะ Web ไม่มีคู่เทียบ
  — `docs/22` §6)
- **คำถามที่ตามมา (§9 Q4):** กล่องจำลองควรเลือกเป็นเป้าหมาย Campaign ได้ปะปนกับกล่องจริงไหม หรือต้องติ๊กเลือกเอง /
  แยก Campaign · นับในตัวเลข Dashboard ไหม

### 4.3 Mobile: "ทำตัวเป็นกล่อง"

ตามข้อกำหนดเครื่องใน `docs/19` §4.4 ทุกข้อ:

- **client แยกจาก staff:** Dio อีกตัวที่**ไม่มี** `Authorization` และใส่ `X-Device-Api-Key` ต่อคำขอ — กันไม่ให้ 401 ของ key
  กล่องไปทำให้ interceptor เข้าใจว่า session ของช่างหมดอายุ และกันไม่ให้ JWT ของช่างหลุดไปกับคำขอของกล่อง · staff
  token ยังใช้คุยกับ backend ตามปกติ (สร้าง/ดูรายการกล่องจำลอง ฯลฯ)
- **เก็บ API key ต่อกล่อง** ใน `flutter_secure_storage` (ตัวเดียวกับที่เก็บ token อยู่แล้ว) key ตาม `deviceId` · ล้างเมื่อ
  logout หรือไม่ → §9 Q6 (เสนอ: เก็บผูกกับผู้ใช้ ล้างเมื่อ logout เหมือน token — แต่จะทำให้ต้องหมุน key ใหม่ทุกครั้ง)
- **ดึงงาน** `GET /device-sync/:id/jobs` ทุก `pollAfterSeconds` (30 วิ) ต่อกล่องที่ "เปิดใช้งาน" · error / 5xx → รอนานขึ้น
  30 → 60 → 120 วิ ไม่เกิน 5 นาที · **401 → หยุดกล่องนั้นและแจ้งผู้ใช้** ไม่ยิงซ้ำ
- **ทำงานเฉพาะตอนแอปเปิดอยู่ (foreground)** — Android/iOS ไม่ให้ poll ทุก 30 วิในพื้นหลังอย่างน่าเชื่อถือ ปิดแอป = กล่อง
  "ดับ" (ใช้ทดสอบกรณีเครื่องออฟไลน์/หมดเวลารอได้พอดี — `docs/19` §14 ข้อ 7)
- ทำทีละงานตามลำดับใน `jobs` · รายงานผล `POST .../result` ส่งซ้ำได้จนได้ 200 (ไม่ว่า `accepted` เป็นอะไร)
- **โหมดผลลัพธ์** (ตาม `docs/19` §8): กดเอง (สำเร็จ / ล้มเหลว + ข้อความ) และอัตโนมัติ (ตั้งอัตราล้มเหลว % + หน่วงเวลาสุ่ม)
- ผูกกับ online/offline ที่มีอยู่แล้ว: ทุกคำขอที่ผ่าน guard อัปเดต `Device.lastSeenAt` เอง

### 4.4 ขั้นตอนการติดตั้งที่แสดง (Config)

ขั้นที่ B ต้องการ (PENDING → DELIVERED → ACKNOWLEDGED → DOWNLOADING → VALIDATING → INSTALLING → REBOOTING → SUCCESS /
FAILED / ROLLED_BACK) เทียบกับสิ่งที่ backend รู้จริงตอนนี้:

| ขั้นในแอปจำลอง | backend เห็นอะไร | หมายเหตุ |
|---|---|---|
| PENDING | target `pending`, `pulledAt = null` (เว็บ: Waiting) | ยังไม่ดึง |
| DELIVERED | `pulledAt` ถูกตั้งตอน `GET /jobs` (เว็บ: Applying) | |
| ACKNOWLEDGED · DOWNLOADING · VALIDATING · INSTALLING · REBOOTING | **ไม่มี** — ยัง Applying | แสดงในแอปอย่างเดียว หน่วงเวลาแต่ละขั้นให้สมจริง (ไม่ SUCCESS ทันที) · สำหรับ Config "DOWNLOADING" คือได้ค่ามาใน `jobs` แล้ว ขั้นนี้จึงเป็นแค่ภาพ |
| SUCCESS / FAILED | `POST .../result` `success` / `failed` (+ `detail` บอกว่าล้มที่ขั้นไหน เช่น "VALIDATING: …") | |
| ROLLED_BACK | Operation กด Rollback → backend สร้าง **Rollout ใหม่ด้วย Config เดิม** → กล่องได้งานใหม่ใน `jobs` | ไม่ใช่สถานะของงานเดิม — กล่องจำลองเห็นเป็นงานใหม่ แอปแสดงว่า "ย้อนกลับ" ได้จาก `CampaignRollout.isRollback` ถ้า backend ส่งมา (ตอนนี้ไม่ส่ง → §9 Q7) |

ถ้าต้องการให้ **เว็บเห็นขั้นระหว่างทาง** ด้วย ต้องเพิ่มของ backend (A) เช่น endpoint รายงานความคืบหน้า
`POST /device-sync/:id/jobs/:jobId/progress` + field `progressStage` ที่ target → §9 Q7 (ไม่จำเป็นสำหรับ Phase 1)

## 5. Phase 1b — จำลอง OTA Firmware (รอ `docs/19` ขั้นที่ 2)

- ตอนนี้ Firmware **ไม่ได้ผ่าน device-sync**: Rollout ของ Firmware ทำงานแบบเดิม (backend apply ให้ทันที — `docs/19` §1)
  และการติดตั้งจริงเป็นแค่ช่างกด "ยืนยันติดตั้ง Firmware" (attestation, `confirmFirmwareInstall()` — deviation จาก
  Design PDF §10.2–10.3 โดยตั้งใจ) · Firmware Rollback = `MockFirmwareRollbackExecutor` สลับพาร์ทิชัน A/B ตอนอนุมัติ
- `docs/19` §9 ออกแบบเผื่อไว้แล้ว: งานชนิด `"Firmware"` ใน `jobs` (`firmwareId`, `version`, `downloadUrl` presigned จาก
  MinIO, `checksumSha256`, `sizeBytes`, `expiresAt`) + env `DEVICE_FIRMWARE_APPLY_MODE` + รายงานผลด้วย endpoint เดิม
- เมื่อ A ทำขั้นที่ 2 แล้ว แอปจำลองต่อยอดได้ทันที: ดาวน์โหลดไฟล์จริง (DOWNLOADING มีความหมายจริง), ตรวจ checksum
  (VALIDATING จริง), INSTALLING / REBOOTING จำลอง, รายงานผล — **ขอให้ A ประเมินว่าขั้นที่ 2 จะเริ่มเมื่อไร** (§9 Q8)

## 6. Downgrade (ย้อนเวอร์ชัน)

- **ไม่มี `ALLOW_FIRMWARE_DOWNGRADE` หรือกลไกเทียบเท่าใน backend นี้** — ไม่มีการเทียบเวอร์ชันที่ไหนเลย Operation เลือก
  Firmware ที่อนุมัติแล้วรุ่นไหนก็ได้ ระบบจึงไม่ได้บล็อก downgrade แต่ก็ไม่ได้ "รองรับ" แบบมีกติกา
- **Config:** "ย้อน" = Rollback ของ Campaign (สร้าง Rollout ใหม่จาก Config รอบก่อน — ทำงานในโหมด `real` แล้วตาม
  `docs/19` §3.1) กล่องจำลองรับได้ใน Phase 1 เลย
- **Firmware:** ขึ้นกับ Phase 1b · ถ้าต้องการกติกา (เช่น ห้ามเวอร์ชันต่ำกว่าเว้นแต่ติ๊กยืนยัน) ต้องออกแบบเพิ่ม → §9 Q8

## 7. Phase 2 — จำลองส่ง GPS telemetry (รอ `docs/23`)

- เริ่มได้**ก็ต่อเมื่อ** A ตอบคำถามใน `docs/23_GPS_Telemetry_Integration_Plan.md` (PR #356) และ backend มี endpoint รับ
  telemetry จริงแล้ว
- แนวคิดคร่าวๆ: กล่องจำลองส่งพิกัดตามเส้นทางสมมติทุก N วินาทีด้วย API key ตัวเดียวกับ Phase 1 — รายละเอียดออกแบบตอนนั้น

## 8. นอกขอบเขต

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ `schema.prisma`, ไม่สร้าง endpoint, ไม่แก้โค้ด Mobile/Web
- **Phase 1 ไม่เกี่ยวกับ `docs/23` เลย** — คนละเรื่องกัน (Phase 1 = ดึงงาน Config ผ่าน device-sync ที่มีอยู่, `docs/23` =
  รับ telemetry ที่ยังไม่มี) ทำขนานกันได้ ยกเว้นข้อสังเกตเรื่องสถานะ `installed` ใน §4.1 ที่กระทบทั้งคู่
- ไม่แตะ `docs/22` (UI redesign) — หน้าจอของกล่องจำลองจะใช้ design system v2 ตามปกติ
- จะเปิด PR implementation แยก (backend ของ A / mobile ของ B) หลังตกลง §9

## 9. คำถามเปิดถึง A

**3 ข้อแรกขอคำตอบก่อนเริ่ม Phase 1**

**Q1 — ใครสร้างกล่องจำลองได้ และผ่านทางไหน:** ST/OT ไม่มีสิทธิ์ `POST /devices` (Admin/SuperAdmin เท่านั้น ซึ่งเข้า Mobile
ไม่ได้)
- (ก) เปิดสิทธิ์ `device-registration` Create ให้ ST/OT
- (ข) endpoint แยก เช่น `POST /devices/simulated` บังคับ `isSimulated`, สร้างค่า identity ปลอมเอง, สร้างเป็น `installed` (เสนอ)
- พ่วง: กล่องที่ลงทะเบียนใหม่ค้าง `registered` และไม่มี endpoint เปลี่ยนเป็น `installed` — ควรแก้แบบไหน (กระทบกล่องจริงใน
  `docs/23` ด้วย)

**Q2 — จำกัดจำนวนกล่องจำลองไหม:** ต่อคน (เช่น ≤ 10) / ต่อทีม / ไม่จำกัด — ถ้าจำกัดต่อคนต้องเก็บ `createdBy` (FK ไป `User`
หรือ string)

**Q3 — cleanup:** ลบอัตโนมัติหลังไม่ใช้งาน N วัน (เช่น 30 วัน นับจาก `lastSeenAt`) หรือให้ผู้สร้างลบเอง — ตอนนี้**ไม่มี
endpoint ลบหรือ decommission เลย** และ override อ้าง Device แบบ `Restrict` → ลบจริง (cascade ประวัติ Rollout/override) หรือ
แค่เปลี่ยนเป็น `decommissioned` + ซ่อนจากรายการ

**ถามระหว่างรีวิวได้**

**Q4 — กล่องจำลองในเป้าหมาย Campaign / Dashboard:** ปะปนกับกล่องจริงได้ไหม ควรมีตัวกรอง "ไม่รวมกล่องจำลอง" เป็นค่าเริ่มต้น
หรือไม่ · นับในตัวเลข Dashboard ไหม

**Q5 — โหมด `mock` / `real`:** งานแจกเฉพาะ Rollout ที่ปล่อยตอน `DEVICE_CONFIG_APPLY_MODE=real` (ทั้งระบบ) — ถ้าจะให้กล่อง
จำลองใช้ได้ตลอดโดยไม่เปลี่ยน env ต้องเปลี่ยนเป็นโหมดต่อเครื่อง (เช่น กล่อง `isSimulated` ได้งานแบบ `real` เสมอ แม้ Rollout
ปล่อยตอน `mock`) หรือยอมรับว่าต้องตั้ง `real` ตอนทดสอบ

**Q6 — API key ของกล่องจำลองในเครื่อง:** ล้างตอน logout ไหม · ถ้าหาย (ลบแอป) ให้ ST/OT หมุน key ใหม่ของกล่อง**ตัวเอง**ได้ไหม
(ตอนนี้ `rotate-key` เป็น Admin เท่านั้น)

**Q7 — ให้เว็บเห็นขั้นระหว่างทาง:** ต้องการ endpoint `progress` + field ขั้นปัจจุบันที่ target ไหม (ไม่จำเป็นสำหรับ Phase 1) ·
และส่ง `isRollback` ของ Rollout มาใน `jobs` เพื่อให้แอปแสดง ROLLED_BACK ได้ไหม

**Q8 — Firmware:** `docs/19` ขั้นที่ 2 จะเริ่มเมื่อไร · ต้องการกติกา downgrade ไหม
