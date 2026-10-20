# แผนฟีเจอร์ "กล่องจำลอง" ในแอป Mobile

> **สถานะ:** แผนเพื่อขอความเห็น — **ยังไม่มีโค้ดใน PR นี้** · ร่าง 20 ต.ค. 2569 โดย B (kittiphong) · ปรับรอบ 2 วันเดียวกัน:
> ส่วน backend (§4.1) เขียนเป็นข้อเสนอที่ชัดเจนให้ A คอมเมนต์ปรับ เหลือคำถามเปิด 3 ข้อที่เป็นเรื่อง policy (§9)
> · รอ A (paveekornkwork-dev — เจ้าของ `device` / `device-sync` module) ก่อนเริ่ม implement
>
> **ต่อยอดจาก `docs/19_Device_Pull_Test_Proposal.md` §8 "แอปจำลองกล่อง (B)"** ซึ่งตกลงไว้แล้ว (B ตอบ 15 ต.ค.) ว่าเป็น
> **โหมดหนึ่งในแอปเดิม** ให้ผู้ทดสอบกรอก URL / Device ID / API key เอง ดึงงาน Config แล้วกดผลเอง (หรืออัตโนมัติ)
> เอกสารนี้ขยายเป็นฟีเจอร์ที่ ST/OT ใช้ได้จริง: สร้างกล่องจำลองเองหลายตัว มีป้าย "จำลอง" แสดงขั้นตอนการติดตั้งแบบละเอียด
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `cec3779` — `backend/src/device-sync/*`, `backend/src/device/*`,
> `backend/src/device-model/*`, `backend/src/campaign/campaign-rollout.service.ts`, `backend/prisma/schema.prisma`,
> `backend/prisma/seed.ts`, `docs/architecture/RBAC_Matrix.md`, `mobile/lib/core/api/api_client.dart`, `mobile/lib/core/auth/*`

---

## 1. บริบทและเป้าหมาย

- ตอนนี้มีกล่อง ESP32 จริงแค่ **ตัวเดียว** แต่ flow ที่ต้องทดสอบต้องใช้หลายเครื่องพร้อมกัน: Campaign Rollout ที่มีเครื่อง
  สำเร็จ/ล้มเหลวปนกัน, Auto Pause (> 5%), Rollback, เครื่องออฟไลน์/หมดเวลารอ (`docs/19` §11 วางไว้ 8 กรณี)
- **เป้าหมาย:** ST/OT สร้าง "กล่องจำลอง" ได้หลายตัวจากในแอป แต่ละตัวทำตัวเป็นกล่องจริง — ดึงงานผ่านช่องทางเดียวกับกล่องจริง
  (`/device-sync/*`) แสดงขั้นตอนการติดตั้ง แล้วรายงานผลกลับ — ทดสอบได้โดยไม่ต้องมีฮาร์ดแวร์
- เป็นฟีเจอร์ใช้งานจริง ไม่ใช่เครื่องมือ debug — แต่ต้องแยกจากกล่องจริงให้ชัดทุกที่ที่คนเห็น (§4.1.2, §4.2)

## 2. ข้อเท็จจริงจากโค้ดปัจจุบัน

| เรื่อง | ของจริงตอนนี้ | ผลต่อแผน |
|---|---|---|
| endpoint ฝั่งกล่อง | `GET /device-sync/:deviceId/jobs` (คืน `serverTime`, `pollAfterSeconds = 30`, `jobs[]`) และ `POST /device-sync/:deviceId/jobs/:jobId/result` body `{ result: 'success' \| 'failed', detail?: string ≤ 500 }` ตอบ 200 `{ accepted }` (ส่งซ้ำได้) · ทั้ง controller ใช้ `DeviceApiKeyGuard` (`X-Device-Api-Key` เทียบ `Device.apiKeyHash` ของ `:deviceId`) | ใช้ 2 ตัวนี้ตรงๆ **ไม่ต้องมี endpoint ดึงงาน/รายงานผลใหม่** |
| ชนิดงาน | `listJobs` คืนเฉพาะ **`payloadType: 'Config'`** · Firmware ยังไม่มาทาง device-sync (`docs/19` ขั้นที่ 2 "ออกแบบเผื่อไว้" ยังไม่ทำ) — Rollout ของ Firmware ยัง apply ให้ทันทีแบบเดิม การติดตั้งจริงคือช่างกด "ยืนยันติดตั้ง Firmware" (attestation) | **จำลอง OTA Firmware ผ่าน device-sync ยังทำไม่ได้** → Phase 1b (§5) |
| สถานะงานใน backend | `CampaignRolloutTargetStatus` = `pending` / `success` / `failed` / `skipped_offline` + `pulledAt` (เว็บแสดง Waiting = ยังไม่ดึง, Applying = ดึงแล้วรอผล) | ขั้นระหว่างทาง (ACKNOWLEDGED … REBOOTING) **ไม่มีที่เก็บใน backend** — แสดงในแอปอย่างเดียว (§4.2.4) |
| งานถูกแจกเมื่อไร | เฉพาะ Rollout ที่ `applyMode = 'real'` — บันทึกตอนปล่อยจาก env `DEVICE_CONFIG_APPLY_MODE` (ทั้งระบบ, ค่าเริ่มต้น `mock`) | ตอนทดสอบต้องปล่อย Rollout ขณะ backend เป็น `real` (§4.1.6) |
| สถานะเครื่องที่รับงานได้ | ต้อง `installed` ไม่งั้นงานถูกบันทึก `failed` ทันที | ดูแถวถัดไป |
| เปลี่ยนสถานะ / ลบเครื่อง | `POST /devices` สร้างเป็น **`registered`** เสมอ · **ไม่มี endpoint เปลี่ยนเป็น `installed` / `decommissioned` และไม่มี endpoint ลบหรือ revoke key** (ไม่มี PATCH/DELETE `/devices/*` เลย มีแค่ `rotate-key` ของ Admin ที่ออก key ใหม่ทับ) | กล่องจำลองต้องสร้างเป็น `installed` และต้องมี endpoint ลบใหม่ (§4.1.3, §4.1.4) |
| สร้างกล่อง | `POST /devices` สิทธิ์ `device-registration` **Create: Admin / SuperAdmin เท่านั้น** (`seed.ts`: "ไม่ใช่ … ST/OT" เพราะเป็นงาน fleet management) · บังคับ `deviceId`, `simNumber`, `modelId`, `protocol`, `imei`, `serialNumber`, `blackboxId` · `simNumber` ห้ามซ้ำกับเครื่องที่ยังไม่ decommission (partial unique index) | **ST/OT ไม่มีสิทธิ์** และ Admin/SuperAdmin **เข้า Mobile ไม่ได้** (`webOnlyRoles`) — ตอนนี้ไม่มีใครสร้างกล่องจากแอปได้เลย (§4.1.3) |
| รุ่นอุปกรณ์ | ตั้งแต่ #351 `DeviceModel.supportedProtocols` มีได้ **ค่าเดียว** (`ArrayMaxSize(1)`) | endpoint ใหม่รับแค่ `modelId` แล้ว derive `protocol` เอง |
| สิทธิ์ใน backend | ทุก endpoint ของ staff ใช้ `@RequirePermission(resource, action)` + grant ใน `seed.ts` (ไม่มี guard ตาม role ตรงๆ) | "จำกัดให้ ST/OT" = resource ใหม่ + grant ให้ ST/OT (§4.1.3) |
| API key | ออก**ครั้งเดียว**ใน response — ไม่มีทางอ่านซ้ำ | แอปเก็บเอง (§4.2.3) |
| field "จำลอง" | `Device` **ไม่มี** | เพิ่ม `isSimulated` (§4.1.1) |
| เวอร์ชัน Firmware | ไม่มีการเทียบเวอร์ชันที่ไหนเลย — **ไม่มี `ALLOW_FIRMWARE_DOWNGRADE` หรือกฎเทียบเท่า** | §6 |
| Mobile ApiClient | Dio ตัวเดียว ตั้ง `Authorization: Bearer <staff JWT>` แบบ global + interceptor ที่ถือว่า 401 ของคำขอที่มี `Authorization` = session หมดอายุ | คำขอฝั่งกล่องต้องใช้ client แยก (§4.2.3) |

## 3. แบ่งเป็น Phase

| Phase | ทำอะไร | พึ่งใคร |
|---|---|---|
| **1** | กล่องจำลองหลายตัว + ป้าย "จำลอง" + ดึงงาน **Config** ผ่าน device-sync + แสดงขั้นตอนในแอป + รายงานผล | backend ตาม §4.1 (โมดูลของ A — ตกลงกันว่าใครทำ) · mobile §4.2 เริ่มโครงได้ขนานกัน |
| **1b** | จำลอง OTA **Firmware** (ดาวน์โหลด / ตรวจ checksum / ติดตั้ง) | `docs/19` ขั้นที่ 2 (A) (§5) |
| **2** | จำลองส่ง GPS telemetry | `docs/23` (PR #356) (§7) |

> **ต่างจากขอบเขตที่ตั้งไว้ตอนแรก:** B ตั้งไว้ว่า "จำลอง OTA เต็มรูปแบบ (PENDING → … → SUCCESS / FAILED / ROLLED_BACK
> รวม downgrade) ด้วย device-sync ที่มีอยู่ เริ่มได้เลยไม่ต้องรอใคร" — ตรวจกับโค้ดแล้ว device-sync แจก**เฉพาะงาน Config**
> และ Phase 1 ยังต้องมีงาน backend ตาม §4.1 ก่อน (สิทธิ์สร้างกล่อง, `isSimulated`, สถานะ `installed`) ส่วน Firmware OTA
> ต้องรอ `docs/19` ขั้นที่ 2 จึงแยกเป็น Phase 1b

## 4. Phase 1 — กล่องจำลอง (Config)

### 4.1 Backend (ข้อเสนอ — ให้ A คอมเมนต์ปรับ)

#### 4.1.1 Schema (additive migration)

```prisma
model Device {
  // ... field เดิมทั้งหมดไม่เปลี่ยน
  // กล่องจำลองที่ ST/OT สร้างจากแอปเพื่อทดสอบ (docs/24) — ตั้งโดย backend เท่านั้น
  // (`POST /devices/simulated`) client กำหนดเองไม่ได้ · กล่องจริงทั้งหมด false
  isSimulated   Boolean  @default(false)
  // ผู้สร้างกล่องจำลอง — ใช้กับ cap ต่อบัญชีและสิทธิ์ลบ · null = กล่องจริง/ของเดิม
  simulatedById String?
  simulatedBy   User?    @relation("SimulatedDeviceCreator", fields: [simulatedById], references: [id], onDelete: SetNull)

  @@index([simulatedById])
}
```

- ทั้งสอง field มี default / nullable → **ไม่กระทบแถวเดิม** (ตามกฎ additive ใน CLAUDE.md) · FK ใหม่ชี้ไป `User` ที่มีอยู่จริง
  ทุกแถวเป็น null ตอน migrate → ไม่มี orphan (ตามกฎ Migration Safety)
- `schema.prisma` เป็นไฟล์ร่วม → `git pull origin main` ก่อนแก้ · migration ที่แตะ `Device` **ต้องเช็ค diff ด้วยตา** ไม่ให้มี
  `DROP INDEX "Device_simNumber_active_key"` หลุดมา (partial index ที่ Prisma ไม่รู้จัก — คำเตือนใน `schema.prisma`)
- deviation จาก `GPS_Data_Dictionary.xlsx` (ตาราง DEVICE ไม่มี field นี้) → ใส่คอมเมนต์เหนือ field ตามกฎ "ห้ามเบี่ยงแบบเงียบๆ"

#### 4.1.2 การแสดงผล `isSimulated`

- เพิ่มใน schema `Device` ของ `openapi.yaml` → `GET /devices`, `GET /devices/:id` คืนค่านี้ (ไม่ต้องมี endpoint ใหม่)
- `GET /devices` เพิ่ม query `isSimulated=true|false` (optional) ให้กรองได้
- **ป้าย "จำลอง"** ทุกที่ที่แสดงกล่อง: Device Search / Device Detail ทั้ง Mobile และ **Web** (A) · รายชื่อเครื่องตอนเลือกเป้าหมาย
  Campaign และหน้า Rollout (Web)

#### 4.1.3 Endpoint ใหม่: `POST /devices/simulated` (ST/OT สร้างกล่องจำลองเอง)

- **สิทธิ์:** resource ใหม่ `simulated-device` action `Create` · grant ใน `seed.ts` ให้ **ST, OT** (+ Admin — SuperAdmin inherit
  อัตโนมัติ) ผ่าน `@RequirePermission('simulated-device', ActionType.Create)` ตาม pattern เดิม · **ไม่แตะ `device-registration`**
  — `POST /devices` ยังเป็น Admin/SuperAdmin เท่านั้นเหมือนเดิม ST/OT จึงสร้าง**กล่องจริง**ไม่ได้
- **body:** `{ modelId: string (uuid), label?: string ≤ 50 }` — ช่างเลือกแค่รุ่น (ให้ได้ Config ที่ตรงรุ่น) + ชื่อเรียกในแอป
  - `protocol` derive จาก `model.supportedProtocols[0]` (รุ่นมีโปรโตคอลเดียวตั้งแต่ #351)
  - `deviceModel` string resolve จาก `model.name` (เหมือน `register()`)
- **backend สร้างให้เอง:**
  - `isSimulated = true`, `simulatedById = req.user.sub` — **ไม่รับจาก body** (`forbidNonWhitelisted` ปฏิเสธอยู่แล้ว)
  - `deviceId` รูปแบบ `SIM-XXXXXX` (สุ่ม, ชนแล้วสุ่มใหม่) — ขึ้นต้นต่างจากกล่องจริงชัดเจน
  - `simNumber` / `imei` / `serialNumber` / `blackboxId` เป็นค่าปลอมที่ขึ้นต้น `SIM-` (ไม่ชนกับ partial unique index ของ
    `simNumber` และไม่ดูเหมือนค่าจริง)
  - **`status = installed` + `installedAt = now()`** — กล่องจำลองไม่มีขั้นติดตั้งหน้างาน และ device-sync แจกงานเฉพาะ `installed`
  - API key: `randomBytes(32)` + bcrypt เหมือน `register()` คืน **`apiKey` ครั้งเดียว** ใน response
- **cap:** กล่องจำลองที่ยังไม่ถูกลบ (`isSimulated && status != decommissioned`) ของผู้สร้างคนนี้ **ไม่เกิน 5** → เกินตอบ **409**
  (ค่าคงที่ใน service ปรับง่าย — §9 Q2)
- **response 201:** `Device` (+ `isSimulated`) + `apiKey` — schema เดียวกับ `RegisterDeviceResponse`
- **AuditLog:** `action: 'register-simulated'` metadata `{ deviceId }` (mirror `register()` — เป็นการกระทำของคน)
- error: 400 validation / 401 / 403 role อื่น / 404 `modelId` ไม่พบ / 409 เกิน cap หรือรุ่น `inactive`

#### 4.1.4 Endpoint ใหม่: `DELETE /devices/simulated/:deviceId` (ลบ + revoke)

ระบบ**ไม่มี** endpoint revoke/ลบเดิมให้ใช้ (§2) จึงเสนอตัวใหม่:

- **สิทธิ์:** resource `simulated-device` action **`Update`** (grant ST, OT, Admin) — enum `ActionType` มีแค่ `Create` / `Read` /
  `Update` / `Approve` / `Override` ไม่มี `Delete` และการลบในข้อเสนอนี้เป็นการเปลี่ยนสถานะ (soft) จึงใช้ `Update` แทนการเพิ่มค่า enum
  **+ เช็คความเป็นเจ้าของใน service:** ต้องเป็น
  `simulatedById === req.user.sub` หรือ role Admin/SuperAdmin — ไม่ใช่ → **404** (ไม่บอกว่ากล่องของคนอื่นมีอยู่ — แบบ IDOR
  Prevention ใน CLAUDE.md ด้วย `updateMany({ where: { deviceId, isSimulated: true, simulatedById } })` + `count === 0` → 404)
- **ไม่ลบแถวจริง (soft):** ตั้ง `status = decommissioned` + **`apiKeyHash = null`** (revoke ทันที — `DeviceApiKeyGuard` ตอบ 401
  ตั้งแต่คำขอถัดไป) · เหตุผล: `CampaignRolloutTarget` / override อ้างเครื่องนี้อยู่ (`onDelete: Restrict`) ประวัติ Rollout ต้องไม่หาย
  และ `decommissioned` ปล่อย `simNumber` จาก partial unique index พอดี
- ลบกล่องจริงผ่าน endpoint นี้ไม่ได้ (`isSimulated: true` อยู่ใน where เสมอ)
- `GET /devices` ซ่อนกล่องจำลองที่ `decommissioned` เป็นค่าเริ่มต้นหรือไม่ → A เลือก (เสนอ: ซ่อน)
- AuditLog `action: 'delete-simulated'` · response 204

#### 4.1.5 `openapi.yaml` (ตาม CLAUDE.md)

- path ใหม่ 2 ตัว (`createSimulatedDevice`, `deleteSimulatedDevice`) `tags: [device]` (tag เดียวกับ `/devices` เดิม) · `security` = `bearerAuth` (inherit global —
  เป็น endpoint ของ staff ไม่ใช่ `deviceApiKey`) · response 4xx ครบตาม §4.1.3–4.1.4
- schema `Device` เพิ่ม `isSimulated` · schema ใหม่ `CreateSimulatedDeviceRequest` · `GET /devices` เพิ่ม query `isSimulated`
- `npx @redocly/cli lint docs/api/openapi.yaml` ก่อน commit
- RBAC_Matrix: แถวใหม่ในตาราง 4.1 + resource `simulated-device` ใน §2

#### 4.1.6 ข้อที่ backend ไม่ต้องแก้ใน Phase 1

- `/device-sync/*` ใช้ได้กับกล่องจำลองทันที (guard ดู `apiKeyHash` + `deviceId` เหมือนกล่องจริง) · `lastSeenAt` online/offline ได้ฟรี
- โหมด `mock`/`real` ไม่แตะ — ตอนทดสอบตั้ง `DEVICE_CONFIG_APPLY_MODE=real` ก่อนปล่อย Rollout ตาม `docs/19` §11

### 4.2 Mobile

#### 4.2.1 หน้ากล่องจำลองของฉัน

- รายการกล่องจำลองที่ตัวเองสร้าง (`GET /devices?isSimulated=true` แล้วกรองตาม `simulatedById` ฝั่งแอป หรือ A เพิ่ม query
  `mine=true`) · ปุ่ม "สร้างกล่องจำลอง" (เลือกรุ่น + ชื่อเรียก → `POST /devices/simulated`) · ปุ่มลบ (`DELETE …`, ยืนยันก่อน)
- เกิน cap → แสดงข้อความจาก 409 · ตำแหน่งในแอปเป็นแท็บ/หน้าไหนตัดสินตอน implement (ใช้ design system v2 ตาม `docs/22`)

#### 4.2.2 ป้าย "จำลอง"

- Device Search / Device Detail ใช้ `AppBadge` tone `info` ข้อความ **"จำลอง"** ข้างเลขเครื่อง (คำไทยเพราะ Web ไม่มีคู่เทียบ —
  `docs/22` §6) · model `Device` ฝั่ง Mobile เพิ่ม `isSimulated` (`?? false` ถ้า backend เก่ายังไม่ส่ง)

#### 4.2.3 "ทำตัวเป็นกล่อง" (ตาม `docs/19` §4.4 ทุกข้อ)

- **client แยกจาก staff:** Dio อีกตัวที่**ไม่มี** `Authorization` และใส่ `X-Device-Api-Key` ต่อคำขอ — กันไม่ให้ 401 ของ key
  กล่องทำให้ interceptor เข้าใจว่า session ของช่างหมดอายุ และ JWT ของช่างไม่หลุดไปกับคำขอของกล่อง · staff token ยังใช้คุยกับ
  backend ตามปกติ (สร้าง/ลบ/ดูรายการ)
- **เก็บ API key ต่อกล่อง** ใน `flutter_secure_storage` (ตัวเดียวกับที่เก็บ token) key ตาม `deviceId` · logout แล้วล้าง (กล่องผูกกับผู้สร้าง)
  · key หาย (ลบแอป / logout) → ลบกล่องแล้วสร้างใหม่ (cap นับเฉพาะที่ยังไม่ลบ จึงไม่ติด)
- **ดึงงาน** `GET /device-sync/:id/jobs` ทุก `pollAfterSeconds` ต่อกล่องที่เปิดใช้งาน · error / 5xx → 30 → 60 → 120 วิ ไม่เกิน
  5 นาที · **401 → หยุดกล่องนั้นและแจ้งผู้ใช้** ไม่ยิงซ้ำ
- **ทำงานเฉพาะตอนแอปเปิดอยู่ (foreground)** — OS ไม่ให้ poll ทุก 30 วิในพื้นหลังอย่างน่าเชื่อถือ · ปิดแอป = กล่อง "ดับ" (ใช้ทดสอบ
  กรณีออฟไลน์/หมดเวลารอได้พอดี — `docs/19` §14 ข้อ 7)
- ทำทีละงานตามลำดับ · รายงานผลส่งซ้ำได้จนได้ 200 (ไม่ว่า `accepted` เป็นอะไร)
- **โหมดผลลัพธ์** (ตาม `docs/19` §8): กดเอง (สำเร็จ / ล้มเหลว + ข้อความ + เลือกขั้นที่ล้ม) และอัตโนมัติ (ตั้งอัตราล้มเหลว % ต่อกล่อง)

#### 4.2.4 ขั้นตอนการติดตั้งที่แสดง (Config)

| ขั้นในแอป | backend เห็นอะไร | หมายเหตุ |
|---|---|---|
| PENDING | target `pending`, `pulledAt = null` (เว็บ: Waiting) | ยังไม่ดึง |
| DELIVERED | `pulledAt` ถูกตั้งตอน `GET /jobs` (เว็บ: Applying) | |
| ACKNOWLEDGED · DOWNLOADING · VALIDATING · INSTALLING · REBOOTING | **ไม่มี** — ยัง Applying | แสดงในแอปอย่างเดียว หน่วงเวลาสุ่มต่อขั้น (เช่น 1–4 วิ) ไม่ SUCCESS ทันที · สำหรับ Config ค่ามากับ `jobs` แล้ว "DOWNLOADING" จึงเป็นแค่ภาพ |
| SUCCESS / FAILED | `POST .../result` `success` / `failed` · `detail` บอกขั้นที่ล้ม เช่น `"VALIDATING: ค่า apn ไม่ถูกต้อง"` | Operation เห็นข้อความนี้บนหน้า Rollout |
| ROLLED_BACK | Operation กด Rollback → backend สร้าง **Rollout ใหม่ด้วย Config รอบก่อน** → กล่องได้งานใหม่ใน `jobs` | ไม่ใช่สถานะของงานเดิม · แอปบอกได้ว่าเป็นงาน rollback ถ้า `jobs` ส่ง `isRollback` ของ Rollout มาด้วย (ตอนนี้ไม่ส่ง — ขอเพิ่มเป็น field ใน `DeviceConfigJob`, additive) |

ถ้าต่อไปต้องการให้**เว็บ**เห็นขั้นระหว่างทางด้วย ต้องเพิ่ม endpoint รายงานความคืบหน้า + field ขั้นปัจจุบันที่ target — ไม่จำเป็นใน
Phase 1 ทำทีหลังได้โดยไม่รื้อของเดิม

## 5. Phase 1b — จำลอง OTA Firmware (รอ `docs/19` ขั้นที่ 2)

- `docs/19` §9 ออกแบบเผื่อไว้แล้ว: งานชนิด `"Firmware"` ใน `jobs` (`firmwareId`, `version`, `downloadUrl` presigned จาก MinIO,
  `checksumSha256`, `sizeBytes`, `expiresAt`) + env `DEVICE_FIRMWARE_APPLY_MODE` + รายงานผลด้วย endpoint เดิม
- เมื่อ A ทำแล้ว แอปจำลองต่อยอดได้ทันที: ดาวน์โหลดไฟล์จริง (DOWNLOADING มีความหมายจริง), ตรวจ checksum (VALIDATING จริง),
  INSTALLING / REBOOTING จำลอง, รายงานผล · ROLLED_BACK ของ Firmware ตอนนี้เป็น `MockFirmwareRollbackExecutor` สลับพาร์ทิชันตอน
  อนุมัติ — ต้องออกแบบใหม่ให้ผ่าน device-sync ตอนทำขั้นที่ 2

## 6. Downgrade (ย้อนเวอร์ชัน)

- **backend นี้ไม่มี `ALLOW_FIRMWARE_DOWNGRADE` หรือกลไกเทียบเท่า** — ไม่มีการเทียบเวอร์ชันที่ไหนเลย Operation เลือก Firmware ที่
  อนุมัติแล้วรุ่นไหนก็ได้ จึงไม่ได้บล็อก downgrade แต่ก็ไม่มีกติกาคุม
- **Config (Phase 1):** "ย้อน" = Rollback ของ Campaign (Rollout ใหม่จาก Config รอบก่อน — ทำงานในโหมด `real` ตาม `docs/19` §3.1)
  กล่องจำลองรับได้เลยตาม §4.2.4
- **Firmware (Phase 1b):** แอปจำลองรับเวอร์ชันต่ำกว่าได้เสมอ (สอดคล้องกับ backend ที่ไม่บล็อก) — ถ้าต้องการกติกา downgrade จริง
  ควรออกแบบที่ backend พร้อมขั้นที่ 2 ไม่ใช่ในแอปจำลอง

## 7. Phase 2 — จำลองส่ง GPS telemetry (รอ `docs/23`)

- เริ่มได้**ก็ต่อเมื่อ** A ตอบคำถามใน `docs/23_GPS_Telemetry_Integration_Plan.md` (PR #356) และ backend มี endpoint รับ telemetry
  จริงแล้ว · แนวคิดคร่าวๆ: กล่องจำลองส่งพิกัดตามเส้นทางสมมติด้วย API key ตัวเดียวกับ Phase 1

## 8. นอกขอบเขต

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ `schema.prisma`, ไม่สร้าง endpoint, ไม่แก้โค้ด Mobile/Web
- **Phase 1 ไม่เกี่ยวกับ `docs/23` เลย** — คนละเรื่องกัน (Phase 1 = งาน Config ผ่าน device-sync ที่มีอยู่, `docs/23` = รับ telemetry
  ที่ยังไม่มี) ทำขนานกันได้
- ข้อสังเกตที่เจอระหว่างตรวจ (ไม่อยู่ในขอบเขต แต่ควรรู้): กล่อง**จริง**ที่ลงทะเบียนผ่าน `POST /devices` ค้าง `registered` และไม่มี
  endpoint เปลี่ยนเป็น `installed` — กล่อง ESP32 จริงตาม `docs/23` ก็จะรับงานผ่าน device-sync ไม่ได้ ควรแก้แยก (กล่องจำลองใน
  เอกสารนี้หลบได้เพราะสร้างเป็น `installed` ตั้งแต่แรก)
- ไม่แตะ `docs/22` (UI redesign) — หน้าจอกล่องจำลองใช้ design system v2 ตามปกติ
- จะเปิด PR implementation แยก (backend / mobile) หลังตกลง §9 และตกลงว่าใครทำส่วน backend (โมดูลของ A)

## 9. คำถามเปิดถึง A (policy)

**Q1 — endpoint แยกหรือใช้ตัวเดิม:** เห็นด้วยกับ `POST /devices/simulated` + resource `simulated-device` แยกจาก `POST /devices`
(§4.1.3) ไหม หรืออยากใช้ `POST /devices` เดิมแล้วเพิ่ม `isSimulated` ใน body — ถ้าใช้ตัวเดิม ต้องเปิด `device-registration` Create
ให้ ST/OT ซึ่งจะทำให้ ST/OT ลงทะเบียน**กล่องจริง**ได้ด้วย (ขัดกับเหตุผลใน `seed.ts`) และต้องกรอก IMEI/Serial/Blackbox/SIM ที่กล่อง
จำลองไม่มี

**Q2 — cap ต่อบัญชี:** เสนอ **5 กล่องที่ยังไม่ลบ** ต่อผู้ใช้ — เหมาะไหม หรือปรับเป็นค่าอื่น / ต่อทีม

**Q3 — cleanup:** ลบอัตโนมัติ (เช่น job ตามรอบ decommission + revoke กล่องจำลองที่ `lastSeenAt` เก่ากว่า **30 วัน** หรือไม่เคยติดต่อ
เลยภายใน 30 วันหลังสร้าง) หรือให้ลบมือ (§4.1.4) อย่างเดียว

---

## 10. Token Management สำหรับ Gateway Connection

> **สถานะของหัวข้อนี้: ตัดสินใจแล้ว (B, 20 ต.ค. 2569) และไม่ขึ้นกับโค้ดตัวอย่างของ A**
> เพิ่มหลังจากตกลงกับ A ใน PR #357 ว่าจะเปลี่ยนทิศทางเป็น "มือถือต่อ ws-gateway ของพี่เลี้ยงตรง" (มือถือเป็นกล่องอีกตัว
> ในระบบ `arduino_gps`) · **หัวข้ออื่นของเอกสาร** (flow การเชื่อม Gateway, mobile WebSocket client, OTA lifecycle) **ยังรอ
> โค้ดตัวอย่างจาก A** แล้วจะเขียนใหม่ทั้งฉบับทีหลัง เนื้อหาเดิมใน §1–§9 ยังเป็นแผนรุ่นก่อน (`/device-sync` + กล่องจำลองหลายตัว)
>
> หัวข้อนี้ใช้แทนสองจุดเดิมเฉพาะเรื่อง token ของ Gateway: การเก็บ key ใน `flutter_secure_storage` (§4.2) และการให้ผู้ทดสอบกรอก
> key เอง (`docs/19` §8)

### 10.1 ที่มาของ token

- ออก token ให้ device_id เฉพาะ **`mobile-sim-001`** ผ่าน Admin API ของพี่เลี้ยง **ไม่ใช้รหัสร่วมของ auto-register**
  - ตรวจข้อมูลจริงแล้ว (20 ต.ค.): กล่องจริง `BOX-0001` ไม่ได้มาจาก auto-register มี `DEVICE_REGISTER` โดย `admin` ใน audit
    ของทั้งสองเซอร์วิส และ record ไม่มี `auto_registered`
- ต้องลงทะเบียน **ทั้ง 2 เซอร์วิสด้วย token เดียวกัน** (สองระบบไม่ sync กันเอง แบบเดียวกับ `BOX-0001`):
  - `delivery-server` `POST /api/admin/devices` (ระบุ `hardware_model` + `schema_version` ที่มี schema อยู่จริง) ถ้าไม่ส่ง
    `token` server จะสร้างให้ (32 ตัวอักษร) และตอบกลับเป็น plaintext **ครั้งเดียว**
  - `ws-gateway` `POST /api/admin/devices` ส่ง `token` ค่าเดียวกันเข้าไป
- ต้องเป็น device_id ของมือถือเอง ห้ามใช้ `BOX-0001` เพราะ gateway เก็บได้ 1 connection ต่อ device_id
  connection ใหม่จะเตะ connection เดิมออก (`close(4000, 'replaced by new connection')`)

### 10.2 เก็บที่ backend ของทีมเรา ไม่เก็บในตัวแอป

- **config entry ใหม่ ไม่ใช้ตาราง `Device` เดิม:** token นี้เป็น credential ของระบบภายนอก ไม่ใช่กล่องของเรา
  - backend ยังไม่มีตาราง setting หรือ util เข้ารหัสอยู่เลย จึงต้องเพิ่มใหม่ (additive migration) ชื่อและรูปแบบจะตกลงตอน
    implement เช่น `IntegrationCredential { key @unique, externalDeviceId, encryptedToken, iv, authTag, updatedById, updatedAt }`
    ใช้ `key` เป็น `mentor-gateway` ไว้แยกกับ credential ภายนอกตัวอื่นในอนาคต
- **เข้ารหัสแบบถอดกลับได้ (encrypt at rest):** เช่น AES-256-GCM ด้วย key จาก env var ใหม่ (ห้าม commit ค่าเข้า repo)
  - ต่างจาก `Device.apiKeyHash` ของกล่องจริงที่เป็น bcrypt (hash ทางเดียว) เพราะ backend ของเราแค่ **ตรวจ** key ที่กล่อง
    ส่งมา แต่ token นี้มือถือต้องเอา **ค่าจริง** ไปยิงออกไปที่ ws-gateway
- **ตั้งและดูค่าได้เฉพาะ Admin / SuperAdmin** ตาม pattern เดิม (`@RequirePermission(resource, ActionType)` + grant ใน `seed.ts`)
  เช่น resource ใหม่ `simulator-gateway-config` action `Read` / `Update` grant ให้ Admin (SuperAdmin สืบทอด)
  - Admin / SuperAdmin เข้า Mobile ไม่ได้ (`webOnlyRoles`) จึงตั้งค่าผ่าน Web เท่านั้น
  - การตั้งหรือเปลี่ยน token เป็น mutation ต้องลง `AuditLog` (ไม่ใส่ค่า token ใน log) หน้า Web ควรแสดงแบบปิดบังเป็นค่าเริ่มต้น

### 10.3 Endpoint ใหม่ให้มือถือขอ token

- ยืนยันตัวตนด้วย **staff JWT ปกติของมือถือ** (`JwtAuthGuard`) ไม่ใช่ `DeviceApiKeyGuard` / `X-Device-Api-Key`
- จำกัดสิทธิ์ด้วย permission ใหม่ของฟีเจอร์นี้ เช่น resource `simulator-gateway-token` action `Read` grant ให้ **ST / OT**
- backend ถอดรหัสแล้วตอบ token จริง เช่น `{ "deviceId": "mobile-sim-001", "token": "…" }` พร้อม header
  `Cache-Control: no-store` ถ้ายังไม่ได้ตั้งค่าตอบ 404
- **path:** ที่ร่างไว้คือ `GET /devices/simulator-gateway-token` แต่ใน `device.controller.ts` มี `@Get(':deviceId')` อยู่แล้ว
  path นี้จะชนกับ route นั้น (ถูกตีความเป็น deviceId) จึงเสนอแยก path เช่น `GET /simulator/gateway-token` หรือถ้าจะอยู่ใต้
  `/devices` ต้องประกาศ route นี้ก่อน `:deviceId`
- ตอน implement ต้องอัปเดต `openapi.yaml` (operationId, tag, 401/403/404) และ `RBAC_Matrix.md` ตามกฎใน `CLAUDE.md`

### 10.4 ฝั่งมือถือไม่เก็บ token ถาวร

- ขอ token จาก backend ทุกครั้งที่เริ่มใช้ฟีเจอร์ simulator และ cache ไว้ใน memory ระหว่าง session เดียวเท่านั้น
- ทิ้งเมื่อปิดแอปหรือ logout **ไม่ใช้ `flutter_secure_storage`** หรือที่เก็บถาวรอื่นของเครื่อง และไม่ log ค่า token
- ถ้า ws-gateway ปฏิเสธ (401 ตอน upgrade) ให้ขอ token จาก backend ใหม่ 1 ครั้ง เผื่อเพิ่งเปลี่ยน token ถ้ายังไม่ผ่านให้หยุดและแจ้งผู้ใช้

### 10.5 ข้อดีและข้อจำกัด

**ข้อดี**
- เพิกถอนหรือเปลี่ยน token ได้จากที่เดียว (แก้ที่ backend ของเรา) ไม่ต้องไล่แก้ในเครื่องผู้ใช้
- ไม่มี token ค้างอยู่ในเครื่องมือถือที่อาจหายหรือถูกแครก

**ข้อจำกัดที่ต้องรู้**
- ระหว่างใช้งาน token ยังเป็น plaintext อยู่ใน memory ของแอป และผู้ที่มีสิทธิ์ ST/OT ขอค่าได้ทุกคน แนวทางนี้ลดการค้างของ
  token ในเครื่อง ไม่ได้ซ่อน token จากผู้ใช้ที่มีสิทธิ์
- การเปลี่ยน token ต้องทำ 3 ที่ให้ตรงกัน: `delivery-server`, `ws-gateway` (พี่เลี้ยง) และค่าที่เก็บใน backend ของเรา
- device_id เดียว (`mobile-sim-001`) ต่อ gateway ได้ทีละ 1 เครื่อง ถ้าช่าง 2 คนเปิด simulator พร้อมกันจะเตะกันเอง
  (ดู §10.1) ถ้าต้องให้หลายเครื่องใช้พร้อมกัน ต้องออก device_id + token แยกต่อเครื่อง ซึ่งยังไม่อยู่ในขอบเขตตอนนี้
