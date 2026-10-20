# แผนรับ GPS Telemetry จากกล่อง ESP32 เข้า Backend

> **สถานะ:** แผนเพื่อขอความเห็น — **ยังไม่มีโค้ดใน PR นี้** · ร่าง 20 ต.ค. 2569 โดย B (kittiphong)
> · รอ A (paveekornkwork-dev — ผู้เขียน `device-sync` module, #330/#337, และ `DeviceApiKeyGuard`,
> docs/14) ตอบคำถามเปิดใน §10 ก่อนเริ่ม implement
>
> **ปรับรอบ 2 (20 ต.ค. 2569):** A ตอบคำถามใน PR แล้ว และชี้ว่ากล่องส่ง telemetry โดยไม่มี auth header เลย
> `DeviceApiKeyGuard` เดิมจึงใช้ไม่ได้ · พี่เลี้ยงให้ B ตัดสินใจ B เลือกทาง (ก) ฝัง key ใน URL ที่ตั้งผ่าน Config
> แบบเป็น **path parameter** (ไม่ใช่ query — ข้อจำกัดของระบบพี่เลี้ยง) — เขียน §7 ใหม่และแก้จุดที่เกี่ยวข้อง
> (§2, §4, §5, §8, §10) · คำตอบของ A ข้ออื่นยังไม่ได้ใส่ในรอบนี้
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `cec3779` — `backend/prisma/schema.prisma` (model `Device`),
> `backend/src/device-sync/*`, `backend/src/common/guards/device-api-key.guard.ts`,
> `backend/src/device/*`, `backend/src/main.ts`, `docs/14_Device_Sync_Proposal.md` §3.2

---

## 1. บริบทและเป้าหมาย

- พี่เลี้ยงส่งโปรเจกต์ตัวอย่าง **`arduino_gps`** มาให้ เป็นระบบจัดการกล่อง ESP32 GPS มี 3 เซอร์วิส
  (`ws-gateway`, `delivery-server`, `data-monitor`) ตอนนี้กล่องส่ง GPS ไปที่ `data-monitor` ซึ่งเป็นเซอร์วิส
  จำลองสำหรับทดสอบ (แสดงผลสดในเว็บ) ที่ `http://192.168.1.43:320/api/gps`
- **เป้าหมาย:** ให้กล่องส่ง GPS telemetry และ event แจ้งเตือนเข้า backend ของโปรเจกต์นี้โดยตรงแทน
  `data-monitor`
- **ต่างจากดีไซน์เดิมโดยตั้งใจ:** ระบบนี้ออกแบบมาเป็น Config & Firmware Center เท่านั้น telemetry ถูกวางไว้
  ที่ระบบเดิม (`docs/planning/01_GPS_Build_Reference.md` ข้อ 187 — "กล่องจะส่ง Telemetry เข้าระบบเดิม")
  และในโค้ดปัจจุบันก็บันทึกไว้ชัดว่า "ระบบนี้ไม่มีช่องทางรับ telemetry จากอุปกรณ์เลย"
  (`schema.prisma` เหนือ `enum CampaignRolloutStatus`, RBAC_Matrix แก้ครั้งที่ 59 — Auto-rule 4 ข้อใน
  Design PDF §11.2 ถูก defer เพราะเหตุนี้) — **พี่เลี้ยงยืนยันแล้วว่าให้รับ telemetry ใน backend นี้**
  ถ้าแผนนี้ผ่าน ต้องอัปเดตเอกสาร/คอมเมนต์เหล่านั้นให้ตรงด้วย (§9)

## 2. สิ่งที่มีอยู่แล้วใน backend (ข้อเท็จจริงจากโค้ด)

| เรื่อง | มีอะไรอยู่แล้ว | ผลต่อแผนนี้ |
|---|---|---|
| ช่องทางที่อุปกรณ์เรียกเอง | `device-sync` module: `GET /device-sync/:deviceId/jobs`, `POST /device-sync/:deviceId/jobs/:jobId/result` — controller ครอบ `@UseGuards(DeviceApiKeyGuard)` ทั้งตัว, path แยกจาก `/devices/*` ของ staff (JWT) | **ต่อท้าย controller เดิมไม่ได้** — `DeviceApiKeyGuard` ระดับ controller จะครอบ endpoint ใหม่ด้วย ต้องเป็น controller แยกที่ใช้ path prefix `device-sync` เดียวกัน (§4) |
| Auth อุปกรณ์ | `DeviceApiKeyGuard` ตรวจ header `X-Device-Api-Key` กับ `Device.apiKeyHash` (bcrypt) ของเครื่องตาม path `:deviceId` แล้วแนบ `req.device` | **ใช้กับ telemetry ไม่ได้** — กล่องส่งข้อมูลไป `data_server` โดยไม่ใส่ header ยืนยันตัวตนเลย ต้องมี guard ใหม่ที่อ่าน key จาก path (§7) |
| ออก key | `POST /devices` (ลงทะเบียน — คืน `apiKey` ครั้งเดียว) และ `POST /devices/:deviceId/rotate-key` — สิทธิ์ `device-registration` (Admin; SuperAdmin inherit) | กล่องตัวอย่างยังต้องลงทะเบียนก่อน (§8) แต่ key ของ telemetry เป็นคนละตัวกับ `apiKey` นี้ (§7) |
| สถานะ online | guard เขียน `Device.lastSeenAt` ทุกครั้งที่ auth ผ่าน (throttle ≥ 1 นาที, never-throw — docs/19 §4.3) | guard ใหม่ของ telemetry ไม่ได้เขียนให้อัตโนมัติ — ถ้าต้องการต้องเขียน `lastSeenAt` แบบเดียวกันใน guard ใหม่ (§7) · หรือใช้สถานะออนไลน์จาก Server กลาง (#359) |
| FK ไปหา Device | `DeviceConfigOverride` / `DeviceFirmwareOverride` ใช้ `@relation(fields: [deviceId], references: [deviceId], onDelete: Restrict)` | ตารางใหม่ใช้แบบเดียวกัน |
| Validation ทั้งแอป | `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` + `setGlobalPrefix('api/v1')` (`main.ts`) | **payload ปัจจุบันของกล่องจะโดน 400 ทันที** (field snake_case และ `device_id` ใน body ไม่อยู่ใน DTO) — ต้องตัดสินใจเรื่องชื่อ field (§5, §10 Q4) |
| DTO pattern | `class-validator` เช่น `ReportJobResultDto` (`@IsIn`, `@IsOptional`, `@MaxLength`) + ค่าคงที่ export จากไฟล์ DTO | DTO ใหม่ทำแบบเดียวกัน |
| ไม่ลง AuditLog | ผลจากเครื่องไม่ลง `AuditLog` (ตกลง 15 ต.ค. 2569, docs/19 §14 ข้อ 1 — Audit Log เป็นของการกระทำของคน) | telemetry ไม่ลง AuditLog เช่นกัน |

## 3. ตารางใหม่ `DeviceTelemetry` (additive migration)

```prisma
// ร่าง — ชื่อ/ชนิดยังเปลี่ยนได้ตามคำตอบ §10
model DeviceTelemetry {
  id             String   @id @default(uuid())
  deviceId       String
  latitude       Float
  longitude      Float
  speedKmh       Float?
  fix            Boolean
  satellites     Int?
  locationSource String   // ค่าจากกล่อง เช่น "gps" (ค่าอื่นที่เป็นไปได้ยังไม่รู้ — §10 Q7)
  recordedAt     DateTime // `timestamp` ที่กล่องส่งมา (เวลาวัดจริง)
  receivedAt     DateTime @default(now()) // เวลาที่ backend รับ — เพิ่มจากที่กล่องส่ง
  device         Device   @relation(fields: [deviceId], references: [deviceId], onDelete: Restrict)

  @@index([deviceId, recordedAt])
}
```

- **additive ล้วน**: ตารางใหม่ 1 ตาราง + back-relation `telemetry DeviceTelemetry[]` บน `Device` (ไม่เปลี่ยน
  คอลัมน์เดิม) — ตาม CLAUDE.md "migration ใหม่ต้องเป็น additive" · `schema.prisma` เป็นไฟล์ร่วม ต้อง
  `git pull origin main` ก่อนแก้ · **ระวัง:** migration ที่แตะตาราง `Device` อาจทำให้ Prisma generate
  `DROP INDEX "Device_simNumber_active_key"` (partial index ที่ Prisma ไม่รู้จัก — คำเตือนในคอมเมนต์เหนือ
  `enum DeviceLifecycleStatus`) ต้องเช็ค diff ด้วยตาก่อน apply
- **`receivedAt`** เพิ่มเองจาก field ที่โจทย์ร่างไว้ — กล่องอาจนาฬิกาเพี้ยน (ยังไม่มี GPS fix ตอนบูต) เก็บเวลา
  ฝั่ง server ไว้เทียบ/เรียงได้เสมอ
- **ปริมาณข้อมูล:** ส่งทุก 10 วิ (`gps.send_interval_sec` ค่าเริ่มต้น) = **~8,640 แถว / กล่อง / วัน**
  (~3.15 ล้านแถว / กล่อง / ปี) — ตอนนี้มีกล่องตัวอย่างไม่กี่ตัวจึงไม่เป็นปัญหา แต่ถ้าขยายจริงต้องมี
  retention → **คำถามเปิด §10 Q1**
- **`fix = false`:** กล่องยังส่ง latitude/longitude มาหรือไม่ และเป็นค่าอะไร (0,0 / ค่าล่าสุด) ยังไม่รู้ —
  ถ้าส่งเป็น null ต้องเปลี่ยน `latitude`/`longitude` เป็น nullable → §10 Q7

## 4. Endpoint ใหม่: `POST /device-sync/:deviceId/telemetry/:key`

- **controller แยก** (เช่น `DeviceTelemetryController` ที่ `@Controller('device-sync')`) ไม่ใส่ใน
  `DeviceSyncController` เดิม เพราะ `@UseGuards(DeviceApiKeyGuard)` ระดับ controller จะบังคับ header
  `X-Device-Api-Key` ซึ่งกล่องไม่ส่ง · ใช้ guard ใหม่ตาม §7 แทน
  URL เต็ม: `{host}:3001/api/v1/device-sync/{deviceId}/telemetry/{key}`
- service scope ทุก query ด้วย `deviceId` ที่ผ่าน guard แล้ว (IDOR Prevention ใน CLAUDE.md) — `deviceId`
  มาจาก path เท่านั้น ไม่รับจาก body
- **DTO คร่าวๆ** (ชื่อ field ขึ้นกับ §10 Q4 — ร่างเป็น camelCase ตาม convention ของ API ทั้งระบบ):

  ```ts
  export class ReportTelemetryDto {
    @IsLatitude() latitude!: number;
    @IsLongitude() longitude!: number;
    @IsOptional() @IsNumber() @Min(0) speedKmh?: number;
    @IsString() @MaxLength(20) locationSource!: string;
    @IsBoolean() fix!: boolean;
    @IsOptional() @IsInt() @Min(0) satellites?: number;
    @IsOptional() @IsString() @MaxLength(32) firmwareVersion?: string; // §6
    @IsISO8601() timestamp!: string; // -> recordedAt
  }
  ```

- **response:** เสนอ `200` + `{ accepted: true }` ตาม pattern `jobs/:jobId/result` (ส่งซ้ำตอนเน็ตหลุดเป็นเรื่อง
  ปกติของอุปกรณ์) · กล่องไม่ต้องอ่าน body
- **`openapi.yaml`** (ตาม CLAUDE.md): path ใหม่ + `operationId` (เช่น `reportDeviceTelemetry`),
  `tags: [device-sync]` เดียวกับ path เดิม, `security: []` (ไม่ใช้ `bearerAuth` และไม่ใช่ `deviceApiKey`
  — key อยู่ใน path parameter `key` อธิบายใน `description` ว่าเป็นความลับ), response
  `400` (validation), `401` (key ผิด), schema `DeviceTelemetryReport` + รัน
  `npx @redocly/cli lint docs/api/openapi.yaml` ก่อน commit
- ไม่ผ่าน `PermissionGuard` และไม่เพิ่มแถวใน RBAC_Matrix — เหมือน `/device-sync/*` เดิม (อุปกรณ์ไม่มี role)
  แต่ควรเพิ่มหมายเหตุใน RBAC_Matrix ว่ามี endpoint อุปกรณ์เพิ่ม
- เทส: unit (service + guard) + integration ผ่าน HTTP จริง (401 key ผิด / key ของเครื่องอื่นถ้าเป็น key ต่อกล่อง /
  เครื่องที่ไม่มีในระบบ — ข้อความเดียวกันทุกกรณี, 400 field ผิด/เกิน, 200 บันทึกได้) · ไม่ใส่ key ต่อท้ายเลย
  ได้ 404 ตาม routing ปกติ

## 5. Payload mapping (กล่อง → backend ที่เสนอ)

**telemetry** (ทุก `gps.send_interval_sec` วิ)

| กล่องส่ง (snake_case) | backend ที่เสนอ | หมายเหตุ |
|---|---|---|
| `device_id` | path `:deviceId` → `DeviceTelemetry.deviceId` | **ต้องไม่อยู่ใน body** (`forbidNonWhitelisted` → 400) · ค่าต้องตรงกับ `Device.deviceId` ที่ลงทะเบียน |
| `latitude` | `latitude` | ชื่อตรงกันอยู่แล้ว |
| `longitude` | `longitude` | ชื่อตรงกันอยู่แล้ว |
| `speed_kmh` | `speedKmh` | |
| `location_source` | `locationSource` | |
| `fix` | `fix` | ชื่อตรงกันอยู่แล้ว |
| `satellites` | `satellites` | ชื่อตรงกันอยู่แล้ว |
| `firmware_version` | `firmwareVersion` | เก็บที่ไหน — §6 / §10 Q3 |
| `timestamp` | `timestamp` → `recordedAt` | ISO 8601 UTC |
| — | `receivedAt` | server ใส่เอง |

**event** (firmware 1.1.0+; 1.2.0 เพิ่ม geofence)

| กล่องส่ง | backend ที่เสนอ | หมายเหตุ |
|---|---|---|
| `device_id` | path `:deviceId` | เหมือนข้างบน |
| `event_type` | `eventType` | `OVERSPEED` · `GEOFENCE_EXIT` · `GEOFENCE_ENTER` |
| `speed_kmh` | `speedKmh` | |
| `speed_limit_kmh` | `speedLimitKmh` | OVERSPEED |
| `distance_m` | `distanceM` | GEOFENCE_* (v1.2.0) |
| `radius_m` | `radiusM` | GEOFENCE_* (v1.2.0) |
| `latitude` / `longitude` | `latitude` / `longitude` | |
| `timestamp` | `timestamp` → `occurredAt` | |

กล่องส่งทั้ง 2 แบบไปที่ URL เดียวกัน (`data_server` มี `path` ช่องเดียว) จึง**แยก endpoint เป็น `.../telemetry`
กับ `.../events` ไม่ได้ถ้าไม่แก้ firmware** — ต้องเป็น endpoint เดียว แยกชนิดด้วยการมี `event_type` ใน body (แบบที่
`data-monitor` ของพี่เลี้ยงทำ) แล้วจะเก็บ event ไว้ที่ไหนขึ้นกับ §10 Q2 · key ใน path (§7) จึงครอบทั้งสองแบบ

## 6. `firmware_version` ที่กล่องรายงานเอง

- **ตอนนี้ backend รู้เวอร์ชัน Firmware จากฝั่งคนเท่านั้น:** `Device.partitionAFirmwareId` /
  `partitionBFirmwareId` + `activePartition` (FK ไป `Firmware`) ถูกเขียนตอนช่างกด "ยืนยันติดตั้ง Firmware"
  (`POST /devices/:deviceId/confirm-firmware-install`) ไม่มี field ไหนเก็บ "เวอร์ชันที่กล่องบอกเอง"
- **เสนอ:** เก็บ string ที่กล่องรายงาน (เช่น `"1.1.0"`) — เปิดทางให้กฎ **Version Verification** ใน Design PDF
  §11.2 (หนึ่งใน 4 ข้อที่ defer เพราะไม่มี telemetry) เทียบกับ Firmware ใน partition ที่ active ได้
- **ทางเลือก → §10 Q3:**
  - (ก) `Device.reportedFirmwareVersion String?` + `reportedFirmwareAt DateTime?` — อัปเดตเมื่อค่าเปลี่ยน
    อ่านง่ายบนหน้า Device Detail
  - (ข) เก็บใน `DeviceTelemetry` ทุกแถว — มีประวัติว่าเปลี่ยนเวอร์ชันเมื่อไร แต่ซ้ำ ~8,640 ครั้ง/วัน
  - (ค) ทั้งสองอย่าง (ค่าล่าสุดที่ `Device` + ประวัติที่ telemetry)
- เทียบกับ `Firmware.version` ได้หรือไม่ขึ้นกับว่ารูปแบบ string ตรงกัน — ยังไม่ได้เช็คกับ Firmware ที่อัปโหลดจริง

## 7. Auth — key ฝังใน path ของ URL ที่ตั้งผ่าน Config (ไม่ต้องแก้ firmware)

**ที่มา:** A อ่านโค้ดกล่องแล้วพบว่าการส่งไป Data Server **ไม่ใส่ header ยืนยันตัวตนเลย** (`httpJson(..., false)`
ใน `features.h`) ส่วน `Authorization: Bearer` + `X-Device-Id` ใช้เฉพาะตอนคุยกับ Server กลาง `DeviceApiKeyGuard`
(header `X-Device-Api-Key`) จึงใช้กับ endpoint นี้ไม่ได้ · A เสนอ 3 ทาง: (ก) ฝัง key ใน URL ที่ตั้งผ่าน Config,
(ข) รับ `device_id` แบบไม่ยืนยันตัวตน, (ค) แก้ firmware ให้ส่ง header · พี่เลี้ยงให้ B ตัดสินใจ **B เลือก (ก)** —
ไม่ต้อง reflash กล่องจริงที่มีอยู่ตัวเดียว ปลอดภัยกว่า (ข) และใช้กลไก Config ที่มีอยู่แล้ว

**ทำไมเป็น path ไม่ใช่ query (`?key=`):** `data_server` ของระบบพี่เลี้ยงไม่ใช่ URL ช่องเดียว แต่เป็น 4 ช่อง
(`protocol`, `host`, `port`, `path`) ที่ firmware ต่อกันเป็น `protocol://host:port` + `path` ตรงๆ
(`dataServerUrl()` ใน `features.h`) · schema ของ `delivery-server` จำกัด `data_server.path` ไว้ที่
`^/[A-Za-z0-9._~/-]*$` ยาวไม่เกิน 128 ตัวอักษร (`schemas/ESP32-DEVKIT-V1/1.json` — schema 2, 3 สืบทอดโดยไม่เปลี่ยน
และ schema ที่เผยแพร่แล้วแก้ไม่ได้) จึง**ไม่รับ `?`, `=`, `&`** สั่ง Config ที่มี query จะได้ `400 INVALID_CONFIG`
ตั้งแต่ delivery-server · ตัว firmware เองเช็คแค่ว่า `path` ขึ้นต้นด้วย `/` (`device_config.h`)

**แนวทาง**
- route `POST /device-sync/:deviceId/telemetry/:key` ใน controller แยก (§4)
- **guard ใหม่** (เช่น `TelemetryKeyGuard`) อ่าน key จาก `req.params.key` แทน header — ไม่ผูกกับ `Device.apiKeyHash`
  หรือ `DeviceApiKeyGuard` เดิม เป็นกลไกเฉพาะ endpoint นี้
  - เทียบแบบ constant-time กับ hash ที่เก็บไว้ (key สุ่ม entropy สูง ใช้ SHA-256 พอ ไม่ต้อง bcrypt ซึ่งช้าเกินสำหรับ
    คำขอทุก 10 วินาที)
  - ไม่ผ่าน → `401` ข้อความกลางๆ เดียวกันทุกกรณี (ไม่มีเครื่องนี้ / key ผิด / key ของเครื่องอื่น) กัน enumeration
  - เครื่องที่ `decommissioned` ปฏิเสธเหมือน key ผิด (คำตอบ A ใน Q5)
  - ถ้าต้องการสถานะออนไลน์จาก telemetry ให้เขียน `Device.lastSeenAt` แบบ throttle เหมือน guard เดิม
- **รูปแบบ key:** สุ่ม 32 byte เข้ารหัส base64url (43 ตัวอักษร `A-Z a-z 0-9 _ -`) ผ่าน pattern ข้างบน · ความยาว path
  สูงสุด = `/api/v1/device-sync/` (20) + deviceId (≤ 32) + `/telemetry/` (11) + key (43) = 106 ≤ 128

**การ provision — เลือก 1 แบบ (→ §10 Q10)**

| แบบ | เก็บที่ไหน | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **key ต่อกล่อง** | field ใหม่ เช่น `Device.telemetryKeyHash String?` (additive) + endpoint ออก/หมุน key สิทธิ์ Admin | key ผูกกับ `deviceId` ใน path — กล่องหนึ่งส่งแทนอีกกล่องไม่ได้ · key หลุดกระทบกล่องเดียว · เพิกถอนรายกล่องได้ | ต้อง provision ทุกกล่อง · แก้ schema + มี endpoint/หน้าจอออก key เพิ่ม |
| **key กลางเดียว** | env var เช่น `TELEMETRY_INGEST_KEY` (เก็บ hash หรือเทียบตรง) | ง่ายสุด ไม่แก้ schema · เหมาะช่วงที่มีกล่องจริงตัวเดียว | `deviceId` ใน path ไม่ถูกยืนยัน — ใครมี key ส่งแทนกล่องไหนก็ได้ · key หลุดต้องเปลี่ยน Config ทุกกล่อง |

**ตั้งค่าที่กล่อง (B / admin ทำ — ไม่ต้องแก้ firmware เลย):** สั่ง Config ใหม่ผ่าน `delivery-server`
(`PUT /api/admin/devices/BOX-0001/config` ซึ่ง merge กับค่าเดิม) ตั้ง `data_server` 4 ช่อง เช่น

```json
{ "protocol": "http", "host": "<IP หรือโดเมนของ backend>", "port": 3001,
  "path": "/api/v1/device-sync/BOX-0001/telemetry/<key>" }
```

- `path` **ต้องมี `/api/v1` นำหน้า** เพราะ backend ตั้ง `setGlobalPrefix('api/v1')`
- `host` ต้องอยู่ใน `DATA_SERVER_HOST_ALLOWLIST` ของ delivery-server (A ชี้ไว้) ถ้าใช้ IP
- กล่องส่งไปที่ URL นี้ตรงๆ ทั้ง telemetry และ event (§5)

**ความปลอดภัย (ตามจริง)**
- ตอนนี้ `data_server` ของกล่องจริงตั้งเป็น **`http` ไปที่ IP ในวง LAN** (ไม่ใช่ https) key ใน path จึง**วิ่งผ่าน Wi-Fi
  แบบไม่เข้ารหัส** ใครดักในเครือข่ายเดียวกันเห็น key ได้ ไม่ใช่แค่เสี่ยงหลุดใน log
- key ใน URL ยังอาจไปอยู่ใน access log ของ reverse proxy / web server ระหว่างทาง (NestJS เองไม่ log URL เป็นค่าเริ่มต้น)
- ช่วงทดสอบใน LAN ยอมรับความเสี่ยงนี้ได้ · **เมื่อ backend มีโดเมนและ cert ใช้งานจริง ต้องเปลี่ยน `protocol` เป็น
  `https`** (firmware รองรับ https อยู่แล้ว — Config เดิมของกล่องเคยใช้ https) และหมุน key ใหม่ตอนเปลี่ยน
- ถ้าต้องการเข้มงวดกว่านี้ในอนาคต ค่อยย้าย key ไป header ซึ่งต้องแก้ firmware (ทาง ค)

## 8. สิ่งที่ฝั่งกล่อง / ข้อมูลต้องเตรียม (นอกโค้ด backend)

1. **ลงทะเบียนกล่อง** เช่น `BOX-0001` ผ่าน `POST /devices` — `RegisterDeviceDto` บังคับ `deviceId`,
   `simNumber`, `modelId` (ต้องมี `DeviceModel` สำหรับกล่อง ESP32 ใน catalog ก่อน), `protocol` (โมเดลมีได้
   โปรโตคอลเดียว — #351), `imei`, `serialNumber`, `blackboxId` → ต้องหาค่าที่ใช้กับกล่อง ESP32 ทดสอบ
   (ESP32 อาจไม่มี IMEI/SIM จริง) → §10 Q8
2. **เปลี่ยน Config ของกล่อง** (`data_server` 4 ช่อง): จาก `http://<data-monitor>:320/api/gps` เป็น
   `{backend}:3001` + `path` = `/api/v1/device-sync/BOX-0001/telemetry/<key>` (§7)
3. **ไม่ต้องเปลี่ยน auth header และไม่ต้องแก้ firmware** — key อยู่ใน path ที่ตั้งผ่าน Config (§7)
4. **ชื่อ field ใน body** — ถ้าเลือก camelCase (§10 Q4 ทาง ก) firmware กล่องต้องเปลี่ยนชื่อ field และเลิกส่ง
   `device_id` ใน body

ข้อ 2 เป็นแค่การสั่ง Config ผ่าน `delivery-server` (B / admin ทำ) ข้อ 4 ขึ้นกับ Q4 ถ้าเลือก camelCase ต้องแก้
firmware ของพี่เลี้ยง

## 9. เอกสาร/คอมเมนต์ที่ต้องอัปเดตตอน implement

- `schema.prisma`: คอมเมนต์เหนือ `enum CampaignRolloutStatus` ที่ว่า "ไม่มีช่องทางรับ telemetry" + คอมเมนต์
  model ใหม่ (deviation จาก `GPS_Data_Dictionary.xlsx` ซึ่งไม่มีตาราง telemetry — ตามกฎ "ห้ามเบี่ยงแบบเงียบๆ")
- `docs/api/openapi.yaml` (§4)
- `docs/architecture/RBAC_Matrix.md`: หมายเหตุ endpoint อุปกรณ์ใหม่ + แถว Auto-rule ที่ defer ไว้
- `docs/planning/01_GPS_Build_Reference.md` ข้อ 187 (telemetry ไประบบเดิม → มาที่ backend นี้แล้ว)

## 10. คำถามเปิดถึง A

**ขอคำตอบ 3 ข้อแรกก่อนเริ่มเขียนโค้ด** ที่เหลือตอบระหว่างรีวิวได้

**Q1 — Retention ของ `DeviceTelemetry`:** ~8,640 แถว/กล่อง/วัน ต้องมี retention policy ไหม
- (ก) ยังไม่ต้อง — กล่องตัวอย่างไม่กี่ตัว ทำทีหลังเมื่อมีกล่องจริง
- (ข) ลบแถวเก่ากว่า N วันด้วย job ตามรอบ (N = ?)
- (ค) เก็บแค่ตำแหน่งล่าสุดต่อเครื่อง (upsert แถวเดียว) + ไม่เก็บประวัติ

**Q2 — Event แจ้งเตือน (`OVERSPEED`, `GEOFENCE_EXIT`, `GEOFENCE_ENTER`):** ตอนนี้ไม่มีกลไกรองรับเลย (`Incident`
มีอยู่แต่ใช้กับปัญหา Config/Firmware, Field Report, config-sync-writer — ไม่มี endpoint ฝั่งอุปกรณ์สร้าง Incident
หรือ Notification)
- (a) **สร้างเป็น `Incident` ใหม่** — Operation เห็นใน Incident Center ทันที แต่ปนกับ Incident เชิงเทคนิค และ
  overspeed อาจเกิดถี่มาก
- (b) **สร้างเป็น `Notification` แยก** — แจ้ง Operation/ช่าง (ต้องเพิ่ม `NotificationType` ใหม่ + ตัดสินว่าแจ้งใคร)
- (c) **เก็บลงตารางเหตุการณ์ใหม่เฉยๆ** (`DeviceEvent`) ยังไม่ขึ้น Incident/Notification — แสดงผล/แจ้งเตือนเป็น
  ขั้นถัดไป

**Q3 — เก็บ `firmware_version` ที่กล่องรายงานที่ไหน:** (ก) `Device` · (ข) `DeviceTelemetry` · (ค) ทั้งสอง (§6)

**Q4 — ชื่อ field ใน body:** `forbidNonWhitelisted` ทำให้ต้องเลือก
- (ก) camelCase ตาม API ทั้งระบบ — กล่องต้องเปลี่ยนชื่อ field
- (ข) DTO ของ endpoint อุปกรณ์รับ snake_case ตามที่กล่องส่งอยู่ (ต่างจาก convention ทั้งระบบ แต่กล่องแก้น้อยกว่า)

**Q5 — เครื่องที่ `decommissioned`:** ให้ส่ง telemetry ได้ต่อ (guard ปัจจุบัน) หรือปฏิเสธ (ถ้าปฏิเสธ — แก้ที่
guard ซึ่งกระทบ `/jobs` ด้วย หรือเช็คเฉพาะ endpoint ใหม่)

**Q6 — ใครใส่ key ลงกล่องตัวอย่าง** — **ตัดสินแล้ว:** B / admin ตั้งผ่าน Config ของ `delivery-server`
(key อยู่ใน `data_server.path`) ไม่ต้องแก้ firmware (§7)

**Q7 — `fix = false`:** กล่องส่ง latitude/longitude มาเป็นค่าอะไร และ `location_source` มีค่าอะไรได้บ้างนอกจาก
`"gps"` (ต้องถามพี่เลี้ยง/ดูโค้ด `arduino_gps`)

**Q8 — ข้อมูลลงทะเบียนกล่อง ESP32:** ใช้ `DeviceModel` ตัวไหน (สร้างใหม่ เช่น "ESP32-GPS"?) และ `imei` /
`simNumber` / `serialNumber` / `blackboxId` ใช้ค่าอะไรกับกล่องทดสอบ

**Q10 — key ของ telemetry แบบไหน:** key ต่อกล่อง (`Device.telemetryKeyHash`) หรือ key กลางเดียว
(`TELEMETRY_INGEST_KEY`) — ข้อดีข้อเสียใน §7

**Q9 — ใครทำ:** `device-sync` เป็นงานของ A (#330/#337) — A ทำเอง, B ทำแล้ว A รีวิว, หรือแบ่ง (เช่น B ทำ
telemetry, A ทำ event/Incident)

## 11. นอกขอบเขตของ PR นี้

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ `schema.prisma`, ไม่สร้าง endpoint, ไม่แก้ `openapi.yaml` หรือโค้ดใดๆ
- จะเปิด **PR implementation แยก** หลังตกลงคำถามใน §10 กับ A แล้ว (อาจแตกเป็น telemetry ก่อน แล้ว event ทีหลัง)
- ไม่รวม: หน้าแสดงตำแหน่ง/แผนที่บน Web หรือ Mobile, Auto-rule ใน §11.2 ที่ใช้ telemetry (Offline / GPS data
  gap / Version Verification ฯลฯ), การแก้ firmware ของกล่อง — เป็นขั้นถัดไปหลัง backend รับข้อมูลได้แล้ว
