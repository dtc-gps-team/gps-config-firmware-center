# ขั้นตอนการสร้างระบบแบบละเอียด (Detailed Build Steps)
## GPS Config & Firmware Center

**อ้างอิงจาก:** GPS_Project_Structure_Formal.md v3.7, 01_GPS_Build_Reference.md, 02_GPS_Development_Plan.md
**จุดต่างจาก 02_GPS_Development_Plan.md:** เอกสารนี้ลงรายละเอียดขั้นตอนย่อยในแต่ละ Phase ทีละก้าน พร้อม **Checkpoint (Definition of Done)** ท้ายทุก Phase ว่าทำเสร็จแล้วต้องได้อะไรเพิ่มมาบ้าง — ใช้เป็น Checklist ระหว่างพัฒนาจริงได้เลย
**การแบ่งงาน 2 คน (ปรับใหม่ — แบ่งตามแพลตฟอร์ม):** ใช้หลักการเดียวกับ `02_GPS_Development_Plan.md` — **แทนที่การแบ่งแบบเดิมใน `docs/planning/Team_Task_Plan_2Persons.md` แล้ว** ตอนนี้แบ่งเป็น **A (paveekornkwork-dev) = Web + Backend module: `auth`/RBAC, `config`, `firmware`, `campaign`, `incident`, `audit`, `device-status`** และ **B (kittiphongkubkub) = Mobile + Backend module: `task`, `notification`** ส่วน `config-sync-writer` (Critical Infra) และงานที่เชื่อม Web↔Mobile โดยตรงเป็น **ร่วมกัน** แต่ละ Phase ด้านล่างระบุผู้รับผิดชอบต่อขั้นตอนไว้ในวงเล็บ `[A]` / `[B]` / `[ร่วมกัน]`

**รวมประเด็นจาก Gap Analysis:** เพิ่มขั้นตอนที่ยังไม่เคยมีในแผนเดิม ได้แก่ RBAC Matrix, Semantic Validation ของ Config, Rollback Mechanism, การเขียนเข้าระบบเดิมพร้อมกันหลายกล่อง, Alert เมื่อ Sync ล้มเหลว, Device Lifecycle, และความปลอดภัยของการเชื่อมต่อระบบเดิม

---

## Phase 0 — Setup โครงสร้างโปรเจกต์ + รากฐานที่ขาดไม่ได้

### ขั้นตอน

1. `[ร่วมกัน]` ตั้ง Monorepo: สร้างโฟลเดอร์ `web/`, `backend/`, `mobile/`, `docs/` แยก `package.json`/`pubspec.yaml` ของตัวเอง ตามโครงสร้างใน Build Reference Section 2
2. `[ร่วมกัน]` ตั้ง `docker-compose.yml` สำหรับ PostgreSQL, Redis, MinIO (dev environment) — ทดสอบว่า `docker-compose up` รันได้ทั้งหมดโดยไม่ error
3. `[ร่วมกัน]` ตั้งค่า Prisma schema เริ่มต้น: ตาราง `User`, `Role`, `Permission`, `Config`, `Firmware`, `Task`, `Campaign`, `Incident`, `AuditLog`, `Device` — Schema กลางนี้ทั้งคู่ต้องใช้ร่วมกัน จึงต้องตกลงโครงสร้างฟิลด์ด้วยกันก่อนแยกไปทำงานของแต่ละคน
4. `[A]` **ทำ RBAC Matrix ให้เสร็จก่อนเขียนโค้ด Auth** (Gap ที่พบจากการวิเคราะห์) — ทำตารางระบุชัดว่าแต่ละ Role (SW, Operation, ST, OT, Auditor, Admin, Field Technician) เข้าถึงหน้าจอ/Action ไหนได้บ้าง (Create/Read/Update/Approve/Override) เก็บเป็นเอกสารแยก `docs/architecture/RBAC_Matrix.md` — ห้ามเขียน Auth Guard ก่อนมี Matrix นี้ เพราะจะได้ Guard ที่ไม่ครบ/ไม่ตรงกันระหว่างจอ — แม้ A เป็นคนทำ แต่ต้องคุยเนื้อหากับ B ก่อนปิด เพราะ B ต้องเอาไปใช้ทำ RBAC ฝั่ง Mobile
5. `[A]` สร้างโมดูล `auth`: Passport.js/JWT, Login endpoint, Guard ตาม RBAC Matrix ข้อ 4
6. `[ร่วมกัน]` ตั้ง CI/CD เบื้องต้นด้วย GitHub Actions (lint + test อัตโนมัติ ทุก Pull Request)
7. `[ร่วมกัน]` ตั้ง `.env.example` ให้ครบตาม Build Reference Section 7 (รวม `LEGACY_SYNC_MODE` และตัวแปรอื่นที่ยังไม่ได้ใช้จริงแต่เตรียมไว้)
8. `[ร่วมกัน]` **ออกแบบ Device Registration เบื้องต้น** (Gap ที่พบ) — เพิ่มตาราง `Device` ให้มีฟิลด์ `device_id`, `sim_number`, `device_model`, `protocol`, `status` (`registered`/`installed`/`decommissioned`), `registered_at`, `installed_at` — ยังไม่ต้องทำหน้าจอ แค่มี Schema รองรับไว้ก่อน (B จะใช้ทำ Device Registration Flow ฝั่ง Mobile ใน Phase 5 และ A จะใช้ทำ Device Search/Override ฝั่ง Web ใน Phase 4 จึงต้องออกแบบร่วมกัน)

**จุดส่งมอบก่อนเข้า Phase 1:** A ต้องส่ง RBAC Matrix (ข้อ 4) ให้ B ก่อน — A เองก็ใช้ Matrix นี้กำหนดสิทธิ์บนหน้า Config Editor/Approval Center ใน Phase 1 ด้วยเช่นกัน

### Checkpoint — Phase 0 เสร็จแล้วต้องได้อะไร

- [ ] รัน `web/`, `backend/`, `mobile/` แยกกันได้จริงบนเครื่อง dev
- [ ] Login ผ่าน JWT ได้ และ Guard บล็อกตาม Role ตรงกับ RBAC Matrix ที่ทำไว้ (มีเอกสาร RBAC Matrix เป็นไฟล์จริง ไม่ใช่แค่พูดคุยกัน)
- [ ] Prisma schema มีตารางครบตามข้อ 3 และ 8 พร้อม migration ที่รันได้
- [ ] CI เขียว (lint + test ผ่าน) บน Pull Request แรก
- [ ] `.env.example` ครบทุกตัวแปรที่ระบบทั้งหมดจะใช้ (แม้ยังไม่ implement จริงทุกตัว)

---

## Phase 1 — Config Workflow (สร้าง → ทดสอบ → อนุมัติ)

### ขั้นตอน

1. `[A]` สร้างโมดูล `config`: Endpoint CRUD Config (Draft/Update/Delete Draft)
2. `[A]` **ทำ Config Definition Lookup ก่อน** — ตารางเก็บนิยามฟิลด์ Config ทั้ง ~262 ฟิลด์ (ชื่อ, Data Type, ค่าที่ยอมรับได้ถ้ารู้, Required/Optional) แม้เอกสารต้นฉบับจากพี่ในทีมยังไม่ครบ ก็ให้เริ่มจากฟิลด์ที่รู้แน่นอนก่อน (APN1, MTYP, SIM1, SEV1 ฯลฯ) ที่เหลือ mark เป็น `unknown_spec: true` ไว้ในตาราง Definition
3. `[A]` **เพิ่ม Semantic Validation เท่าที่ทำได้** (Gap ที่พบ) — นอกจากตรวจ Data Type ตรงกันแล้ว ใส่กฎเพิ่มเท่าที่รู้จริง เช่น ค่าตัวเลขต้องไม่ติดลบถ้ารู้ว่าฟิลด์นั้นเป็นค่าที่เป็นบวกเสมอ (Timeout, Interval) — ฟิลด์ที่ไม่รู้กฎให้ตรวจแค่ Data Type ตรงกันตามที่ตกลงไว้ (ทำเครื่องหมาย `validation_level: syntactic_only` เทียบกับฟิลด์ที่มี `validation_level: semantic` ไว้ในโค้ด เพื่อให้เห็นชัดว่าฟิลด์ไหนตรวจแน่นแค่ไหน)
4. `[A]` สร้างหน้า Web "Config Editor" (ฟอร์มกรอกตาม Config Definition Lookup) พร้อม Client-side Validation (React Hook Form + Zod)
5. `[A]` สร้างฟีเจอร์ "Import Config จากไฟล์ JSON" (v3.2) ตาม Interface `ConfigImporter` ใน Build Reference Section 3.1 — Validate Schema ก่อนแปลงเป็น `DeviceConfigDraft` เดียวกับที่ฟอร์มสร้าง
6. `[A]` เชื่อมกับ Device Simulator: ส่ง Config Draft ไปทดสอบ รับผลกลับมาแสดงบนหน้า Web ให้ SW ดู
7. `[A]` ทำหน้า SW "ตัดสินใจผ่าน/ไม่ผ่าน" ด้วยตัวเอง (ปุ่มกดยืนยันเอง ไม่ใช่ระบบตัดสินอัตโนมัติ) — ถ้าไม่ผ่าน สถานะกลับไปเป็น Draft ให้แก้ไขใหม่
8. `[A]` ทำหน้า Operation "Approval Center": ดูผลทดสอบ + อนุมัติ/ปฏิเสธ — ถ้าปฏิเสธ สถานะต้องย้อนกลับไปที่ Draft (ไม่ใช่แค่สถานะ "รอแก้ไข") เพื่อบังคับให้กลับไปทดสอบกับ Simulator ใหม่ทั้งหมดตามที่ยืนยันไว้ (Section 3.1 ของ Formal.md)
9. `[A]` บันทึก Config ที่อนุมัติแล้วลง Central Data Store พร้อมเก็บ**ประวัติทุกเวอร์ชัน** ไม่ใช่แค่เวอร์ชันล่าสุด (จำเป็นสำหรับ Rollback ใน Phase 4)

**จุดส่งมอบก่อนเข้า Phase 2:** A ต้องมีโครงสร้าง `DeviceConfigDraft` และสถานะ Config นิ่งแล้ว เพราะ `config-sync-writer` ใน Phase 2 จะรับ Config ที่อนุมัติแล้วจากตรงนี้ไปเขียนต่อ

### Checkpoint — Phase 1 เสร็จแล้วต้องได้อะไร

- [ ] สร้าง Config ได้ทั้งผ่านฟอร์มและ Import JSON แล้วผลลัพธ์เข้า flow เดียวกัน
- [ ] Config Definition Lookup มีข้อมูลฟิลด์อย่างน้อยกลุ่มที่รู้แน่นอนแล้ว (ไม่ต้องครบ 262 ฟิลด์ แต่ต้องมี Metadata ระบุว่าฟิลด์ไหน "รู้กฎ" ฟิลด์ไหน "รู้แค่ Data Type")
- [ ] SW ทดสอบกับ Simulator แล้วตัดสินใจผ่าน/ไม่ผ่านได้จริงผ่านหน้า Web
- [ ] Operation อนุมัติ/ปฏิเสธได้ และปฏิเสธแล้วบังคับย้อนกลับไป Draft จริง (ทดสอบ Flow นี้ด้วยเคสจริงอย่างน้อย 1 เคส)
- [ ] Config ที่อนุมัติแล้วถูกเก็บพร้อมประวัติเวอร์ชัน ดึงเวอร์ชันเก่ากลับมาดูได้

---

## Phase 2 — config-sync-writer และ device-status (Mock/Stub + งานที่ต้องคิดล่วงหน้าเพื่อ Production)

### ขั้นตอน

1. `[ร่วมกัน]` เขียน Interface `ConfigSyncWriter.writeConfigToLegacySystem()` (ดู Build Reference Section 4.1) — `config-sync-writer` เป็น Critical Infra ที่กระทบทั้งระบบถ้าพลาด จึงเป็นงานร่วมกันไม่ใช่ของคนใดคนหนึ่ง
2. `[ร่วมกัน]` Implementation โหมด `mock`: เขียน Log แทนการยิง TCP จริง
3. `[ร่วมกัน]` Implementation โหมด `docker`: ยิงไปเครื่อง Local/Docker ทดสอบ (`127.0.0.1:801`)
4. `[ร่วมกัน]` เชื่อม flow อนุมัติ Config (Phase 1 ข้อ 8) ให้เรียก `config-sync-writer` เป็น Background Job ทันทีที่ Operation อนุมัติ
5. `[ร่วมกัน]` **ออกแบบ Retry/Timeout/Queue ตั้งแต่ตอนนี้** (Gap ที่พบ — เขียนเข้าระบบเดิมพร้อมกันหลายกล่อง) — ใช้ Queue (เช่น Bull/BullMQ บน Redis ที่มีอยู่แล้ว) รับงานเขียนเข้าระบบเดิมทีละ Job แทนการยิง Concurrent ไม่จำกัด กำหนด Concurrency Limit เริ่มต้นแบบระมัดระวัง (เช่น 5 connection พร้อมกัน) ปรับเพิ่มได้ทีหลังเมื่อรู้ขีดจำกัดจริงของระบบเดิม ใส่ Retry แบบ Exponential Backoff เมื่อ TCP Timeout/Connection Refused
6. `[A]` เขียน Interface `DeviceStatusChecker.checkDeviceStatus()` (module `device-status` เป็นของ A — แสดงผลบนหน้าเว็บ) — **ยืนยันแล้ว (v3.3)** ว่ากล่องเช็คเวอร์ชันตัวเองตอนเปิดเครื่อง (Boot) ไม่ใช่ตามคาบเวลาคงที่ ระหว่างที่ยังไม่รู้ว่ากล่องเปิดเครื่องบ่อยแค่ไหนจริง ให้ Poll แบบสั้นๆ ไปก่อน (เช่นทุก 1 นาที) เพื่อความง่าย พร้อมคอมเมนต์ `// TODO: เปลี่ยนเป็น Event-driven จาก Telemetry เมื่อออกแบบได้ ไม่ต้อง Poll ถี่เกินจำเป็น` — หมายเหตุ (v3.6): ทีมอยากให้ตัว**กล่อง**เช็คตามรอบเวลาคงที่เพิ่มเติมด้วย (เช่น ทุก 6 ชม.) นอกเหนือจากตอนเปิดเครื่อง แต่นั่นเป็น TBD ที่ต้องถามพี่ในทีม/ผู้ผลิตกล่องว่า Firmware รองรับไหม ไม่ใช่สิ่งที่ `device-status` module (ซึ่งเป็นแค่ตัวที่เราใช้ "เช็คผลจากฝั่งเรา" ไม่ใช่ตัวกล่องเอง) จะแก้ปัญหานี้แทนได้ — ถ้ากล่องรองรับได้ ค่อยเพิ่มค่ารอบเวลาเป็นฟิลด์หนึ่งใน Config ที่เขียนผ่าน `config-sync-writer` ตามปกติ
7. `[ร่วมกัน]` **เพิ่ม Alert เมื่อ Sync ล้มเหลว** (Gap ที่พบ) — ถ้า `config-sync-writer` เขียนไม่สำเร็จเกิน N ครั้ง (Retry หมด) หรือกล่องไม่อัปเดตหลังผ่านไปเกิน M รอบเช็ค (ตัวเลขจริงรอ TBD คาบเวลา แต่ Logic ให้เตรียมไว้ก่อน) ให้สร้าง Incident อัตโนมัติ + แจ้งเตือนผ่าน `notification` module ไปยัง Operation/SW ที่เกี่ยวข้อง — แยกจาก Notification ทั่วไป ให้มีระดับความสำคัญ (Severity) กำกับ (A ทำฝั่ง Trigger เพราะอยู่ใน `config-sync-writer`/`incident`, ร่วมกันออกแบบ Threshold/ข้อความแจ้งเตือนเพราะ `notification` เป็นของ B)
8. `[ร่วมกัน]` ทำหน้า Web แสดงสถานะกล่อง ใช้ข้อความ UX แบบ **"จะได้รับการอัปเดตในการเปิดเครื่องครั้งถัดไปของกล่อง"** (ปรับข้อความตามข้อเท็จจริง v3.3 — ไม่ใช้คำว่า "รอบถัดไป" แบบกำกวมอีกต่อไป)

**จุดส่งมอบก่อนเข้า Phase 3:** ต้องมี `config-sync-writer` และ Queue พร้อมใช้แล้ว (โหมด mock/docker) — Phase 3 (Firmware) ที่ A ทำจะเรียกใช้ Interface เดียวกันนี้ ไม่ต้องรอให้ทำ Firmware ให้เสร็จก่อน แค่ต้องมี Interface ที่นิ่งแล้วให้เรียกได้

### Checkpoint — Phase 2 เสร็จแล้วต้องได้อะไร

- [ ] อนุมัติ Config แล้วเห็น Log การเขียนเข้าระบบเดิม (โหมด mock และ docker ทั้งคู่)
- [ ] เขียนเข้าระบบเดิมพร้อมกันหลายกล่องผ่าน Queue ได้โดยไม่ยิง Connection เกิน Limit ที่ตั้งไว้ (ทดสอบด้วยการอนุมัติ Config หลายตัวพร้อมกัน)
- [ ] มี Retry อัตโนมัติเมื่อจำลอง TCP Timeout ได้ (ทดสอบโดยปิดเครื่อง Docker ทดสอบชั่วคราวแล้วดูว่า Retry ทำงาน)
- [ ] เกิด Incident อัตโนมัติเมื่อจำลอง Sync ล้มเหลวเกิน Retry ที่ตั้งไว้
- [ ] หน้าเว็บแสดงสถานะกล่องแบบ Placeholder ได้ พร้อมข้อความ UX ที่ไม่สัญญาเวลาแน่นอน

---

## Phase 3 — Firmware Workflow

### ขั้นตอน

1. `[A]` สร้างโมดูล `firmware`: รับไฟล์ผ่าน**การอัปโหลดตรงเข้าระบบเราทางเดียวเท่านั้น** (v3.7 — ตัดช่องทาง "ดึงจากระบบเดิม" ออกทั้งหมด ไม่มีช่องทางสำรองอื่น) เก็บลง Object Storage (MinIO) พร้อม Metadata เวอร์ชัน และบันทึก/แสดงสถานะอัปโหลด-จัดเก็บฝั่งเรา (`upload_status`)
2. `[A]` เพิ่มฟิลด์ Compatibility: ระบุว่า Firmware เวอร์ชันนี้ใช้กับ `device_model` ไหนได้บ้าง (ป้องกันส่ง Firmware ผิดรุ่นเข้ากล่อง)
3. `[ร่วมกัน — จุดบรรจบ]` เชื่อมกับ `config-sync-writer` (ขยาย Interface เป็น `writeFirmwarePointerToLegacySystem()`) ใช้ Queue เดียวกับ Phase 2 ข้อ 5 — A (เจ้าของโมดูล `firmware`) เรียกใช้ Interface ของ `config-sync-writer` ที่เป็นงานร่วมกันจาก Phase 2 ตรงนี้คือจุดที่ทั้งคู่ควรคุยกันก่อนเริ่ม
4. `[A]` เชื่อมสถานะฝั่งกล่องเข้ากับ `device-status` (v3.7 — ใช้กลไกเดียวกับที่ติดตาม Config) เพื่อแสดง**สถานะอัปเดตเวอร์ชัน Firmware จริงของกล่อง** แยกจากสถานะอัปโหลด/จัดเก็บของเรา — หน้าเว็บต้องแสดงทั้ง 2 ฝั่งแยกกันชัดเจน
5. หมายเหตุ: กลไกที่กล่องดาวน์โหลด**ไฟล์**จริงยังเป็น TBD — Phase นี้ทำแค่จัดเก็บ + เตรียมโครงสร้างไว้ก่อน

### Checkpoint — Phase 3 เสร็จแล้วต้องได้อะไร

- [ ] อัปโหลด Firmware เข้าระบบเราได้ (ทางเดียว — v3.7) เก็บ Metadata + Compatibility Tag ถูกต้อง พร้อมแสดงสถานะอัปโหลด/จัดเก็บ
- [ ] เชื่อม `config-sync-writer` (โหมด mock/docker) สำหรับ Firmware ได้เหมือน Config
- [ ] แสดงสถานะอัปเดตเวอร์ชันจริงของกล่อง (ผ่าน `device-status`) แยกจากสถานะอัปโหลดฝั่งเรา — ครบทั้ง 2 ฝั่ง

---

## Phase 4 — Rollback, Campaign, Task, Incident, Notification, Audit

### ขั้นตอน

1. `[ร่วมกัน]` **ทำ Rollback Mechanism ให้เป็นรูปเป็นร่าง** (Gap ที่พบ) — ให้ Operation เลือก "ย้อนกลับไปเวอร์ชันก่อนหน้า" ได้จากประวัติที่เก็บไว้ตั้งแต่ Phase 1 ข้อ 9 กด Rollback แล้วระบบสร้าง Config เวอร์ชันใหม่ที่มีค่าเดียวกับเวอร์ชันก่อนหน้า (ไม่ใช่การลบเวอร์ชันที่มีปัญหาทิ้ง) แล้วเข้า flow เขียนเข้าระบบเดิมตามปกติ — อธิบาย UX ให้ผู้ใช้เข้าใจว่า Rollback ก็ต้องรอกล่องเช็ครอบถัดไปเหมือนการอัปเดตปกติ ไม่ใช่ยกเลิกได้ทันที (A ทำ Logic ย้อนเวอร์ชัน Config ใน `config` module และ UI หน้า Incident ที่กดเรียกใช้ แต่ต้องคุยกับ B ก่อนเริ่มเพราะ Rollback สุดท้ายไปเรียก `config-sync-writer` ที่เป็นงานร่วมกัน)
2. `[A]` `campaign`: จัดลำดับ/ทยอยเขียนข้อมูลเข้าระบบเดิมเป็นกลุ่ม (Pilot/Canary/Batch) โดยใช้ Queue จาก Phase 2 — ทำ Campaign Monitor ให้ดึง Failure Rate จริงจาก Incident ที่เกิดจาก Sync ล้มเหลว (เชื่อมกับ Phase 2 ข้อ 7)
3. `[B]` `task`: มอบหมายงานให้ทีมช่างหน้างาน เชื่อมกับ Mobile app
4. `[A]` `incident`: บันทึกปัญหาที่เกิดระหว่างอัปเดต เชื่อมกับ Rollback (ข้อ 1) ให้กด Rollback ได้จากหน้า Incident โดยตรง — ต้องรับ Incident อัตโนมัติจากทั้งฝั่ง `config-sync-writer` (Phase 2 ข้อ 7) และฝั่ง Mobile Simulator Test (Phase 5 ข้อ 7 ที่ B ทำ) จึงต้องคุยกับ B เรื่องรูปแบบข้อมูลที่ส่งเข้ามาให้ตรงกัน
5. `[ร่วมกัน]` `notification`: FCM ไป Mobile + WebSocket ไป Web (รวม Alert จาก Phase 2 ข้อ 7) — module นี้เป็นของ B แต่ต้องออกแบบร่วมกับ A เพราะต้องรองรับ Alert ที่ยิงมาจากโมดูลฝั่ง A ด้วย
6. `[A]` `audit`: บันทึก log การอนุมัติ/ปฏิเสธ/แก้ไข/Rollback ทุกจุดสำคัญ พร้อมผู้กระทำและเวลา

### Checkpoint — Phase 4 เสร็จแล้วต้องได้อะไร

- [ ] กด Rollback จากหน้า Incident หรือหน้า Config History ได้จริง แล้วเห็น Config เวอร์ชันเก่าถูกเขียนกลับเข้าระบบเดิม (โหมด mock/docker)
- [ ] Campaign ปล่อยเวอร์ชันเป็นกลุ่มได้ (Pilot → Canary → Batch) และ Campaign Monitor แสดง Failure Rate จริงจากข้อมูล Incident
- [ ] Audit Log บันทึกครบทุก Action สำคัญ ตรวจสอบย้อนหลังได้ว่าใครอนุมัติ/ปฏิเสธ/Rollback อะไรเมื่อไหร่

---

## Phase 5 — Mobile App + Device Lifecycle

### ขั้นตอน

1. `[B]` หน้าจอ 5 หมวดตาม Sitemap: dashboard, task, campaign, incident, device
2. `[B]` **ทำ Device Registration Flow** (Gap ที่พบ) — ตอนช่างหน้างานติดตั้งกล่องใหม่ครั้งแรก ให้กรอกข้อมูลกล่อง (Device ID, SIM Number, Device Model) ผ่านแอป Mobile บันทึกเข้าตาราง `Device` ที่เตรียมไว้ตั้งแต่ Phase 0 สถานะเริ่มต้นเป็น `registered` เปลี่ยนเป็น `installed` เมื่อยืนยันติดตั้งสำเร็จ (ฟีเจอร์ "Confirm Install" ในตาราง Sprint)
3. `[B]` Flow ดูสถานะกล่อง (อ่านอย่างเดียว) — ดึงจาก `device-status` module ที่ A ทำไว้ใน Phase 2
4. **ไม่ต้องสร้างโมดูลสื่อสารกับกล่อง GPS ใดๆ** (ไม่มี TCP Client, ไม่มี SMS)
5. `[B]` Offline-first ด้วย Drift (SQLite) + Sync Queue สำหรับข้อมูลงานหน้างานและ Device Registration (กรณีไม่มีสัญญาณตอนติดตั้ง)
6. `[A]` เพิ่มหน้า Admin/Operation ฝั่ง Web สำหรับ **Decommission Device** (Gap ที่พบ) — เปลี่ยนสถานะกล่องเป็น `decommissioned` เมื่อเลิกใช้งาน กันไม่ให้กล่องที่เลิกใช้แล้วยังโผล่ในรายงานสถานะ/Campaign — เป็นหน้า Web จึงเป็นงานของ A แม้ Phase นี้ส่วนใหญ่เป็นของ B ก็ตาม
7. `[B + A]` **เพิ่มปุ่ม "ทดสอบกับ Device Simulator" ก่อนยืนยันติดตั้ง** (ใหม่ v3.5 — ไม่บังคับ) — B ทำ UI ฝั่ง Mobile (ปุ่มเรียกทดสอบ + แสดงผล + disable ปุ่ม Confirm Install เมื่อไม่ผ่าน) A เปิด Endpoint `POST /api/v1/config/{id}/simulate` และ `/firmware/{id}/simulate` ให้ Mobile เรียกได้ (ใช้ Simulator ตัวเดียวกับที่ Web ใช้ใน Phase 1 ซึ่งเป็นของ A) — ถ้าผลไม่ผ่าน ต้องสร้าง Incident อัตโนมัติพร้อมเหตุผล (เชื่อมกับโมดูล `incident` ใน Phase 4 ซึ่งเป็นของ A)

### Checkpoint — Phase 5 เสร็จแล้วต้องได้อะไร

- [ ] ช่างหน้างานติดตั้งกล่องใหม่ผ่านแอป แล้ว Record เข้าตาราง Device ได้จริง (ทดสอบ Flow แบบ Offline แล้ว Sync กลับมาสำเร็จ)
- [ ] ดูสถานะกล่องผ่านแอปได้ (Read-only)
- [ ] Decommission กล่องได้จากฝั่ง Web และกล่องนั้นหายไปจากรายการที่ใช้งานอยู่
- [ ] กดปุ่ม "ทดสอบกับ Device Simulator" ก่อน Confirm Install ได้ (ทางเลือก) — ทดสอบทั้ง 2 เคส: ผลผ่านแล้วกด Confirm Install ได้ปกติ / ผลไม่ผ่านแล้วปุ่ม Confirm Install ถูกบล็อกพร้อมสร้าง Incident อัตโนมัติ

---

## Phase 6 — เชื่อมต่อระบบเดิมจริง + ความปลอดภัย (⏸ ชะลอไว้ก่อนตามคำสั่งของทีม — ยังไม่เริ่ม)

> **หมายเหตุ (27 สิงหาคม 2569):** ทีมยืนยันชัดเจนว่า **ยังไม่ต้องการเชื่อมต่อกับระบบ Production จริง (`config.dtc.co.th`) ในตอนนี้** พัฒนาและทดสอบ `config-sync-writer` ในโหมด `mock`/`docker` ต่อไปตาม Phase 0–5 ได้ตามปกติ แต่ **ห้ามเริ่ม Phase 6 (เปลี่ยนเป็นโหมด `production`) จนกว่าจะได้รับคำสั่งเริ่มชัดเจนจากทีมอีกครั้ง** แม้ TBD ทั้ง 2 ข้อ (รูปแบบคำสั่ง Write/Set, พฤติกรรมเปิด/ปิดเครื่องของกล่อง) จะถูกปิดแล้วก็ตาม — การปิด TBD ทางเทคนิคไม่ได้แปลว่าอนุญาตให้ต่อ Production โดยอัตโนมัติ ต้องรอการตัดสินใจแยกต่างหาก

**เงื่อนไขเริ่ม Phase นี้ (ต้องครบทั้ง 2 ข้อ):** (1) ได้คำตอบ TBD ข้อรูปแบบคำสั่ง Write/Set จากพี่ในทีมแล้ว **และ** (2) ทีมสั่งให้เริ่มเชื่อมต่อ Production ได้แล้วอย่างชัดเจน

### ขั้นตอน

1. `[ร่วมกัน]` ยืนยันสิทธิ์การเข้าถึง/เขียนข้อมูลเข้าระบบเดิมกับผู้ดูแลระบบเดิม — ขอ Credential เฉพาะของระบบเรา (ไม่ใช้ Credential ส่วนตัวของใครคนหนึ่ง)
2. `[ร่วมกัน]` **ตรวจสอบความปลอดภัยของการเชื่อมต่อ** (Gap ที่พบ) — ยืนยันว่า TCP Connection ไปยัง `config.dtc.co.th:909` เข้ารหัสหรือไม่ (ถ้าไม่เข้ารหัส ต้องประเมินความเสี่ยงร่วมกับผู้ดูแลระบบเดิมว่ายอมรับได้หรือต้องทำ VPN/Private Network เพิ่ม) เก็บ Credential ใน Secret Manager ไม่ใช่ `.env` ธรรมดาบน Production
3. `[ร่วมกัน]` ทดสอบคำสั่ง Write/Set กับเครื่อง Local/Docker ให้ตรงกับที่ Hercules ทำได้ก่อนเสมอ
4. `[ร่วมกัน]` เปลี่ยน Implementation ของ `config-sync-writer` จาก mock/docker เป็น production — ไม่ต้องแก้โค้ดส่วนอื่นเพราะเรียกผ่าน Interface อยู่แล้ว
5. `[ร่วมกัน]` **ทำ Rate Limit ฝั่งเราเองสำหรับ Production** (Gap ที่พบ) — ตั้ง Concurrency Limit ที่อนุรักษ์นิยมกว่าตอนทดสอบ (เช่นเริ่มที่ 2-3 connection พร้อมกัน) แล้วค่อยๆ ขยับขึ้นหลังพิสูจน์ว่าระบบเดิมรับได้ ป้องกันไม่ให้ระบบเรากระทบระบบ Production ของทีมอื่นวงกว้าง
6. `[A]` เมื่อได้คำตอบ TBD ว่ากล่องเปิด/ปิดเครื่องบ่อยแค่ไหนในสนามจริง (v3.3) ปรับข้อความ UX บนหน้าเว็บให้ระบุเวลารอที่ชัดเจนขึ้น (แทนคำว่า "การเปิดเครื่องครั้งถัดไป" แบบกว้างๆ — Web display เป็นของ A) และร่วมกันปรับ Threshold การแจ้ง Alert (Phase 2 ข้อ 7) ให้สอดคล้องกับพฤติกรรมเปิดเครื่องจริง
7. `[ร่วมกัน]` Rollout แบบ Canary ก่อนเสมอ (ผ่าน `campaign` module) — เขียนเข้าระบบเดิมกับกล่องกลุ่มเล็กก่อน สังเกตผลจริงผ่าน Customer ERP แล้วค่อยขยายเป็น Batch ใหญ่

### Checkpoint — Phase 6 เสร็จแล้วต้องได้อะไร

- [ ] `config-sync-writer` ทำงานกับระบบ Production จริงได้ กล่องอัปเดตตัวเองสำเร็จ เห็นผลใน Customer ERP ตรงกับที่คาดไว้
- [ ] Credential เก็บใน Secret Manager ไม่มีในโค้ดหรือ `.env` ที่ commit เข้า git
- [ ] Rate Limit ฝั่งเราทำงานจริง (ทดสอบว่าไม่ยิง Connection เกิน Limit ที่ตั้งไว้แม้มี Job เข้าคิวเยอะ)
- [ ] Canary Rollout ผ่านกลุ่มเล็กสำเร็จก่อนขยาย Batch ใหญ่ — มี Log/Report ยืนยันผลการทดสอบ Canary

---

## สรุป Checkpoint ทั้งหมดแบบภาพรวม

| Phase | สิ่งที่ได้เพิ่มมาเมื่อ Phase เสร็จ |
|---|---|
| 0 | โปรเจกต์รันได้ครบ 3 ส่วน + Login/RBAC ทำงานจริงตาม Matrix ที่ทำไว้ + Schema DB ครบ |
| 1 | สร้าง/Import Config → ทดสอบ Simulator → SW/Operation ตัดสินใจได้จริง พร้อมประวัติเวอร์ชัน |
| 2 | เขียนเข้าระบบเดิมอัตโนมัติ (mock/docker) แบบมี Queue/Retry/Alert เมื่อ Sync ล้มเหลว |
| 3 | Firmware อัปโหลดเข้าระบบเราได้ (ทางเดียว — v3.7) พร้อม Compatibility Tag และแสดงสถานะครบ 2 ฝั่ง (อัปโหลด + อัปเดตเวอร์ชันจริงของกล่อง) |
| 4 | Rollback ใช้งานได้จริง + Campaign/Incident/Audit ครบวงจร |
| 5 | Mobile App ใช้งานได้ครบ + Device Registration/Decommission ทำงานจริง |
| 6 | เชื่อมต่อระบบเดิม Production จริง ปลอดภัย มี Rate Limit และผ่าน Canary แล้ว |

> เอกสารนี้ควรใช้คู่กับ `02_GPS_Development_Plan.md` (Sprint Checklist ที่มีวันที่จริง) — แผนนี้ให้รายละเอียด "ทำอะไรบ้าง" ส่วน Sprint Checklist บอก "ทำเมื่อไหร่"
