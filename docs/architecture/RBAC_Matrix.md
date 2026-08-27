# RBAC Matrix — GPS Config & Firmware Center

**สถานะ:** DRAFT v2 (แก้ไขจากฉบับแรก โดยอิง `02-user-access-design.md` เป็นแหล่งข้อมูลหลัก)
**แหล่งข้อมูลหลัก:** `docs/02-user-access-design/02-user-access-design.md` (เอกสาร Formal Design หัวข้อ 2 — User & Access Design)
**แหล่งข้อมูลรอง:** `GPS_Data_Dictionary.xlsx` (ROLE, CONFIG_DEFINITION, DEVICE_CONFIG_OVERRIDE, FIRMWARE_OVERRIDE), `03_GPS_Detailed_Build_Steps.md`
**จัดทำโดย:** paveekornk (A) ตาม Phase 0 ข้อ 4
**ผู้ที่ต้อง Sign-off ก่อนใช้งานจริง:** kittiphong (B)

---

## เปลี่ยนแปลงจากฉบับร่างแรก (v1 → v2)

หลังได้เอกสาร `02-user-access-design.md` ซึ่งเป็น Formal Design ที่ละเอียด/น่าเชื่อถือกว่าฉบับร่างแรก แก้ไข 4 จุดดังนี้:

1. **ตัด "Field Technician" ออก** — เอกสารนี้ยืนยันชัดเจนว่ามีแค่ **6 Role** (Administrator, Software Engineer, Operation, Senior Technician, Operation - Technician, Auditor) ไม่มี Role ที่ 7 — คำว่า "Field Technician" ที่เคยเห็นใน `03_GPS_Detailed_Build_Steps.md` เป็นการเขียนคลาดเคลื่อน
2. **แก้ไข: Operation เป็นผู้สร้าง/ควบคุม Campaign** (v1 เข้าใจผิดว่าเป็น SW/Admin — คลาดเคลื่อนจาก `CAMPAIGN_ASSIGNMENT.assigned_by` ใน Data Dictionary ที่ยังไม่ได้อัปเดตตามหลัง RBAC เวอร์ชันล่าสุด ดูหัวข้อ "จุดขัดแย้งที่ยังไม่เคลียร์" ด้านล่าง)
3. **แก้ไข: Audit Log — แม้แต่ Administrator ก็เข้าไม่ได้** (v1 ให้ Admin อ่านได้ ผิด) เพื่อรักษาความเป็นกลางในการตรวจสอบ Auditor ต้องตรวจสอบการกระทำของ Admin ได้โดยไม่มีผลประโยชน์ทับซ้อน
4. **เพิ่มหมายเหตุเรื่อง Action Type** — ระบบจริงออกแบบไว้แค่ 4 Action Type (C/R/U/D) ไม่ใช่ 5 แบบที่ใช้ในตารางนี้ ดูคำอธิบายท้ายหัวข้อ "คำอธิบายสัญลักษณ์"

---

## ⚠️ จุดขัดแย้งที่ยังไม่เคลียร์ (ต้องถาม kittiphong)

**ใครสร้าง Campaign กันแน่:** `02-user-access-design.md` (2.4.3) เขียนชัดว่า Operation "สร้างและควบคุม Campaign" — แต่ `GPS_Data_Dictionary.xlsx` เขียนไว้ที่ `CAMPAIGN_ASSIGNMENT.assigned_by` ว่า "ผู้มอบหมาย (**Administrator/Software Engineer** ที่สร้าง Campaign)" สองเอกสารขัดกันเอง

Matrix นี้ยึดตาม `02-user-access-design.md` เป็นหลัก (Operation สร้าง Campaign) ตามที่ยืนยันมา แต่ **`GPS_Data_Dictionary.xlsx` น่าจะต้องอัปเดตให้ตรงกัน** ไม่งั้น field `CAMPAIGN_ASSIGNMENT.assigned_by` ใน Prisma schema จะขัดกับ RBAC Guard ที่เขียนจริง

## ⚠️ ยังไม่มีเอกสารต้นทางระบุ (ยังต้องยืนยัน)

- **Device Registration (Mobile)** — `02-user-access-design.md` ไม่ได้พูดถึงฟีเจอร์นี้เลย (เป็นฟีเจอร์ที่เพิ่มทีหลังใน `03_GPS_Detailed_Build_Steps.md` Phase 5) สมมติฐานในตารางนี้: ทำได้โดย Role ที่ทำงานหน้างานผ่าน Mobile เป็นหลัก คือ Operation/Senior Technician/Operation - Technician
- **Decommission Device (Web)** — ไม่มีเอกสารใดระบุ Role ชัดเจน สมมติฐาน: Admin + Operation (งานบริหารจัดการอุปกรณ์)
- **ปุ่ม "ทดสอบกับ Device Simulator" ก่อน Confirm Install (v3.5)** — ไม่อยู่ใน Permission Matrix ทางการ (2.5) เพราะเป็นฟีเจอร์ใหม่กว่าเอกสารนี้ สมมติฐาน: Role เดียวกับที่ทำ Confirm Install ได้ (Operation/ST/OT)

---

## คำอธิบายสัญลักษณ์

| สัญลักษณ์ | ความหมาย |
|---|---|
| **C** | Create — สร้างข้อมูลใหม่ได้ |
| **R** | Read — ดูข้อมูลได้ |
| **U** | Update — แก้ไขข้อมูลที่มีอยู่ได้ |
| **A** | Approve — อนุมัติ/ปฏิเสธได้ |
| **O** | Override — ข้ามกฎปกติเพื่อแก้ค่าเฉพาะเครื่องได้ |
| **—** | ไม่มีสิทธิ์เข้าถึงหน้าจอ/Action นี้เลย |

**ชื่อย่อ Role:** Admin = Administrator, SW = Software Engineer, Operation, ST = Senior Technician, OT = Operation - Technician, Auditor — **รวม 6 Role เท่านั้น**

> **หมายเหตุสำคัญเรื่อง Action Type:** `02-user-access-design.md` หัวข้อ 2.3 ระบุว่าระบบจริงลดเหลือแค่ **4 Action Type คือ C/R/U/D** เท่านั้น — "A (Approve) และ X (Execute) แยกประเภท — ให้ผูกกับ Permission ปกติแทน (เช่น `campaign:start` เป็น Permission key ปกติ)" ตารางนี้ยังคงใช้ **A (Approve)** และ **O (Override)** เป็นคอลัมน์แยกเพื่อให้อ่านง่ายและตรงกับที่ทีมขอมา แต่เวลาเขียนโค้ด Guard จริง **ให้อิงตามหลักการ C/R/U/D + Permission key เฉพาะ** (เช่น `config_template:approve`, `device_config:override`) ไม่ใช่มองว่ามี Action Type "Approve"/"Override" แยกอยู่ในระบบจริง

---

## 1. ระบบพื้นฐาน (Auth / Dashboard / User Management)

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Login | R | R | R | R | R | R |
| Dashboard / Main | R | R | R | R | R | R |
| Device Search & Group¹ | C,R,U | R | C,R,U | R² | R² | R |
| Master Data (Manufacturer/Model/HW Rev/Customer) | C,R,U | R | R | — | — | R |
| RBAC / User Management | C,R,U | — | — | — | — | — |
| Audit Log³ | — | — | — | — | — | R |

¹ Operation จัดการ Static Device Group ได้ (2.4.3) นอกเหนือจากการค้นหาอุปกรณ์
² ST/OT เห็นเฉพาะอุปกรณ์ของลูกค้าที่ตนเองถูกมอบหมายเท่านั้น (Customer Scope)
³ **แม้แต่ Administrator ก็เข้า Audit Log ไม่ได้** — Auditor แยกเป็น Role อิสระเพื่อรักษาความเป็นกลาง ต้องตรวจสอบการกระทำของ Admin เองได้โดยไม่มีผลประโยชน์ทับซ้อน (2.4.6, 2.6)

---

## 2. Config Workflow

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Config Definition Lookup (~262 field) | R | C,R,U | R | — | — | R |
| Config Editor (Template — สร้าง/แก้ Draft) | R | C,R,U⁴ | R | — | — | R |
| Config Import จากไฟล์ JSON (v3.2) | R | C⁴ | R | — | — | R |
| Config Change Request (เสนอแก้ Template) | — | R,U⁵ | — | C,R | — | R |
| Approval Center — Config/Campaign⁶ | — | — | A | — | — | R |
| Device Config Override (Web เท่านั้น) | — | — | O | O⁷ | O⁸ | R |

⁴ SW แก้ Config Template/Definition ได้เต็มที่ แต่ **ไม่มีสิทธิ์อนุมัติงานของตัวเอง** (2.4.2, 2.6 — Segregation of Duties)
⁵ SW พิจารณา Accept/Reject/แปลงเป็น Draft จากคำขอที่ ST ส่งมา — ไม่ใช่การอนุมัติแบบ Approval Center (เป็นคนละกลไกกัน)
⁶ **Operation อนุมัติได้เฉพาะผ่าน Web เท่านั้น — Mobile ไม่มีเมนู Pending Approval เลย** (ตัดถาวรตามคำสั่งหัวหน้าโปรเจกต์ 2.6.1) Push Notification ไป Mobile เป็นแค่การแจ้งเตือน ไม่ใช่ช่องทางกดอนุมัติ
⁷ ST override ได้ **ทุก Field ไม่จำกัด** (ข้าม `field_overridable`) — เป็น 1 ใน 2 หน้าจอ Web เพียงหน้าเดียวที่ ST เข้าถึงได้ทั้งหมด (2.4.4)
⁸ OT override ได้เฉพาะ Field ที่ SW กำหนดไว้ล่วงหน้าว่า `field_overridable = TRUE` เท่านั้น — เป็น 1 ใน 2 หน้าจอ Web เพียงหน้าเดียวที่ OT เข้าถึงได้ทั้งหมด (2.4.5)

**สำคัญ:** ST และ OT **ไม่เห็นเมนู/หน้าจอ Web อื่นใดเลยนอกจาก Device Config Override และ Firmware Override รายเครื่อง** — ไม่ใช่ Full Web Access ทั้งสอง Role ใช้งานหลักผ่าน Mobile

---

## 3. Firmware Workflow

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Firmware Repository (อัปโหลด/จัดการ) | R | C,R,U⁹ | R | — | — | R |
| Approval Center — Firmware (QA + Release)¹⁰ | — | — | A | — | — | R |
| Firmware Override รายเครื่อง (Web เท่านั้น) | — | — | O | O¹¹ | O¹² | R |

⁹ SW อัปโหลด Firmware, กำหนด Compatibility Rule, แก้ Metadata/Release Note — ไม่มีสิทธิ์อนุมัติ Release ของตัวเอง
¹⁰ Operation ตรวจคุณภาพ (QA) และอนุมัติ Release ในขั้นตอนเดียวกัน (รวม QA Engineer เดิมเข้ามาแล้ว) — **ในขั้นตอนเดียวกันนี้ Operation เป็นคนติ๊กด้วยว่า Firmware เวอร์ชันนี้ให้ OT ติดตั้งเองได้หรือไม่** (`installable_by_technician`)
¹¹ ST ติดตั้งได้ **ทุกเวอร์ชันที่ RELEASED** ไม่ต้องรอ Operation อนุญาตล่วงหน้า — เป็น 1 ใน 2 หน้าจอ Web ที่ ST เข้าถึงได้
¹² OT ติดตั้งได้เฉพาะเวอร์ชันที่ Operation ทำเครื่องหมาย `installable_by_technician = TRUE` ไว้ล่วงหน้าเท่านั้น — ทุก Role ต้องผ่านการตรวจ `FIRMWARE_COMPATIBILITY` กับรุ่นอุปกรณ์เป้าหมายก่อนเสมอ ไม่ต้องขออนุมัติก่อนทำ แต่บันทึกเหตุผล + Audit Log ทุกครั้ง

---

## 4. Campaign / Deployment

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Campaign Wizard (สร้าง/ควบคุม Campaign)¹³ | R | — | C,R,U | — | — | R |
| Campaign Monitor | R | — | R | R¹⁴ | R¹⁴ | R |
| Deployment Job / Confirm Install (หน้างาน) | — | — | U | U | U | R |

¹³ **แก้ไขจาก v1:** Operation เป็นผู้สร้าง/Start/Pause/Resume/Rollback Campaign เอง ไม่ใช่ SW/Admin (2.4.3) — ดูหัวข้อ "จุดขัดแย้งที่ยังไม่เคลียร์" ด้านบนเรื่อง `CAMPAIGN_ASSIGNMENT.assigned_by`
¹⁴ ST/OT เห็นเฉพาะ Campaign ของลูกค้าที่ตนเองรับผิดชอบ แบบ Read-only เท่านั้น (Customer Scope)

---

## 5. Incident & Rollback

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Incident (บันทึก/จัดการปัญหา) | U¹⁵ | — | C,R,U | C¹⁶ | C¹⁶ | R |
| Rollback (ย้อน Config/Firmware) | — | — | C,U¹⁷ | — | — | R |

¹⁵ Admin ทำได้แค่ "ระงับการใช้งาน Firmware กรณีฉุกเฉิน" (Suspend) เท่านั้น ไม่ใช่จัดการ Incident เต็มรูปแบบ
¹⁶ ST/OT รายงาน Incident เบื้องต้นจากหน้างานผ่าน Mobile ได้เท่านั้น ไม่ใช่การจัดการ Incident แบบเต็ม (ไม่มี Update/Close)
¹⁷ Operation กด Rollback จากหน้า Incident หรือ Config History — สร้าง Config เวอร์ชันใหม่ที่มีค่าเดียวกับเวอร์ชันก่อนหน้า ไม่ใช่ลบเวอร์ชันที่มีปัญหาทิ้ง

---

## 6. Mobile-only / ยังไม่มีเอกสารต้นทางยืนยัน

| หน้าจอ | Admin | SW | Operation | ST | OT | Auditor |
|---|---|---|---|---|---|---|
| Device Registration (ลงทะเบียนกล่องใหม่)¹⁸ | R | — | C,R | C,R | C,R | R |
| Decommission Device (Web)¹⁸ | U | — | U | — | — | R |
| ทดสอบกับ Device Simulator ก่อน Confirm Install¹⁸ | — | — | C,R | C,R | C,R | R |
| Notification (รับแจ้งเตือน) | R | R | R | R | R | R |

¹⁸ **ยังไม่มีในเอกสาร Formal Design (`02-user-access-design.md`)** — เป็นสมมติฐานจาก `03_GPS_Detailed_Build_Steps.md` เท่านั้น ต้องยืนยันกับทีมก่อนใช้เขียน Guard จริง

---

## สรุปหลักการที่ยึดตลอดทั้ง Matrix (จาก 02-user-access-design.md หัวข้อ 2.6)

- **เฉพาะ Operation เท่านั้นที่อนุมัติ Config/Firmware/Campaign ได้** — บังคับที่ Approval Chain Definition (`approver_role`) ไม่ใช่ Flag รายคน — Senior Technician และ Operation - Technician ไม่มีสิทธิ์นี้เลยไม่ว่าช่องทางไหน
- **การอนุมัติทำได้เฉพาะผ่าน Web เท่านั้น** — Mobile ไม่มีเมนู Pending Approval อีกต่อไป มีแค่ Push Notification แจ้งเตือน
- **Device Config Override และ Firmware Override รายเครื่อง ทำผ่าน Web เท่านั้น ตัดออกจาก Mobile ถาวร** — เป็น 2 หน้าจอ Web เพียงหน้าเดียวที่ ST/OT เข้าถึงได้ (ไม่ใช่ Full Web Access)
- **Approval by Person = แจ้งเตือนก่อน ไม่ใช่ผูกขาด** (2.6.1) — ผู้ขอเลือกคนแจ้งเตือนก่อนได้ แต่ Operation คนอื่นที่ Role ตรงกันก็กดอนุมัติแทนได้เสมอ กัน Approval ค้างเวลาคนที่ถูกเลือกไม่ว่าง
- **SelfApprovalGuard:** `requested_by ≠ approved_by` เสมอ เช็คทั้งตอนสร้างคำขอและตอนกดอนุมัติจริง
- **Software Engineer ไม่ Approve งานของตัวเอง** — Segregation of Duties ระหว่างผู้สร้างกับผู้อนุมัติยังคงไว้เสมอ
- **Auditor แยก Role อิสระจาก Administrator เสมอ** แม้แต่ Admin เองก็เข้า Audit Log ไม่ได้
- **Customer Scope Check เป็นชั้นที่ 2 เสมอ** (นอกจาก Role Permission Check ชั้นที่ 1) — ST/OT เห็นเฉพาะข้อมูลลูกค้าที่ถูกมอบหมายเท่านั้น แม้ Admin จะเห็นได้ทุกรายในฐานะ Internal Role

---

## ขั้นตอนถัดไป

1. ส่งไฟล์นี้ให้ kittiphong (B) ตรวจสอบ 3 จุดที่ยังไม่เคลียร์ (หัวข้อ "⚠️" ด้านบน) โดยเฉพาะเรื่อง Campaign Assignment ที่ขัดกับ Data Dictionary
2. ถ้ายืนยันแล้วว่า Data Dictionary ต้องแก้ (`CAMPAIGN_ASSIGNMENT.assigned_by`) ให้แจ้ง kittiphong ปรับไฟล์ `GPS_Data_Dictionary.xlsx` และ `schema.prisma` ให้ตรงกับ RBAC ฉบับนี้
3. เอา Matrix นี้ไปใช้เขียน Auth Guard (Phase 0 ข้อ 5) — อ้างอิงหลักการ C/R/U/D + Permission key ตามที่ระบุในหมายเหตุ ไม่ใช่ Action Type 5 แบบตรงๆ
4. kittiphong เอา Matrix นี้ไปใช้ทำ RBAC ฝั่ง Mobile ต่อ (โดยเฉพาะหมวด 4-6)
