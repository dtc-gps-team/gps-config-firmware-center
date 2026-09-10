# 09 — มติจาก Sprint 1 Review (พี่เลี้ยง) + แผนการปรับระบบ

> เสนอโดย: paveekornk (A) — 2026-09-08
> สถานะ: **เอกสารบันทึกมติ + แผน ยังไม่ได้แก้โค้ด/เอกสารอื่นใด** — B รีวิว + อนุมัติ
> แล้ว (PR #99, ตอบ 5 คำถามใน §5) · รอพี่เลี้ยงยืนยันอีกรอบ แล้วค่อยเริ่มลงมือทีละข้อ
> ตาม §4 (บางข้อต้องแตกเป็น proposal doc ย่อยอีกที)
>
> ทั้ง 7 ข้อนี้เป็น **การปรับทิศทางของระบบ** ไม่ใช่งานแก้เฉพาะ Sprint 1 — จึงต้อง
> ลงไปแก้เอกสารออกแบบหลัก (`CLAUDE.md`, `docs/planning/*`, `RBAC_Matrix.md`,
> `GPS_Data_Dictionary.xlsx`) ก่อน แล้ว implementation ค่อยไหลตามทีละ Sprint

---

## 0. ที่มา

หลังนำเสนอ Sprint 1 พี่เลี้ยงให้ feedback 7 ข้อ ทีมคุยกันแล้วได้ข้อสรุปด้านล่าง
เอกสารนี้รวมไว้ที่เดียวเพื่อให้ B รีวิวก่อนเริ่มแก้จริง

## 1. สรุปภาพรวม 7 ข้อ

| # | เรื่อง | มติสั้น ๆ | ขนาดงาน | จังหวะ | เจ้าของหลัก |
|---|---|---|---|---|---|
| 1 | Task Management | ไม่มี layer วางแผนถาวร — เว็บ = list + ฟอร์มมอบหมายขั้นต่ำ | เล็ก | ทำได้เลย (comment) + Sprint 2 (ฟอร์ม) | A |
| 2 | ฟิลเตอร์ตาราง | ต่อคอลัมน์: ข้อความ = พิมพ์ค้นสด, หมวดหมู่ = dropdown จากข้อมูลจริง | เล็ก–กลาง | Sprint 2 | A |
| 3 | ตรวจจับ action ล่าสุด (เปลี่ยนหน้า/เสิร์ช) | เก็บ **local เครื่องเดียว** ไม่ขึ้น backend ไม่ลง AuditLog | กลาง | proposal doc ก่อน | A (web) + B (mobile) |
| 4 | ชื่อ Config ห้ามซ้ำ | unique **ทั้งระบบ** | กลาง | ทำได้เลย | A |
| 5 | ลบ Config ที่ไม่ได้ใช้นาน | ครบ 90 วัน → สร้าง "คำขอลบ" อัตโนมัติ → SuperAdmin อนุมัติ | ใหญ่ | proposal doc ก่อน (รวมกับข้อ 7) | A |
| 6 | เก็บ location ที่ช่างทำงาน | **เลื่อน** — เปิด issue ไว้ | กลาง | ภายหลัง | B (mobile) + A (audit) |
| 7 | เพิ่ม role SuperAdmin | = Admin + อนุมัติคำขอลบ Config + จัดการ Admin + แก้ role/permission · **ไม่ข้าม Separation of Duty** | เล็ก (โค้ด) | proposal doc ก่อน (รวมกับข้อ 5) | A |

---

## 2. รายละเอียดแต่ละข้อ

### ข้อ 1 — Task Management: ไม่มี layer วางแผน

**มติ**
ระบบจะ**ไม่มี**การจัดตารางงาน / ปฏิทิน / วางแผนกำลังคน / บอร์ด workload / drag-drop /
workflow มอบหมายซ้ำ — ตลอดไป ไม่ใช่แค่เลื่อน

| ฝั่ง | ขอบเขตถาวร |
|---|---|
| มือถือ (ช่าง ST/OT) | list "งานของฉัน" + เปิดดูรายละเอียด + กดอัปเดตสถานะ — **ทำเสร็จแล้ว ไม่ต้องแตะ** |
| เว็บ (Operation) | (ก) ตาราง list "งานไหนมอบหมายให้ใคร สถานะอะไร" (ข) ฟอร์มมอบหมายขั้นต่ำ 6 ช่อง (`title`, `description`, `assignedTo`, `deviceId`, `configId`, `dueDate`) เปิดเป็น Dialog จากปุ่มในหน้า `/tasks` |

**ทำเลยรอบนี้**
- `web/src/app/(app)/tasks/page.tsx` — comment out เนื้อหา เหลือ placeholder (หรือลบ route ชั่วคราว) พร้อม TODO ชี้เอกสารนี้
- `web/src/app/(app)/tasks/create-task-button.tsx` — comment out
- `web/src/lib/nav.ts` — เอา entry `Task Management` ออกจาก `NAV_ITEMS`

**เอกสาร**
- `docs/planning/01_GPS_Build_Reference.md` — ตรงส่วนที่พูดถึง `task` module เติมประโยค: *"ขอบเขต: list งานที่ได้รับมอบหมาย + อัปเดตสถานะ + ฟอร์มมอบหมายพื้นฐาน — **ไม่รวม** การจัดตารางงาน / วางแผนกำลังคน"*
- `docs/planning/02_GPS_Development_Plan.md` — แถวที่ 7 เปลี่ยนชื่อ `Task Management` → `มอบหมายงาน + ติดตามสถานะ (ฟอร์ม + list ไม่ใช่ planning tool)` + หมายเหตุใต้ตาราง

**Sprint 2 (ยังไม่ทำรอบนี้)**
uncomment · ต่อ `page.tsx` → `GET /tasks` · เปลี่ยน `CreateTaskButton` เป็น Dialog + ฟอร์ม → `POST /tasks`
ตามหลัง 2 endpoint ที่ยังไม่มี: `GET /users?role=ST,OT` (dropdown ช่าง) + `GET /devices` (dropdown อุปกรณ์) — ทั้งคู่เป็นงาน A ที่มีในแผน Sprint 2 อยู่แล้ว (User Management + Device Search)

---

### ข้อ 2 — ฟิลเตอร์ตารางแบบต่อคอลัมน์

**มติ**

| ชนิดคอลัมน์ | คอนโทรล | ที่มา options |
|---|---|---|
| ข้อความอิสระ (ชื่อ, deviceId, username) | ช่องพิมพ์ กรองสดแบบ debounce (~300ms) | — |
| หมวดหมู่ (status, deviceModel, protocol, role) | dropdown / multi-select | ค่า distinct จากข้อมูลจริง |
| วันที่ | date range picker | — |

+ global search box ค้นข้ามทุกคอลัมน์ · หลายฟิลเตอร์เปิดพร้อมกัน = AND

**แนวทาง implement**
- เริ่ม **client-side** — โหลด list มาแล้วกรอง/หาค่า distinct ใน memory (data ยังน้อย, `deviceModel/protocol` มีค่าเดียวตอนนี้)
- ถ้าเว็บใช้ TanStack Table: ใช้ `getFilteredRowModel` + `getFacetedUniqueValues` + `globalFilter` ได้เลย
- ออกแบบ component ให้สลับเป็น server-side ทีหลังได้ = แค่เปลี่ยน data source · **ยังไม่ทำ** endpoint `/xxx/filter-options` (YAGNI)

**เอกสาร**
- `docs/planning/01_GPS_Build_Reference.md` — เพิ่มเป็น UI standard: ทุกหน้าตาราง list ใช้ pattern ฟิลเตอร์ต่อคอลัมน์นี้

**จังหวะ:** โค้ดทำ Sprint 2 ตอนต่อ API หน้า list จริง (Config list, Device Search) — รอบนี้แค่บันทึกมาตรฐานลงเอกสาร

---

### ข้อ 3 — ตรวจจับ action ล่าสุด: เก็บ local เครื่องเดียว

> **❌ มติข้อนี้ถูกยกเลิกภายหลัง (10/09/2026)** — ทีมตัดฟีเจอร์ Local Activity Log ทิ้งทั้งหมด
> (Mobile เป็น Home-centric อยู่แล้ว ทางลัดย้อนหน้าไม่จำเป็นเท่าที่คาด · Web ไม่เคย implement) ·
> **A+B ตกลง + พี่เลี้ยงเห็นชอบการกลับมติแล้ว** · ดู `docs/10_LocalActivityLog_Proposal.md`
> (banner หัวไฟล์) · เนื้อหาด้านล่างเก็บไว้เป็นบันทึกประวัติ

**มติ — สำคัญ: อันนี้ไม่ใช่งาน `audit` module**
- track การเปลี่ยนหน้า + การเสิร์ช → เก็บ **local ในเครื่องผู้ใช้เท่านั้น** ไม่ส่งขึ้น backend
- **`AuditLog` ใน DB ยังเป็น mutation-only เหมือนเดิม** (สร้าง/แก้/อนุมัติ/ปฏิเสธ/นำไปใช้)
- Auditor มองไม่เห็น log นี้ (โดยตั้งใจ — มันคือ "กิจกรรมล่าสุด" ส่วนตัวของผู้ใช้ ไม่ใช่ compliance)

**Retention** (ยืนยันตามรีวิว B)
- web: **30 วัน หรือ 1000 รายการล่าสุด** แล้วแต่อันไหนถึงก่อน
- mobile: **14 วัน หรือ 300 รายการล่าสุด** แล้วแต่อันไหนถึงก่อน (storage มือถือจำกัดกว่า)
- rolling — ตัดตัวเก่าสุด · ตัวเลขสุดท้ายรอ `docs/10` ยืนยันอีกที ใช้เป็น baseline ได้

**เชิงเทคนิค**
- web: IndexedDB (ไม่ใช่ localStorage — sync + โควตาจำกัด)
- mobile: sqlite (หรือ shared_preferences ถ้ายืนยันเก็บน้อย)
- wrap read/write ใน try/catch — private mode / storage ถูกเคลียร์ ต้องไม่พัง

**ไฟล์ (หลัง proposal อนุมัติ)**
- proposal doc ใหม่: `docs/10_LocalActivityLog_Proposal.md` (โครง storage, shape ของ entry, จุด hook, UI แสดงผล)
- `docs/planning/01_GPS_Build_Reference.md` + `docs/architecture/RBAC_Matrix.md` — note ว่า read-level activity = local เท่านั้น, `AuditLog` = mutation-only
- โค้ด: web activity-log util (IndexedDB) + hook เข้า router/search · mobile เทียบเท่า

**จังหวะ:** proposal doc ก่อน แล้วค่อย implement

---

### ข้อ 4 — ชื่อ Config ห้ามซ้ำ (unique ทั้งระบบ)

**มติ**
- เพิ่ม field `Config.name` — unique ทั้งระบบ (ไม่ใช่ต่อ deviceModel/protocol)
- สร้าง Config ชื่อซ้ำ → `409 Conflict`

**ไฟล์**
- `backend/prisma/schema.prisma` — `Config` เพิ่ม `name String @unique`
- `backend/prisma/migrations/<ts>_add_config_name/` — migration ใหม่ (additive)
  - **Migration Safety:** ตาราง Config อาจมีข้อมูลอยู่แล้ว → backfill ชื่อให้ row เดิมก่อนใส่ constraint (เช่น `${deviceModel}-${protocol}-${short id}`) — เขียนใน migration หรือ script แยก ตรวจ orphan/ซ้ำก่อน
- `backend/src/config/dto/create-config.dto.ts` + `update-config.dto.ts` — เพิ่ม `name` (required, min length)
- `backend/src/config/config.service.ts` — เช็คชื่อซ้ำใน `create()` / `update()` → `ConflictException` (จับ Prisma `P2002` ด้วย กัน race)
- `backend/src/config/*.spec.ts` + integration — เทสเคสชื่อซ้ำ
- `docs/api/openapi.yaml` — schema `DeviceConfigDraft` / body สร้าง Config เพิ่ม `name` + bump version + `redocly lint`
- `web/src/app/(app)/config/...` — ฟอร์ม Config Editor เพิ่มช่อง "ชื่อ Config" (Sprint 2 wiring — แต่ type/interface เพิ่มได้เลย)
- `web/src/lib/demo-data.ts` — demo config เพิ่ม field `name`
- `GPS_Data_Dictionary.xlsx` — CONFIG table เพิ่ม field `name` (unique) + comment ว่าเบี่ยงจาก dict เดิมเพราะ review

**จังหวะ:** quick win — ทำได้หลัง PR นี้ผ่าน (แยก PR ของตัวเอง แตะ shared schema ต้อง `git pull` ก่อน)

---

### ข้อ 5 + 7 — คำขอลบ Config อัตโนมัติ + SuperAdmin (ก้อนเดียวกัน)

สองข้อนี้ผูกกัน — SuperAdmin คือคนอนุมัติคำขอลบ — จึงรวมเป็น proposal doc เดียว

#### 5. Config เข้าข่ายเสนอลบอัตโนมัติ

**เกณฑ์ — ต้องครบทุกข้อ:**
1. `status ∈ {draft, rejected}` — **เริ่มแค่ 2 สถานะนี้ก่อน** (`testing` ไม่รวม, `approved`/`synced` ห้ามแตะ)
2. ไม่มี `Task` ผูก (`Config.tasks` ว่าง)
3. ไม่มี `Campaign` ผูก
4. ไม่มี `Incident` ผูก
5. `updatedAt` เกิน **90 วัน**
6. ไม่มีคำขอลบ pending/reviewed ของ Config นี้อยู่แล้ว

**กลไก:**
- scheduled job (วันละครั้ง) หา Config ที่เข้าเกณฑ์ → สร้าง "คำขอลบ"
- ก่อนสร้างจริง: แจ้งเตือนผู้สร้าง Config ล่วงหน้า (grace period ~7 วัน) ให้กด "เก็บไว้" ได้
- **SuperAdmin** อนุมัติ → soft delete (`Config.deletedAt`, กู้คืนได้) · SuperAdmin ปฏิเสธ → Config อยู่ต่อ + cooldown ไม่ให้ job flag ซ้ำทันที (~90 วัน)

#### 7. Role SuperAdmin

**SuperAdmin = ทุกอย่างที่ Admin ทำได้ + เพิ่ม:**

| สิทธิ์ | resource ใหม่ |
|---|---|
| อนุมัติ/ปฏิเสธคำขอลบ Config | `config-deletion` (`Approve`) |
| สร้าง/ปิด/เปลี่ยน role ของบัญชี **Admin และ SuperAdmin** | `admin-management` |
| เพิ่ม role ใหม่ + แก้ `RolePermission` | `role-management` |
| (อนาคต) system / integration settings | `system-settings` |

**SuperAdmin ทำไม่ได้:**
- อนุมัติ Config / Firmware / Campaign แทน Operation
- ข้าม Separation of Duty ใด ๆ (ถ้า Operation ไม่อยู่ = SuperAdmin ตั้ง Operation เพิ่ม ซึ่งทำได้อยู่แล้ว)

**กติกาป้องกัน:**
- Admin ปกติ **จัดการ SuperAdmin/Admin ไม่ได้** (กันยกระดับตัวเอง)
- ระบบต้องมี SuperAdmin ≥ 1 คนเสมอ (ลบคนสุดท้ายไม่ได้)
- ทุก action ของ SuperAdmin ลง `AuditLog`

**ไฟล์ (proposal ก่อน แล้วค่อย implement)**
- proposal doc ใหม่: `docs/11_ConfigDeletion_SuperAdmin_Proposal.md`
- `CLAUDE.md` — แก้กฎ **"Role มีแค่ 6 ค่าเท่านั้น" → 7 ค่า** (เพิ่ม `SuperAdmin`) พร้อมเหตุผล + อ้าง PR นี้ · **คง**ข้อห้าม `FieldTechnician` ไว้ (คนละเรื่อง — นั่นคือความผิดพลาด, SuperAdmin คือการเพิ่มโดยตั้งใจ)
- `backend/prisma/seed.ts` — เพิ่ม Role row `SuperAdmin` + permission grants + resource ใหม่ 3 ตัว · **ไม่มี migration** (Role เป็นตาราง, `code` เป็น free string อยู่แล้ว)
- `backend/prisma/schema.prisma` — เพิ่ม model `ConfigDeletionRequest` **แยกของตัวเอง** (ยืนยันตามรีวิว B — ไม่รวม approval framework กลาง กัน over-engineer ก่อนเห็น use case ที่สาม) + `Config.deletedAt DateTime?`
- `backend/prisma/migrations/` — migration additive สำหรับ 2 อย่างข้างบน
- `backend/src/config/` — soft-delete logic, endpoint คำขอลบ + อนุมัติ, scheduled job (`@nestjs/schedule`)
- `backend/src/common/guards/` — permission ใหม่ + กติกา "ห้ามแตะ SuperAdmin/Admin"
- `docs/architecture/RBAC_Matrix.md` — Section 1 เพิ่มแถว SuperAdmin · Section 2 + ตาราง 4.x เพิ่ม resource/แถวใหม่ · changelog
- `docs/api/openapi.yaml` — endpoint คำขอลบ/อนุมัติ + `role` description (list SuperAdmin) + version bump
- `GPS_Data_Dictionary.xlsx` — ROLE table เพิ่ม `SuperAdmin` + CONFIG เพิ่ม `deleted_at` + ตาราง CONFIG_DELETION_REQUEST ใหม่

**จังหวะ:** proposal doc ก่อน (design model + flow ให้ชัด) แล้วค่อย implement — น่าจะ Sprint 3+

---

### ข้อ 6 — เก็บ location ที่ช่างทำงาน (เลื่อน)

**มติ:** ทำทีหลัง — พี่เลี้ยงบอกไม่เร่ง

**ตอนนี้ทำแค่:**
- เปิด GitHub issue: "Mobile จับ GPS ตอน action (Confirm Install / Incident) → เก็บที่ `Task` + `AuditLog`"
- `GPS_Data_Dictionary.xlsx` — note ว่า `AUDIT_LOG` + `TASK` จะมี field location ในอนาคต
- `docs/planning/02_GPS_Development_Plan.md` — เพิ่มแถว backlog

**เจ้าของ:** B (mobile capture) + A (audit/task backend) — คุยกันตอนถึงคิว

---

## 3. ผลกระทบข้ามทีม (ส่วนที่แตะงาน B)

| ข้อ | กระทบ B ยังไง |
|---|---|
| 1 Task | scope มือถือ = เท่าเดิม ไม่ต้องแก้ · แค่รับทราบว่าเว็บไม่ทำ planning |
| 3 activity log | ต้องทำฝั่ง mobile ด้วย (sqlite local) — pattern เดียวกับ web, ดู `docs/10` ตอนออก |
| 5+7 | `notification` module ของ B อาจต้องส่ง noti "คำขอลบรออนุมัติ" ให้ SuperAdmin + noti grace period ให้ผู้สร้าง Config |
| 6 location | งาน mobile ของ B โดยตรง (เลื่อน) |

ข้อ 2, 4 อยู่ในฝั่ง A ล้วน

---

## 4. ลำดับลงมือ (หลัง PR นี้อนุมัติ)

1. **แก้เอกสารตามมติ** — PR เดียว: `CLAUDE.md` (role 6→7), `docs/planning/01`, `docs/planning/02`, `docs/architecture/RBAC_Matrix.md`, `GPS_Data_Dictionary.xlsx`
2. **quick win** — ข้อ 1 (comment out + nav), ข้อ 4 (`Config.name` unique) — แยก PR
3. **proposal docs** — `docs/10` (local activity log), `docs/11` (config deletion + SuperAdmin) → รีวิวอีกรอบก่อน implement
4. **issue** — ข้อ 6
5. **Sprint 2** — ข้อ 2 (ฟิลเตอร์) ตอนต่อ API หน้า list

---

## 5. คำถามเปิด — ตอบครบแล้วในรีวิว B (PR #99)

1. **ข้อ 4 — backfill ชื่อ Config:** B ไม่มีความเห็นเพิ่ม เป็นฝั่ง A ล้วน → ใช้ `${deviceModel}-${protocol}-${short id}` ตามที่เสนอ
2. **ข้อ 5 — model คำขอลบ:** → **แยก `ConfigDeletionRequest` ของตัวเอง** ไม่รวม approval framework กลาง (B: business rule ของ config/firmware/campaign approval ต่างกันพอควรอยู่แล้ว รวมตอนนี้เสี่ยง over-engineer · noti hook ที่ event ไม่ใช่ schema จึงไม่กระทบ)
3. **ข้อ 7 — resource SuperAdmin:** → **แยก `admin-management` / `role-management` 2 ตัว** ตามที่เสนอ (B: ยืดหยุ่นกว่าถ้าอนาคตต้องแยกสิทธิ์)
4. **ข้อ 3 — retention mobile:** → **14 วัน / 300 รายการ** (ไม่ใช่ 30/1000 แบบ web — storage มือถือจำกัดกว่า) รายละเอียดสุดท้ายรอ `docs/10`
5. **จังหวะข้อ 5+7:** → **Sprint 3** ตามที่เสนอ (ให้เวลา `docs/11` + review · ไม่ชนคิว PR C native / PR D ของ B)
