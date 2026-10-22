# แผนรับ GPS Telemetry จากกล่อง ESP32 เข้า Backend

> **สถานะ:** แผนที่ตกลงแล้ว รอ A รีวิวรอบสุดท้าย — **ยังไม่มีโค้ดใน PR นี้** · ร่าง 20 ต.ค. 2569 โดย B (kittiphong)
> · ผู้รีวิว A (paveekornkwork-dev — ผู้เขียน `device-sync` module, #330/#337, และ `DeviceApiKeyGuard`, docs/14)
>
> **ปรับรอบ 2 (20 ต.ค. 2569):** A ชี้ว่ากล่องส่ง telemetry โดยไม่มี auth header เลย `DeviceApiKeyGuard` เดิมจึงใช้
> ไม่ได้ · พี่เลี้ยงให้ B ตัดสินใจ B เลือกทาง (ก) ฝัง key ใน URL ที่ตั้งผ่าน Config แบบเป็น **path parameter**
> (ไม่ใช่ query — schema ของ `data_server.path` ใน delivery-server ไม่รับ `?` `=` `&`) — เขียน §7 ใหม่
>
> **ปรับรอบ 3 (20 ต.ค. 2569):** ใส่คำตอบของ A ครบ Q1–Q10 และรีวิว §7 (เทียบ hash เสมอแม้ไม่พบเครื่อง,
> rate limit, ขั้นตอนหมุน key) — คำถามใน §10 ปิดหมดแล้ว เหลือจุดที่ต้องยืนยันก่อน implement ใน §10.2
>
> **ปรับรอบ 4 (21 ต.ค. 2569):** พี่เลี้ยงยืนยันสถานะของ `arduino_gps` (§1) — ปรับเฉพาะ**เหตุผล**ที่เคยอ้างว่า "firmware
> เป็นของพี่เลี้ยง เราควบคุมไม่ได้" ให้เป็นข้อจำกัดที่ตั้งใจเลือก (§1, §4, §7) **การตัดสินใจทางเทคนิคไม่เปลี่ยน**
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `cec3779` — `backend/prisma/schema.prisma` (model `Device`,
> `DeviceModel`), `backend/src/device-sync/*`, `backend/src/common/guards/device-api-key.guard.ts`,
> `backend/src/device/*`, `backend/src/device-model/*`, `backend/src/main.ts`, `docs/14_Device_Sync_Proposal.md`
> §3.2 · ฝั่งกล่องอ่านจาก `arduino_gps` ของพี่เลี้ยง (`firmware/esp32_gps_box/features.h`,
> `delivery-server/schemas/ESP32-DEVKIT-V1/1.json`)

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
  ต้องอัปเดตเอกสาร/คอมเมนต์เหล่านั้นให้ตรงด้วย (§9)
- **สถานะของ `arduino_gps` (พี่เลี้ยงยืนยัน 21 ต.ค. 2569):** เป็น**ต้นแบบสาธิต**ในตอนนี้ และเป็น**คนละงาน**กับกล่อง
  SMARTEYEPLUS / ระบบเดิม `config.dtc.co.th` (ไม่ปรับแกนของระบบตาม ESP32) · ฝั่งเราเขียนให้พร้อมใช้กับของจริง
  (mock mode เป็นค่าเริ่มต้น เชื่อมกันผ่าน API อย่างเดียว)
- **ข้อจำกัดที่ตั้งใจเลือก: ถือว่า firmware และ schema ของกล่องที่ติดตั้งใช้งานแล้วแก้ไม่ได้** — สอดคล้องกับสภาพจริงของกล่อง
  ภาคสนาม (ติดตั้งแล้ว reflash ทีละตัวไม่สมเหตุสมผลในทางปฏิบัติ) backend จึงต้องรับข้อมูลตามรูปแบบที่กล่องส่งจริงเสมอ
  และต้องตั้งค่ากล่องผ่าน Config ที่ firmware รองรับอยู่แล้วเท่านั้น · ข้อจำกัดนี้เป็นเหตุผลของการตัดสินใจใน §4 (Q4) และ §7

## 2. สิ่งที่มีอยู่แล้วใน backend (ข้อเท็จจริงจากโค้ด)

| เรื่อง | มีอะไรอยู่แล้ว | ผลต่อแผนนี้ |
|---|---|---|
| ช่องทางที่อุปกรณ์เรียกเอง | `device-sync` module: `GET /device-sync/:deviceId/jobs`, `POST /device-sync/:deviceId/jobs/:jobId/result` — controller ครอบ `@UseGuards(DeviceApiKeyGuard)` ทั้งตัว, path แยกจาก `/devices/*` ของ staff (JWT) | **ต่อท้าย controller เดิมไม่ได้** — `DeviceApiKeyGuard` ระดับ controller จะครอบ endpoint ใหม่ด้วย ต้องเป็น controller แยกที่ใช้ path prefix `device-sync` เดียวกัน (§4) |
| Auth อุปกรณ์ | `DeviceApiKeyGuard` ตรวจ header `X-Device-Api-Key` กับ `Device.apiKeyHash` (bcrypt) ของเครื่องตาม path `:deviceId` แล้วแนบ `req.device` | **ใช้กับ telemetry ไม่ได้** — กล่องส่งข้อมูลไป `data_server` โดยไม่ใส่ header ยืนยันตัวตนเลย ใช้ guard ใหม่ที่อ่าน key จาก path (§7) · **ไม่แตะ guard เดิม** จึงไม่กระทบ `/jobs` |
| ออก key | `POST /devices` (ลงทะเบียน — คืน `apiKey` ครั้งเดียว) และ `POST /devices/:deviceId/rotate-key` — สิทธิ์ `device-registration` (Admin; SuperAdmin inherit) | กล่องตัวอย่างยังต้องลงทะเบียนก่อน (§8) แต่ key ของ telemetry เป็นคนละตัวกับ `apiKey` นี้ (§7) |
| สถานะ online | guard เดิมเขียน `Device.lastSeenAt` ทุกครั้งที่ auth ผ่าน (throttle ≥ 1 นาที, never-throw — docs/19 §4.3) | guard ใหม่**ไม่เขียน `lastSeenAt` ในรอบแรก** — สถานะออนไลน์ควรมีแหล่งเดียว ตอนนี้มีจาก Server กลางอยู่แล้ว (#359) จะตัดสินว่าใช้แหล่งไหนแยกต่างหาก (§10.2) |
| Rate limit | **ยังไม่มีเลย** — backend ไม่มี `@nestjs/throttler` หรือ limiter อื่น | endpoint นี้ต้องมี limiter ของตัวเอง (§7.4) |
| FK ไปหา Device | `DeviceConfigOverride` / `DeviceFirmwareOverride` ใช้ `@relation(fields: [deviceId], references: [deviceId], onDelete: Restrict)` | ตารางใหม่ใช้แบบเดียวกัน |
| Validation ทั้งแอป | `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` + `setGlobalPrefix('api/v1')` (`main.ts`) | DTO ต้องรับ**ทุก field ที่กล่องส่งจริง** ไม่งั้นโดน 400 ทุกรอบ (§4, §5) |
| DTO pattern | `class-validator` เช่น `ReportJobResultDto` (`@IsIn`, `@IsOptional`, `@MaxLength`) + ค่าคงที่ export จากไฟล์ DTO | DTO ใหม่ทำแบบเดียวกัน |
| งานตามเวลา | `RolloutTimeoutJob` (ตรวจทุก 5 นาที) | ตัวลบข้อมูลเก่าใช้รูปแบบเดียวกัน (§3.3) |
| `protocol` ของโมเดล/เครื่อง | `DeviceModel.supportedProtocols String[]` (DTO บังคับ 1 ค่า — #351) และ `Device.protocol String` เป็น string อิสระ (`@IsString`, ยาว 1–50) ไม่มีรายการค่าตายตัวทั้งใน backend และฟอร์มเว็บ · `Config.protocol` ต้องอยู่ใน `supportedProtocols` ของรุ่น | ตั้งโมเดลกล่อง ESP32 เป็น `HTTP` ได้ (§8, §10.2) |
| ไม่ลง AuditLog | ผลจากเครื่องไม่ลง `AuditLog` (ตกลง 15 ต.ค. 2569, docs/19 §14 ข้อ 1 — Audit Log เป็นของการกระทำของคน) | telemetry และ event ไม่ลง AuditLog เช่นกัน |

## 3. Schema ใหม่ (additive migration เดียว)

### 3.1 ตาราง `DeviceTelemetry`

```prisma
// Deviation จาก GPS_Data_Dictionary.xlsx (ไม่มีตาราง telemetry) — พี่เลี้ยงให้รับ telemetry ใน backend นี้ (docs/23)
model DeviceTelemetry {
  id             String   @id @default(uuid())
  deviceId       String
  latitude       Float    // fix = false กล่องส่งพิกัดเริ่มต้น (ไม่ใช่ null) — UI ต้องกรอง fix = true (Q7)
  longitude      Float
  speedKmh       Float?   // กล่องส่ง null ได้ (ไม่มี fix และไม่ใช่โหมดจำลอง)
  fix            Boolean
  satellites     Int?
  locationSource String   // "gps" หรือ "default"
  simulated      Boolean  @default(false) // กล่องส่ง simulated: true เฉพาะโหมดจำลอง
  recordedAt     DateTime // `timestamp` ของกล่อง · ว่าง/อ่านไม่ได้ -> ใช้ receivedAt (Q7)
  receivedAt     DateTime @default(now()) // เวลาที่ backend รับจริง
  device         Device   @relation(fields: [deviceId], references: [deviceId], onDelete: Restrict)

  @@index([deviceId, recordedAt])
  @@index([receivedAt]) // ตัวลบข้อมูลเก่า (§3.3)
}
```

- **`receivedAt`** เพิ่มเองจาก field ที่กล่องส่ง — กล่องอาจยังไม่มีเวลา GPS (ส่ง `timestamp: ""`) หรือเวลาเพี้ยน
  จึงเก็บเวลาฝั่ง server ไว้เสมอ
- **ปริมาณข้อมูล:** ส่งทุก 10 วิ (`gps.send_interval_sec` ค่าเริ่มต้น ตั้งได้ 5–3600) = **~8,640 แถว / กล่อง / วัน**
  เก็บ 30 วัน (§3.3) = ~260,000 แถวต่อกล่อง ดัชนี `(deviceId, recordedAt)` รับได้สบาย

### 3.2 ตาราง `DeviceEvent` (Q2)

```prisma
// Deviation จาก GPS_Data_Dictionary.xlsx เช่นเดียวกับ DeviceTelemetry — เก็บเหตุการณ์จากกล่องไว้ก่อน ยังไม่สร้าง Incident
model DeviceEvent {
  id            String   @id @default(uuid())
  deviceId      String
  eventType     String   // OVERSPEED | GEOFENCE_EXIT | GEOFENCE_ENTER
  latitude      Float?
  longitude     Float?
  speedKmh      Float?
  speedLimitKmh Float?   // OVERSPEED
  distanceM     Float?   // GEOFENCE_* (firmware 1.2.0)
  radiusM       Float?   // GEOFENCE_* (firmware 1.2.0)
  simulated     Boolean  @default(false)
  occurredAt    DateTime // `timestamp` ของกล่อง · ว่าง -> receivedAt
  receivedAt    DateTime @default(now())
  device        Device   @relation(fields: [deviceId], references: [deviceId], onDelete: Restrict)

  @@index([deviceId, occurredAt])
  @@index([receivedAt])
}
```

- **ยังไม่สร้าง Incident หรือ Notification อัตโนมัติในรอบนี้** — บันทึกไว้อย่างเดียว เหตุผล (A): Incident ในระบบนี้คือ
  ปัญหาเชิงเทคนิคของ Config/Firmware และยังไม่รู้ว่าใครควรได้รับแจ้งเรื่องขับเร็วหรือออกนอกเขต เก็บข้อมูลครบไว้ก่อน
  แล้วค่อยเพิ่มการแจ้งเตือน/กฎสร้าง Incident ทีหลังได้โดยไม่ต้องย้อนเก็บใหม่
- ปริมาณไม่ใช่ปัญหา: กล่องแจ้ง OVERSPEED เมื่อเกินต่อเนื่อง 3 วินาที ครั้งเดียวต่อ 1 ช่วงที่เกิน และรีเซ็ตเมื่อต่ำกว่า
  (limit − 5) ต่อเนื่อง 5 วินาที

### 3.3 เก็บย้อนหลัง 30 วัน (Q1)

- ลบแถวที่ `receivedAt` เก่ากว่า **`TELEMETRY_RETENTION_DAYS`** วัน (env, ค่าเริ่มต้น **30**) ทั้ง `DeviceTelemetry` และ
  `DeviceEvent` — ใช้ `receivedAt` ไม่ใช่ `recordedAt` เพราะเวลาของกล่องเพี้ยนได้
- งานตามเวลาแบบเดียวกับ `RolloutTimeoutJob` ลบ**ทีละชุดเล็กๆ** (เช่น 1,000 แถวต่อรอบ วนจนหมดหรือครบจำนวนรอบที่ตั้งไว้)
  ไม่ `deleteMany` ก้อนเดียว กันล็อกตารางนานและกระทบคำขอที่เข้ามาทุก 10 วินาที
- ไม่ hardcode จำนวนวัน · ค่าที่ไม่ใช่จำนวนเต็มบวกให้ถอยไปใช้ 30 และ log เตือน

### 3.4 คอลัมน์ใหม่บน `Device`

```prisma
  // key ของ telemetry ต่อกล่อง (SHA-256 hex) — null = ใช้ key กลางจาก env (§7.2) ยังไม่มีทางตั้งค่าในรอบแรก
  telemetryKeyHash        String?
  // เวอร์ชัน firmware ที่กล่องรายงานเอง (ต่างจาก partitionA/BFirmwareId ที่ช่างยืนยัน) — §6
  reportedFirmwareVersion String?
  reportedFirmwareAt      DateTime?
```

- **additive ล้วน**: 2 ตารางใหม่ + 3 คอลัมน์ nullable + back-relation บน `Device` ไม่เปลี่ยนคอลัมน์เดิม — ตาม CLAUDE.md
  · `schema.prisma` เป็นไฟล์ร่วม ต้อง `git pull origin main` ก่อนแก้
- **ระวัง:** migration ที่แตะตาราง `Device` อาจทำให้ Prisma generate `DROP INDEX "Device_simNumber_active_key"`
  (partial index ที่ Prisma ไม่รู้จัก — คำเตือนในคอมเมนต์เหนือ `enum DeviceLifecycleStatus`) ต้องเช็ค SQL ด้วยตาและ
  ลบบรรทัดนั้นออกก่อน apply
- **`telemetryKeyHash` เพิ่มตั้งแต่รอบนี้แม้ยังไม่มีใครใช้** — เพื่อให้ออก key รายกล่องทีละเครื่องได้ในอนาคตโดยไม่ต้องแก้
  schema หรือ guard อีก (§7.2)

## 4. Endpoint ใหม่: `POST /device-sync/:deviceId/telemetry/:key`

- **controller แยก** (เช่น `DeviceTelemetryController` ที่ `@Controller('device-sync')`) ไม่ใส่ใน
  `DeviceSyncController` เดิม เพราะ `@UseGuards(DeviceApiKeyGuard)` ระดับ controller จะบังคับ header
  `X-Device-Api-Key` ซึ่งกล่องไม่ส่ง · ใช้ guard ใหม่ + limiter ตาม §7
  URL เต็ม: `{host}:3001/api/v1/device-sync/{deviceId}/telemetry/{key}`
- **endpoint เดียวรับทั้ง telemetry และ event** — กล่องส่งทั้งสองแบบไป URL เดียวกัน (§5) service แยกด้วย `event_type`:
  ไม่มี → `DeviceTelemetry`, มี → `DeviceEvent`
- service scope ทุก query ด้วย `deviceId` จาก path ที่ผ่าน guard แล้ว (IDOR Prevention ใน CLAUDE.md)
- **DTO รับ snake_case ตามที่กล่องส่งมาตรงๆ (Q4)** — ถือเป็นข้อจำกัดที่ตั้งใจเลือก (§1): firmware ที่ติดตั้งใช้งานแล้ว
  แก้ไม่ได้ (reflash ทีละตัวไม่สมเหตุสมผลในทางปฏิบัติ) จึงออกแบบ DTO ให้รองรับรูปแบบข้อมูลตามที่กล่องส่งจริงเสมอ ไม่บังคับ
  ให้กล่องเปลี่ยนชื่อ field · การเบี่ยงจาก convention camelCase ทั้งระบบจำกัดอยู่ที่ DTO ตัวนี้ที่เดียว ต้องเขียนคอมเมนต์
  เหตุผลไว้เหนือ DTO · ตอนบันทึก service แปลงเป็นคอลัมน์ camelCase ของ Prisma ตามปกติ

  ```ts
  /**
   * snake_case โดยตั้งใจ (docs/23 Q4): รับ payload ของ firmware arduino_gps ตามที่ส่งจริง
   * ต้องมีทุก field ที่กล่องส่ง ไม่งั้น forbidNonWhitelisted ตอบ 400 ทุกรอบ
   */
  export class DeviceDataReportDto {
    // กล่องใส่มาใน body ด้วย — optional แต่ถ้ามีต้องตรงกับ :deviceId ใน path (service เช็ค ไม่ตรง -> 400)
    @IsOptional() @IsString() @MaxLength(50) device_id?: string;

    // มี = event (DeviceEvent) · ไม่มี = telemetry (DeviceTelemetry)
    @IsOptional() @IsIn(DEVICE_EVENT_TYPES) event_type?: DeviceEventType;

    @IsLatitude() latitude!: number;
    @IsLongitude() longitude!: number;
    @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) speed_kmh?: number | null;

    // field ของ telemetry — บังคับเฉพาะเมื่อไม่มี event_type
    @ValidateIf((o) => !o.event_type) @IsBoolean() fix?: boolean;
    @ValidateIf((o) => !o.event_type) @IsIn(['gps', 'default']) location_source?: string;
    @IsOptional() @IsInt() @Min(0) satellites?: number;
    @IsOptional() @IsString() @MaxLength(32) firmware_version?: string; // §6

    // field ของ event
    @IsOptional() @IsNumber() speed_limit_kmh?: number;
    @IsOptional() @IsNumber() distance_m?: number;
    @IsOptional() @IsNumber() radius_m?: number;

    @IsOptional() @IsBoolean() simulated?: boolean; // ส่งเฉพาะโหมดจำลอง

    // ไม่ใช้ @IsISO8601 — กล่องส่ง "" เมื่อยังไม่มีวันที่/เวลา GPS ถ้าบังคับจะปฏิเสธทุกรอบที่ยังไม่มี fix
    // service: ว่างหรือ parse ไม่ได้ -> ใช้ receivedAt (Q7)
    @IsString() @MaxLength(40) timestamp!: string;
  }
  ```

- **response:** `200` + `{ accepted: true }` ตาม pattern `jobs/:jobId/result` · กล่องไม่อ่าน body
- **`openapi.yaml`** (ตาม CLAUDE.md): path ใหม่ + `operationId` (เช่น `reportDeviceData`), `tags: [device-sync]`
  เดียวกับ path เดิม, `security: []` (ไม่ใช้ `bearerAuth` และไม่ใช่ `deviceApiKey` — key อยู่ใน path parameter `key`
  อธิบายใน `description` ว่าเป็นความลับ), response `400` (validation / `device_id` ไม่ตรง path), `401` (key ผิด),
  `429` (เกิน rate limit), schema `DeviceDataReport` ที่ระบุว่าเป็น snake_case โดยตั้งใจ + รัน
  `npx @redocly/cli lint docs/api/openapi.yaml` ก่อน commit
- ไม่ผ่าน `PermissionGuard` และไม่เพิ่มแถวใน RBAC_Matrix — เหมือน `/device-sync/*` เดิม (อุปกรณ์ไม่มี role)
  แต่เพิ่มหมายเหตุใน RBAC_Matrix ว่ามี endpoint อุปกรณ์เพิ่ม
- **เทส:** unit (service + guard + limiter) + integration ผ่าน HTTP จริง
  - 401 ข้อความเดียวกันทุกกรณี: key ผิด / ไม่มีเครื่องนี้ / เครื่อง `decommissioned` / key กลางถูกแต่เครื่องตั้ง key ของตัวเองไว้
  - 200: payload จริงของกล่องทั้งตอนมี fix และไม่มี fix (`timestamp: ""`, `speed_kmh: null`, `location_source: "default"`),
    มี `simulated`, event ทั้ง 3 ชนิด, เครื่องสถานะ `registered`
  - 400: field เกิน / `device_id` ใน body ไม่ตรง path · 429 เมื่อเกิน limit · ไม่ใส่ key ต่อท้ายเลยได้ 404 ตาม routing ปกติ

## 5. Payload mapping (กล่อง → backend)

**telemetry** (ทุก `gps.send_interval_sec` วิ) → `DeviceTelemetry`

| กล่องส่ง (snake_case) | คอลัมน์ | หมายเหตุ |
|---|---|---|
| `device_id` | — (ใช้ path `:deviceId`) | optional ใน DTO ถ้ามีต้องตรงกับ path |
| `latitude` / `longitude` | `latitude` / `longitude` | `fix = false` เป็นพิกัดเริ่มต้นของกล่อง (`DEFAULT_LATITUDE`/`DEFAULT_LONGITUDE` 13.68…, 100.60…) |
| `speed_kmh` | `speedKmh` | `null` ได้ |
| `location_source` | `locationSource` | `"gps"` หรือ `"default"` |
| `fix` | `fix` | |
| `satellites` | `satellites` | `fix = false` เป็น 0 |
| `firmware_version` | `Device.reportedFirmwareVersion` | ไม่เก็บทุกแถว (§6) |
| `simulated` | `simulated` | ส่งเฉพาะโหมดจำลอง |
| `timestamp` | `recordedAt` | ISO 8601 UTC · `""` เมื่อยังไม่มีเวลา GPS → ใช้ `receivedAt` |
| — | `receivedAt` | server ใส่เอง |

**event** (firmware 1.1.0+; 1.2.0 เพิ่ม geofence) → `DeviceEvent`

| กล่องส่ง | คอลัมน์ | หมายเหตุ |
|---|---|---|
| `device_id` | — (ใช้ path) | เหมือนข้างบน |
| `event_type` | `eventType` | `OVERSPEED` · `GEOFENCE_EXIT` · `GEOFENCE_ENTER` |
| `speed_kmh` | `speedKmh` | |
| `speed_limit_kmh` | `speedLimitKmh` | OVERSPEED |
| `distance_m` | `distanceM` | GEOFENCE_* (v1.2.0) |
| `radius_m` | `radiusM` | GEOFENCE_* (v1.2.0) |
| `latitude` / `longitude` | `latitude` / `longitude` | |
| `simulated` | `simulated` | |
| `timestamp` | `occurredAt` | `""` → `receivedAt` |

กล่องส่งทั้ง 2 แบบไปที่ URL เดียวกัน (`data_server` มี `path` ช่องเดียว) จึง**แยก endpoint ไม่ได้ถ้าไม่แก้ firmware** —
แยกชนิดด้วย `event_type` ใน body (แบบที่ `data-monitor` ของพี่เลี้ยงทำ) · key ใน path (§7) ครอบทั้งสองแบบ

**การแสดงผล (Q7):** เก็บทุกแถวแม้ `fix = false` ไม่ทิ้งข้อมูล แต่ **UI และกฎใดๆ ที่ใช้ตำแหน่งต้องกรองเฉพาะ `fix = true`**
เสมอ — พิกัดเริ่มต้นดูเหมือนตำแหน่งจริงถ้าไม่ดู `fix` (ไม่ทำ `latitude`/`longitude` เป็น nullable) · เวลาที่แสดงคือ
`recordedAt` ซึ่งเป็น `receivedAt` อยู่แล้วเมื่อกล่องส่ง `timestamp` ว่าง

## 6. `firmware_version` ที่กล่องรายงานเอง (Q3)

- **ตอนนี้ backend รู้เวอร์ชัน Firmware จากฝั่งคนเท่านั้น:** `Device.partitionAFirmwareId` /
  `partitionBFirmwareId` + `activePartition` ถูกเขียนตอนช่างกด "ยืนยันติดตั้ง Firmware"
  (`POST /devices/:deviceId/confirm-firmware-install`)
- **ตัดสินแล้ว:** เก็บที่ `Device.reportedFirmwareVersion` + `reportedFirmwareAt` (§3.4) **ไม่เก็บทุกแถวของ telemetry**
  — ค่าเหมือนเดิมแทบทุกครั้ง เก็บทุกแถวซ้ำ ~8,640 ครั้งต่อวันโดยไม่ได้ข้อมูลเพิ่ม และ Version Verification (Design PDF
  §11.2) ต้องการแค่ค่าล่าสุด ถ้าต้องการประวัติค่อยเพิ่มตารางเล็กที่เขียนเฉพาะตอนค่าเปลี่ยน
- **เขียนเมื่อไร:** ค่าเปลี่ยน → เขียนทั้งสองคอลัมน์ทันที · ค่าเดิม → เลื่อน `reportedFirmwareAt` เป็นเวลาล่าสุดที่รายงาน
  แบบ throttle (≥ 1 นาที เหมือน `lastSeenAt` ของ guard เดิม) ไม่เขียน `Device` ทุก 10 วินาที
- **แหล่งความจริง:** #359 อ่านเวอร์ชันที่กล่องรายงานผ่าน Server กลางด้วย (จาก HELLO ของ gateway) หน้า Device Detail
  ต้องระบุว่าค่าไหนมาจากแหล่งไหนและเวลาล่าสุด
- เทียบกับ `Firmware.version` ได้หรือไม่ขึ้นกับว่ารูปแบบ string ตรงกัน — ยังไม่ได้เช็คกับ Firmware ที่อัปโหลดจริง

## 7. Auth — key ฝังใน path ของ URL ที่ตั้งผ่าน Config (ไม่ต้องแก้ firmware)

**ที่มา:** A อ่านโค้ดกล่องแล้วพบว่าการส่งไป Data Server **ไม่ใส่ header ยืนยันตัวตนเลย** (`httpJson(..., false)`
ใน `features.h`) ส่วน `Authorization: Bearer` + `X-Device-Id` ใช้เฉพาะตอนคุยกับ Server กลาง `DeviceApiKeyGuard`
(header `X-Device-Api-Key`) จึงใช้กับ endpoint นี้ไม่ได้ · A เสนอ 3 ทาง: (ก) ฝัง key ใน URL ที่ตั้งผ่าน Config,
(ข) รับ `device_id` แบบไม่ยืนยันตัวตน, (ค) แก้ firmware ให้ส่ง header · พี่เลี้ยงให้ B ตัดสินใจ **B เลือก (ก)** —
ปลอดภัยกว่า (ข) และใช้กลไก Config ที่ firmware รองรับอยู่แล้ว · **ตัด (ค) เพราะต้อง reflash firmware ที่ติดตั้งใช้งานแล้ว**
ซึ่งเป็นสิ่งที่ดีไซน์นี้ตั้งใจไม่ทำ (ข้อจำกัดภาคสนามใน §1) ไม่ใช่เพราะ firmware เป็นของใคร

**ทำไมเป็น path ไม่ใช่ query (`?key=`):** `data_server` ของระบบพี่เลี้ยงไม่ใช่ URL ช่องเดียว แต่เป็น 4 ช่อง
(`protocol`, `host`, `port`, `path`) ที่ firmware ต่อกันเป็น `protocol://host:port` + `path` ตรงๆ
(`dataServerUrl()` ใน `features.h`) · schema ของ `delivery-server` จำกัด `data_server.path` ไว้ที่
`^/[A-Za-z0-9._~/-]*$` ยาวไม่เกิน 128 ตัวอักษร (`schemas/ESP32-DEVKIT-V1/1.json` — schema 2, 3 สืบทอดโดยไม่เปลี่ยน
และ schema ที่เผยแพร่แล้วแก้ไม่ได้) จึง**ไม่รับ `?`, `=`, `&`** สั่ง Config ที่มี query จะได้ `400 INVALID_CONFIG`
ตั้งแต่ delivery-server · ตัว firmware เองเช็คแค่ว่า `path` ขึ้นต้นด้วย `/` (`device_config.h`)

### 7.1 รูปแบบ key

- สุ่ม 32 byte (`crypto.randomBytes(32)`) เข้ารหัส base64url ได้ 43 ตัวอักษร (`A-Z a-z 0-9 _ -`) ผ่าน pattern ข้างบน
- ความยาว path สูงสุด = `/api/v1/device-sync/` (20) + deviceId (≤ 32) + `/telemetry/` (11) + key (43) = 106 ≤ 128
- backend เก็บแค่ **SHA-256 (hex) ของ key** ไม่เก็บ key ดิบ · key สุ่ม entropy สูงจึงใช้ SHA-256 พอ ไม่ต้อง bcrypt ซึ่งช้าเกิน
  สำหรับคำขอทุก 10 วินาที

### 7.2 key กลางก่อน เผื่อขยายเป็นต่อกล่อง (Q10)

**ตัดสินแล้ว:** เริ่มด้วย **key กลางตัวเดียว** จาก env (`TELEMETRY_INGEST_KEY_SHA256` = SHA-256 hex ของ key) แต่ guard
รองรับ key ต่อกล่องไว้แล้วตั้งแต่แรก:

1. ถ้า `Device.telemetryKeyHash` ของเครื่องนั้น**มีค่า** → เทียบกับ hash ของเครื่องนั้น (key กลางใช้กับเครื่องนี้ไม่ได้อีก)
2. ถ้าเป็น **null** → ถอยไปเทียบกับ key กลางจาก env

คอลัมน์ `telemetryKeyHash` อยู่ใน migration ของรอบนี้ (§3.4) เมื่อพร้อมค่อยเพิ่ม endpoint ออก key รายกล่องแล้วทยอยออกทีละ
เครื่อง โดยไม่ต้องแก้ schema หรือ guard

**ข้อเสียของ key กลางที่ยอมรับในรอบนี้:** `deviceId` ใน path **ไม่ถูกยืนยันจริง** — ใครมี key กลางก็ส่ง telemetry ในชื่อ
กล่องไหนก็ได้ที่ลงทะเบียนไว้ และ key หลุดต้องเปลี่ยน Config ทุกกล่อง · **เหตุผลที่ยอมรับ:** ตอนนี้มีกล่องจริงแค่ตัวเดียว
การทำ key ต่อกล่องตั้งแต่แรกต้องมี endpoint ออก/หมุน key และหน้าจอเพิ่ม ซึ่งเกินความจำเป็นของรอบแรก

ถ้าไม่ได้ตั้ง env key กลาง → เครื่องที่ไม่มี key ของตัวเองถูกปฏิเสธทั้งหมด (fail closed) และ log เตือนตอนเริ่มแอป

### 7.3 Guard ใหม่ (`TelemetryKeyGuard`)

อ่าน key จาก `req.params.key` แทน header — ไม่ผูกกับ `Device.apiKeyHash` หรือ `DeviceApiKeyGuard` เดิม

```text
device   = findUnique({ deviceId }, select: status, telemetryKeyHash)   // ไม่พบ = null
expected = device?.telemetryKeyHash ?? CENTRAL_HASH ?? DUMMY_HASH       // มีค่าเสมอ
match    = timingSafeEqual(sha256(key), expected)                       // ทำทุกครั้ง ไม่ early-return
ok       = match && device !== null && device.status !== 'decommissioned'
ไม่ ok   -> 401 ข้อความกลางๆ เดียวกันทุกกรณี
```

- **เทียบแบบ constant-time** (`crypto.timingSafeEqual` กับ hash 32 byte ทั้งสองฝั่ง ความยาวเท่ากันเสมอ)
- **เทียบ hash เสมอแม้ไม่พบเครื่อง** — ห้าม return ก่อนเทียบ เพื่อไม่ให้แยกได้จากเวลาตอบว่า `deviceId` นี้มีในระบบไหม
  (timing attack) · ไม่พบเครื่องก็เทียบกับ key กลาง (หรือ dummy hash ถ้าไม่ได้ตั้ง env) แล้วค่อยปฏิเสธ
- **401 ข้อความเดียวกันทุกกรณี** (ไม่มีเครื่องนี้ / key ผิด / key กลางกับเครื่องที่มี key ของตัวเอง / `decommissioned`) กัน enumeration
- **สถานะเครื่อง (Q5):** ปฏิเสธเฉพาะ `decommissioned` · สถานะอื่นรวม `registered` (ลงทะเบียนแล้วแต่ยังไม่ติดตั้ง) รับได้
  เพราะกล่องเริ่มส่งทันทีหลังตั้ง Config · telemetry **ไม่เปลี่ยนสถานะเครื่อง** (เช่น ไม่เลื่อนเป็น `installed` เอง)
- เช็คเฉพาะ guard ใหม่ ไม่แตะ `DeviceApiKeyGuard` เดิม จึงไม่กระทบ `/jobs`
- ไม่ log ค่า key หรือ URL เต็ม

### 7.4 Rate limit

backend ยังไม่มี limiter เลย (§2) — เพิ่มเฉพาะ endpoint นี้ ทำงาน**ก่อน** guard (กันการเดา key ด้วย) ตอบ `429`

| ขอบเขต | ค่าเริ่มต้น | ที่มาของตัวเลข |
|---|---|---|
| ต่อ `deviceId` ใน path | **60 คำขอ / นาที** | รอบส่งเร็วสุดที่ schema อนุญาตคือ 5 วิ (`gps.send_interval_sec` min 5) = 12 คำขอ/นาที บวก event เป็นครั้งคราว · 60 คือเผื่อ ~5 เท่า |
| ต่อ IP ต้นทาง | **300 คำขอ / นาที** | หลายกล่องอาจออกมาจาก IP เดียว (NAT) · กันการยิง `deviceId` สุ่มที่ limit ต่อเครื่องจับไม่ได้ |

- ตั้งค่าได้ผ่าน env (`TELEMETRY_RATE_LIMIT_PER_DEVICE`, `TELEMETRY_RATE_LIMIT_PER_IP`) ไม่ hardcode
- ต้องหลวมพอเพราะ **กล่องไม่ส่งซ้ำเมื่อ POST ล้ม** (`postToDataServer` เก็บแค่รหัส HTTP ล่าสุด) คำขอที่โดน 429/401 คือข้อมูลที่หายไป
  โดยเฉพาะ event ที่ส่งครั้งเดียวต่อเหตุการณ์
- ตอนนี้ backend รัน instance เดียว เก็บตัวนับในหน่วยความจำได้ (เช่น `@nestjs/throttler` เฉพาะ controller นี้ ไม่เปิด global)
  ถ้าขยายเป็นหลาย instance ค่อยย้ายตัวนับไปที่เก็บกลาง · ถ้าอยู่หลัง reverse proxy ต้องตั้ง `TRUST_PROXY` ให้ได้ IP จริง

### 7.5 ตั้งค่าที่กล่อง (B / admin ทำ — ไม่ต้องแก้ firmware)

สั่ง Config ใหม่ผ่าน `delivery-server` (`PUT /api/admin/devices/BOX-0001/config` ซึ่ง merge กับค่าเดิม) ตั้ง `data_server` 4 ช่อง

```json
{ "protocol": "http", "host": "<IP หรือโดเมนของ backend>", "port": 3001,
  "path": "/api/v1/device-sync/BOX-0001/telemetry/<key>" }
```

- `path` **ต้องมี `/api/v1` นำหน้า** เพราะ backend ตั้ง `setGlobalPrefix('api/v1')`
- `host` ต้องอยู่ใน `DATA_SERVER_HOST_ALLOWLIST` ของ delivery-server (A ชี้ไว้) ถ้าใช้ IP
- กล่องส่งไปที่ URL นี้ตรงๆ ทั้ง telemetry และ event (§5)

### 7.6 ขั้นตอนหมุน (rotate) key

**key กลาง:**
1. สุ่ม key ใหม่ (§7.1) แล้วคำนวณ SHA-256
2. **เปลี่ยนที่ backend ก่อน:** ตั้ง `TELEMETRY_INGEST_KEY_SHA256` เป็นค่าใหม่แล้ว restart backend → **ตั้งแต่จังหวะนี้กล่องได้ 401**
3. **สั่ง Config ใหม่ที่ delivery-server** ให้ `data_server.path` ใช้ key ใหม่ (§7.5) ทุกกล่องที่ใช้ key กลาง
4. รอกล่องรับ Config (ผ่าน ws-gateway — ถ้ากล่องออฟไลน์รอได้ถึง delivery timeout 600 วิ หรือจนกว่ากล่องกลับมา)
5. ตรวจว่ากลับมาเป็น 200 (ดูข้อมูลล่าสุดใน `DeviceTelemetry`) · ทิ้ง key เก่า

**key ต่อกล่อง (อนาคต):** ขั้นตอนเดียวกันแต่ทำทีละเครื่อง — ขั้น 2 เปลี่ยน `Device.telemetryKeyHash` ของเครื่องนั้นผ่าน
endpoint ออก key (ยังไม่มี) แทน env

**ยอมรับ downtime:** ระหว่างขั้น 2 ถึงขั้น 4 กล่องได้ **401 ชั่วคราว** และข้อมูลช่วงนั้นหายเพราะกล่องไม่ส่งซ้ำ ในดีไซน์รอบนี้
(guard รับ key ได้ทีละตัว) หมุนแบบไม่มี downtime ไม่ได้ — ยอมรับไว้เพราะมีกล่องตัวเดียวและหมุนไม่บ่อย
(ทำตอนเปลี่ยนเป็น https หรือเมื่อสงสัยว่า key หลุด) ถ้าต่อไปต้องการหมุนแบบไม่มีช่วง 401 ต้องให้ guard รับ key เก่าและใหม่พร้อมกันชั่วคราว

### 7.7 ความปลอดภัย (ตามจริง)

- ตอนนี้ `data_server` ของกล่องจริงตั้งเป็น **`http` ไปที่ IP ในวง LAN** (ไม่ใช่ https) key ใน path จึง**วิ่งผ่าน Wi-Fi
  แบบไม่เข้ารหัส** ใครดักในเครือข่ายเดียวกันเห็น key ได้ ไม่ใช่แค่เสี่ยงหลุดใน log
- key ใน URL ยังอาจไปอยู่ใน access log ของ reverse proxy / web server ระหว่างทาง (NestJS เองไม่ log URL เป็นค่าเริ่มต้น)
- ช่วงทดสอบใน LAN ยอมรับความเสี่ยงนี้ได้ · **เมื่อ backend มีโดเมนและ cert ใช้งานจริง ต้องเปลี่ยน `protocol` เป็น
  `https`** (firmware รองรับ https อยู่แล้ว — Config เดิมของกล่องเคยใช้ https) และหมุน key ใหม่ตอนเปลี่ยน (§7.6)
- การย้าย key ไป header (ทาง ค) เข้มงวดกว่า แต่ต้อง reflash firmware ที่ติดตั้งใช้งานแล้ว ซึ่งขัดกับข้อจำกัดที่ตั้งใจเลือก (§1)
  จึงไม่อยู่ในแผนนี้

## 8. สิ่งที่ฝั่งกล่อง / ข้อมูลต้องเตรียม (นอกโค้ด backend)

1. **สร้าง `DeviceModel` `ESP32-DEVKIT-V1`** (ตรงกับ `hardware_model` ของ Server กลาง — ฟอร์มลงทะเบียนใน #360 จับคู่
   โมเดลให้อัตโนมัติ) `supportedProtocols: ["HTTP"]` (โมเดลมีได้โปรโตคอลเดียว — #351) → ยืนยันก่อนใช้จริงตาม §10.2
2. **ลงทะเบียน `BOX-0001`** ผ่าน `POST /devices` (Q8) — ใช้ค่าจริงเท่าที่มี ค่าที่กล่องไม่มีให้อ่านออกชัดว่าไม่มี:

   | field | ค่า | เหตุผล |
   |---|---|---|
   | `deviceId` | `BOX-0001` | ตรงกับ Server กลาง |
   | `modelId` | `ESP32-DEVKIT-V1` | ข้อ 1 |
   | `protocol` | `HTTP` | ตาม `supportedProtocols` ของโมเดล |
   | `serialNumber` | MAC address ของบอร์ด | มีจริงและไม่ซ้ำ · ต้องอ่านจากบอร์ดจริงก่อนลงทะเบียน |
   | `imei` | `NO-IMEI-BOX-0001` | ESP32 ไม่มี IMEI |
   | `simNumber` | `NO-SIM-BOX-0001` | ไม่มี SIM · ไม่ซ้ำรายเครื่อง (มี partial unique index `Device_simNumber_active_key`) |
   | `blackboxId` | `NO-BLACKBOX-BOX-0001` | ไม่มี blackbox — ใช้หลักเดียวกัน (A ไม่ได้ระบุ field นี้ ขอยืนยัน §10.2) |

   **ห้ามใส่ค่าว่างหรือค่ากำกวม** แบบ `central:` ที่เคยเป็นปัญหาใน #360 — ระบบไม่มีทางแก้ข้อมูลเครื่องหลังลงทะเบียน
   ค่าจึงต้องอ่านออกว่าไม่ใช่ข้อมูลจริง · การทำ field เหล่านี้เป็น optional ตามประเภทโมเดลต้องคุยกับพี่เลี้ยงเรื่องฟอร์มลงทะเบียน
   (ยังรอคุยอยู่ ไม่อยู่ในแผนนี้)
3. **ตั้ง key กลาง** ที่ backend (§7.2) แล้ว**เปลี่ยน Config ของกล่อง** (`data_server` 4 ช่อง): จาก
   `http://<data-monitor>:320/api/gps` เป็น `{backend}:3001` + `path` = `/api/v1/device-sync/BOX-0001/telemetry/<key>` (§7.5)
4. **ไม่ต้องแก้ firmware เลย** — ไม่เปลี่ยน auth header (key อยู่ใน path) และไม่เปลี่ยนชื่อ field (DTO รับ snake_case — Q4)

ข้อ 1–3 เป็นงานตั้งค่าที่ B / admin ทำ

## 9. เอกสาร/คอมเมนต์ที่ต้องอัปเดตตอน implement

- `schema.prisma`: คอมเมนต์เหนือ `enum CampaignRolloutStatus` ที่ว่า "ไม่มีช่องทางรับ telemetry" + คอมเมนต์ deviation ของ
  2 ตารางใหม่และ 3 คอลัมน์ใหม่ (ไม่มีใน `GPS_Data_Dictionary.xlsx` — ตามกฎ "ห้ามเบี่ยงแบบเงียบๆ")
- คอมเมนต์เหนือ `DeviceDataReportDto` ว่า snake_case โดยตั้งใจ (Q4)
- `docs/api/openapi.yaml` (§4)
- `docs/architecture/RBAC_Matrix.md`: หมายเหตุ endpoint อุปกรณ์ใหม่ + แถว Auto-rule ที่ defer ไว้
- `docs/planning/01_GPS_Build_Reference.md` ข้อ 187 (telemetry ไประบบเดิม → มาที่ backend นี้แล้ว)
- `.env.example`: `TELEMETRY_INGEST_KEY_SHA256`, `TELEMETRY_RETENTION_DAYS`, `TELEMETRY_RATE_LIMIT_PER_DEVICE`,
  `TELEMETRY_RATE_LIMIT_PER_IP` พร้อมคำอธิบาย (ไม่ใส่ค่า key จริง)

## 10. คำตอบจาก A และการแบ่งงาน

### 10.1 สรุปที่ตัดสินแล้ว (A ตอบใน #356, 20 ต.ค. 2569)

| ข้อ | ตัดสิน | อยู่ที่ |
|---|---|---|
| Q1 retention | ลบข้อมูลเก่ากว่า 30 วัน (env `TELEMETRY_RETENTION_DAYS`) ทีละชุดเล็กๆ | §3.3 |
| Q2 event | เก็บลง `DeviceEvent` ยังไม่สร้าง Incident/Notification | §3.2 |
| Q3 firmware_version | `Device.reportedFirmwareVersion` + `reportedFirmwareAt` | §3.4, §6 |
| Q4 ชื่อ field | DTO รับ snake_case ตามกล่อง · `device_id` optional ต้องตรง path · `simulated` · `timestamp` ว่างได้ (ไม่ใช้ `@IsISO8601`) · `speed_kmh` null ได้ | §4 |
| Q5 สถานะเครื่อง | ปฏิเสธเฉพาะ `decommissioned` (401 เหมือน key ผิด) · `registered` รับได้ · telemetry ไม่เปลี่ยนสถานะเครื่อง | §7.3 |
| Q6 ใครใส่ key | B / admin ตั้งผ่าน Config ของ `delivery-server` | §7.5 |
| Q7 `fix = false` | เก็บทุกแถว · UI กรอง `fix = true` · `timestamp` ว่าง → `receivedAt` | §3.1, §5 |
| Q8 ลงทะเบียนกล่อง | `ESP32-DEVKIT-V1`, serial = MAC, `NO-IMEI-…` / `NO-SIM-…` | §8 |
| Q9 ใครทำ | B ทำ A รีวิว (ดูด้านล่าง) | §10.3 |
| Q10 key | key กลางก่อน + `Device.telemetryKeyHash` nullable ไว้ขยายเป็นต่อกล่อง | §7.2 |
| รีวิว §7 | เทียบ hash เสมอแม้ไม่พบเครื่อง · rate limit ต่อเครื่อง/IP · ขั้นตอนหมุน key | §7.3, §7.4, §7.6 |

### 10.2 ต้องยืนยันก่อน implement

1. **protocol `HTTP` ของโมเดล ESP32** — เช็คโค้ดแล้ว: `DeviceModel.supportedProtocols` / `Device.protocol` เป็น string อิสระ
   ไม่มีรายการค่าตายตัวทั้งใน DTO backend และฟอร์มเว็บ จึง**บันทึก `HTTP` ได้** · ที่ยังต้องยืนยัน: (ก) ทีมตกลงใช้ชื่อ `HTTP`
   (ตัวพิมพ์ใหญ่ แบบเดียวกับ `TCP`/`UDP` ที่มีอยู่) (ข) Config ของโมเดลนี้ต้องใช้ `protocol: HTTP` ด้วย (`ConfigService`
   บังคับให้อยู่ใน `supportedProtocols`) และส่วนที่เขียน Config ไประบบปลายทาง (`config-sync-writer`) ไม่ได้สมมุติว่ามีแค่
   `TCP`/`UDP` — ยังไม่ได้ตรวจส่วนนี้
2. **`blackboxId` ของ `BOX-0001`** — A ไม่ได้ระบุ ใช้ `NO-BLACKBOX-BOX-0001` ตามหลักเดียวกับ IMEI/SIM ขอ A ยืนยัน
3. **MAC address ของบอร์ด** — ต้องอ่านจากบอร์ดจริงก่อนลงทะเบียน
4. **สถานะออนไลน์ / `lastSeenAt`** — รอบแรก guard ใหม่ไม่เขียน `lastSeenAt` · จะใช้ telemetry หรือ Server กลาง (#359)
   เป็นแหล่งของสถานะออนไลน์ แยกตัดสินใน PR ถัดไป (A เสนอให้คุยต่อที่นี่)

### 10.3 แบ่งงาน (Q9)

- **B ทำ A รีวิว** — B รู้รายละเอียดกล่องและแผนนี้ลึกที่สุด ส่วน A ติดงานเชื่อมต่อ Server กลางและ Rollout ก่อนเดโม
- **ไม่เร่งให้ทันเดโม 23 และ 28 ต.ค.**
- **PR ที่ 1 (B):** migration (`DeviceTelemetry`, `DeviceEvent`, `Device.telemetryKeyHash`, `reportedFirmwareVersion`,
  `reportedFirmwareAt`) + `TelemetryKeyGuard` + limiter + endpoint + DTO + ตัวลบข้อมูลเก่า + openapi/RBAC_Matrix/เทส
- **PR ที่ 2 (ภายหลัง):** การแจ้งเตือนหรือกฎสร้าง Incident จาก `DeviceEvent` เมื่อมีข้อมูลจริงให้ตัดสิน · endpoint/หน้าจอออก
  key ต่อกล่องเมื่อจำเป็น

## 11. นอกขอบเขตของ PR นี้

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ `schema.prisma`, ไม่สร้าง endpoint, ไม่แก้ `openapi.yaml` หรือโค้ดใดๆ
- implementation เปิดเป็น PR แยกตาม §10.3
- ไม่รวม: หน้าแสดงตำแหน่ง/แผนที่บน Web หรือ Mobile, Auto-rule ใน §11.2 ที่ใช้ telemetry (Offline / GPS data
  gap / Version Verification ฯลฯ), การแจ้งเตือนจาก event, endpoint ออก key ต่อกล่อง, การแก้ firmware ของกล่อง
