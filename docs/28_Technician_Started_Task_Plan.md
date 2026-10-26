# แผน Task ที่ช่างเริ่มเองจากหน้ากล่อง (บันทึกงานหน้างาน)

> **สถานะ:** แผน — ยังไม่มีโค้ดใน PR นี้ · B กำหนดทิศทาง 26 ต.ค. 2569 เอกสารนี้ขอ A รีวิวก่อนเริ่มทำ
>
> **ผู้เขียน/ผู้รีวิว:** ร่างโดย B (kittiphong) 26 ต.ค. 2569 · ขอ A (paveekornkwork-dev) รีวิว เพราะเปลี่ยนสิทธิ์ใน
> RBAC Matrix, กฎแยกหน้าที่ (SoD) ของคำขอส่ง Config และ comment "Task Management ยกเลิกถาวร" ใน `web/src/lib/nav.ts`
>
> **ต่อจาก:** docs/25 (คำขอส่ง Config จากหน้างาน) และ docs/27 (อนุมัติแล้วช่างกดส่งเอง + Firmware) · เอกสารนี้**แก้มติ
> บางข้อของ docs/25 และ docs/27** ระบุไว้ที่ §2.1
>
> **เงื่อนไขที่ห้ามผ่อน:** คนขอกับคนอนุมัติต้องไม่ใช่คนเดียวกัน · Operation เท่านั้นที่อนุมัติคำขอ · ตรวจไม่ได้ให้
> **ปฏิเสธ (fail closed)**
>
> **ที่มาของข้อมูล:** `main` ที่ `abff732` + branch ของ #381 (B1) ที่ `4a873ce`

---

## 1. ปัญหา

### 1.1 ตอนนี้ไม่มีใครสร้าง Task ได้จากหน้าจอ
- แอป Mobile ทำงานรอบ Task ทั้งหมด (งานของฉัน → Task Detail → ขอส่ง Config) แต่ **Task เกิดได้ทางเดียวคือ
  `POST /tasks` (Operation)** ซึ่งไม่มีหน้าจอเรียก
  - หน้า Task Management บน Web ถูกยกเลิกถาวรแล้ว (`web/src/lib/nav.ts`, RBAC_Matrix §6 แก้ครั้งที่ 25)
  - comment ใน `nav.ts` บอกว่าการมอบหมายงาน "ย้ายไปอยู่ในขั้นตอนสร้าง Campaign" แต่ **หัวหน้าแก้ scope 2026-09-14
    ว่า Campaign ไม่มอบหมายงานให้ช่างแล้ว** (comment ที่ `Task.campaignId` ใน `schema.prisma`) — `CampaignService.create()`
    ไม่สร้าง Task เลย ค้นทั้ง `web/` และ `backend/src` แล้วไม่มีจุดไหนสร้าง Task นอกจาก `POST /tasks`
  - ที่ผ่านมา Task สำหรับทดสอบมาจาก seed หรือสคริปต์
- การมอบหมายงานให้ช่างเป็นหน้าที่ของ**ระบบแยกที่บริษัทมีอยู่แล้ว** (มติหัวหน้าเดียวกัน) ระบบเราจึงไม่ควรเป็นที่สั่งงาน

### 1.2 คำขอส่ง Config ผูกกับ Config ที่ Operation เลือกไว้ใน Task
- `POST /tasks/{taskId}/config-apply-requests` อ่าน `configId` จาก Task เสมอ และต้องมี `Task.configAssignedBy`
  (docs/25 §4.2) — ช่างเลือก Config เองไม่ได้ ถ้า Task ไม่มี Config ที่ผูกไว้ก็ขอส่งไม่ได้เลย

### 1.3 เป้าหมาย
- **Task = บันทึกงานที่ช่างไปทำกับกล่อง 1 ครั้ง** ช่างเป็นคนเริ่มเองจากหน้ากล่อง ไม่ต้องรอใครสร้างให้
- ช่าง**เลือก Config หรือ Firmware ที่อนุมัติแล้ว**ให้กล่องเองได้ แล้วเข้า flow ของ docs/27 ต่อ (Operation อนุมัติ →
  ช่างกดส่งเข้ากล่อง)
- Task ที่ Operation สร้างแบบเดิมยังใช้ได้

---

## 2. มติ (B ตัดสิน 26 ต.ค. 2569)

| # | เรื่อง | มติ |
|---|---|---|
| D1 | Task เกิดจากไหน | **ได้ทุกทาง:** ช่างกด "อัปโหลด" ที่หน้ากล่อง · ช่างกด "เริ่มงาน" โดยไม่อัปโหลด (เช่น ตรวจสัญญาณ เปลี่ยนซิม) · Operation สร้างผ่าน `POST /tasks` เหมือนเดิม |
| D2 | ขอบเขต Task 1 ใบ | **การไปทำกล่อง 1 ครั้ง** — ถ้าช่างคนนั้นมี Task ของกล่องนี้ที่ยังไม่ปิดอยู่ ใช้ใบเดิม (ขอ Config แล้วตามด้วย Firmware ได้ในใบเดียว) |
| D3 | ช่างเลือกอะไรได้ | **Config ที่สถานะ `approved`/`synced`** ที่รุ่นและโปรโตคอลตรงกับกล่อง · **Firmware ที่ QA อนุมัติแล้ว** ที่รองรับรุ่นของกล่อง (ถอยเวอร์ชันได้แต่เตือนชัด ตาม docs/27 D3) · Operation ยังอนุมัติคำขออีกชั้นทุกครั้ง |
| D4 | ปิด Task | **ช่างกด "เสร็จงาน" เอง** · ถ้าลืม ระบบปิดให้เมื่อไม่มีความเคลื่อนไหวเกิน 24 ชม. |
| D5 | Task ที่ Operation สร้าง | ยังสร้างได้ (`POST /tasks`) · ถ้าผูก Config ไว้ Mobile แสดงเป็น**ตัวเลือกแนะนำ** แต่ช่างเลือกตัวอื่นจากรายการ D3 ได้ |

### 2.1 มติเดิมที่เปลี่ยน
| เอกสาร | เดิม | ใหม่ |
|---|---|---|
| docs/25 §3.3 | Config และเครื่องของคำขอมาจาก Task เสมอ ไม่รับจาก client | เครื่องมาจาก Task เสมอ (เหมือนเดิม) · **Config/Firmware รับจาก body** ตรวจตามกฎ D3 |
| docs/25 §4.2 (SoD ข้อ 3) | ผู้อนุมัติต้องไม่ใช่ Operation ที่ผูก Config เข้า Task · Task ที่ไม่มี `configAssignedBy` → ปฏิเสธ | ใช้ข้อ 3 **เฉพาะเมื่อช่างเลือก Config ตัวเดียวกับที่ Operation ผูกไว้ใน Task** (คนผูกยังเป็นผู้มีส่วนได้เสีย) · Config ที่ช่างเลือกเอง: ผู้อนุมัติ ≠ ผู้ขอ (ข้อ 1–2 เดิม) พอ |
| docs/25 §3.3 | ขอได้เฉพาะ Task สถานะ `in_progress` | เหมือนเดิม — Task ที่ช่างเริ่มเองเป็น `in_progress` ตั้งแต่สร้าง |
| docs/27 §5.1 | `kind=config` ใช้ `Task.configId` | `kind=config` รับ `configId` ใน body (ไม่ส่ง = ใช้ `Task.configId` เข้ากันได้กับ Mobile เดิม) |
| RBAC_Matrix §6 / `nav.ts` | "Task Management ยกเลิกถาวร" | **ยังยกเลิกฝั่ง Web เหมือนเดิม** (ไม่มีหน้าสั่งงานบน Web) · แก้ comment ให้ถูก: Task เกิดจากช่างเริ่มเองบน Mobile ไม่ใช่จาก Campaign |

---

## 3. Flow

```
ช่างค้นหากล่อง → หน้ากล่อง
  ├─ [เริ่มงาน] ─────────────┐
  └─ [อัปโหลด] → เลือก Config/Firmware (D3) ─┐
                             ▼              ▼
          POST /tasks/start { deviceId }  (หา Task เปิดอยู่ของช่าง+กล่องนี้ ไม่มีก็สร้าง in_progress)
                             │              │
                             │              ▼
                             │   POST /tasks/{id}/config-apply-requests { kind, configId | firmwareId }
                             │              │  → pending → Operation อนุมัติ → approved
                             │              │  → ช่างกด "ส่งเข้ากล่อง" → sending → ผล (docs/27)
                             ▼              ▼
                     Task Detail: บันทึก, ประวัติคำขอ, ขออัปโหลดเพิ่มได้
                             │
                     [เสร็จงาน] → completed     (หรือปิดอัตโนมัติเมื่อเงียบเกิน 24 ชม. — §5.4)
```

- กด "อัปโหลด" แล้ว Mobile เรียก `start` ก่อนเสมอ (ได้ Task เดิมหรือใบใหม่) แล้วค่อยสร้างคำขอ — ถ้าสร้างคำขอไม่ผ่าน
  (เช่น กล่องมีคำขอค้างของคนอื่น) Task ยังอยู่ ช่างเห็นข้อความใน Task Detail และลองใหม่หรือกดเสร็จงานได้
- **ต้องออนไลน์ตอนเริ่มงาน** — Task id มาจาก server · คิวออฟไลน์ของ Mobile (`pending_actions`) ยังใช้กับการแก้ Task
  ที่มีอยู่แล้วเท่านั้นเหมือนเดิม

---

## 4. Data model (migration additive)

```prisma
enum TaskSource {
  operation    // POST /tasks — แถวเดิมทั้งหมด
  technician   // POST /tasks/start — ช่างเริ่มเองจากหน้ากล่อง (docs/28)
}

model Task {
  // ...เดิม
  source      TaskSource @default(operation)   // ใหม่ — ไม่มีใน Data Dictionary (comment อธิบายใน schema)
  completedAt DateTime?                        // ใหม่ — เวลาปิดงาน (ช่างกดหรือระบบปิด)
  autoClosed  Boolean   @default(false)        // ใหม่ — true = ระบบปิดให้ (§5.4)
}
```

- `ConfigApplyRequest.configAssignedBy` เป็น nullable อยู่แล้วตามแผน B2 (docs/27 §4) — ใช้ต่อ: เก็บค่าเฉพาะเมื่อ
  `configId` ที่ขอ = `Task.configId` (SoD ข้อ 3 ยังใช้) · ช่างเลือกเอง = `null`
- ไม่แก้ migration เดิม · แถว Task เดิมเป็น `operation` ทั้งหมด

---

## 5. API

### 5.1 เริ่มงาน — `POST /tasks/start` (ใหม่, โมดูล `task` ของ B)
```json
{ "deviceId": "BOX-0001", "note": "ไปตรวจสัญญาณ" }     // note ไม่บังคับ → บันทึกเป็น TaskEvent ที่มี note
```
- สิทธิ์: resource ใหม่ **`field-task`** action `Create` — grant ให้ **ST, OT** (Q1)
- **หาใบเดิมก่อน:** Task ของ `actor` + `deviceId` ที่สถานะ `pending`/`in_progress` (ทั้ง `source` ไหนก็ได้ — ถ้า Operation
  สั่งงานกล่องนี้ให้ช่างคนนี้ไว้แล้ว ใช้ใบนั้น) → **200** คืนใบเดิม (ถ้า `pending` เปลี่ยนเป็น `in_progress` ให้)
- **ไม่มี → สร้างใหม่ 201:** `source=technician`, `assignedTo=actor.id` (ไม่รับจาก client), `status=in_progress`,
  `title` สร้างให้ เช่น `"BOX-0001 — 26 ต.ค. 2569"`, `configId=null`
- กันกดซ้ำพร้อมกัน: ล็อกแถว `Device` (`SELECT … FOR UPDATE` แบบ `lockDevice()` ของ config-apply-request) ก่อนหา/สร้าง
- ไม่พบกล่อง → 404 · กล่องสถานะ `decommissioned` → 409 · **ไม่บังคับ `installed`** (ไปติดตั้งกล่องใหม่ก็เริ่มงานได้ —
  แต่การอัปโหลดยังบังคับ `installed` ตามกฎเดิม)
- ไม่ส่งแจ้งเตือน `task_assigned` (ช่างสร้างให้ตัวเอง) · ลง `AuditLog` `task_start`

### 5.2 ตัวเลือกที่ส่งเข้ากล่องได้ — `GET /devices/{deviceId}/apply-options` (ใหม่, โมดูล `config-apply-request` ของ B)
```json
{
  "configs":   [{ "id": "…", "name": "…", "status": "approved", "latestVersion": 12, "suggested": true }],
  "firmwares": [{ "id": "…", "version": "1.3.0", "isDowngrade": false, "isCurrent": false }],
  "currentFirmwareVersion": "1.2.0"
}
```
- สิทธิ์: `config-apply-request` action `Create` (ST, OT — คนที่ขอได้เท่านั้น)
- `configs`: สถานะ `approved`/`synced` ไม่ถูกลบ รุ่น+โปรโตคอลตรงกับกล่อง · `suggested=true` เมื่อเป็น `configId` ของ
  Task ที่เปิดอยู่ของช่างกับกล่องนี้ (D5)
- `firmwares`: QA อนุมัติแล้ว รองรับรุ่นของกล่อง · `isDowngrade`/`isCurrent` เทียบกับเวอร์ชันที่กล่องรายงาน (Server กลาง
  ในโหมด central · `Device` partition ในโหมดอื่น) · อ่านเวอร์ชันไม่ได้ → `currentFirmwareVersion: null` และ
  `isDowngrade: null` (Mobile เตือนว่าไม่รู้เวอร์ชันปัจจุบัน การสร้างคำขอยัง fail closed ตาม docs/27 §5.1)
- ทำไมไม่ใช้ `GET /configs` + `GET /firmware` ตรงๆ: ต้องกรองรุ่น/สถานะ/QA ซ้ำในแอป และกฎ "ส่งได้ไหม" ควรอยู่ที่เดียวกับ
  ที่ตรวจตอนสร้างคำขอ

### 5.3 สร้างคำขอ — `POST /tasks/{taskId}/config-apply-requests` (เดิม + body)
```json
{ "kind": "config",   "configId": "<uuid>", "note": "…" }   // configId ไม่ส่ง = Task.configId (Mobile เดิม)
{ "kind": "firmware", "firmwareId": "<uuid>", "note": "…" } // docs/27 B2
```
- `configId` ต้องผ่านกฎเดียวกับ §5.2 (ตรวจซ้ำที่ server เสมอ) · ไม่ส่งและ Task ไม่มี `configId` → 400
- SoD ตาม §2.1: ผู้อนุมัติ ≠ ผู้ขอ เสมอ · ถ้า `configId` = `Task.configId` บันทึก `configAssignedBy` = ผู้ผูก แล้วผู้อนุมัติ
  ≠ คนนั้นด้วย (Task เดิมที่ไม่มี `configAssignedBy` แต่ช่างเลือก Config ตัวเดียวกับที่ผูก → ปฏิเสธเหมือนเดิม fail closed)
- กฎอื่นเหมือนเดิม: Task ต้อง `in_progress` · กล่องละ 1 คำขอที่ยังไม่จบ · ไม่มี Rollout ค้าง

### 5.4 ปิดงาน — `PATCH /tasks/{id}` `{ "status": "completed" }` (เดิม) + กติกาใหม่
- คำขอของ Task ที่ยัง `sending` อยู่ → **409** "รอผลจากกล่องก่อน" (ปิดกลางทางแล้วผลกลับมาจะไม่มีใครเห็น)
- คำขอที่ `pending`/`approved` → ปิดเป็น `cancelled` (เหตุผล "ช่างปิดงาน") ในทรานแซกชันเดียวกัน — ขยาย
  `cancelPendingConfigApplyRequests()` ที่ทำตอนยกเลิก Task อยู่แล้ว
- บันทึก `completedAt`
- **ปิดอัตโนมัติ (job ใหม่ ทุก 15 นาที):** Task `in_progress` ที่ `updatedAt` และ TaskEvent ล่าสุดเก่ากว่า 24 ชม. และ**ไม่มี
  คำขอ `sending`** → `completed` + `autoClosed=true` + TaskEvent "ระบบปิดงานให้ (ไม่มีความเคลื่อนไหว 24 ชม.)" · ใช้กับทั้ง
  สอง `source` (Q3)

### 5.5 อื่นๆ
- `GET /tasks`, `GET /tasks/{id}`: response เพิ่ม `source`, `completedAt`, `autoClosed` · กฎมองเห็นเหมือนเดิม (ST/OT
  เห็นเฉพาะของตัวเอง)
- `POST /tasks` (Operation) ไม่เปลี่ยน · ST/OT เรียกไม่ได้เหมือนเดิม (ไม่ได้ `tasks:Create`)

---

## 6. Mobile (B)

| หน้า | เปลี่ยน |
|---|---|
| **Device Detail** | ปุ่มหลัก **"อัปโหลด"** → หน้าเลือก (§5.2) · ปุ่มรอง **"เริ่มงาน"** (ถ้ามีใบเปิดอยู่แล้วเปลี่ยนเป็น **"ไปที่งาน"**) · โหมด central ซ่อน Firmware Override / ยืนยันติดตั้ง ตาม docs/27 §11 (B3) |
| **หน้าเลือกอัปโหลด (ใหม่)** | แท็บ Config / Firmware · ตัวที่ `suggested` อยู่บนสุดพร้อมป้าย "Operation แนะนำ" · Firmware ที่ `isCurrent` กดไม่ได้ · `isDowngrade` ป้ายแดง "ถอยเวอร์ชัน" + ยืนยันอีกครั้ง · ช่องหมายเหตุ · กดขอ → `start` → สร้างคำขอ → ไป Task Detail |
| **Task Detail** | ป้ายที่มา ("เริ่มเองจากหน้ากล่อง" / "Operation สั่ง") · การ์ดคำขอแสดง**ทุกคำขอของใบนี้** (ใหม่สุดบน) · ปุ่ม **"ขออัปโหลดเพิ่ม"** · ปุ่ม **"เสร็จงาน"** (ซ่อนระหว่าง `sending` และบอกเหตุผล) |
| **งานของฉัน / Home** | Task ที่ช่างเริ่มเองแสดงปนกับงานที่ได้รับมอบ เรียงตามล่าสุด · แท็บ "เสร็จแล้ว" ดูย้อนหลังได้ (เป็นประวัติการทำงาน) |

- `fromWire` ของ enum ใหม่ (`TaskSource`) ต้อง**ไม่ throw** กับค่าที่ไม่รู้จัก (fallback `operation`) — บทเรียนจาก B1
  ที่ `ConfigApplyRequestStatus.fromWire` throw ทำให้ต้อง deploy Mobile คู่กับ backend

## 7. Web (A)
- **ไม่บังคับ:** การ์ดอนุมัติคำขอ (A2 ของ docs/27) แสดงว่าช่างเลือก Config เอง หรือเป็นตัวที่ Operation ผูกไว้
- แก้ comment ใน `web/src/lib/nav.ts` ตาม §2.1 (ไม่มีหน้าใหม่)
- ประวัติรายเครื่อง (#371/#378) แสดง Task ได้อยู่แล้ว — ถ้าเพิ่มป้าย `source` ได้จะดีมาก

## 8. RBAC และเอกสาร
- resource ใหม่ `field-task` (Create: ST, OT) — เพิ่มแถวใน seed ไม่ต้อง migration (`Role`/`Permission` เป็นตาราง)
- RBAC_Matrix: แถว endpoint `POST /tasks/start`, `GET /devices/{deviceId}/apply-options` · แก้แถว
  `POST /tasks/{taskId}/config-apply-requests` (SoD ใหม่) · changelog ใช้เลขถัดจากที่ merge ล่าสุดตอนนั้น
- openapi: path ใหม่ 2 ตัว + `Task.source/completedAt/autoClosed` + body `configId` ของคำขอ
- Data Dictionary: `Task.source`, `completedAt`, `autoClosed` ไม่มีใน DD → comment เหนือ field ใน schema ตาม CLAUDE.md

---

## 9. แบ่งงานและลำดับ PR

| # | งาน | ใคร | ต้องรอ |
|---|---|---|---|
| 0 | เอกสารนี้ | B | — |
| 1 | **C1** backend: §4 migration, `POST /tasks/start`, `field-task`, ปิดงาน §5.4 + job ปิดอัตโนมัติ, `configId` ใน body + SoD ใหม่ §5.3, `apply-options` (ส่วน configs) | B | #381 (B1) merge |
| 2 | **B2** (docs/27) firmware — เพิ่ม `firmwares` ใน `apply-options` ในใบเดียวกัน | B | C1, A1 |
| 3 | **C2** Mobile §6 (รวมกับ B3 ของ docs/27) | B | C1 (config) · B2 (firmware) |
| 4 | Web §7 (ไม่บังคับ) | A | C1 |

C1 แยกจาก B2 ได้เพราะส่วน Config ใช้ได้ทันทีโดยไม่ต้องรอ A1 — ช่างเริ่มงานและขอส่ง Config ที่เลือกเองได้ก่อน

## 10. เทสที่ต้องมี (C1)
- `start`: สร้างใบใหม่ · กดซ้ำได้ใบเดิม (200) · มีใบ Operation `pending` ของกล่องนี้ → ใช้ใบนั้นและเปลี่ยนเป็น
  `in_progress` · ช่าง 2 คนกล่องเดียวกัน → คนละใบ · `assignedTo` จาก body ถูกเมิน · role อื่น 403 · กล่องไม่พบ 404 ·
  `decommissioned` 409
- คำขอ: `configId` ที่เลือกเองผ่าน · รุ่น/โปรโตคอลไม่ตรง 409 · `draft` 409 · ไม่ส่ง `configId` ใช้ของ Task · ไม่ส่งและ Task
  ไม่มี → 400 · SoD: Operation ที่ผูก Config อนุมัติคำขอที่ใช้ Config ตัวนั้นไม่ได้ แต่อนุมัติ Config ที่ช่างเลือกเองได้
- ปิดงาน: `sending` → 409 · `pending`/`approved` ถูกยกเลิก · job ปิดเฉพาะใบที่เงียบเกิน 24 ชม. และข้ามใบที่มี `sending`
- `apply-options`: กรองสถานะ/รุ่น · `suggested` ถูกใบ

## 11. คำถามถึง A
- **Q1 — สิทธิ์เริ่มงาน:** เสนอ resource ใหม่ `field-task` (Create: ST, OT) แทนการ grant `tasks:Create` ให้ ST/OT เพราะ
  `tasks:Create` คือ `POST /tasks` ที่ระบุ `assignedTo` เป็นคนอื่นได้ — ถ้าใช้ตัวเดียวกันต้องเพิ่มเงื่อนไขในโค้ดแทนตาราง
  สิทธิ์ · A เห็นด้วยไหม
- **Q2 — SoD ข้อ 3:** ผ่อนเป็น "ใช้เฉพาะเมื่อช่างเลือก Config ตัวที่ Operation ผูกไว้" (§2.1) โอเคไหม · ข้อ 1–2 (ผู้อนุมัติ ≠
  ผู้ขอ, Operation เท่านั้น) ไม่เปลี่ยน
- **Q3 — ปิดอัตโนมัติ 24 ชม.:** ใช้กับ Task ที่ Operation สร้างด้วยไหม (เสนอว่าใช้ — ทั้งสองแบบเป็นบันทึกงานเหมือนกัน
  แต่ถ้า Operation ตั้ง `dueDate` ไว้ยาวกว่านั้น อาจข้ามใบที่ยังไม่ถึง `dueDate`)

## 12. นอกขอบเขต
- หน้าสั่งงาน / มอบหมาย Task บน Web (ยังยกเลิกตามมติเดิม)
- ลงทะเบียนกล่องใหม่จากหน้างาน (#295) — เริ่มงานกับกล่องที่ลงทะเบียนแล้วเท่านั้น
- เก็บตำแหน่งตอนช่างทำงาน (#106) — ต่อยอดจาก Task ใบนี้ได้ภายหลัง
- เริ่มงานตอนออฟไลน์
