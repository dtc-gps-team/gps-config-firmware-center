# RBAC Matrix — GPS Config & Firmware Center

**อ้างอิงจาก:** `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 (`[A]` ทำ RBAC Matrix ให้เสร็จก่อนเขียนโค้ด Auth), `01_GPS_Build_Reference.md` Section 2, `02_GPS_Development_Plan.md` แถวที่ 5, **`docs/api/openapi.yaml` บน `main` (v0.1.0) — ใช้เป็นแหล่งอ้างอิงหลักสำหรับ Role enum, Config status enum, และรายชื่อ Endpoint ที่มีจริง (เช็คล่าสุดหลัง `git pull` main สดๆ)**
**สถานะ:** ร่างจาก paveekornk (A) — ต้องคุยเนื้อหากับ kittiphong (B) ก่อนปิด เพราะ B ต้องเอาไปใช้ทำ RBAC ฝั่ง Mobile และ Guard ฝั่ง Backend ต้อง implement ตาม Matrix นี้เป๊ะๆ
**ห้าม:** เขียน Auth Guard (`backend/src/common/guards/`) หรือ `middleware.ts` ฝั่ง Web ก่อนตารางนี้ถูก sign-off

---

## 1. คำนิยาม Role

| Role (ตาม enum จริงใน openapi.yaml บน `main`) | ชื่อเต็ม | แพลตฟอร์มที่ใช้ | บทบาทโดยสรุป |
|---|---|---|---|
| **SW** | Software Engineer | Web | สร้าง/แก้ไข/Import Config, รัน Config/Firmware Simulation, ตัดสินใจผ่าน-ไม่ผ่านด้วยตัวเองก่อนส่งให้ Operation อนุมัติ |
| **Operation** | Operation | Web | อนุมัติ/ปฏิเสธ Config (Approval Center → status `approved`), จัดการ Campaign, มอบหมายงานให้ช่างหน้างาน, ตัดสินใจ Rollback |
| **ST** | Senior Technician | Web + Mobile | ช่างเทคนิคระดับอาวุโส — มีสิทธิ์ Override Config/Firmware ตรงที่หน้างาน/ระบบโดยไม่ต้องผ่าน flow อนุมัติปกติ (ใช้กรณีแก้ปัญหาเฉพาะกล่องที่ Approval Center ไม่ทันการ) และดูแลการแก้ไข Incident เชิงเทคนิค |
| **OT** | Operation-Technician | Web + Mobile | ช่างเทคนิคที่ทำงานสังกัดฝั่ง Operation — สนับสนุนงานปฏิบัติการประจำวัน (มอบหมาย/ติดตามงานช่าง, จัดการ Change Request ที่ส่งเข้ามา) และมีสิทธิ์ Override Config/Firmware เช่นเดียวกับ ST |
| **Auditor** | Auditor | Web | ดูข้อมูลอย่างเดียวทุกจอเพื่อตรวจสอบ (compliance) — ห้าม Create/Update/Approve/Override ทุกกรณี |
| **Admin** | System Admin | Web | จัดการผู้ใช้/สิทธิ์ในระบบ, ปลดระวางกล่อง (Decommission Device), ดูข้อมูลทุกจอ — **ไม่ใช่ผู้อนุมัติ Config แทน Operation** (คงหลัก Separation of Duty) |

> **✅ ยืนยันแล้วผ่าน [PR #13](https://github.com/dtc-gps-team/gps-config-firmware-center/pull/13) (merged): ตัด Role `FieldTechnician` ออกทั้งเอกสาร — ไม่มี Role นี้อยู่จริง** เดิม `03_GPS_Detailed_Build_Steps.md` ระบุว่ามี 7 Role รวม "Field Technician" แต่ทีมยืนยันแล้วว่าเป็นชื่อตกค้างจากตอนออกแบบครั้งแรก คนที่ทำงานหน้างาน (ติดตั้งกล่อง/รับ Task/Confirm Install/ส่ง Change Request ผ่านมือถือ) ที่จริงคือ **ST/OT ที่ login เข้าแอป Mobile** ไม่ใช่ Role แยกต่างหาก — enum `role` ใน `openapi.yaml` ก็ไม่เคยมี `FieldTechnician` มาตั้งแต่ต้น จึงตรงกับโค้ดจริงพอดี (ก่อนหน้านี้เอกสารฉบับร่างเข้าใจผิดคิดว่าต้องเพิ่ม `FieldTechnician` เข้า enum — **ไม่ต้องทำแล้ว**) เพราะฉะนั้น ST/OT จึงใช้ทั้ง **Web + Mobile** (ดู Section 3 ที่แก้ตามนี้ทั้งตาราง)
>
> enum สถานะ Config (`DeviceConfigDraft.status` และ query param `status` ของ `GET /config`) บน `main` ตอนนี้คือ `[draft, testing, approved, rejected, synced]` — **เป็นคำรวม "approved" คำเดียว ไม่ได้แยก `sw_approved`/`operation_approved`** ตามที่ร่างก่อนหน้าสมมติไว้ผิด (คิดว่าใครแก้ enum ให้ละเอียดขึ้นแล้ว แต่ที่จริงคือ noise จาก branch เดียวกัน) → ดูผลกระทบต่อ Action ในตารางข้อ 2 และ Gap ที่เกี่ยวข้องในข้อ 6

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
| **Config Editor** (สร้าง/แก้ Draft ผ่านฟอร์ม — สถานะ `draft`) | C, R, U ² | R | R | R | R | R |
| **Config Import จากไฟล์ (JSON)** (เข้า flow เดียวกับฟอร์ม) | C | R | R | R | R | R |
| **Config Simulation (dry-run)** — รันทดสอบผ่าน `POST /config/{id}/simulate` (**ไม่เปลี่ยนสถานะ** — คืนแค่ผลทดสอบ กดซ้ำได้ระหว่างที่ยังเป็น `draft`) | C, R, U | R | R | R | R | R |
| **Approval Center** — Operation อนุมัติ/ปฏิเสธ Config (อนุมัติ → `approved`, ปฏิเสธ → กลับ `draft` ทั้งหมด) | R | R, **A** | R | R | R | R |
| **Config Simulation Gate** (บล็อก/แก้ไข/ผ่าน ก่อนเข้า Approval) | R | R | R | R | R | R |
| **Device Config Override** | R | R | **C, R, U, O** | **C, R, U, O** | R | R |
| **Firmware Repository** (อัปโหลด + Compatibility Tag) | C, R, U | R | R | R | R | R |
| **Firmware Override รายเครื่อง** | R | R | **C, R, U, O** | **C, R, U, O** | R | R |
| **Campaign Wizard** (สร้างแคมเปญ) | R | C, R, U | R | R | R | R |
| **Campaign Monitor** (ติดตาม Failure Rate) | R | R, U | R | R | R | R |
| **Task Management** (สร้าง/มอบหมาย/ติดตามงานช่าง — ดูรายละเอียดสิทธิ์ที่ 4.3) | R | C, R, U | R¹ | R¹ | R | R |
| **Change Request Inbox** (จากมือถือ) | R | R, U | R | R, U | R | R |
| **Incident & Rollback** | R (สร้าง Incident อัตโนมัติจากระบบ) | C, R, **U** (สั่ง Rollback) | R, U (แก้ไขเชิงเทคนิค) | R | R | R |
| **Audit Log** | - | R | R | R | **R** | R |
| **Decommission Device** | - | C, U | R | R | R | C, U |
| **User / Role Management** | - | - | - | - | - | **C, R, U** |
| **Notification Center** (ของตนเอง) | R, U (mark read) | R, U | R, U | R, U | R, U | R, U |

¹ ST/OT บน Web ดู Task ที่ตัวเองถูก assign ได้อย่างเดียว — การแก้ `status` ของงานตัวเอง (รับงาน/ปิดงาน) ทำผ่าน **Mobile** (ดู Section 3 และ 4.3)

² **ปิด open question: Config ไม่ scope ตาม creator** — ยืนยันโดย paveekornk (A) เจ้าของ module `config`: SW ทุกคนแก้ไข/ลบ Config ที่ยังเป็น `draft` ร่วมกันได้ ไม่ใช่แยกเป็นของใครของมัน (ต่างจาก Task ที่ ST/OT เห็น/แก้เฉพาะงานตัวเอง — ดู footnote ¹) `ConfigService.update`/`remove` จึงไม่ filter ด้วย `createdBy` โดยตั้งใจ — ถ้าทีมต้องการเปลี่ยนเป็นแยกตามเจ้าของทีหลัง ต้องแก้ทั้งแถวนี้และ service layer ใหม่

---

## 3. Matrix — หน้าจอฝั่ง Mobile (Operation/ST/OT)

**หมายเหตุ:** ตาม [PR #13](https://github.com/dtc-gps-team/gps-config-firmware-center/pull/13) — ผู้ใช้ Mobile ทั้งหมดคือ **Operation/ST/OT** (ไม่มี Role `FieldTechnician` แยกต่างหากอีกต่อไป) คงคอลัมน์ Role ไว้เผื่ออนาคตอยากแยกสิทธิ์เฉพาะบางแถวระหว่าง Operation/ST/OT

| หน้าจอ / Action | Role | Action |
|---|---|---|
| **Login** | Operation/ST/OT | R (ตนเอง) |
| **Task List** (งานที่ได้รับมอบหมาย) | Operation/ST/OT | R, U (อัปเดตสถานะงานของตัวเอง) |
| **Device Registration** (ลงทะเบียนกล่องใหม่ตอนติดตั้ง) | Operation/ST/OT | C, R |
| **ทดสอบกับ Device Simulator ก่อนติดตั้ง** (ไม่บังคับ — v3.5) | Operation/ST/OT | C, R |
| **Confirm Install** (ยืนยันติดตั้งสำเร็จ) | Operation/ST/OT | U |
| **Change Request** (ส่งคำขอเปลี่ยนแปลงเข้า Inbox เว็บ) | Operation/ST/OT | C, R (เฉพาะของตัวเอง) |
| **Push Notification / แจ้งเตือน** | Operation/ST/OT | R, U (mark read) |
| **Device Status ของกล่องที่ตนดูแล** | Operation/ST/OT | R |

> ผู้ใช้ Mobile (Operation/ST/OT) **ไม่มีสิทธิ์เข้าหน้า Config Editor, Approval Center, Campaign Wizard, Audit Log ผ่านมือถือ** — งานเหล่านี้ทำผ่าน Web เท่านั้น ยกเว้น **Override** ที่ ST/OT มีสิทธิ์เต็ม (C,R,U,O) อยู่แล้วผ่าน Web ตาม Section 2 (ยังไม่ได้เปิดให้ทำผ่าน Mobile — ถ้าต้องการเพิ่มในอนาคตต้องระบุแยก)

---

## 4. Mapping ไปยัง Backend Endpoint (สำหรับเขียน Auth Guard)

แหล่งอ้างอิงหลัก: **`docs/api/openapi.yaml` บน `main` (v0.1.0)** — ตาราง 4.1 คือ endpoint ที่**มีอยู่จริง**ใน spec วันนี้ ใช้ implement Guard ได้ทันที ส่วนตาราง 4.2 คือ endpoint ที่ Matrix นี้อ้างถึงในข้อ 2/3 แต่**ยังไม่มีใน spec** — ต้องเพิ่มเข้า openapi.yaml ก่อนเขียน Guard จริง (ห้ามเดา path/method เอาเองแล้วชงเข้าโค้ด)

### 4.1 Endpoint ที่มีจริงใน `openapi.yaml` (main) วันนี้

| Endpoint | Method | operationId | Role ที่อนุญาต |
|---|---|---|---|
| `/auth/login` | POST | `login` | Public (`security: []` — ระบุไว้ใน spec แล้ว) — enum `role` ปัจจุบัน `[SW, Operation, ST, OT, Auditor, Admin]` ครอบคลุมครบแล้ว ไม่ต้องเพิ่ม Role ใหม่ (ตัด FieldTechnician ออกตาม PR #13) |
| `/config` | GET | `listConfigs` | ทุก Role ที่ login แล้ว |
| `/config` | POST | `createConfig` | SW |
| `/config/import` | POST | `importConfig` | SW |
| `/config/{configId}/simulate` | POST | `simulateConfig` | SW, Operation/ST/OT (endpoint เดียวกันทั้ง Web/Mobile ตาม summary ใน spec) |
| `/config/{configId}/approve` | POST | `approveConfig` | Operation เท่านั้น |
| `/config/{configId}/reject` | POST | `rejectConfig` | Operation เท่านั้น |
| `/config-definitions` | GET | `listConfigDefinitions` | SW, Operation, ST, OT (resource `config-definition` · catalog อ่านอย่างเดียว ไม่ใช่ข้อมูลอ่อนไหว — Auditor/Admin ยังไม่ให้ เพราะยังไม่มี use case) |
| `/config-definitions` | POST | `createConfigDefinition` | **SW เท่านั้น** (resource `config-definition` action `Create` · Semantic Validation, #26 — SW สร้าง field definition ใหม่เองได้เลย ไม่ต้องผ่านอนุมัติ เพราะ field ที่มีปัญหาจริงจะโดนจับตอนเอาไปสร้าง Config Template แล้วเข้า simulate/decide/approve อยู่ดี — ตัดสินใจร่วมกับทีมและพี่เลี้ยง 2569-09) |
| `/notifications` | GET | `listNotifications` | ทุก Role ที่ login แล้ว — ดึงเฉพาะของ user ตัวเอง (ผูกกับ JWT ไม่ใช่ query param) |
| `/notifications/{notificationId}/read` | PATCH | `markNotificationRead` | ทุก Role ที่ login แล้ว — เฉพาะ notification ของตัวเอง |
| `/tasks` | GET | `listTasks` | ทุก Role ที่ login แล้ว — ST/OT ที่ใช้ Mobile ต้องถูกกรองที่ Backend ให้เห็นเฉพาะ `assignedTo` = ตนเอง (Operation เห็นทุก Task) |
| `/tasks` | POST | `createTask` | Operation เท่านั้น (ปิด open question — ดู 4.3) |
| `/tasks/{taskId}` | GET | `getTask` | ทุก Role ที่ login แล้ว (ST/OT เฉพาะงานที่ตัวเองถูก assign) |
| `/tasks/{taskId}` | PATCH | `updateTask` | Operation (ทุก field) · ST/OT (เฉพาะ field `status` ของ Task ที่ตัวเองถูก assign) |
| `/firmware` | GET | `listFirmware` | ทุก Role ที่ login แล้ว |
| `/firmware` | POST | `uploadFirmware` | SW |
| `/firmware/{firmwareId}/simulate` | POST | `simulateFirmware` | SW, Operation/ST/OT |
| `/devices/{deviceId}/status` | GET | `getDeviceStatus` | ทุก Role ที่ login แล้ว (หมายเหตุ: มีแต่ spec ใน openapi.yaml ยังไม่มีโค้ดจริง — ดู changelog แก้ครั้งที่ 13) |
| `/devices/{deviceId}/test-connection` | POST | `testDeviceConnection` | **ST, OT เท่านั้น** (resource `device-connection-test` · ทดสอบสัญญาณอุปกรณ์ที่ติดตั้งจริง — A ยืนยันบน PR #52 ว่ายังไม่เปิด SW/Operation) |

### 4.2 Endpoint ที่ Matrix อ้างถึง แต่ยังไม่มีใน `openapi.yaml` — ต้องเพิ่มก่อนเขียน Guard

| Endpoint ที่ต้องเพิ่ม (ชื่อ/path เป็นข้อเสนอ ยังไม่ fix) | Method | Role ที่อนุญาต (ตามข้อ 2) | เหตุผลที่ยังไม่มี |
|---|---|---|---|
| Config: ให้ SW ปักผลตัดสินใจผ่าน/ไม่ผ่านเอง (แยกจาก `simulate` ที่แค่คืนผลทดสอบ ไม่เปลี่ยน status) | POST | SW | `simulateConfig` คืนแค่ `SimulationResult` ไม่แตะ status — enum status ก็ไม่มีค่าแยกสำหรับขั้นนี้ด้วย (มีแค่ `draft/testing/approved/rejected/synced`) ต้องตกลงกับทีมว่าจะเพิ่ม endpoint ใหม่ หรือให้ `approveConfig` ทำหน้าที่ครอบคลุมทั้ง SW+Operation ในครั้งเดียว |
| `/config/{configId}/override` | POST | ST, OT | ยังไม่มีโมดูล Override เลยใน spec |
| `/firmware/{firmwareId}/override` | POST | ST, OT | เช่นเดียวกับข้างบน |
| `/devices` (registration) | POST | Operation/ST/OT | ยังไม่มี endpoint สร้าง Device |
| `/devices/{deviceId}/decommission` | POST | Operation, Admin | ยังไม่มีโมดูล Device lifecycle |
| `/campaigns` | GET/POST/PATCH | Operation (เขียน), ทุก Role (อ่าน) | ยังไม่มีโมดูล `campaign` ใน spec เลย |
| `/change-requests` | POST | Operation/ST/OT (ฝั่ง Mobile) | ยังไม่มีโมดูลนี้ |
| `/change-requests` | GET/PATCH | Operation, OT | เช่นเดียวกับข้างบน |
| `/incidents` | GET/POST/PATCH | ระบบสร้างอัตโนมัติ (POST), Operation/ST อ่าน-แก้ (GET/PATCH) | ยังไม่มีโมดูล `incident` ใน spec |
| `/audit-logs` | GET | Operation, ST, OT, Auditor, Admin | ยังไม่มีโมดูล `audit` ใน spec |
| `/users` | GET/POST/PATCH | Admin เท่านั้น | ยังไม่มีโมดูล User/Role Management ใน spec |

> ตามหมายเหตุท้าย `openapi.yaml`: "ทุกครั้งที่เพิ่ม Endpoint ใหม่ในแต่ละ Phase ถัดไป ให้กลับมาอัปเดตไฟล์นี้ด้วย" — ตาราง 4.2 นี้คือ backlog ของสิ่งที่ต้องอัปเดตเข้า spec ก่อน ไม่ใช่สิ่งที่ Guard เขียนได้ตอนนี้

### 4.3 Task module — รายละเอียดสิทธิ์ (ปิด open question: Task creator = Operation)

ยืนยันโดย kittiphong (B) เจ้าของ module `task` ตามแพทเทิร์นเดิมของ Matrix นี้ — **Operation สั่งงาน/อนุมัติ, ST/OT ปฏิบัติงาน**

| Action | Role ที่ทำได้ |
|---|---|
| สร้าง Task / มอบหมาย Task | Operation |
| แก้ไข / ลบ Task ทั้งหมด (ทุก field) | Operation |
| ดู Task ที่ตัวเองถูกมอบหมาย | ST, OT |
| แก้ `status` ของ Task ตัวเอง (เช่น รับงาน / ปิดงาน) | ST, OT (เฉพาะ Task ที่ตัวเองถูก assign เท่านั้น) |
| ดู Task ทั้งหมด (ทุก Task ในระบบ) | SW (read-only), Operation (จัดการได้ — ดูแถวบน), Auditor, Admin (read-only) |

> **ST/OT ห้ามสร้าง Task เอง** และ **ห้ามแก้ field อื่นนอกจาก `status`** ของ Task ที่ตัวเองถูก assign — ป้องกันการมอบหมายงานให้ตัวเอง / แก้ไขข้อมูล Task ของคนอื่น Guard ฝั่ง Backend ต้องบังคับทั้ง role check และ ownership check (`assignedTo` = user id ที่ login — ดู Section 5 ข้อ 8)

---

## 5. กติกา Separation of Duty (สำคัญ — ต้องคุยกับ B ให้ตรงกันก่อนปิด)

1. **SW ห้ามอนุมัติ Config ของตัวเอง** — คนที่กด Create/Import Config (SW) ต้องไม่ใช่คนเดียวกับที่กด Approve (Operation) แม้ในทางเทคนิคจะ login คนละ account อยู่แล้วก็ตาม แต่ Guard ต้องบล็อกที่ระดับ Role ไม่ใช่แค่ระดับ user id
2. **สถานะ Config ต้องไล่ตาม enum จริงบน `main`**: `draft` → `testing` → `approved` → `synced` (หรือ `rejected` แล้วย้อนกลับ `draft`) — ห้าม Guard/Service ข้าม state ใดๆ — **หมายเหตุสำคัญ:** enum ปัจจุบันยังไม่มีสถานะแยกระหว่างที่ SW ตัดสินใจผ่านแล้วกับที่ Operation อนุมัติแล้ว (ทั้งคู่ใช้ path ไปสู่ `approved` เดียวกัน) เป็น Gap ที่ต้องปิดก่อนเขียนโค้ดจริง (ดู 4.2)
3. **Override (ST/OT) ต้องบันทึกลง Audit Log ทุกครั้งแบบบังคับ** ไม่มีข้อยกเว้น เพราะเป็นการข้าม flow อนุมัติปกติ (ต่างจาก Config ปกติที่ผ่าน Approval Center อยู่แล้ว)
4. **Operation ปฏิเสธ Config → สถานะย้อนกลับไป `draft` เสมอ** (ตามที่ยืนยันไว้ใน Formal.md Section 3.1) ไม่มี Role ไหนสามารถ Override ขั้นตอนนี้ได้ นอกจาก ST/OT ที่ใช้ path "Override" แยกต่างหาก ซึ่งไม่ผ่าน Approval Center เลย
5. **Admin ไม่ใช่ Approver และไม่ใช่ Override** — สิทธิ์ Admin จำกัดเฉพาะ User/Role Management และ Decommission Device เพื่อคงหลัก Separation of Duty ไม่ให้ Admin กลายเป็น "ซูเปอร์ยูสเซอร์" ที่ผ่านทุกขั้นตอนได้คนเดียว (ถ้าทีมต้องการให้ Admin override ได้ในกรณีฉุกเฉินจริง ต้องระบุเพิ่มและใส่เหตุผลใน Audit Log)
6. **Auditor เป็น Read-only 100%** ทุกจอ ไม่มีข้อยกเว้น แม้แต่จอที่ SW/Operation เข้าถึงได้แบบ Read ก็ตาม — **ยกเว้น**การ mark-as-read บน Notification ของตัวเอง (U ใน "Notification Center") ซึ่ง**ไม่ใช่ข้อยกเว้นของกฎนี้** แต่ไม่เข้าข่ายกฎนี้ตั้งแต่ต้น เพราะเป็น action ส่วนตัวต่อ inbox ของตัวเอง ไม่ใช่การแก้ไขข้อมูลธุรกิจ (business data เช่น Config/Firmware/Campaign) ที่กฎ Read-only นี้ต้องการคุม — เทียบง่ายๆ คือเหมือนเปลี่ยนรหัสผ่านตัวเอง ก็ไม่ถือว่าขัดกับ Read-only เช่นกัน
7. **Decommission Device เป็นสิทธิ์ร่วมของ Operation และ Admin — ยืนยันกับทีมแล้ว** (ไม่ใช่ Assumption อีกต่อไป): Operation ทำได้เพราะเป็นคนดูแลสถานะกล่องประจำวัน, Admin ทำได้เพราะเป็นงานเชิงระบบ (device lifecycle) ทั้งสอง Role นี้เท่านั้นที่มีสิทธิ์ ไม่มี Role อื่นเพิ่มเติม
8. **ผู้ใช้ Mobile (Operation/ST/OT) เห็นเฉพาะข้อมูลของตัวเองในหน้าจอ Mobile** — Task/Change Request/Notification ที่ query ต้อง filter ด้วย user id ของตัวเอง ไม่ใช่แค่ซ่อน UI แต่ต้องกรองที่ Backend ด้วย (`GET /tasks` มี query param `assignedTo` อยู่แล้ว — Guard ต้อง**บังคับ**ค่านี้ให้เท่ากับ user id ที่ login ไม่ใช่ให้เลือกเองจากฝั่ง client; `GET /notifications` ต้องผูกกับ user จาก JWT โดยตรง ไม่รับ user id จาก client เลย) — กฎนี้ใช้กับทุก Role ที่ login ผ่าน Mobile เหมือนกัน ไม่ใช่เฉพาะ Role ใด Role หนึ่ง

---

## 6. Assumption / Gap ที่ยังไม่ยืนยัน — ต้องคุยกับ kittiphong (B) ก่อนปิด Matrix

- **enum สถานะ Config ไม่มีจุดแยกระหว่างขั้น SW กับขั้น Operation** — ทั้งสองขั้นจบที่ `approved` เหมือนกันหมด ต้องตกลงว่าจะ (ก) เพิ่ม status ใหม่ (เช่น `sw_approved`) หรือ (ข) ใช้ field อื่นเก็บว่าใครกดผ่านขั้นไหนแทนการเพิ่ม enum
- **ขอบเขต ST vs OT**: ในเอกสารต้นทางระบุแค่ "Override เฉพาะ ST/OT" โดยไม่แยกรายละเอียด ในร่างนี้แบ่งให้ ST เน้นงานเทคนิค/Incident ระดับอาวุโส และ OT เน้นงานปฏิบัติการ (Task/Change Request) แต่ทั้งคู่ Override ได้เท่ากัน — ถ้าทีมต้องการแบ่งสิทธิ์ Override ให้ต่างกัน ต้องแก้ตารางส่วนที่ 2 และ 4
- **User/Role Management**: ยังไม่มีจอนี้ระบุไว้ใน Checkpoint Features ของแผน Sprint ใดเลย — เพิ่มเข้ามาในร่างนี้เพราะ Admin role ต้องมีอย่างน้อย 1 หน้าที่ใช้งานจริง ต้องตกลงว่าจะทำ Sprint ไหน
- **GPS_Data_Dictionary.xlsx (`CAMPAIGN_ASSIGNMENT.assigned_by`)**: ยืนยันเจ้าของแล้ว — **paveekornk (A) รับไปแก้เอง แยกเป็น PR ต่างหาก ไม่รวมกับ RBAC Matrix นี้** — สถานะปัจจุบันคือ**ยังไม่ได้ลงมือแก้จริง** (แค่ยืนยันความรับผิดชอบ) ต้องติดตามต่อว่าทำเสร็จเมื่อไหร่ เพื่อไม่ให้ตกหล่นไปอีก
- **`POST /config/{configId}/simulate` ยังไม่รองรับ "ช่างทดสอบอุปกรณ์ที่ติดตั้งจริง"** (พบระหว่างรีวิว Stage 3 โดย kittiphong): `SIMULATABLE_CONFIG_STATUSES` (ดู `config-status.ts`) อนุญาตแค่สถานะ `draft`/`testing` เพราะ endpoint นี้ออกแบบไว้สำหรับ SW dry-run Config **ระหว่างร่างอยู่** เท่านั้น — แต่ Config ที่ติดตั้งบนอุปกรณ์จริงหน้างานจะเป็น `approved`/`synced` เสมอ (ผ่านการอนุมัติมาแล้ว) ทำให้ช่าง (ST/OT ผ่าน Mobile) เรียก endpoint นี้เพื่อทดสอบสัญญาณจากอุปกรณ์ที่ติดตั้งจริงไม่ได้เลย (โดน 409 ทุกครั้ง) — เป็นคนละความหมายกับ dry-run: อันหนึ่งตรวจ field value ของ Config template อันหนึ่งควรตรวจการเชื่อมต่อจริงของอุปกรณ์เครื่องนั้น ต้องออกแบบ endpoint แยกต่างหากสำหรับเคสช่างหน้างาน (อาจต้องคุย mock/real mode ของมันเองแยกจาก `DEVICE_SIMULATOR_MODE`) — **ยังไม่แก้ใน Stage 3 นี้** เพราะผูกกับหน้า "ทดสอบสัญญาณ" ที่ B ออกแบบฝั่ง Mobile อยู่ — ติดตามและออกแบบร่วมกับ kittiphong (B) ต่อผ่านคอมเมนต์บน PR Stage 3 นี้ (ไม่เปิด issue แยก)
- **Notification เปลี่ยนเป็น FCM จริง — รอ A รีวิว**: kittiphong (B) เสนอเปลี่ยน Notification จาก in-app inbox เป็น push notification จริงผ่าน Firebase Cloud Messaging (Android/iOS/Web) — รายละเอียดเต็มดู `docs/05_Mobile_Notification_FCM.md` — ต้องการ schema ใหม่ (`DeviceToken`) ที่ยังไม่มีในระบบ **A ยังไม่ได้รีวิว**
- ~~**ตาราง join `CONFIG_DEFINITION_MODEL_SUPPORT`... ยังไม่ได้ออกแบบ**~~ **ปิดแล้ว (แก้ครั้งที่ 14)** — ดู Change Log: paveekornk (A) ออกแบบเป็น `ConfigFieldDefinitionModelSupport` และ implement Semantic Validation ครบแล้ว

---

## Change Log

| วันที่ | ผู้แก้ไข | รายละเอียด |
|---|---|---|
| 2026-08-28 | paveekornk | สร้างฉบับร่างแรก ตาม Gap ที่ระบุใน `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 — ยืนยันคำเต็ม ST=Senior Technician, OT=Operation-Technician กับ paveekornk แล้ว |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 2 โดยอ้างอิง openapi.yaml จาก branch `docs/rbac-matrix` (ภายหลังพบว่ามีคอมมิตทดลองที่ไม่ตรงกับ main — ข้อมูลบางส่วนคลาดเคลื่อน) |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 3 — `git pull` main ใหม่แล้วยึด `docs/api/openapi.yaml` บน `main` จริงเป็นหลัก: ย้อน role enum กลับเป็น `[SW, Operation, ST, OT, Auditor, Admin]` (ยังไม่มี FieldTechnician จริง), ย้อนสถานะ Config กลับเป็น `[draft, testing, approved, rejected, synced]` (ไม่มี sw_approved/operation_approved แยก), เพิ่ม endpoint `/notifications` และ `/notifications/{id}/read` ที่ kittiphong เพิ่มเข้ามาใหม่เข้าตาราง 4.1 |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 4 — ตอบ Comment รีวิวของ kittiphong 5 ข้อ: (1) ย้ายสิทธิ์ Device Registration จาก FieldTechnician → Operation/ST/OT ทั้งใน Section 1 (platform ST/OT เพิ่ม Mobile), Section 3, และตาราง 4.2, (2) ย้าย Decommission Device จาก Assumption (ข้อ 6) มาเป็นกติกายืนยันแล้วใน Section 5 ข้อ 7, (3) เพิ่ม footnote อธิบายว่าทำไม Auditor mark-as-read บน Notification ไม่ขัดกับกฎ Read-only (ไม่ใช่ข้อยกเว้น แต่ไม่เข้าข่ายกฎตั้งแต่ต้น), (4) merge/rebase `origin/main` เข้า branch ก่อน push เวอร์ชันนี้ตามที่ขอ, (5) บันทึกยืนยันว่า paveekornk รับไปแก้ `GPS_Data_Dictionary.xlsx` (`CAMPAIGN_ASSIGNMENT.assigned_by`) เอง แยก PR ต่างหาก |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 5 — ตาม [PR #13](https://github.com/dtc-gps-team/gps-config-firmware-center/pull/13) (merged): **ตัด Role `FieldTechnician` ออกทั้งเอกสาร** เปลี่ยนเป็น Operation/ST/OT ให้ครบทุกจุดที่เหลือ (Section 1 role table + note, Section 3 ทั้งตาราง, ตาราง 4.1 ทุกแถวที่เคยอ้างถึง, ตาราง 4.2 แถว `/change-requests`, Section 5 กติกาข้อ 8) — ปิด Gap เรื่อง FieldTechnician ที่เคยเปิดไว้ใน Section 6 ไปด้วย เพราะไม่มี Role นี้แล้ว คงเหลือ Open question อื่นตามที่ทีมแจ้ง: ขอบเขต ST vs OT override scope, ใครเป็นคนสร้าง Task หลัก, Sprint ของ User Management, และสถานะ `GPS_Data_Dictionary.xlsx` (`CAMPAIGN_ASSIGNMENT.assigned_by`) ที่ paveekornk รับผิดชอบแต่ยังไม่ได้ลงมือแก้ |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 6 — ตอบ comment รีวิว PR #15 ของ kittiphong: ลบเครื่องหมาย `*` ที่ลอยค้างอยู่ท้าย "Web + Mobile" ในช่อง platform ของ ST/OT (Section 1) ออก เพราะ footnote ที่เคยผูกกับ `*` ถูกลบไปแล้วตอนแก้ FieldTechnician ในรอบ 5 คำอธิบายเรื่อง ST/OT ใช้ Mobile ด้วยยังคงอยู่ในย่อหน้าใต้ตารางตามเดิม (อ้างอิง PR #13) ไม่ต้องเพิ่ม footnote ใหม่ |
| 2026-08-28 | kittiphong | แก้ครั้งที่ 7 — **ปิด open question: Task creator = Operation** ตัดสินใจโดย kittiphong (B) เจ้าของ module `task` ตามแพทเทิร์น Operation สั่งงาน/อนุมัติ, ST/OT ปฏิบัติงาน: (1) เพิ่มตาราง 4.3 รายละเอียดสิทธิ์ module `task`, (2) Section 2 แถว Task Management — OT จาก `C, R, U` เหลือ `R` (ST/OT ไม่สร้าง/จัดการ Task บน Web แก้ `status` งานตัวเองผ่าน Mobile), (3) ตาราง 4.1 — `/tasks` POST `createTask` เหลือ `Operation` เท่านั้น, `/tasks/{taskId}` PATCH `updateTask` = Operation ทุก field / ST-OT เฉพาะ field `status` ของงานตัวเอง, (4) ลบรายการ "Task Management ฝั่งใครเป็นคนสร้าง" ออกจาก open question list (Section 6) |
| 2026-08-28 | kittiphong | แก้ครั้งที่ 8 — เก็บ inconsistency ภายในเอกสารเองที่เกิดจากรอบ 7: (1) ตาราง 4.1 `GET /tasks` (`listTasks`) — เดิมยังบอกว่า "Operation/ST/OT ถูกกรองเฉพาะ `assignedTo` = ตนเอง" ซึ่งขัดกับ 4.3 ที่ให้ Operation จัดการ Task ทั้งหมด → แก้เป็น "ST/OT ที่ใช้ Mobile ถูกกรอง, Operation เห็นทุก Task" ให้ตรงกับ `getTask`/`updateTask` ในตารางเดียวกัน, (2) ตาราง 4.3 แถว "ดู Task ทั้งหมด" ระบุครบว่ารวม SW (read-only) + Operation (จัดการได้) ไม่ใช่แค่ Auditor/Admin, (3) Section 2 แถว Task Management เพิ่ม footnote ¹ ให้ ST/OT ว่าแก้ `status` งานตัวเองผ่าน Mobile — ไม่มีการเปลี่ยนสิทธิ์ใดๆ เป็นการทำให้ข้อความในเอกสารสอดคล้องกันเท่านั้น |
| 2026-09-01 | paveekornk | แก้ครั้งที่ 9 — ตอบ comment รีวิว PR #46 (Stage 1 CRUD, #26) ของ kittiphong ข้อ 2: **ปิด open question ที่ไม่เคยถูกถามมาก่อน — Config ไม่ scope ตาม creator** ยืนยันโดย paveekornk (A) เจ้าของ module `config`: SW ทุกคนแก้/ลบ Config ที่ยังเป็น `draft` ร่วมกันได้ ไม่แยกเป็นของใครของมัน (1) Section 2 แถว Config Editor เพิ่ม footnote ² อธิบายการตัดสินใจนี้ (2) โค้ดจริง (`ConfigService.update`/`remove`) ทำแบบนี้อยู่แล้วตั้งแต่ Stage 1 โดยไม่ได้ filter `createdBy` — เอกสารรอบนี้แค่ตามให้ทันโค้ด ไม่ได้เปลี่ยนพฤติกรรม |
| 2026-09-02 | paveekornk | แก้ครั้งที่ 10 — เริ่ม Stage 3 (Simulate) ของ issue #26: Section 2 แถว Config Simulation ระบุชัดว่า `simulate` ไม่เปลี่ยนสถานะ Config เลย (คืนแค่ผลทดสอบ) ตรงกับโค้ดจริง — เรื่อง open question "endpoint สำหรับ SW ปักผลตัดสินใจผ่าน/ไม่ผ่าน" (Section 6 ข้อ 1) ยังไม่แตะในรอบนี้ (เดิมเคยลองเสนอทางเลือกไว้ในดราฟต์นี้ แต่ถอนออกตาม comment รีวิวของ kittiphong บน PR Stage 3 — endpoint ที่ยังไม่ได้ให้ B รีวิว design ไม่ควรมากับ PR ของ feature อื่น จะไปเสนอแยกเป็น PR ต่างหากแทน) |
| 2026-09-02 | paveekornk | แก้ครั้งที่ 11 — ตอบ comment รีวิวรอบ 2 ของ kittiphong บน PR Stage 3 ข้อ 7: เพิ่ม Gap ใหม่ใน Section 6 — `simulate` (`SIMULATABLE_CONFIG_STATUSES`) รองรับแค่สถานะ `draft`/`testing` (บริบท SW dry-run ตอนร่าง) ไม่รองรับ `approved`/`synced` (บริบทช่างทดสอบอุปกรณ์ที่ติดตั้งจริงหน้างานผ่าน Mobile) ต้องออกแบบ endpoint แยกต่างหาก — ยังไม่แก้ใน Stage 3 นี้ — ติดตามและออกแบบร่วมกับ kittiphong (B) ต่อผ่านคอมเมนต์บน PR Stage 3 นี้ (ไม่เปิด issue แยก) เพราะผูกกับหน้า "ทดสอบสัญญาณ" ฝั่ง Mobile ที่ B ดูแลอยู่ |
| 2026-09-02 | kittiphong | แก้ครั้งที่ 12 — เริ่ม task #12 (Config Definition Lookup, แผน Agile แถว 12) โดย kittiphong (B): (1) ตาราง 4.1 เพิ่มแถว `GET /config-definitions` (`listConfigDefinitions`) resource ใหม่ `config-definition` action `Read` — SW/Operation/ST/OT (catalog อ่านอย่างเดียว) (2) Section 6 เพิ่ม Gap ใหม่ — ตาราง join `CONFIG_DEFINITION_MODEL_SUPPORT` (ผูก field definition กับ deviceModel/protocol) ยังไม่ได้ออกแบบ **A ยังไม่ได้รีวิว** ต้องคุยกับ A ก่อนสร้าง — task #12 จงใจทำแค่ catalog อ่านอย่างเดียว (seed `ConfigFieldDefinition` เริ่มจาก field `APN` + endpoint `GET /config-definitions` + spec) ยังไม่แตะ validation ใน `config.service.ts`/`device-simulator.ts` |
| 2026-09-02 | kittiphong | แก้ครั้งที่ 13 — implement `POST /devices/{deviceId}/test-connection` (Device module ใหม่) ตาม spec ที่ตกลงกับ paveekornkwork-dev (A) บนคอมเมนต์ PR #52 (`docs/06_Device_Connection_Test_Spec.md`): (1) ตาราง 4.1 เพิ่มแถว `testDeviceConnection` resource ใหม่ `device-connection-test` action `Read` — **ST/OT เท่านั้น** (A ยืนยันไม่เปิด SW/Operation) (2) `MockDeviceConnectionTester` คืน `signalStrength` คงที่ (-65 dBm) ให้ Mobile ทำ UI ได้ตั้งแต่ mock — env `DEVICE_CONNECTION_TEST_MODE` แยกจาก `DEVICE_SIMULATOR_MODE` (3) 409 ถ้า Device ยังไม่ `installed`, 404 ถ้าไม่พบ `deviceId` — **จงใจตัด `GET /devices/{deviceId}/status` ออกจากรอบนี้** (มีแต่ spec ยังไม่มีโค้ด, การคำนวณ configStatus/firmwareStatus ต้องออกแบบใหม่เพราะ Device ไม่มี FK ตรงไป Config/Firmware — รอ PR แยก) |
| 2026-09-03 | paveekornk | แก้ครั้งที่ 14 — implement **Semantic Validation** (Phase 1, #26) เจ้าของ module `config`/`config-definition`: ปิด Gap ที่ kittiphong เปิดไว้ในแก้ครั้งที่ 12 (ตาราง join `CONFIG_DEFINITION_MODEL_SUPPORT` ยังไม่ได้ออกแบบ) — ตัดสินใจร่วมกับ kittiphong (B) และพี่เลี้ยง 2569-09 มีดังนี้: (1) เพิ่ม model `ConfigFieldDefinitionModelSupport` ผูก `ConfigFieldDefinition` กับ (deviceModel, protocol) ได้หลายคู่ — สร้างพร้อมกันตอน `createConfigDefinition` เท่านั้น ไม่มี endpoint แก้แยก (2) ตาราง 4.1 เพิ่มแถว `POST /config-definitions` (`createConfigDefinition`) resource `config-definition` action `Create` — **SW เท่านั้น ไม่มีขั้นตอนอนุมัติ** เพราะ field ที่มีปัญหาจริงจะโดนจับตอนเอาไปสร้าง Config Template แล้วเข้า simulate/decide/approve อยู่ดี (3) field ที่ไม่มีนิยามในคลัง หรือมีนิยามแต่ไม่รองรับ deviceModel/protocol ที่ระบุ → **block ทั้งคู่ (409/400 แบบ hard block ไม่มี warn-only)** ไม่มีทางลัดให้ field "พิเศษเฉพาะลูกค้า" ข้าม validation ได้ (4) การกรอง "รุ่นไหนใช้ parameter ตัวไหน" ทำที่ฝั่ง UI ตอนสร้าง Config Template โดยอ่านจาก `supportedModels` ของแต่ละ field — ไม่ต้องเพิ่ม endpoint filter แยก (5) เจตนาไม่ทำตอนนี้ (deferred, ไม่ใช่ Gap): ระดับความเข้มงวด 2 ระดับ (`syntactic_only` vs `semantic` ตาม `03_GPS_Detailed_Build_Steps.md`) — YAGNI จนกว่าจะมี use case จริง เป็น additive migration เพิ่มทีหลังได้โดยไม่กระทบของเดิม — ดู `config-definition.service.ts`/`config.service.ts` สำหรับโค้ดจริงและ `docs/api/openapi.yaml` (v3.11) สำหรับ spec |
| 2026-09-04 | paveekornk | แก้ครั้งที่ 15 — ปิด item "Validation strictness metadata" ของ Checkpoint Phase 1 ข้อ 6 (#26): **`ConfigFieldDefinition.unknownSpec` คือ Metadata "รู้กฎ vs รู้แค่ Data Type" ที่ Checkpoint ต้องการ** — `unknownSpec: false` = รู้กฎครบ (semantic), `true` = รู้แค่ชื่อ + dataType (syntactic_only) · **ไม่เพิ่ม field `validationLevel` แยก** · deferred อย่างเป็นทางการ (ติด blocker เดียวกับ #68 — ยังไม่มีสเปกฟิลด์จริง): (1) `validateFields()` ยังไม่ branch ตาม `unknownSpec` (2) ยังไม่มี field เก็บกฎ semantic รายฟิลด์ (`minValue`/`maxValue`/`pattern`) (3) กฎ "Timeout/Interval ห้ามติดลบ" ยังอยู่ใน `MockDeviceSimulator` — ดู `docs/04_Phase1_A_ConfigWorkflow.md` §Validation strictness |
