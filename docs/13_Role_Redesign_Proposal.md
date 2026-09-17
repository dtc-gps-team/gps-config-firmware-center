# ข้อเสนอปรับโครงสร้าง Role — GPS Config & Firmware Center

> เอกสารนี้สรุปจากการทบทวนเรื่อง Role ระหว่าง A กับ B หลังการประชุมล่าสุด (พบว่าชื่อ Role
> บางตัวไม่สื่อความหมาย + ต้องปรับสิทธิ์ให้รองรับขั้นตอนอนุมัติ Campaign ที่ยังไม่มี) —
> เทียบกับ `GPS_Config_Firmware_Center_Design.pdf` (System Design ต้นฉบับ) และ
> `GPS_Data_Dictionary.xlsx` (source of truth ของ data model) ประกอบทุกข้อเสนอ
> เป้าหมายคือให้ B และพี่เลี้ยงเห็นเหตุผลของแต่ละจุดครบก่อนเริ่ม implement จริง

---

## 1. ทำไมต้องทบทวน

Role ปัจจุบัน 7 ตัว (`SW`, `Operation`, `ST`, `OT`, `Auditor`, `Admin`, `SuperAdmin`) ใช้มาตั้งแต่
Sprint แรก — พบ 2 ปัญหาหลัง sync กับ PDF ต้นฉบับ:

1. **ชื่อบาง Role ไม่สื่อความหมาย** — โดยเฉพาะ `SW` ที่รวบงาน 3 อย่างที่ PDF มองว่าเป็นคนละหน้าที่
   กันไว้ในตัวเดียว (ดูข้อ 3.1)
2. **Campaign ไม่มีขั้นตอนอนุมัติแยกจากคนสร้าง** — Operation สร้างแล้ว active ทันที ไม่มี
   Separation of Duty แบบที่ Config มี (ดูข้อ 3.5)

## 2. เทียบ Role ปัจจุบันกับ PDF ต้นฉบับ

PDF §13.1 (Role-Based Access Control) ระบุไว้ 8 role — เทียบกับ 7 ตัวที่ระบบใช้จริงแล้ว
**ชื่อตรงกันแค่ 2 ตัว**: `Operation` และ `Auditor`

| PDF §13.1 | สิทธิ์หลักตาม PDF | มีคู่เทียบในระบบปัจจุบันไหม |
|---|---|---|
| System Administrator | Master Data, System Setting | ≈ `Admin`/`SuperAdmin` |
| Firmware Engineer | Upload Firmware, Compatibility | รวมอยู่ใน `SW` |
| Config Engineer | Config Definition, Template, Validation | รวมอยู่ใน `SW` |
| QA Engineer | ทดสอบ ตรวจผล อนุมัติคุณภาพ | ไม่มีเลย |
| Operation | สร้างและควบคุม Campaign | ตรงกัน (`Operation`) |
| Customer Support | ค้นหา Device และตรวจประวัติ | ไม่มี — แต่ capability มีอยู่แล้ว (ดูข้อ 3.6) |
| Customer User | ดูข้อมูลภายใต้ Customer Scope | ไม่มี — นอก scope (ดูข้อ 3.6) |
| Auditor | อ่าน Audit/Report แก้ไขไม่ได้ | ตรงกัน (`Auditor`) |
| — | — | `ST`, `OT` (ช่างหน้างาน Mobile) — ไม่มีคู่เทียบใน PDF เลย |

---

## 3. รายละเอียดการเปลี่ยนแปลงแต่ละ Role

### 3.1 ยกเลิก `SW` → แยกเป็น 3 Role: Config Engineer / Firmware Engineer / QA Engineer

**เหตุผล**: `SW` ในระบบตอนนี้ทำทุกอย่างรวมกัน — สร้าง/แก้ Config, อัปโหลด Firmware, รัน
Simulation ทดสอบเอง — แต่ PDF §13.1 ตั้งใจแยก 3 หน้าที่นี้ออกเป็นคนละ role ชัดเจน
(Config Engineer / Firmware Engineer / QA Engineer) นี่อาจเป็นสาเหตุที่ชื่อ `SW`
รู้สึก "ไม่สื่อความหมาย" ตามที่ยกขึ้นมา — เพราะมันครอบคลุมงานที่ PDF มองว่าเป็นคนละ
บทบาทกัน

| Role ใหม่ | ขอบเขต | อ้างอิงสิทธิ์เดิมของ SW |
|---|---|---|
| **Config Engineer** | Config เท่านั้น (สร้าง/แก้/Import/Simulate, Config Definition) | `grant('SW', 'config', ...)`, `grant('SW', 'config-definition', ...)` |
| **Firmware Engineer** | Firmware เท่านั้น (Upload, แก้ Compatibility Tag) | `grant('SW', 'firmware', 'Create'/'Update')` |
| **QA Engineer** (ใหม่) | อนุมัติคุณภาพ Firmware ก่อนใช้งานได้จริง — ดูข้อ 3.2 | ไม่เคยมีมาก่อน |

การแยกนี้เป็นการ "ตัดตามรอยต่อ" ที่มีอยู่แล้วในโค้ด (สิทธิ์ config/firmware ของ `SW` แยก
`grant()` กันอยู่แล้ว) ไม่กระทบ logic เดิม แค่เปลี่ยน role ที่ผูกสิทธิ์อยู่

**Confirm ขอบเขต Mobile (ตอบคำถาม kittiphong ใน PR #174):** ทั้ง 3 role ใหม่เป็น
**Web-only** ทั้งหมด — ไม่ต้องแก้อะไรฝั่ง Mobile เพิ่มเลยนอกจาก**ลบ** `case UserRole.sw`
ออกจาก enum exhaustive switch (`mobile/lib/core/api/models.dart` — `_roleLabel()` +
`MockAuthRepository` prefix map) ไม่ต้องเพิ่ม case ใหม่ให้ 3 role นี้ — ตรงกับ precedent เดิม
ที่ RBAC_Matrix.md บรรทัด 91 ระบุไว้แล้วว่า Config Editor/Approval Center เป็น Web only
(ผู้ใช้ Mobile มีแค่ Operation/ST/OT) และ `SW` เองก็ไม่เคย mapped เข้าหน้าจอ Mobile จริงจัง
สักหน้าอยู่แล้ว (`grant('SW','tasks','Read')` ที่มีอยู่เป็นสิทธิ์ที่ไม่เคยถูกใช้งานจริง เหลือค้างมา
จากก่อน Task Management จะถูกยกเลิกถาวร)

### 3.2 QA Engineer — ต้องสร้าง Firmware Approval Lifecycle ใหม่ทั้งหมด

**สถานะปัจจุบัน**: `FirmwareUploadStatus` enum มีแค่ `pending | stored | failed` —
เป็นสถานะทาง**เทคนิค**ล้วนๆ (อัปโหลดไฟล์สำเร็จไหม) พอ `stored` ก็ใช้ใน Campaign ได้ทันที
**ไม่มีขั้นตอนอนุมัติคุณภาพเลย** ต่างจาก Config ที่มี `draft → testing → approved/rejected → synced`
ครบ

**เหตุผลที่ต้องเพิ่ม**: PDF §13.2 Approval Workflow ระบุ chain ของ Firmware Production ไว้ว่า
**"Engineer → QA → Product Owner → Operations Manager"** — ยืนยันว่า Firmware ควรมี
ขั้นตอนอนุมัติคุณภาพก่อนปล่อยจริง ไม่ใช่แค่ "อัปโหลดสำเร็จ = ใช้ได้"

**ขอบเขตที่ตกลง (แบบย่อ ไม่ทำเต็มตาม PDF)**: ทำแค่ **2 ขั้น** เลียนแบบ pattern ของ Config
ที่มีอยู่แล้ว — **Firmware Engineer อัปโหลด → QA Engineer อนุมัติคุณภาพ → ใช้ใน Campaign ได้**
ไม่ทำตาม PDF เต็มรูปแบบ 4 ขั้น เพราะ "Product Owner" และ "Operations Manager" ไม่เคยอยู่ใน
แผน role ของทีมเลย การเพิ่มจะทำให้ scope บานปลายเกินความจำเป็น — 2 ขั้นก็ให้ผลลัพธ์เดียวกัน
(Separation of Duty จริง: คนสร้าง Firmware ≠ คนอนุมัติคุณภาพ) และสอดคล้องกับ pattern ที่ทีม
คุ้นเคยอยู่แล้วจาก Config

**ยังไม่ตัดสินใจ** (ดูข้อ 5): ชื่อ/ค่าของ status enum ใหม่ที่แน่นอน, สิทธิ์ RBAC แบบละเอียด

### 3.3 `ST` — คงชื่อเดิม "Senior Technician" (ไม่เปลี่ยน แค่โชว์ให้ถูก)

**เหตุผล**: เช็ค `backend/prisma/seed.ts` และ `GPS_Data_Dictionary.xlsx` พบว่าชื่อเต็ม
**"Senior Technician"** มีอยู่แล้วในระบบ (`Role.name` field) และตรงกับที่ Data Dictionary
อ้างถึงในหลายจุด (เช่น สิทธิ์ Override ที่ Senior Technician ข้ามข้อจำกัดได้) — ปัญหาไม่ใช่ชื่อ
ไม่มี แต่คือ**หน้าเว็บ/แอปยังโชว์แค่ code ดิบ ("ST") ไม่เคยเอา `name` มาแสดง** สิ่งที่ต้องแก้คือ
UI ไม่ใช่ตัวชื่อ

หมายเหตุ: PDF ต้นฉบับไม่มี role ประเภทช่างหน้างานเลย (ดูตาราง §2) — ชื่อนี้มาจาก Data
Dictionary ของทีมเอง ไม่ได้อ้างอิง PDF

### 3.4 `OT` — เปลี่ยนชื่อแสดงผลเป็น **"Operation Technician"**

**เหตุผล**: ชื่อเดิมที่ seed ไว้คือ "Operation-Technician" ซึ่งเสี่ยงสับสนกับ role `Operation`
เอง (คนละ role กันโดยสิ้นเชิง — `Operation` อนุมัติ Config/จัดการ Campaign, `OT` สนับสนุนงาน
ปฏิบัติการหน้างาน + Override) เคยพิจารณาตัดเหลือแค่ "Operation" เฉยๆ แต่ปฏิเสธไป เพราะ
Data Dictionary มีจุดที่ต้องเลือกระหว่าง `Operation`, `Operation - Technician`, `Senior
Technician` พร้อมกันในฟิลด์เดียว (เช่น ผู้รับผิดชอบลูกค้าในแคมเปญ) ถ้าชื่อซ้ำกันจะแยกไม่ออก
จึงตัดสินใจเป็น **"Operation Technician"** (ตัดแค่ขีดกลางออก) — สั้นลง ยังชัดว่าต่างจาก
Operation เพราะมีคำว่า Technician ต่อท้ายเสมอ

หมายเหตุ: เช่นเดียวกับ ST — เป็นชื่อภายในของทีม ไม่ได้อ้างอิง PDF (PDF ไม่มี role นี้)

### 3.5 Campaign Approval — **ไม่เพิ่ม Role ใหม่**

**ปัญหาที่พบ**: PDF §9.1 (ข้อมูล Campaign) มีแถว Governance ระบุ "Creator, Approver" แยกกัน
แต่ **§13.2 Approval Workflow กลับไม่มี Campaign อยู่ในรายการ chain การอนุมัติเลย** (มีแค่
Config ทั่วไป, Firmware Production, Emergency Patch) — PDF เองก็ไม่เคยตอบว่าใครอนุมัติ
Campaign ชัดเจน เป็นช่องว่างในเอกสารต้นฉบับ ไม่ใช่แค่ระบบเราขาด

**แนวทางที่พิจารณาแล้วไม่เลือก**: เพิ่ม role ใหม่ "Operation Lead" (สิทธิ์เหมือน Operation
+ อนุมัติ Campaign ได้) — ปัดตกเพราะถ้า Operation Lead สร้าง Campaign เองด้วย จะอนุมัติ
Campaign ตัวเองไม่ได้ (ต้องกัน self-approval) และถ้ามี Operation Lead แค่คนเดียว Campaign
ที่ตัวเองสร้างจะไม่มีใครอนุมัติได้เลย (deadlock) — จะแก้ได้ต้องมี Operation Lead ≥ 2 คน ซึ่งเป็น
ข้อจำกัดเชิงองค์กรที่ไม่จำเป็น และ CLAUDE.md ก็ห้าม SuperAdmin เป็นทางออกฉุกเฉินแทน
("อนุมัติ Config/Firmware/Campaign แทน Operation ไม่ได้")

**แนวทางที่เลือก**: ใช้ role `Operation` เดิม + เพิ่ม **SelfApprovalGuard** (Operation คนไหน
ก็อนุมัติ Campaign ของ Operation คนอื่นได้ แต่อนุมัติของตัวเองไม่ได้) — ไม่ต้องเพิ่ม role ใหม่
ไม่มีปัญหาเรื่องจำนวนคน ตราบใดที่ทีม Operation มีมากกว่า 1 คน

**แก้ไข 2026-09-17 (ตามที่ kittiphong ท้วงใน PR #174):** เดิมเอกสารนี้เขียนว่า
SelfApprovalGuard "มีอยู่แล้วจริง...ตรงกับที่ Config ใช้อยู่แล้ว" — **ไม่ถูกต้อง** เช็คแล้ว
(`grep -rn "SelfApprovalGuard" backend/src` ไม่เจอเลย) ไม่มี guard นี้ในโค้ดจริง ๆ และกลไก
Separation of Duty ที่ Config ใช้อยู่ตอนนี้ทำงานที่**ระดับ Role ล้วนๆ** (SW ถูกห้ามอนุมัติ
Config ทั้ง role เลย ไม่เคยต้องเทียบว่าเป็น user คนเดียวกับคนสร้างหรือเปล่า) ต่างจากที่ Campaign
ต้องการ (Operation คนเดียวกันห้ามอนุมัติของตัวเอง แต่ Operation คนอื่นอนุมัติได้ — ต้องเทียบ
**user id ภายใน role เดียวกัน**) คำว่า "SelfApprovalGuard" เจอแค่ในคำอธิบาย field หนึ่งของ
Data Dictionary (แนวคิดทั่วไป ไม่ใช่ชื่อ guard ที่ implement จริงในระบบนี้)

**สรุปที่ถูกต้อง**: นี่คือ **mechanism ใหม่ทั้งหมดที่ต้องสร้าง** ไม่ใช่ของที่มีอยู่แล้วให้ reuse —
ต้องมี (1) migration เพิ่มคอลัมน์ `approvedBy` ให้ `Campaign` (ตอนนี้มีแค่ `createdBy`) และ
(2) service logic เช็ค `createdBy !== currentUserId` เอง ผลสรุปเรื่อง role ยังเหมือนเดิม
(ไม่เพิ่ม role ใหม่ ใช้ `Operation`) แค่ขอบเขตงานตอน implement ใหญ่กว่าที่เขียนไว้เดิม

### 3.6 Customer User / Customer Support — **ไม่เพิ่ม**

**Customer User** (PDF: "ดูข้อมูลภายใต้ Customer Scope") — ไม่เพิ่ม เพราะระบบนี้เป็น internal
tool ล้วนๆ ไม่เคยมี flow ให้ลูกค้า login เข้ามาดูข้อมูลตัวเองเลยตั้งแต่ต้น (ตรงกับที่สรุปไว้ใน
docs/12 customer scope เฟส B — ข้อมูลลูกค้าที่เก็บเป็นแค่ metadata ผูกกับอุปกรณ์ให้พนักงาน
ภายในใช้)

**Customer Support** (PDF: "ค้นหา Device และตรวจประวัติ") — ไม่เพิ่ม เพราะ capability นี้มีอยู่
แล้วในระบบ — `Device Search` เปิดให้ **ทุก Role อ่านได้อยู่แล้ว** (`nav.ts` ไม่มี `allowedRoles`
จำกัด) ไม่มี gap ให้ต้องเพิ่ม role ใหม่มาทำหน้าที่ซ้ำ

---

## 4. สรุป Role ทั้งหมดหลังปรับ (9 ตัว)

| Code | ชื่อแสดงผล | เปลี่ยนจากเดิมไหม |
|---|---|---|
| `ConfigEngineer` (ชื่อ code แน่นอนรอตกลง) | Config Engineer | ใหม่ (แยกจาก SW) |
| `FirmwareEngineer` | Firmware Engineer | ใหม่ (แยกจาก SW) |
| `QAEngineer` | QA Engineer | ใหม่ทั้งหมด |
| `Operation` | Operation | ไม่เปลี่ยน (แค่เพิ่ม SelfApprovalGuard ตอนอนุมัติ Campaign) |
| `ST` | Senior Technician | ไม่เปลี่ยนชื่อ แค่โชว์ผลถูกจุด |
| `OT` | **Operation Technician** | เปลี่ยนชื่อแสดงผล (ตัดขีดออก) |
| `Auditor` | Auditor | ไม่เปลี่ยน |
| `Admin` | System Admin | ไม่เปลี่ยน |
| `SuperAdmin` | SuperAdmin | ไม่เปลี่ยน |

## 5. สิ่งที่ยังไม่ตัดสินใจ / ต้องคุยต่อ

- [x] ขอบเขต Mobile ของ 3 role ใหม่ — **Web-only ทั้งหมด** ฝั่ง Mobile แค่ลบ
  `case UserRole.sw` ออกจาก enum พอ ไม่ต้องเพิ่ม case ใหม่ (ดูรายละเอียดในข้อ 3.1)
- [ ] Code ที่แน่นอนของ 3 role ใหม่ (เช่น `ConfigEngineer` vs `CFG` ฯลฯ)
- [ ] สิทธิ์ RBAC แบบละเอียด (resource + action) ของ Config Engineer / Firmware Engineer / QA Engineer — ตอนนี้ระบุแค่ทิศทางกว้างๆ
- [ ] ค่า enum ของ Firmware approval status ใหม่ (เทียบเคียง `draft/testing/approved/rejected` ของ Config)
- [x] User ที่ยังเป็น `SW` เดิม (เช่น `sw.test`) — **ไม่ต้อง migrate** เพราะเป็นแค่ test/seed
  data ใน `backend/prisma/seed.ts` ไม่ใช่ user จริงที่ผูกอยู่กับใคร พอ `SW` ถูกแยกออก
  `sw.test` ก็หายไปเลย แทนที่ด้วย test user ใหม่ของแต่ละ role (เช่น `config.test`,
  `firmware.test`, `qa.test`) ตาม pattern เดียวกับ `operation.test`/`st.test` ที่มีอยู่แล้ว
- [ ] อัปเดต `docs/architecture/RBAC_Matrix.md` และ `CLAUDE.md` §Role Enum ให้ตรงกับ role ชุดใหม่ทั้งหมด

---

*เอกสารนี้เป็นข้อเสนอสรุปจากบทสนทนาระหว่าง A กับ Claude (เทียบกับ PDF ต้นฉบับ + Data
Dictionary) ยังไม่ผ่านการยืนยันจาก B/พี่เลี้ยงอย่างเป็นทางการ — ควรคุยยืนยันทีละข้อในข้อ 3
ก่อนเริ่ม implement จริง*
