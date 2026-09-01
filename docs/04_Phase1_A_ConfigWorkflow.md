# 04 — Phase 1-A: Config Workflow (Stage 1-2)

> เอกสารสรุป workflow ของโมดูล Config (issue #26) เฉพาะ Stage ที่ทำเสร็จแล้ว
> (Stage 1: CRUD, Stage 2: Import จากไฟล์ JSON) — Stage 3 (Simulate) และ
> Stage 4 (Approve/Reject) จะเพิ่มเข้ามาต่อในเอกสารนี้เมื่อเริ่มทำจริง

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
  วางแผนทำใน **Stage 3** พร้อม Simulate เพราะต้องมี schema ต่อ device model
  ก่อนถึงจะ validate ได้ลึกกว่านี้ (ดู `// TODO(Stage 3)` ใน
  `config.service.ts`)
- **ไม่ dedup ตอน import** — import ไฟล์ที่มี `deviceModel`/`protocol` ซ้ำกับ
  Config ที่มีอยู่แล้ว จะสร้างแถวใหม่แยกกัน ไม่ merge/replace ของเดิม
  สอดคล้องกับ [footnote ² ใน RBAC_Matrix.md](./architecture/RBAC_Matrix.md)
  (SW ทุกคนแก้ไข Config draft ร่วมกันได้ ไม่ scope ตาม creator)

### สิทธิ์ (RBAC)

`POST /config/import` ใช้ permission เดียวกับ `POST /config`: resource
`config`, action `Create` — เฉพาะ Role `SW` (ตาม `RolePermission` seed)

## อ้างอิง

- `docs/api/openapi.yaml` — สัญญา request/response เต็มของ
  `importConfig`/`createConfig`
- `docs/architecture/RBAC_Matrix.md` — ตาราง permission เต็ม + footnote
  การตัดสินใจเรื่อง ownership
- `01_GPS_Build_Reference.md` §3.1 — บริบทที่มาของแนวคิด
  `ConfigImporter`/`parseConfigFile` ที่ยังไม่ได้ทำ (ดูเหตุผล YAGNI ด้านบน)
