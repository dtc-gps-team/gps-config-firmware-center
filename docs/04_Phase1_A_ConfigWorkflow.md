# 04 — Phase 1-A: Config Workflow (Stage 1-3)

> เอกสารสรุป workflow ของโมดูล Config (issue #26) เฉพาะ Stage ที่ทำเสร็จแล้ว
> (Stage 1: CRUD, Stage 2: Import จากไฟล์ JSON, Stage 3: Simulate) — Stage 4
> (SW ปักผลตัดสินใจ/Approve/Reject) จะเพิ่มเข้ามาต่อในเอกสารนี้เมื่อเริ่มทำจริง

## ภาพรวม

Config draft ถูกสร้างได้ 2 ทาง แล้วต่อ flow เดียวกันจากจุดนั้นเป็นต้นไป:

1. **สร้างผ่านฟอร์ม** — `POST /config` (Stage 1)
2. **Import จากไฟล์ JSON** — `POST /config/import` (Stage 2)

ทั้งสองทางจบที่ `ConfigService.create()` เดียวกัน ไม่มี business rule พิเศษ
แยกสำหรับ import — ตาม `docs/api/openapi.yaml` ที่ระบุว่า import "แปลงเป็น
DeviceConfigDraft แล้วเข้า flow ทดสอบ/อนุมัติเดียวกับฟอร์ม"

## Stage 2: Import Config จากไฟล์ JSON

### ขั้นตอน (`ConfigService.importFromJson`)

1. เช็คว่ามีไฟล์แนบมาไหม (`multipart/form-data`, field name `file`) — ไม่มี
   → 400
2. เช็ค `format` ที่ส่งมาว่าอยู่ใน `SUPPORTED_IMPORT_FORMATS` (`['json']`
   ตอนนี้) — ไม่ตรง → 400
3. `JSON.parse()` เนื้อไฟล์ — parse ไม่ผ่าน → 400
4. เช็ค shape ว่าเป็น object เดียว ไม่ใช่ `null`/array/ค่าเดี่ยว — ไม่ผ่าน →
   400 (กันไม่ให้ `class-validator` โยน `TypeError` หลุดเป็น 500)
5. `plainToInstance(CreateConfigDto, parsed)` + `validate()` — DTO
   เดียวกับที่ฟอร์มใช้ ด้วย `whitelist: true, forbidNonWhitelisted: true`
   เหมือน global `ValidationPipe` — validate ไม่ผ่าน → 400 พร้อมรายละเอียด
   error ราย field
6. ผ่านหมด → เรียก `this.create(dto, actor)` เหมือน flow ฟอร์มทุกประการ
   (ผูก `createdBy` จาก JWT, สถานะเริ่มต้น `draft`)

### ข้อจำกัดของไฟล์

- ขนาดไฟล์ไม่เกิน 1MB (`IMPORT_FILE_SIZE_LIMIT_BYTES` ใน
  `config.controller.ts`) — เกิน → 413 (NestJS แปลง `MulterError` ให้เอง
  อัตโนมัติ ไม่ต้องมี exception filter แยก)
- รองรับเฉพาะ format `json` ตอนนี้ — CSV/format อื่นเป็น scope อนาคต

### จงใจไม่ทำ (YAGNI, ยืนยันแล้ว)

- **ไม่มี interface `ConfigImporter`/`parseConfigFile` แยก** — เขียน logic
  ตรงๆ ใน `importFromJson()` เพราะรองรับ format เดียว ยังไม่มีเหตุผลจะ
  abstract ล่วงหน้า จะ refactor แยก interface ตอนมี format ที่ 2 จริง
- **ไม่ validate `ConfigFieldDefinition`** — ตอนนี้ validate แค่ shape ของ
  `fields` (ต้องเป็น object) ยังไม่เช็คว่า field ตรงกับ schema ของ
  `deviceModel`/`protocol` นั้นๆ จริงไหม (field ครบ, type/ค่าถูกต้อง) —
  ต้องรอตาราง Config Definition Lookup (`ConfigFieldDefinition`) ทั้งตารางก่อน
  ถึงจะ validate ได้ลึกกว่านี้ — Stage 3 (Simulate) ก็จงใจไม่ทำส่วนนี้เช่นกัน
  (ดู `TODO(รอตาราง ConfigFieldDefinition)` ใน `config.service.ts`)
- **ไม่ dedup ตอน import** — import ไฟล์ที่มี `deviceModel`/`protocol` ซ้ำกับ
  Config ที่มีอยู่แล้ว จะสร้างแถวใหม่แยกกัน ไม่ merge/replace ของเดิม
  สอดคล้องกับ [footnote ² ใน RBAC_Matrix.md](./architecture/RBAC_Matrix.md)
  (SW ทุกคนแก้ไข Config draft ร่วมกันได้ ไม่ scope ตาม creator)

### สิทธิ์ (RBAC)

`POST /config/import` ใช้ permission เดียวกับ `POST /config`: resource
`config`, action `Create` — เฉพาะ Role `SW` (ตาม `RolePermission` seed)

## Stage 3: Simulate — ทดสอบกับ Device Simulator

### ขั้นตอน (`ConfigService.simulate`)

1. `findOne(id)` — ไม่เจอ Config → 404
2. เช็คว่า status ปัจจุบันอยู่ใน `SIMULATABLE_CONFIG_STATUSES`
   (`['draft', 'testing']`) ไหม — ไม่อยู่ (เช่น `approved`/`synced`) → 409
3. เรียก `DeviceSimulator.simulateConfig()` ด้วย `deviceModel`/`protocol`/
   `fields` **ที่ persist ไว้ใน DB ของ Config นี้เท่านั้น** (ไม่ใช้ค่าจาก
   request body แม้ `docs/api/openapi.yaml` จะรับ `deviceModel` มาได้ก็ตาม
   — ป้องกัน client ส่ง deviceModel ปลอมมาแล้วได้ผลทดสอบของอุปกรณ์คนละรุ่น)
4. คืนผล `SimulationResult { passed, details }` ตรงๆ — **ไม่แตะ status ของ
   Config เลย** กดซ้ำได้เรื่อยๆ ระหว่างที่ SW ยังปรับแก้ค่าอยู่

### Device Simulator — ยังเป็น Mock

ยังไม่มี Device Simulator จริงให้เชื่อมต่อ (สถานะเดียวกับ `config-sync-writer`
ใน Phase 2 ที่ยัง mock/docker) — `MockDeviceSimulator`
(`backend/src/config/device-simulator.ts`) ตรวจกฎเท่าที่รู้แน่นอนแทน:

1. Config ต้องมีอย่างน้อย 1 field
2. ฟิลด์ที่ชื่อเข้าเงื่อนไข Timeout/Interval (จับคู่แบบ case-insensitive
   substring กับ `TIMEOUT`/`INTERVAL`) ต้องไม่เป็นค่าติดลบ — ตรงกับตัวอย่างใน
   `03_GPS_Detailed_Build_Steps.md` Phase 1 ข้อ 3

นอกเหนือจากนี้ถือว่าผ่าน แยก Interface (`DeviceSimulator`) จาก Implementation
ตาม Build Reference §4.3 (Extensibility) ไว้แล้ว — วันไหนมี Simulator จริง
ค่อยเพิ่ม Implementation ใหม่แล้วสลับ provider ใน `config.module.ts` ที่เดียว

### สิทธิ์ (RBAC)

`POST /config/{id}/simulate` ใช้ resource ใหม่ `config-simulation` (action
`Read`) **แยกจาก resource `config` ธรรมดาโดยตั้งใจ** — กัน Auditor/Admin ที่มี
`config`+`Read` อยู่แล้ว (ไว้ดูรายการ/รายละเอียดเฉยๆ) ไม่ให้เผลอเรียก simulate
ได้ไปด้วย ตรงกับ RBAC_Matrix.md ตาราง 4.1 ที่จำกัดไว้แค่ SW/Operation/ST/OT —
ดูเหตุผลเต็มใน `docs/architecture/RBAC_Matrix.md` (changelog แก้ครั้งที่ 10)

### จงใจไม่ทำใน Stage นี้

- **ไม่เปลี่ยน status** — การที่ SW ปักผลตัดสินใจผ่าน/ไม่ผ่านแล้วเปลี่ยน
  status จริงๆ แยกไปเป็น `POST /config/{id}/decide` ต่างหาก (Stage 4)
- **ไม่ตรวจกับ `ConfigFieldDefinition` จริง** — เพราะยังไม่มีตาราง Config
  Definition Lookup (ตาม `TODO(รอตาราง ConfigFieldDefinition)` ใน `importFromJson`
  — จริงๆ แล้วงานนี้ต้องรอ Config Definition Lookup ทั้งตารางก่อน ไม่ใช่แค่
  Stage 3 นี้ จึงยังเป็น Mock ตรวจกฎทั่วไปแทน)
- **ไม่เก็บผลทดสอบลง DB** — `SimulationResult` เป็น response ชั่วคราว โชว์ให้
  SW ดูตอนนั้นเท่านั้น ตาม docs/api/openapi.yaml ที่ไม่ได้นิยาม field เก็บผล
  ทดสอบไว้ใน `DeviceConfigDraft` schema

## อ้างอิง

- `docs/api/openapi.yaml` — สัญญา request/response เต็มของ
  `importConfig`/`createConfig`
- `docs/architecture/RBAC_Matrix.md` — ตาราง permission เต็ม + footnote
  การตัดสินใจเรื่อง ownership
- `01_GPS_Build_Reference.md` §3.1 — บริบทที่มาของแนวคิด
  `ConfigImporter`/`parseConfigFile` ที่ยังไม่ได้ทำ (ดูเหตุผล YAGNI ด้านบน)
