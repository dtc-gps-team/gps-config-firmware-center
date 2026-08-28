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
| **ST** | Senior Technician | Web + Mobile* | ช่างเทคนิคระดับอาวุโส — มีสิทธิ์ Override Config/Firmware ตรงที่หน้างาน/ระบบโดยไม่ต้องผ่าน flow อนุมัติปกติ (ใช้กรณีแก้ปัญหาเฉพาะกล่องที่ Approval Center ไม่ทันการ) และดูแลการแก้ไข Incident เชิงเทคนิค |
| **OT** | Operation-Technician | Web + Mobile* | ช่างเทคนิคที่ทำงานสังกัดฝั่ง Operation — สนับสนุนงานปฏิบัติการประจำวัน (มอบหมาย/ติดตามงานช่าง, จัดการ Change Request ที่ส่งเข้ามา) และมีสิทธิ์ Override Config/Firmware เช่นเดียวกับ ST |
| **Auditor** | Auditor | Web | ดูข้อมูลอย่างเดียวทุกจอเพื่อตรวจสอบ (compliance) — ห้าม Create/Update/Approve/Override ทุกกรณี |
| **Admin** | System Admin | Web | จัดการผู้ใช้/สิทธิ์ในระบบ, ปลดระวางกล่อง (Decommission Device), ดูข้อมูลทุกจอ — **ไม่ใช่ผู้อนุมัติ Config แทน Operation** (คงหลัก Separation of Duty) |
| **FieldTechnician** ⚠️ | ช่างหน้างาน | Mobile เท่านั้น | รับงานที่ได้รับมอบหมาย, ทดสอบกับ Device Simulator (ไม่บังคับ), กดยืนยันติดตั้งสำเร็จ, ส่ง Change Request |

> **\* หมายเหตุ ST/OT ใช้ Mobile ด้วย (แก้จากรอบรีวิวของ kittiphong):** เฉพาะ action เดียวคือ **Device Registration** (ลงทะเบียนกล่องใหม่ตอนติดตั้ง) — ทีมยืนยันแล้วว่า `FieldTechnician` ไม่ใช่ Role ที่มีอยู่จริงแยกต่างหาก (ไม่เคยเข้า enum ของระบบ) ช่างหน้างานที่ลงทะเบียนกล่องผ่านมือถือคือ ST/OT ที่ login เข้าแอปนั่นเอง จึงย้ายสิทธิ์ Device Registration จาก FieldTechnician ไปเป็น Operation/ST/OT ตรงๆ (ดูตารางข้อ 3 และ 4.2) — ส่วน action มือถืออื่นๆ (Login/Task List/Confirm Install/Change Request/Notification) ยังคงเป็นของ `FieldTechnician` ตามเดิม ยังไม่ได้เปลี่ยน เพราะเพื่อนขอให้แก้เฉพาะจุด Device Registration เท่านั้นในรอบนี้ — คำถามที่ว่า `FieldTechnician` ควรมีอยู่จริงหรือไม่สำหรับ action ที่เหลือ ยังเป็น Gap เปิดอยู่ (ดูข้อ 6)

> **⚠️ Gap ที่ยืนยันแล้วจาก `openapi.yaml` บน `main` ล่าสุด:** enum `role` ใน `LoginResponse.role` ตอนนี้มีแค่ `[SW, Operation, ST, OT, Auditor, Admin]` — **ยังไม่มี `FieldTechnician`** (รอบก่อนเข้าใจผิดว่าเพิ่มแล้ว เพราะไปเช็คจาก branch `docs/rbac-matrix` ที่มีคอมมิตทดลองอยู่ ไม่ใช่ค่าจริงบน `main`) ต้องแจ้ง kittiphong ให้เพิ่ม `FieldTechnician` เข้า enum นี้ก่อน เพราะ Mobile ก็ login ผ่าน endpoint เดียวกัน — **ห้ามเขียน Auth Guard ฝั่ง Mobile จนกว่าจะเพิ่มเสร็จ**
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
| **Config Editor** (สร้าง/แก้ Draft ผ่านฟอร์ม — สถานะ `draft`) | C, R, U | R | R | R | R | R |
| **Config Import จากไฟล์ (JSON)** (เข้า flow เดียวกับฟอร์ม) | C | R | R | R | R | R |
| **Config Simulation (dry-run)** — รันทดสอบ (สถานะ `testing`) แล้ว SW ตัดสินผ่าน/ไม่ผ่านเอง (ผ่าน → ส่งต่อ Operation, ไม่ผ่าน → กลับ `draft`) | C, R, U | R | R | R | R | R |
| **Approval Center** — Operation อนุมัติ/ปฏิเสธ Config (อนุมัติ → `approved`, ปฏิเสธ → กลับ `draft` ทั้งหมด) | R | R, **A** | R | R | R | R |
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
| **Notification Center** (ของตนเอง) | R, U (mark read) | R, U | R, U | R, U | R, U | R, U |

---

## 3. Matrix — หน้าจอฝั่ง Mobile

**หมายเหตุ:** ผู้ใช้ Mobile ส่วนใหญ่คือ `FieldTechnician` แต่ **Device Registration เป็นข้อยกเว้น — ทำโดย Operation/ST/OT** (ดูหมายเหตุ `*` ในข้อ 1) เพิ่มคอลัมน์ Role เข้ามาเพื่อความชัดเจนว่าแต่ละแถวเป็นของใคร

| หน้าจอ / Action | Role | Action |
|---|---|---|
| **Login** | FieldTechnician | R (ตนเอง) |
| **Task List** (งานที่ได้รับมอบหมาย) | FieldTechnician | R, U (อัปเดตสถานะงานของตัวเอง) |
| **Device Registration** (ลงทะเบียนกล่องใหม่ตอนติดตั้ง) | **Operation/ST/OT** ⚠️ | C, R |
| **ทดสอบกับ Device Simulator ก่อนติดตั้ง** (ไม่บังคับ — v3.5) | FieldTechnician | C, R |
| **Confirm Install** (ยืนยันติดตั้งสำเร็จ) | FieldTechnician | U |
| **Change Request** (ส่งคำขอเปลี่ยนแปลงเข้า Inbox เว็บ) | FieldTechnician | C, R (เฉพาะของตัวเอง) |
| **Push Notification / แจ้งเตือน** | FieldTechnician | R, U (mark read) |
| **Device Status ของกล่องที่ตนดูแล** | FieldTechnician | R |

> FieldTechnician **ไม่มีสิทธิ์เข้าหน้า Config Editor, Approval Center, Override, Campaign, Audit Log ใดๆ ทั้งสิ้น** — ทุกอย่างที่เกี่ยวกับ Config/Firmware ทำผ่าน Web โดย SW/Operation/ST/OT เท่านั้น ยกเว้น Device Registration ที่ ST/OT ทำผ่าน**มือถือ**ได้ตามที่ระบุข้างต้น

---

## 4. Mapping ไปยัง Backend Endpoint (สำหรับเขียน Auth Guard)

แหล่งอ้างอิงหลัก: **`docs/api/openapi.yaml` บน `main` (v0.1.0)** — ตาราง 4.1 คือ endpoint ที่**มีอยู่จริง**ใน spec วันนี้ ใช้ implement Guard ได้ทันที ส่วนตาราง 4.2 คือ endpoint ที่ Matrix นี้อ้างถึงในข้อ 2/3 แต่**ยังไม่มีใน spec** — ต้องเพิ่มเข้า openapi.yaml ก่อนเขียน Guard จริง (ห้ามเดา path/method เอาเองแล้วชงเข้าโค้ด)

### 4.1 Endpoint ที่มีจริงใน `openapi.yaml` (main) วันนี้

| Endpoint | Method | operationId | Role ที่อนุญาต |
|---|---|---|---|
| `/auth/login` | POST | `login` | Public (`security: []` — ระบุไว้ใน spec แล้ว) — ต้องรองรับ FieldTechnician ด้วย แต่ enum role ยังไม่มี (ดู Gap ข้อ 1) |
| `/config` | GET | `listConfigs` | ทุก Role ที่ login แล้ว |
| `/config` | POST | `createConfig` | SW |
| `/config/import` | POST | `importConfig` | SW |
| `/config/{configId}/simulate` | POST | `simulateConfig` | SW, FieldTechnician (endpoint เดียวกันทั้ง Web/Mobile ตาม summary ใน spec) |
| `/config/{configId}/approve` | POST | `approveConfig` | Operation เท่านั้น |
| `/config/{configId}/reject` | POST | `rejectConfig` | Operation เท่านั้น |
| `/notifications` | GET | `listNotifications` | ทุก Role ที่ login แล้ว — ดึงเฉพาะของ user ตัวเอง (ผูกกับ JWT ไม่ใช่ query param) |
| `/notifications/{notificationId}/read` | PATCH | `markNotificationRead` | ทุก Role ที่ login แล้ว — เฉพาะ notification ของตัวเอง |
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
| Config: ให้ SW ปักผลตัดสินใจผ่าน/ไม่ผ่านเอง (แยกจาก `simulate` ที่แค่คืนผลทดสอบ ไม่เปลี่ยน status) | POST | SW | `simulateConfig` คืนแค่ `SimulationResult` ไม่แตะ status — enum status ก็ไม่มีค่าแยกสำหรับขั้นนี้ด้วย (มีแค่ `draft/testing/approved/rejected/synced`) ต้องตกลงกับทีมว่าจะเพิ่ม endpoint ใหม่ หรือให้ `approveConfig` ทำหน้าที่ครอบคลุมทั้ง SW+Operation ในครั้งเดียว |
| `/config/{configId}/override` | POST | ST, OT | ยังไม่มีโมดูล Override เลยใน spec |
| `/firmware/{firmwareId}/override` | POST | ST, OT | เช่นเดียวกับข้างบน |
| `/devices` (registration) | POST | **Operation/ST/OT** (แก้จาก FieldTechnician ตามรอบรีวิวของ kittiphong — ดูหมายเหตุข้อ 1) | ยังไม่มี endpoint สร้าง Device |
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
2. **สถานะ Config ต้องไล่ตาม enum จริงบน `main`**: `draft` → `testing` → `approved` → `synced` (หรือ `rejected` แล้วย้อนกลับ `draft`) — ห้าม Guard/Service ข้าม state ใดๆ — **หมายเหตุสำคัญ:** enum ปัจจุบันยังไม่มีสถานะแยกระหว่างที่ SW ตัดสินใจผ่านแล้วกับที่ Operation อนุมัติแล้ว (ทั้งคู่ใช้ path ไปสู่ `approved` เดียวกัน) เป็น Gap ที่ต้องปิดก่อนเขียนโค้ดจริง (ดู 4.2)
3. **Override (ST/OT) ต้องบันทึกลง Audit Log ทุกครั้งแบบบังคับ** ไม่มีข้อยกเว้น เพราะเป็นการข้าม flow อนุมัติปกติ (ต่างจาก Config ปกติที่ผ่าน Approval Center อยู่แล้ว)
4. **Operation ปฏิเสธ Config → สถานะย้อนกลับไป `draft` เสมอ** (ตามที่ยืนยันไว้ใน Formal.md Section 3.1) ไม่มี Role ไหนสามารถ Override ขั้นตอนนี้ได้ นอกจาก ST/OT ที่ใช้ path "Override" แยกต่างหาก ซึ่งไม่ผ่าน Approval Center เลย
5. **Admin ไม่ใช่ Approver และไม่ใช่ Override** — สิทธิ์ Admin จำกัดเฉพาะ User/Role Management และ Decommission Device เพื่อคงหลัก Separation of Duty ไม่ให้ Admin กลายเป็น "ซูเปอร์ยูสเซอร์" ที่ผ่านทุกขั้นตอนได้คนเดียว (ถ้าทีมต้องการให้ Admin override ได้ในกรณีฉุกเฉินจริง ต้องระบุเพิ่มและใส่เหตุผลใน Audit Log)
6. **Auditor เป็น Read-only 100%** ทุกจอ ไม่มีข้อยกเว้น แม้แต่จอที่ SW/Operation เข้าถึงได้แบบ Read ก็ตาม — **ยกเว้น**การ mark-as-read บน Notification ของตัวเอง (U ใน "Notification Center") ซึ่ง**ไม่ใช่ข้อยกเว้นของกฎนี้** แต่ไม่เข้าข่ายกฎนี้ตั้งแต่ต้น เพราะเป็น action ส่วนตัวต่อ inbox ของตัวเอง ไม่ใช่การแก้ไขข้อมูลธุรกิจ (business data เช่น Config/Firmware/Campaign) ที่กฎ Read-only นี้ต้องการคุม — เทียบง่ายๆ คือเหมือนเปลี่ยนรหัสผ่านตัวเอง ก็ไม่ถือว่าขัดกับ Read-only เช่นกัน
7. **Decommission Device เป็นสิทธิ์ร่วมของ Operation และ Admin — ยืนยันกับทีมแล้ว** (ไม่ใช่ Assumption อีกต่อไป): Operation ทำได้เพราะเป็นคนดูแลสถานะกล่องประจำวัน, Admin ทำได้เพราะเป็นงานเชิงระบบ (device lifecycle) ทั้งสอง Role นี้เท่านั้นที่มีสิทธิ์ ไม่มี Role อื่นเพิ่มเติม
8. **FieldTechnician เห็นเฉพาะข้อมูลของตัวเอง** — Task/Change Request/Notification ที่ query ต้อง filter ด้วย user id ของตัวเอง ไม่ใช่แค่ซ่อน UI แต่ต้องกรองที่ Backend ด้วย (`GET /tasks` มี query param `assignedTo` อยู่แล้ว — Guard ต้อง**บังคับ**ค่านี้ให้เท่ากับ user id ที่ login ไม่ใช่ให้เลือกเองจากฝั่ง client; `GET /notifications` ต้องผูกกับ user จาก JWT โดยตรง ไม่รับ user id จาก client เลย)

---

## 6. Assumption / Gap ที่ยังไม่ยืนยัน — ต้องคุยกับ kittiphong (B) ก่อนปิด Matrix

- **`FieldTechnician` ยังไม่อยู่ใน enum `role` บน `main`** — ต้องเพิ่มก่อนเขียน Guard ฝั่ง Mobile (ยืนยันแล้วจาก openapi.yaml ที่ pull มาสดๆ)
- **enum สถานะ Config ไม่มีจุดแยกระหว่างขั้น SW กับขั้น Operation** — ทั้งสองขั้นจบที่ `approved` เหมือนกันหมด ต้องตกลงว่าจะ (ก) เพิ่ม status ใหม่ (เช่น `sw_approved`) หรือ (ข) ใช้ field อื่นเก็บว่าใครกดผ่านขั้นไหนแทนการเพิ่ม enum
- **ขอบเขต ST vs OT**: ในเอกสารต้นทางระบุแค่ "Override เฉพาะ ST/OT" โดยไม่แยกรายละเอียด ในร่างนี้แบ่งให้ ST เน้นงานเทคนิค/Incident ระดับอาวุโส และ OT เน้นงานปฏิบัติการ (Task/Change Request) แต่ทั้งคู่ Override ได้เท่ากัน — ถ้าทีมต้องการแบ่งสิทธิ์ Override ให้ต่างกัน ต้องแก้ตารางส่วนที่ 2 และ 4
- **Task Management ฝั่งใครเป็นคนสร้าง**: ร่างนี้ให้ทั้ง Operation และ OT สร้าง/แก้ไข Task ได้ — ถ้าทีมต้องการให้มีแค่ Role เดียวเป็นคนมอบหมายงานหลัก ต้องระบุเพิ่ม
- **User/Role Management**: ยังไม่มีจอนี้ระบุไว้ใน Checkpoint Features ของแผน Sprint ใดเลย — เพิ่มเข้ามาในร่างนี้เพราะ Admin role ต้องมีอย่างน้อย 1 หน้าที่ใช้งานจริง ต้องตกลงว่าจะทำ Sprint ไหน
- **`FieldTechnician` สำหรับ action ที่เหลือ (Login/Task List/Confirm Install/Change Request/Notification)**: รอบนี้แก้เฉพาะ Device Registration ให้เป็น Operation/ST/OT ตามที่ kittiphong ขอ แต่ยังไม่ได้ข้อสรุปว่า action มือถืออื่นๆ ที่เหลือควรเป็นของ `FieldTechnician` (Role แยกที่ต้องเพิ่มเข้า enum) หรือจริงๆ ก็เป็นของ ST/OT ทั้งหมดเช่นกัน — ถ้าใช่แบบหลัง ต้องรื้อ Section 3 ทั้งตาราง ไม่ใช่แค่แถวเดียว ต้องคุยให้จบก่อนเขียน Guard ฝั่ง Mobile
- **GPS_Data_Dictionary.xlsx (`CAMPAIGN_ASSIGNMENT.assigned_by`)**: พบว่ายังไม่มีใครแก้ — **paveekornk (A) ยืนยันรับไปแก้เอง แยกเป็น PR ต่างหาก ไม่รวมกับ RBAC Matrix นี้** เพื่อไม่ให้ตกหล่น

---

## Change Log

| วันที่ | ผู้แก้ไข | รายละเอียด |
|---|---|---|
| 2026-08-28 | paveekornk | สร้างฉบับร่างแรก ตาม Gap ที่ระบุใน `03_GPS_Detailed_Build_Steps.md` Phase 0 ข้อ 4 — ยืนยันคำเต็ม ST=Senior Technician, OT=Operation-Technician กับ paveekornk แล้ว |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 2 โดยอ้างอิง openapi.yaml จาก branch `docs/rbac-matrix` (ภายหลังพบว่ามีคอมมิตทดลองที่ไม่ตรงกับ main — ข้อมูลบางส่วนคลาดเคลื่อน) |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 3 — `git pull` main ใหม่แล้วยึด `docs/api/openapi.yaml` บน `main` จริงเป็นหลัก: ย้อน role enum กลับเป็น `[SW, Operation, ST, OT, Auditor, Admin]` (ยังไม่มี FieldTechnician จริง), ย้อนสถานะ Config กลับเป็น `[draft, testing, approved, rejected, synced]` (ไม่มี sw_approved/operation_approved แยก), เพิ่ม endpoint `/notifications` และ `/notifications/{id}/read` ที่ kittiphong เพิ่มเข้ามาใหม่เข้าตาราง 4.1 |
| 2026-08-28 | paveekornk | แก้ครั้งที่ 4 — ตอบ Comment รีวิวของ kittiphong 5 ข้อ: (1) ย้ายสิทธิ์ Device Registration จาก FieldTechnician → Operation/ST/OT ทั้งใน Section 1 (platform ST/OT เพิ่ม Mobile), Section 3, และตาราง 4.2, (2) ย้าย Decommission Device จาก Assumption (ข้อ 6) มาเป็นกติกายืนยันแล้วใน Section 5 ข้อ 7, (3) เพิ่ม footnote อธิบายว่าทำไม Auditor mark-as-read บน Notification ไม่ขัดกับกฎ Read-only (ไม่ใช่ข้อยกเว้น แต่ไม่เข้าข่ายกฎตั้งแต่ต้น), (4) merge/rebase `origin/main` เข้า branch ก่อน push เวอร์ชันนี้ตามที่ขอ, (5) บันทึกยืนยันว่า paveekornk รับไปแก้ `GPS_Data_Dictionary.xlsx` (`CAMPAIGN_ASSIGNMENT.assigned_by`) เอง แยก PR ต่างหาก |
