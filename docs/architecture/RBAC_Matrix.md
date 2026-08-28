# RBAC Matrix — GPS Config & Firmware Center

**อ้างอิงจาก:** `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 (`[A]` ทำ RBAC Matrix ให้เสร็จก่อนเขียนโค้ด Auth), `01_GPS_Build_Reference.md` Section 2, `02_GPS_Development_Plan.md` แถวที่ 5, `docs/api/openapi.yaml` (enum `role`)
**สถานะ:** ร่างจาก paveekornk (A) — ต้องคุยเนื้อหากับ kittiphong (B) ก่อนปิด เพราะ B ต้องเอาไปใช้ทำ RBAC ฝั่ง Mobile และ Guard ฝั่ง Backend ต้อง implement ตาม Matrix นี้เป๊ะๆ
**ห้าม:** เขียน Auth Guard (`backend/src/common/guards/`) หรือ `middleware.ts` ฝั่ง Web ก่อนตารางนี้ถูก sign-off

---

## 1. คำนิยาม Role

| Role | ชื่อเต็ม | แพลตฟอร์มที่ใช้ | บทบาทโดยสรุป |
|---|---|---|---|
| **SW** | Software Engineer | Web | สร้าง/แก้ไข/Import Config, รัน Config/Firmware Simulation, ตัดสินใจผ่าน-ไม่ผ่านด้วยตัวเองก่อนส่งอนุมัติ |
| **Operation** | Operation | Web | อนุมัติ/ปฏิเสธ Config (Approval Center), จัดการ Campaign, มอบหมายงานให้ช่างหน้างาน, ตัดสินใจ Rollback |
| **ST** | Senior Technician | Web | ช่างเทคนิคระดับอาวุโส — มีสิทธิ์ Override Config/Firmware ตรงที่หน้างาน/ระบบโดยไม่ต้องผ่าน flow อนุมัติปกติ (ใช้กรณีแก้ปัญหาเฉพาะกล่องที่ Approval Center ไม่ทันการ) และดูแลการแก้ไข Incident เชิงเทคนิค |
| **OT** | Operation-Technician | Web | ช่างเทคนิคที่ทำงานสังกัดฝั่ง Operation — สนับสนุนงานปฏิบัติการประจำวัน (มอบหมาย/ติดตามงานช่าง, จัดการ Change Request ที่ส่งเข้ามา) และมีสิทธิ์ Override Config/Firmware เช่นเดียวกับ ST |
| **Auditor** | Auditor | Web | ดูข้อมูลอย่างเดียวทุกจอเพื่อตรวจสอบ (compliance) — ห้าม Create/Update/Approve/Override ทุกกรณี |
| **Admin** | System Admin | Web | จัดการผู้ใช้/สิทธิ์ในระบบ, ปลดระวางกล่อง (Decommission Device), ดูข้อมูลทุกจอ — **ไม่ใช่ผู้อนุมัติ Config แทน Operation** (คงหลัก Separation of Duty) |
| **Field Technician** | ช่างหน้างาน | Mobile เท่านั้น | รับงานที่ได้รับมอบหมาย, ลงทะเบียนกล่องใหม่, ทดสอบกับ Device Simulator (ไม่บังคับ), กดยืนยันติดตั้งสำเร็จ, ส่ง Change Request |

> หมายเหตุ: `role` enum ใน `docs/api/openapi.yaml` (`LoginResponse.role`) ตอนนี้มีแค่ `[SW, Operation, ST, OT, Auditor, Admin]` — ต้องเพิ่ม `FieldTechnician` เข้าไปด้วย เพราะ Mobile ก็ต้องยืนยันตัวตนผ่าน endpoint เดียวกัน (แจ้ง B/อัปเดต OpenAPI พร้อมกับปิด Matrix นี้)

### รหัส Action ที่ใช้ในตาราง

| รหัส | ความหมาย |
|---|---|
| **C** | Create — สร้างข้อมูล/รายการใหม่ |
| **R** | Read — ดูข้อมูลได้ |
| **U** | Update — แก้ไขข้อมูลที่มีอยู่ |
| **A** | Approve — อนุมัติ/ปฏิเสธ (เปลี่ยนสถานะแบบมีผลผูกพัน) |
| **O** | Override — บังคับเปลี่ยนค่า/ข้ามขั้นตอนปกติ (ใช้กับ Config/Firmware Override โดยเฉพาะ) |
| **-** | ไม่มีสิทธิ์เข้าถึงจอ/action นี้เลย |

---

## 2. Matrix — หน้าจอ/โมดูลฝั่ง Web

| หน้าจอ / Action | SW | Operation | ST | OT | Auditor | Admin |
|---|---|---|---|---|---|---|
| **Login** | R (ตนเอง) | R (ตนเอง) | R (ตนเอง) | R (ตนเอง) | R (ตนเอง) | R (ตนเอง) |
| **Dashboard / Main** | R | R | R | R | R | R |
| **Device Search / Device Detail** | R | R | R | R | R | R |
| **Config Editor** (สร้าง/แก้ Draft ผ่านฟอร์ม) | C, R, U | R | R | R | R | R |
| **Config Import จากไฟล์ (JSON)** | C | R | R | R | R | R |
| **Config Simulation (dry-run)** + ตัดสินผ่าน/ไม่ผ่านของ SW | C, R, U | R | R | R | R | R |
| **Approval Center** (อนุมัติ/ปฏิเสธ Config) | R | R, **A** | R | R | R | R |
| **Config Simulation Gate** (บล็อก/แก้ไข/ผ่าน ก่อนเข้า Approval) | R | R | R | R | R | R |
| **Device Config Override** | R | R | **C, R, U, O** | **C, R, U, O** | R | R |
| **Firmware Repository** (อัปโหลด + Compatibility Tag) | C, R, U | R | R | R | R | R |
| **Firmware Override รายเครื่อง** | R | R | **C, R, U, O** | **C, R, U, O** | R | R |
| **Campaign Wizard** (สร้างแคมเปญ) | R | C, R, U | R | R | R | R |
| **Campaign Monitor** (ติดตาม Failure Rate) | R | R, U | R | R | R | R |
| **Task Management** (มอบหมาย/ติดตามงานช่าง) | R | C, R, U | R | C, R, U | R | R |
| **Change Request Inbox** (จากมือถือ) | R | R, U | R | R, U | R | R |
| **Incident & Rollback** | R (สร้าง Incident อัตโนมัติจากระบบ) | C, R, **U** (สั่ง Rollback) | R, U (แก้ไขเชิงเทคนิค) | R | R | R |
| **Audit Log** | - | R | R | R | **R** | R |
| **Decommission Device** | - | C, U | R | R | R | C, U |
| **User / Role Management** | - | - | - | - | - | **C, R, U** |

---

## 3. Matrix — หน้าจอฝั่ง Mobile (Field Technician)

| หน้าจอ / Action | Field Technician |
|---|---|
| **Login** | R (ตนเอง) |
| **Task List** (งานที่ได้รับมอบหมาย) | R, U (อัปเดตสถานะงานของตัวเอง) |
| **Device Registration** (ลงทะเบียนกล่องใหม่ตอนติดตั้ง) | C, R |
| **ทดสอบกับ Device Simulator ก่อนติดตั้ง** (ไม่บังคับ — v3.5) | C, R |
| **Confirm Install** (ยืนยันติดตั้งสำเร็จ) | U |
| **Change Request** (ส่งคำขอเปลี่ยนแปลงเข้า Inbox เว็บ) | C, R (เฉพาะของตัวเอง) |
| **Push Notification / แจ้งเตือน** | R |
| **Device Status ของกล่องที่ตนดูแล** | R |

> Field Technician **ไม่มีสิทธิ์เข้าหน้า Config Editor, Approval Center, Override, Campaign, Audit Log ใดๆ ทั้งสิ้น** — ทุกอย่างที่เกี่ยวกับ Config/Firmware ทำผ่าน Web โดย SW/Operation/ST/OT เท่านั้น

---

## 4. Mapping ไปยัง Backend Endpoint (สำหรับเขียน Auth Guard)

อ้างอิงจาก `docs/api/openapi.yaml` v0.1.0 — คอลัมน์ "Role ที่อนุญาต" คือค่าที่ Guard (`backend/src/common/guards/roles.guard.ts`) ต้องเช็ค

| Endpoint | Method | Role ที่อนุญาต |
|---|---|---|
| `/auth/login` | POST | Public (ทุก Role รวม Field Technician) |
| `/config` | GET | ทุก Role ที่ login แล้ว |
| `/config` | POST | SW |
| `/config/import` | POST | SW |
| `/config/{configId}/simulate` | POST | SW, Field Technician |
| `/config/{configId}/approve` | POST | Operation |
| `/config/{configId}/reject` | POST | Operation |
| `/config/{configId}/override` * | POST | ST, OT |
| `/tasks` | GET | ทุก Role ที่ login แล้ว (Field Technician เห็นเฉพาะ `assignedTo` = ตนเอง) |
| `/tasks` | POST | Operation, OT |
| `/tasks/{taskId}` | PATCH | Operation, OT, Field Technician (เฉพาะงานของตัวเอง — จำกัดเฉพาะ field `status`) |
| `/firmware` | GET | ทุก Role ที่ login แล้ว |
| `/firmware` | POST | SW |
| `/firmware/{firmwareId}/simulate` | POST | SW, Field Technician |
| `/firmware/{firmwareId}/override` * | POST | ST, OT |
| `/devices/{deviceId}/status` | GET | ทุก Role ที่ login แล้ว |
| `/devices` (registration) * | POST | Field Technician |
| `/devices/{deviceId}/decommission` * | POST | Operation, Admin |
| `/campaigns` * | POST/GET | Operation (write), ทุก Role (read) |
| `/change-requests` * | POST | Field Technician |
| `/change-requests` * | GET/PATCH | Operation, OT |
| `/incidents` * | GET/POST/PATCH | ระบบสร้างอัตโนมัติ (POST), Operation/ST อ่าน-แก้ (GET/PATCH) |
| `/audit-logs` * | GET | Operation, ST, OT, Auditor, Admin |
| `/users` * | GET/POST/PATCH | Admin เท่านั้น |

`*` = endpoint ที่ยังไม่มีใน `docs/api/openapi.yaml` เวอร์ชันปัจจุบัน (0.1.0) — ต้องเพิ่มตอนเขียนโมดูลนั้นจริงตามที่ระบุไว้ท้ายไฟล์ openapi ("ทุกครั้งที่เพิ่ม Endpoint ใหม่ในแต่ละ Phase ถัดไป ให้กลับมาอัปเดตไฟล์นี้ด้วย")

---

## 5. กติกา Separation of Duty (สำคัญ — ต้องคุยกับ B ให้ตรงกันก่อนปิด)

1. **SW ห้ามอนุมัติ Config ของตัวเอง** — คนที่กด Create/Import Config (SW) ต้องไม่ใช่คนเดียวกับที่กด Approve (Operation) แม้ในทางเทคนิคจะ login คนละ account อยู่แล้วก็ตาม แต่ Guard ต้องบล็อกที่ระดับ Role ไม่ใช่แค่ระดับ user id
2. **Override (ST/OT) ต้องบันทึกลง Audit Log ทุกครั้งแบบบังคับ** ไม่มีข้อยกเว้น เพราะเป็นการข้าม flow อนุมัติปกติ (ต่างจาก Config ปกติที่ผ่าน Approval Center อยู่แล้ว)
3. **Operation ปฏิเสธ Config → สถานะย้อนกลับไป Draft เสมอ** (ตามที่ยืนยันไว้ใน Formal.md Section 3.1) ไม่มี Role ไหนสามารถ Override ขั้นตอนนี้ได้ นอกจาก ST/OT ที่ใช้ path "Override" แยกต่างหาก ซึ่งไม่ผ่าน Approval Center เลย
4. **Admin ไม่ใช่ Approver และไม่ใช่ Override** — สิทธิ์ Admin จำกัดเฉพาะ User/Role Management และ Decommission Device เพื่อคงหลัก Separation of Duty ไม่ให้ Admin กลายเป็น "ซูเปอร์ยูสเซอร์" ที่ผ่านทุกขั้นตอนได้คนเดียว (ถ้าทีมต้องการให้ Admin override ได้ในกรณีฉุกเฉินจริง ต้องระบุเพิ่มและใส่เหตุผลใน Audit Log)
5. **Auditor เป็น Read-only 100%** ทุกจอ ไม่มีข้อยกเว้น แม้แต่จอที่ SW/Operation เข้าถึงได้แบบ Read ก็ตาม
6. **Field Technician เห็นเฉพาะข้อมูลของตัวเอง** — Task/Change Request ที่ query ผ่าน `assignedTo` ต้อง filter ด้วย user id ของตัวเอง ไม่ใช่แค่ซ่อน UI แต่ต้องกรองที่ Backend ด้วย

---

## 6. Assumption ที่ยังไม่ยืนยัน — ต้องคุยกับ kittiphong (B) ก่อนปิด Matrix

- **ขอบเขต ST vs OT**: ในเอกสารต้นทางระบุแค่ "Override เฉพาะ ST/OT" โดยไม่แยกรายละเอียด ในร่างนี้แบ่งให้ ST เน้นงานเทคนิค/Incident ระดับอาวุโส และ OT เน้นงานปฏิบัติการ (Task/Change Request) แต่ทั้งคู่ Override ได้เท่ากัน — ถ้าทีมต้องการแบ่งสิทธิ์ Override ให้ต่างกัน (เช่น ST override ได้ทุกกรณี แต่ OT override ได้เฉพาะที่ Operation สั่งมาก่อน) ต้องแก้ตารางส่วนที่ 2 และ 4
- **Task Management ฝั่งใครเป็นคนสร้าง**: ร่างนี้ให้ทั้ง Operation และ OT สร้าง/แก้ไข Task ได้ — ถ้าทีมต้องการให้มีแค่ Role เดียวเป็นคนมอบหมายงานหลัก ต้องระบุเพิ่ม
- **Decommission Device**: ร่างนี้ให้ Operation และ Admin ทำได้ทั้งคู่ (Operation เพราะเป็นคนดูแลสถานะกล่องประจำวัน, Admin เพราะเป็นงานเชิงระบบ) — ยืนยันว่าต้องการให้ทั้งสอง Role ทำได้หรือจำกัดแค่ Role เดียว
- **User/Role Management**: ยังไม่มีจอนี้ระบุไว้ใน Checkpoint Features ของแผน Sprint ใดเลย — เพิ่มเข้ามาในร่างนี้เพราะ Admin role ต้องมีอย่างน้อย 1 หน้าที่ใช้งานจริง ต้องตกลงว่าจะทำ Sprint ไหน (ปัจจุบันไม่มีอยู่ใน Task Backlog)

---

## Change Log

| วันที่ | ผู้แก้ไข | รายละเอียด |
|---|---|---|
| 2026-08-28 | paveekornk | สร้างฉบับร่างแรก ตาม Gap ที่ระบุใน `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 — ยืนยันคำเต็ม ST=Senior Technician, OT=Operation-Technician กับ paveekornk แล้ว |
