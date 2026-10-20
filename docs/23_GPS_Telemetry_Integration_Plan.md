# แผนรับ GPS Telemetry จากกล่อง ESP32 เข้า Backend

> **สถานะ:** แผนเพื่อขอความเห็น — **ยังไม่มีโค้ดใน PR นี้** · ร่าง 20 ต.ค. 2569 โดย B (kittiphong)
> · รอ A (paveekornkwork-dev — ผู้เขียน `device-sync` module, #330/#337, และ `DeviceApiKeyGuard`,
> docs/14) ตอบคำถามเปิดใน §10 ก่อนเริ่ม implement
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
| ช่องทางที่อุปกรณ์เรียกเอง | `device-sync` module: `GET /device-sync/:deviceId/jobs`, `POST /device-sync/:deviceId/jobs/:jobId/result` — controller ครอบ `@UseGuards(DeviceApiKeyGuard)` ทั้งตัว, path แยกจาก `/devices/*` ของ staff (JWT) | endpoint ใหม่ต่อท้าย controller เดิมได้เลย |
| Auth อุปกรณ์ | `DeviceApiKeyGuard` ตรวจ header `X-Device-Api-Key` กับ `Device.apiKeyHash` (bcrypt) ของเครื่องตาม path `:deviceId` แล้วแนบ `req.device` | ใช้ได้ทันที ไม่ต้องสร้างกลไกใหม่ (§7) |
| ออก key | `POST /devices` (ลงทะเบียน — คืน `apiKey` ครั้งเดียว) และ `POST /devices/:deviceId/rotate-key` — สิทธิ์ `device-registration` (Admin; SuperAdmin inherit) | กล่องตัวอย่างต้องลงทะเบียนก่อน (§8) |
| สถานะ online | guard เขียน `Device.lastSeenAt` ทุกครั้งที่ auth ผ่าน (throttle ≥ 1 นาที, never-throw — docs/19 §4.3) | ส่ง telemetry ทุก 10 วิ = เครื่องขึ้นเป็น online อัตโนมัติ ไม่ต้องทำเพิ่ม |
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

## 4. Endpoint ใหม่: `POST /device-sync/:deviceId/telemetry`

- เพิ่มใน `DeviceSyncController` เดิม (ได้ `DeviceApiKeyGuard` จาก `@UseGuards` ระดับ controller อัตโนมัติ)
  URL เต็ม: `{host}:3001/api/v1/device-sync/{deviceId}/telemetry`
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
  `tags: [device-sync]` เดียวกับ path เดิม, `security: - deviceApiKey: []` (scheme ที่มีอยู่แล้ว ไม่ใช่
  `bearerAuth`), response
  `400` (validation), `401` (key ผิด/ไม่มี), schema `DeviceTelemetryReport` + รัน
  `npx @redocly/cli lint docs/api/openapi.yaml` ก่อน commit
- ไม่ผ่าน `PermissionGuard` และไม่เพิ่มแถวใน RBAC_Matrix — เหมือน `/device-sync/*` เดิม (อุปกรณ์ไม่มี role)
  แต่ควรเพิ่มหมายเหตุใน RBAC_Matrix ว่ามี endpoint อุปกรณ์เพิ่ม
- เทส: unit (service) + integration ผ่าน HTTP จริง (401 ไม่มี key / key ของเครื่องอื่น, 400 field ผิด/เกิน,
  200 บันทึกได้ + `lastSeenAt` ขยับ)

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

ตอนนี้กล่องส่งทั้ง 2 แบบไปที่ path เดียวกัน (`data_server.path`) — backend ต้องแยกได้ว่าเป็นอะไร: ใช้ endpoint
คนละตัว (เช่น `.../telemetry` กับ `.../events`) หรือ endpoint เดียวแยกด้วย `eventType` → ขึ้นกับ §10 Q2

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

## 7. Auth — ใช้ `DeviceApiKeyGuard` เดิม ไม่ต้องสร้างกลไกใหม่

- กลไกพร้อมใช้: key ต่อเครื่อง 1 ตัว, bcrypt, ตรวจว่า key เป็นของเครื่องตาม path (เครื่องหนึ่งส่งข้อมูลแทนอีก
  เครื่องไม่ได้), ข้อความ error เดียวกันทั้ง "ไม่พบเครื่อง" และ "key ผิด" (กัน enumeration)
- **ต่างจากที่ `arduino_gps` ใช้ตอนนี้** (`Authorization: Bearer <device token>` + header `X-Device-Id`) —
  ฝั่งกล่องต้องเปลี่ยนเป็น header `X-Device-Api-Key: <key>` และใส่ `deviceId` ใน path แทน (§8)
- **การเอา key ไปใส่กล่อง:** `docs/14_Device_Sync_Proposal.md` §3.2 (B ยืนยันใน PR #190, 21 ก.ย. 2569)
  แบ่งขอบเขตไว้ว่า **ตัว scheme ทีมทำเองได้เต็มที่** ส่วน **"การแจกจ่าย/ติดตั้ง key ให้อุปกรณ์ภาคสนามจริง
  นับพันเครื่อง" + secrets infra + policy หมุนเวียนระดับ operation เป็นของพี่เลี้ยง** — docs/14 ไม่ได้ระบุถึง
  กล่องทดสอบตัวเดียวแบบนี้ตรงๆ จึง**ต้องตกลงกับพี่เลี้ยงว่าใครเป็นคนใส่ key ลง Config ของกล่องตัวอย่าง**
  (§10 Q6) · ตัว key ออกได้ครั้งเดียวตอน `POST /devices` หรือ `rotate-key` ทั้งคู่ต้องใช้สิทธิ์ Admin
- **ช่องว่างที่เจอ:** guard ไม่เช็ค `Device.status` — เครื่องที่ `decommissioned` แต่ยังมี key จะส่ง telemetry
  ได้ต่อ → §10 Q5

## 8. สิ่งที่ฝั่งกล่อง / ข้อมูลต้องเตรียม (นอกโค้ด backend)

1. **ลงทะเบียนกล่อง** เช่น `BOX-0001` ผ่าน `POST /devices` — `RegisterDeviceDto` บังคับ `deviceId`,
   `simNumber`, `modelId` (ต้องมี `DeviceModel` สำหรับกล่อง ESP32 ใน catalog ก่อน), `protocol` (โมเดลมีได้
   โปรโตคอลเดียว — #351), `imei`, `serialNumber`, `blackboxId` → ต้องหาค่าที่ใช้กับกล่อง ESP32 ทดสอบ
   (ESP32 อาจไม่มี IMEI/SIM จริง) → §10 Q8
2. **เปลี่ยน Config ของกล่อง** (`data_server.host` / `port` / `path`): จาก `192.168.1.43:320/api/gps` เป็น
   `{backend}:3001/api/v1/device-sync/BOX-0001/telemetry`
3. **เปลี่ยน auth header** ของกล่องเป็น `X-Device-Api-Key` (§7)
4. **ชื่อ field ใน body** — ถ้าเลือก camelCase (§10 Q4 ทาง ก) firmware กล่องต้องเปลี่ยนชื่อ field และเลิกส่ง
   `device_id` ใน body

ข้อ 2–4 เป็นการแก้ฝั่ง `arduino_gps` ซึ่งเป็นของพี่เลี้ยง — ต้องตกลงกันว่าใครแก้

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

**Q6 — ใครใส่ API key ลงกล่องตัวอย่าง และใครแก้ firmware/Config ฝั่ง `arduino_gps`** (§7, §8) — ต้องคุยกับ
พี่เลี้ยง

**Q7 — `fix = false`:** กล่องส่ง latitude/longitude มาเป็นค่าอะไร และ `location_source` มีค่าอะไรได้บ้างนอกจาก
`"gps"` (ต้องถามพี่เลี้ยง/ดูโค้ด `arduino_gps`)

**Q8 — ข้อมูลลงทะเบียนกล่อง ESP32:** ใช้ `DeviceModel` ตัวไหน (สร้างใหม่ เช่น "ESP32-GPS"?) และ `imei` /
`simNumber` / `serialNumber` / `blackboxId` ใช้ค่าอะไรกับกล่องทดสอบ

**Q9 — ใครทำ:** `device-sync` เป็นงานของ A (#330/#337) — A ทำเอง, B ทำแล้ว A รีวิว, หรือแบ่ง (เช่น B ทำ
telemetry, A ทำ event/Incident)

## 11. นอกขอบเขตของ PR นี้

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ `schema.prisma`, ไม่สร้าง endpoint, ไม่แก้ `openapi.yaml` หรือโค้ดใดๆ
- จะเปิด **PR implementation แยก** หลังตกลงคำถามใน §10 กับ A แล้ว (อาจแตกเป็น telemetry ก่อน แล้ว event ทีหลัง)
- ไม่รวม: หน้าแสดงตำแหน่ง/แผนที่บน Web หรือ Mobile, Auto-rule ใน §11.2 ที่ใช้ telemetry (Offline / GPS data
  gap / Version Verification ฯลฯ), การแก้ firmware ของกล่อง — เป็นขั้นถัดไปหลัง backend รับข้อมูลได้แล้ว
