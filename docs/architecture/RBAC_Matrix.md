# RBAC Matrix — GPS Config & Firmware Center

**อ้างอิงจาก:** `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 (`[A]` ทำ RBAC Matrix ให้เสร็จก่อนเขียนโค้ด Auth), `01_GPS_Build_Reference.md` Section 2, `02_GPS_Development_Plan.md` แถวที่ 5, **`docs/api/openapi.yaml` บน `main` (v0.1.0) — ใช้เป็นแหล่งอ้างอิงหลักสำหรับ Role enum, Config status enum, และรายชื่อ Endpoint ที่มีจริง**
**สถานะ:** ร่างจาก paveekornk (A) — ต้องคุยเนื้อหากับ kittiphong (B) ก่อนปิด เพราะ B ต้องเอาไปใช้ทำ RBAC ฝั่ง Mobile และ Guard ฝั่ง Backend ต้อง implement ตาม Matrix นี้เป๊ะๆ
**ห้าม:** เขียน Auth Guard (`backend/src/common/guards/`) หรือ `middleware.ts` ฝั่ง Web ก่อนตารางนี้ถูก sign-off

---

## 1. คำนิยาม Role

| Role (ตาม enum จริงใน openapi.yaml) | ชื่อเต็ม | แพลตฟอร์มที่ใช้ | บทบาทโดยสรุป |
|---|---|---|---|
| **SW** | Software Engineer | Web | สร้าง/แก้ไข/Import Config, รัน Config/Firmware Simulation, ตัดสินใจผ่าน-ไม่ผ่านด้วยตัวเองก่อนส่งอนุมัติ (ทำให้สถานะเป็น `sw_approved`) |
| **Operation** | Operation | Web | อนุมัติ/ปฏิเสธ Config ที่ `sw_approved` แล้ว (Approval Center → `operation_approved`), จัดการ Campaign, มอบหมายงานให้ช่างหน้างาน, ตัดสินใจ Rollback |
| **ST** | Senior Technician | Web | ช่างเทคนิคระดับอาวุโส — มีสิทธิ์ Override Config/Firmware ตรงที่หน้างาน/ระบบโดยไม่ต้องผ่าน flow อนุมัติปกติ (ใช้กรณีแก้ปัญหาเฉพาะกล่องที่ Approval Center ไม่ทันการ) และดูแลการแก้ไข Incident เชิงเทคนิค |
| **OT** | Operation-Technician | Web | ช่างเทคนิคที่ทำงานสังกัดฝั่ง Operation — สนับสนุนงานปฏิบัติการประจำวัน (มอบหมาย/ติดตามงานช่าง, จัดการ Change Request ที่ส่งเข้ามา) และมีสิทธิ์ Override Config/Firmware เช่นเดียวกับ ST |
| **Auditor** | Auditor | Web | ดูข้อมูลอย่างเดียวทุกจอเพื่อตรวจสอบ (compliance) — ห้าม Create/Update/Approve/Override ทุกกรณี |
| **Admin** | System Admin | Web | จัดการผู้ใช้/สิทธิ์ในระบบ, ปลดระวางกล่อง (Decommission Device), ดูข้อมูลทุกจอ — **ไม่ใช่ผู้อนุมัติ Config แทน Operation** (คงหลัก Separation of Duty) |
| **FieldTechnician** | ช่างหน้างาน | Mobile เท่านั้น | รับงานที่ได้รับมอบหมาย, ลงทะเบียนกล่องใหม่, ทดสอบกับ Device Simulator (ไม่บังคับ), กดยืนยันติดตั้งสำเร็จ, ส่ง Change Request |

> **อัปเดตให้ตรงกับ `main` ล่าสุด:** enum `role` ใน `docs/api/openapi.yaml` (`LoginResponse.role`) ตอนนี้คือ `[SW, Operation, ST, OT, Auditor, Admin, FieldTechnician]` — มี `FieldTechnician` แล้ว (เพิ่มเข้ามาแล้วหลังคุยกันตอนทำ Matrix รอบแรก) ไม่มี Gap ส่วนนี้แล้ว **ใช้ชื่อ `FieldTechnician` แบบคำเดียวไม่มีเว้นวรรคให้ตรงกับ enum ทุกที่ที่อ้างอิงในโค้ด** (เอกสารนี้ใช้ "Field Technician" แบบมีเว้นวรรคเฉพาะตอนพูดถึงตำแหน่งงานในภาษาไทย)
>
> enum สถานะ Config (`DeviceConfigDraft.status` / query param `status` ของ `GET /config`) ตอนนี้คือ `[draft, testing, sw_approved, operation_approved, rejected, synced]` — **ละเอียดกว่าที่ร่างแรกสมมติไว้** (ร่างแรกใช้คำรวมว่า "approved" คำเดียว) แยกชัดว่า SW กับ Operation คนละสถานะกัน สอดคล้องกับ Action ในตารางข้อ 2 ที่ให้ SW "ตัดสินใจผ่าน/ไม่ผ่าน" เป็นคนละ action กับ Operation "อนุมัติ"

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
| **Config Editor** (สร้าง/แก้ Draft ผ่านฟอร์ม — สถานะ `draft`) | C, R, U | R | R | R | R | R |
| **Config Import จากไฟล์ (JSON)** (เข้า flow เดียวกับฟอร์ม) | C | R | R | R | R | R |
| **Config Simulation (dry-run)** — รันทดสอบ (สถานะ `testing`) แล้ว SW ตัดสินผ่าน/ไม่ผ่านเอง (ผ่าน → `sw_approved`, ไม่ผ่าน → กลับ `draft`) | C, R, U | R | R | R | R | R |
| **Approval Center** — Operation อนุมัติ/ปฏิเสธ Config ที่เป็น `sw_approved` (อนุมัติ → `operation_approved`, ปฏิเสธ → กลับ `draft` ทั้งหมด) | R | R, **A** | R | R | R | R |
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

## 3. Matrix — หน้าจอฝั่ง Mobile (FieldTechnician)

| หน้าจอ / Action | FieldTechnician |
|---|---|
| **Login** | R (ตนเอง) |
| **Task List** (งานที่ได้รับมอบหมาย) | R, U (อัปเดตสถานะงานของตัวเอง) |
| **Device Registration** (ลงทะเบียนกล่องใหม่ตอนติดตั้ง) | C, R |
| **ทดสอบกับ Device Simulator ก่อนติดตั้ง** (ไม่บังคับ — v3.5) | C, R |
| **Confirm Install** (ยืนยันติดตั้งสำเร็จ) | U |
| **Change Request** (ส่งคำขอเปลี่ยนแปลงเข้า Inbox เว็บ) | C, R (เฉพาะของตัวเอง) |
| **Push Notification / แจ้งเตือน** | R |
| **Device Status ของกล่องที่ตนดูแล** | R |

> FieldTechnician **ไม่มีสิทธิ์เข้าหน้า Config Editor, Approval Center, Override, Campaign, Audit Log ใดๆ ทั้งสิ้น** — ทุกอย่างที่เกี่ยวกับ Config/Firmware ทำผ่าน Web โดย SW/Operation/ST/OT เท่านั้น

---

## 4. Mapping ไปยัง Backend Endpoint (สำหรับเขียน Auth Guard)

แหล่งอ้างอิงหลัก: **`docs/api/openapi.yaml` บน `main` (v0.1.0)** — ตาราง 4.1 คือ endpoint ที่**มีอยู่จริง**ใน spec ปัจจุบัน ใช้ implement Guard ได้ทันที ส่วนตาราง 4.2 คือ endpoint ที่ Matrix นี้อ้างถึงในข้อ 2/3 แต่**ยังไม่มีใน spec** — ต้องเพิ่มเข้า openapi.yaml ก่อนเขียน Guard จริง (ห้ามเดา path/method เอาเองแล้วชงเข้าโค้ด)

### 4.1 Endpoint ที่มีจริงใน `openapi.yaml` วันนี้

| Endpoint | Method | operationId | Role ที่อนุญาต |
|---|---|---|---|
| `/auth/login` | POST | `login` | Public (ทุก Role รวม FieldTechnician) — `security: []` ระบุไว้ใน spec แล้ว |
| `/config` | GET | `listConfigs` | ทุก Role ที่ login แล้ว |
| `/config` | POST | `createConfig` | SW |
| `/config/import` | POST | `importConfig` | SW |
| `/config/{configId}/simulate` | POST | `simulateConfig` | SW, FieldTechnician (ใช้ endpoint เดียวกันทั้ง Web และ Mobile ตาม summary ใน spec) |
| `/config/{configId}/approve` | POST | `approveConfig` | Operation เท่านั้น |
| `/config/{configId}/reject` | POST | `rejectConfig` | Operation เท่านั้น |
| `/tasks` | GET | `listTasks` | ทุก Role ที่ login แล้ว (FieldTechnician ต้องถูกกรองที่ Backend ให้เห็นเฉพาะ `assignedTo` = ตนเอง) |
| `/tasks` | POST | `createTask` | Operation, OT |
| `/tasks/{taskId}` | GET | `getTask` | ทุก Role ที่ login แล้ว (FieldTechnician เฉพาะงานของตัวเอง) |
| `/tasks/{taskId}` | PATCH | `updateTask` | Operation, OT, FieldTechnician (เฉพาะงานของตัวเอง — จำกัดเฉพาะ field `status`) |
| `/firmware` | GET | `listFirmware` | ทุก Role ที่ login แล้ว |
| `/firmware` | POST | `uploadFirmware` | SW |
| `/firmware/{firmwareId}/simulate` | POST | `simulateFirmware` | SW, FieldTechnician |
| `/devices/{deviceId}/status` | GET | `getDeviceStatus` | ทุก Role ที่ login แล้ว |

### 4.2 Endpoint ที่ Matrix อ้างถึง แต่ยังไม่มีใน `openapi.yaml` — ต้องเพิ่มก่อนเขียน Guard

| Endpoint ที่ต้องเพิ่ม (ชื่อ/path เป็นข้อเสนอ ยังไม่ fix) | Method | Role ที่อนุญาต (ตามข้อ 2) | เหตุผลที่ยังไม่มี |
|---|---|---|---|
| Config: ให้ SW ปักผลตัดสินใจผ่าน/ไม่ผ่านเอง (แยกจาก `simulate` ที่แค่คืนผลทดสอบ ไม่เปลี่ยน status) | POST | SW | Gap ที่พบระหว่างทำ Matrix — สถานะ `sw_approved`/กลับ `draft` มีอยู่ใน enum แล้ว แต่ยังไม่มี endpoint ที่สั่งเปลี่ยนสถานะนี้ |
| `/config/{configId}/override` | POST | ST, OT | ยังไม่มีโมดูล Override เลยใน spec |
| `/firmware/{firmwareId}/override` | POST | ST, OT | เช่นเดียวกับข้างบน |
| `/devices` (registration) | POST | FieldTechnician | ยังไม่มี endpoint สร้าง Device |
| `/devices/{deviceId}/decommission` | POST | Operation, Admin | ยังไม่มีโมดูล Device lifecycle |
| `/campaigns` | GET/POST/PATCH | Operation (เขียน), ทุก Role (อ่าน) | ยังไม่มีโมดูล `campaign` ใน spec เลย |
| `/change-requests` | POST | FieldTechnician | ยังไม่มีโมดูลนี้ |
| `/change-requests` | GET/PATCH | Operation, OT | เช่นเดียวกับข้างบน |
| `/incidents` | GET/POST/PATCH | ระบบสร้างอัตโนมัติ (POST), Operation/ST อ่าน-แก้ (GET/PATCH) | ยังไม่มีโมดูล `incident` ใน spec |
| `/audit-logs` | GET | Operation, ST, OT, Auditor, Admin | ยังไม่มีโมดูล `audit` ใน spec |
| `/users` | GET/POST/PATCH | Admin เท่านั้น | ยังไม่มีโมดูล User/Role Management ใน spec |

> ตามหมายเหตุท้าย `openapi.yaml`: "ทุกครั้งที่เพิ่ม Endpoint ใหม่ในแต่ละ Phase ถัดไป ให้กลับมาอัปเดตไฟล์นี้ด้วย" — ตาราง 4.2 นี้คือ backlog ของสิ่งที่ต้องอัปเดตเข้า spec ก่อน ไม่ใช่สิ่งที่ Guard เขียนได้ตอนนี้

---

## 5. กติกา Separation of Duty (สำคัญ — ต้องคุยกับ B ให้ตรงกันก่อนปิด)

1. **SW ห้ามอนุมัติ Config ของตัวเอง** — คนที่กด Create/Import Config (SW) ต้องไม่ใช่คนเดียวกับที่กด Approve (Operation) แม้ในทางเทคนิคจะ login คนละ account อยู่แล้วก็ตาม แต่ Guard ต้องบล็อกที่ระดับ Role ไม่ใช่แค่ระดับ user id
2. **สถานะ Config ต้องไล่ตาม enum จริงเป๊ะๆ**: `draft` → `testing` → `sw_approved` → `operation_approved` → `synced` (หรือ `rejected` แล้วย้อนกลับ `draft` ได้จากทั้งจุด SW และจุด Operation) — ห้าม Guard/Service ข้าม state ใดๆ (เช่น Operation approve ตรงจาก `draft` โดยไม่ผ่าน `sw_approved` ก่อน ต้องบล็อก)
3. **Override (ST/OT) ต้องบันทึกลง Audit Log ทุกครั้งแบบบังคับ** ไม่มีข้อยกเว้น เพราะเป็นการข้าม flow อนุมัติปกติ (ต่างจาก Config ปกติที่ผ่าน Approval Center อยู่แล้ว)
4. **Operation ปฏิเสธ Config → สถานะย้อนกลับไป `draft` เสมอ** (ตามที่ยืนยันไว้ใน Formal.md Section 3.1) ไม่มี Role ไหนสามารถ Override ขั้นตอนนี้ได้ นอกจาก ST/OT ที่ใช้ path "Override" แยกต่างหาก ซึ่งไม่ผ่าน Approval Center เลย
5. **Admin ไม่ใช่ Approver และไม่ใช่ Override** — สิทธิ์ Admin จำกัดเฉพาะ User/Role Management และ Decommission Device เพื่อคงหลัก Separation of Duty ไม่ให้ Admin กลายเป็น "ซูเปอร์ยูสเซอร์" ที่ผ่านทุกขั้นตอนได้คนเดียว (ถ้าทีมต้องการให้ Admin override ได้ในกรณีฉุกเฉินจริง ต้องระบุเพิ่มและใส่เหตุผลใน Audit Log)
6. **Auditor เป็น Read-only 100%** ทุกจอ ไม่มีข้อยกเว้น แม้แต่จอที่ SW/Operation เข้าถึงได้แบบ Read ก็ตาม
7. **FieldTechnician เห็นเฉพาะข้อมูลของตัวเอง** — Task/Change Request ที่ query ผ่าน `assignedTo` ต้อง filter ด้วย user id ของตัวเอง ไม่ใช่แค่ซ่อน UI แต่ต้องกรองที่ Backend ด้วย (`GET /tasks` ตอนนี้มี query param `assignedTo` อยู่แล้ว — Guard ต้อง**บังคับ**ค่านี้ให้เท่ากับ user id ของ FieldTechnician ที่ login ไม่ใช่ให้เลือกเองจากฝั่ง client)

---

## 6. Assumption ที่ยังไม่ยืนยัน — ต้องคุยกับ kittiphong (B) ก่อนปิด Matrix

- **ขอบเขต ST vs OT**: ในเอกสารต้นทางระบุแค่ "Override เฉพาะ ST/OT" โดยไม่แยกรายละเอียด ในร่างนี้แบ่งให้ ST เน้นงานเทคนิค/Incident ระดับอาวุโส และ OT เน้นงานปฏิบัติการ (Task/Change Request) แต่ทั้งคู่ Override ได้เท่ากัน — ถ้าทีมต้องการแบ่งสิทธิ์ Override ให้ต่างกัน (เช่น ST override ได้ทุกกรณี แต่ OT override ได้เฉพาะที่ Operation สั่งมาก่อน) ต้องแก้ตารางส่วนที่ 2 และ 4
- **Endpoint สำหรับ SW ปักผลตัดสินใจ**: ตาม 4.2 — `simulateConfig` คืนผลทดสอบเฉยๆ ไม่เปลี่ยน status ต้องตกลงกันว่าจะเพิ่ม endpoint แยก (เช่น `/config/{id}/sw-decision`) หรือรวมเข้ากับ `simulate` แบบมี field ตัดสินใจแนบไปด้วย
- **Task Management ฝั่งใครเป็นคนสร้าง**: ร่างนี้ให้ทั้ง Operation และ OT สร้าง/แก้ไข Task ได้ — ถ้าทีมต้องการให้มีแค่ Role เดียวเป็นคนมอบหมายงานหลัก ต้องระบุเพิ่ม
- **Decommission Device**: ร่างนี้ให้ Operation และ Admin ทำได้ทั้งคู่ (Operation เพราะเป็นคนดูแลสถานะกล่องประจำวัน, Admin เพราะเป็นงานเชิงระบบ) — ยืนยันว่าต้องการให้ทั้งสอง Role ทำได้หรือจำกัดแค่ Role เดียว
- **User/Role Management**: ยังไม่มีจอนี้ระบุไว้ใน Checkpoint Features ของแผน Sprint ใดเลย — เพิ่มเข้ามาในร่างนี้เพราะ Admin role ต้องมีอย่างน้อย 1 หน้าที่ใช้งานจริง ต้องตกลงว่าจะทำ Sprint ไหน (ปัจจุบันไม่มีอยู่ใน Task Backlog)

---

## Change Log

| วันที่ | ผู้แก้ไข | รายละเอียด |
|---|---|---|
| 2026-08-28 | paveekornk | สร้างฉบับร่างแรก ตาม Gap ที่ระบุใน `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 — ยืนยันคำเต็ม ST=Senior Technician, OT=Operation-Technician กับ paveekornk แล้ว |
| 2026-08-28 | paveekornk | ปรับให้ตรงกับ `docs/api/openapi.yaml` บน `main` เป็นหลัก: (1) ตัด Gap เรื่อง `FieldTechnician` ออกเพราะเพิ่มเข้า enum แล้ว, (2) ปรับสถานะ Config ให้ตรงกับ enum จริง `sw_approved`/`operation_approved` แทนคำรวม "approved", (3) แยกตาราง Endpoint เป็น 4.1 (มีจริงใน spec) กับ 4.2 (ยังไม่มี — ต้องเพิ่ม) ให้ชัดเจนขึ้น, (4) เพิ่ม Gap เรื่อง endpoint สำหรับ SW ปักผลตัดสินใจที่ยังไม่มีใน spec |
