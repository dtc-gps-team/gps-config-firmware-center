# แผนให้มือถือส่ง Config เข้าเครื่องจริง โดยรักษา Separation of Duty

> **สถานะ:** แผน — **A ตอบคำถามเปิด Q1–Q9 ครบแล้ว** (คอมเมนต์ใน #364, 21 ต.ค. 2569) เอกสารนี้บันทึกคำตอบไว้ใน §7 และ
> ปรับเนื้อหาส่วนที่เกี่ยวข้องให้ตรงแล้ว · **ยังไม่มีโค้ด** และยังไม่แก้ schema, backend หรือ mobile ใน PR นี้
>
> **ผู้เขียน/ผู้รีวิว:** ร่างโดย B (kittiphong) วันที่ 21 ต.ค. 2569 · ขอ A (paveekornkwork-dev) ร่วมรีวิว เพราะแผนนี้แตะ
> `campaign` และ `device` ซึ่งเป็นโมดูลของ A รวมถึง Approval Center บน Web
>
> **เงื่อนไขที่ห้ามผ่อน:** คนขอส่ง Config กับคนอนุมัติต้องไม่ใช่คนเดียวกัน และคนอนุมัติต้องไม่ใช่ Operation ที่ผูก Config
> เข้า Task ทุกจุดในเอกสารนี้ออกแบบภายใต้เงื่อนไขนี้ ถ้าตรวจไม่ได้ว่าใครเป็นใคร ระบบต้อง **ปฏิเสธ (fail closed)**
> ไม่ปล่อยผ่าน
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `0d75292` และ branch ของ #362 (`feat/central-rollout-apply-v2`) ที่ `993b3d0`
> ไฟล์ที่อ่าน:
> - `backend/prisma/schema.prisma` (`Task`, `TaskEvent`, `DeviceConfigOverride`, `CampaignRollout*`, `NotificationType`)
> - `backend/src/task/task.service.ts`
> - `backend/src/device/{device.service.ts, config-applier.ts, device-config-override.controller.ts}`
> - `backend/src/campaign/{campaign-rollout.service.ts, central-rollout-poll.service.ts}`
> - `backend/src/central-device/central-device.service.ts`
> - `docs/architecture/RBAC_Matrix.md` §5, `docs/13` §3.5, `docs/14` §7

---

## 1. ปัญหาและเป้าหมาย

- **ปุ่ม "ส่ง Config เข้าเครื่อง" ในหน้า Task Detail ยังเป็น mock แบบ fire-and-forget:**
  - ปุ่มเรียก `POST /devices/{deviceId}/apply-config` → `DeviceService.applyConfig()` → `MockConfigApplier`
  - ใช้ mock **ทุกโหมด รวมโหมด `central` ของ #362** (`device.module.ts` ผูก `MockConfigApplier` ตายตัว และคอมเมนต์ใน
    `config-applier.ts` ก็เขียนไว้ว่าโหมดเปลี่ยนเฉพาะเส้นทางของ Campaign Rollout)
  - ตอนนี้ mock ทำแค่ตรวจ field เบื้องต้นแล้วเขียน AuditLog หนึ่งแถว ไม่มีอะไรไปถึงกล่องจริง
- **เป้าหมาย:** ให้ช่าง (ST/OT) สั่งส่ง Config ของ Task เข้ากล่องจริงผ่าน Server กลาง (central applier ของ #362) ได้
  และติดตามผลจากกล่องได้จนจบ
- **โดยไม่ลด Separation of Duty:** การส่ง Config เข้าเครื่องจริงต้องผ่าน Operation **อีกคน** อนุมัติก่อนเสมอ
  เทียบเท่ากับที่ Campaign Rollout บังคับอยู่ตอนนี้

## 2. สถานะปัจจุบัน

### 2.1 Config ของ Task มาจากไหน

- **มาจาก `Task.configId`:** Operation ผูกค่านี้ตอนสร้างหรือแก้ Task ประเภทติดตั้ง/เปลี่ยน Config (มติ A/B ใน PR #81)
  ช่างเลือก Config เองไม่ได้
- **`TaskService.assertConfigAssignable()` บังคับตอนผูก:**
  - Config ต้องเป็น `approved`/`synced`
  - deviceModel/protocol ต้องตรงกับ Device
  - `DeviceService.applyConfig()` ตรวจเงื่อนไขชุดเดียวกันซ้ำอีกรอบตอนช่างกด
- **ไม่มีหน้าเว็บสร้าง Task:** Task Management ถูกยกเลิกถาวร (RBAC_Matrix แก้ครั้งที่ 26/29) Task ที่มี `configId`
  มาจากการเรียก `POST /tasks` ตรง (Operation เท่านั้น) หรือจาก seed
- **ระบบไม่บันทึกว่า Operation คนไหนผูก `configId`:**
  - `Task` ไม่มี `createdBy`
  - `TaskEvent.changedBy` บันทึกเฉพาะการเปลี่ยน `status` (ดู §4.2)

### 2.2 ขั้นอนุมัติที่มีอยู่แล้ว และช่องว่าง

| ขั้น | มีอยู่แล้ว? | ใคร |
|---|---|---|
| อนุมัติ **ตัว Config** (`testing` → `approved`) | มี | ConfigEngineer สร้างและทดสอบ → Operation อนุมัติ (SoD ระดับ role, RBAC_Matrix §5 ข้อ 1) |
| ผูก Config เข้า Task | มี (มีเงื่อนไขสถานะ) | Operation **คนเดียว** ไม่มีคนตรวจซ้ำ |
| **อนุมัติ "ส่ง Config นี้เข้าเครื่องนี้ตอนนี้"** | **ไม่มี** | - |

- **เทียบกับฝั่ง Web:** Campaign Rollout ปิดช่องว่างข้อสุดท้ายไว้แล้ว Operation คนหนึ่งสร้าง Rollout และ **Operation อีกคน**
  อนุมัติ (`CampaignRolloutService.assertDecidable()`: ถ้า `rollout.createdBy === actor.id` ได้ 403)
- **เหตุผลที่ต้องเทียบระดับ user id ไม่ใช่ระดับ role:** ทั้งสองฝั่งเป็น role Operation เหมือนกัน (`docs/13` §3.5) และ
  RBAC_Matrix §5 ข้อ 5 กำหนดว่าไม่มีใคร รวม Admin/SuperAdmin ผ่านทุกขั้นได้คนเดียว
- **ถ้าสลับ `MockConfigApplier` เป็น central ตรงๆ** Operation คนเดียวจะเลือก Config และสั่งให้มันเข้ากล่องจริงได้
  โดยไม่มีคนที่สองตรวจ ทางนี้จึงถูกตัดออก (ไม่อยู่ในแผน)

### 2.3 central applier ของ #362 (สิ่งที่จะ reuse)

- **`CentralDeviceService.pushConfig(deviceId, fields)`:**
  - ตรวจ field กับ schema ของกล่องตาม firmware ที่กล่องรายงาน แล้ว PUT ไปที่ Server กลาง
  - คืน `sent` (ได้ `commandId` + `configVersion`), `rejected` หรือ `unavailable`
- **`CampaignRolloutService.pushToCentral()` (private):** สั่ง push แล้วเก็บ `centralCommandId` ไว้ที่
  `CampaignRolloutTarget` และลง AuditLog `apply-config`
- **`CentralRolloutPollService.poll()`:**
  - ถามผลของ target ที่ `pending` + `centralCommandId != null` ของ Rollout โหมด `central` ที่ `active`/`paused`
  - ส่งผลต่อเข้า `recordTargetResult()` ทำให้ได้ Auto Pause และ Incident ตามกฎเดิม
- **ข้อจำกัด:** poll รู้จัก **`CampaignRolloutTarget` อย่างเดียว** คำสั่งที่ไม่ได้อยู่ใน Rollout จะไม่มีใครถามผลต่อ
  (ดูการชั่งน้ำหนักใน §3.2)

## 3. ออกแบบ flow

### 3.1 ภาพรวม

```
ช่าง (ST/OT, ผู้ถูก assign Task)          Operation คนที่ 2 (≠ ผู้ผูก Config เข้า Task)
   │ กด "ขอส่ง Config เข้าเครื่อง"                     │
   ▼                                                    │
POST /tasks/{taskId}/config-apply-requests              │
   → ConfigApplyRequest(pending)                        │
   → แจ้ง Operation (config_apply_pending)  ──────────►  Approval Center: การ์ดคำขอใหม่
                                                        │ อนุมัติ / ปฏิเสธ
                         ◄──── rejected ────────────────┤ (แจ้งช่าง config_apply_rejected)
                                                        ▼ approved
                               ตรวจซ้ำทุกเงื่อนไข → สร้าง Rollout เครื่องเดียว (active, central)
                               → pushToCentral() → centralCommandId
                               → CentralRolloutPollService poll ผลจากกล่อง
                               → recordTargetResult() → ConfigApplyRequest(succeeded/failed/skipped)
   ◄──────── แจ้งช่าง config_apply_succeeded / config_apply_failed ────────
```

### 3.2 เก็บคำขอไว้ที่ไหน

| ทาง | วิธี | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **ก. Rollout เครื่องเดียวล้วน** | ปุ่มของช่างสร้าง `CampaignRollout` (`pending_approval`) ที่มี target เดียว แล้วใช้การ์ดอนุมัติ Rollout ที่มีอยู่แล้ว | ไม่ต้องมี model ใหม่ ได้การ์ด Web, poll, Auto Pause และ Incident ฟรี | **`Rollout.createdBy` ต้องเป็นช่าง** ซึ่งขัดกับกฎว่า Operation เท่านั้นที่สร้าง Rollout ได้ · `assertDecidable` เทียบแค่ผู้สร้าง จะ**ไม่จับ** Operation ที่ผูก Config เข้า Task (SoD ที่ต้องการหลุด) ถ้าไม่เพิ่มเช็ค · `campaignId` บังคับมี ต้องสร้าง Campaign เทียมทุกคำขอ · ชนกับกฎ "กลุ่มเดียวมี Rollout ค้างได้แค่ 1 รอบ" · หน้า Campaign Monitor รกด้วยคำขอรายเครื่อง · ไม่รู้ว่าคำขอนี้มาจาก Task ไหน |
| **ข. model ใหม่ `ConfigApplyRequest` ล้วน** | model ใหม่ (mirror `DeviceConfigOverride` ของ #223) เก็บคำขอและผล แล้ว push/poll เองนอก Rollout | ความหมายชัด (คำขอจากหน้างาน ≠ Campaign) · ผูก Task และผู้ขอได้ตรงๆ · SoD เขียนเฉพาะได้ครบ | ต้องเขียน push, poll, timeout, Incident และ Auto Pause ซ้ำกับ #362 ทั้งหมด · poll สองชุดที่ทำงานเหมือนกัน |
| **ค. Hybrid (เลือกแล้ว — Q2)** | `ConfigApplyRequest` เก็บ**คำขอและการอนุมัติ** (SoD, Task, ผู้ขอ) และเมื่ออนุมัติ ระบบสร้าง **Rollout เครื่องเดียวสถานะ `active`** ที่ผูกกลับมาด้วย `rolloutId` เพื่อ reuse `pushToCentral()`, poll และ AuditLog (ไม่สร้าง Incident — Q4) | SoD อยู่ใน model ของเราเองเต็มที่ · ไม่เขียน push/poll ซ้ำ · การ์ด Web แยกจาก Rollout ของ Campaign | ต้องมี Campaign ระบบตัวเดียวให้ Rollout เหล่านี้ผูก (มติ Q2) · ต้องมีเมธอด public ใหม่ใน `CampaignRolloutService` (โมดูลของ A) |

**เลือกทาง ค. (A ยืนยันใน Q2):** Rollout เครื่องเดียวทุกตัวอยู่ใต้ **Campaign ระบบตัวเดียว** ที่ seed ไว้ล่วงหน้า (ไม่แก้
schema) และ**ซ่อนจากหน้า Campaign Monitor** ไม่ให้ปนกับ Rollout ของแคมเปญจริง (A ทำส่วนซ่อน) · เหตุผลที่เลือก:
- **ทาง ก.** ต้องดัด semantic ของ Rollout ถึง 2 จุด (ผู้สร้างเป็นช่าง และเช็ค SoD ที่ไม่ใช่ของ Rollout) เสี่ยงทำให้กฎ
  ของ Campaign เดิมอ่อนลงโดยไม่ตั้งใจ
- **ทาง ข.** ซ้ำงานของ #362 มากเกินไป
- **ทาง ค.** ให้ Rollout ที่ระบบสร้าง **ข้าม `pending_approval`** ไปเป็น `active` ได้ เพราะการอนุมัติ (ที่เช็ค SoD แล้ว)
  เกิดที่ `ConfigApplyRequest` ก่อนหน้า:
  - `Rollout.createdBy` = ช่างผู้ขอ
  - `approvedBy`/`approvedAt` = Operation ผู้อนุมัติคำขอ
  - ร่องรอยครบเหมือน Rollout ปกติ ซึ่งผู้สร้างกับผู้อนุมัติเป็นคนละคนเสมอ

### 3.3 Mobile: ช่างกดขอส่ง

**endpoint:** `POST /tasks/{taskId}/config-apply-requests` (A ยืนยันชื่อแล้วใน Q1)
- **ผูกกับ Task ไม่ใช่กับ device:**
  - body **ไม่รับ `configId` หรือ `deviceId` จาก client** backend อ่านจาก Task เอง ตามหลักเดิมที่ช่างเลือก Config เองไม่ได้
  - รับแค่ `note` (optional) เป็นข้อความถึง Operation
- **สิทธิ์:** resource ใหม่ `config-apply-request` action `Create` grant ให้ **ST, OT** (เท่ากับ `device-config-apply`
  ตอนนี้)
- **เงื่อนไข** (ทั้งหมดตรวจที่ backend):

| เงื่อนไข | ไม่ผ่าน |
|---|---|
| ผู้เรียกเป็นผู้ถูก assign Task นี้ (`assignedTo === req.user.sub`) | 404 (IDOR pattern เดียวกับ `GET /tasks/{id}`) |
| Task อยู่ `in_progress` | 409 |
| Task มี `configId` และ `deviceId` | 409 |
| Task มี `configAssignedBy` (§4.2) | 409 "งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน" (**fail closed**) |
| Config `approved`/`synced` ยังไม่ถูกลบ และรุ่น/protocol ตรงกับ Device ที่ `installed` | 404/409 (mirror `applyConfig`) |
| เครื่องนี้ไม่มีคำขอที่ยังเปิดอยู่ (`pending`/`sending`) | 409 |
| เครื่องนี้ไม่เป็น target `pending` ของ Rollout ที่ `active`/`paused` | 409 "มี Campaign กำลังส่ง Config ให้เครื่องนี้อยู่" (กันชนกับ Campaign) |

- **ผล:** สร้าง `ConfigApplyRequest(pending)` พร้อม snapshot `configAssignedBy` จาก Task ณ ตอนขอ, ลง AuditLog และแจ้ง
  Operation ด้วย `config_apply_pending`
- **ไม่เข้าคิว offline:** ปุ่มนี้กดได้เฉพาะตอนออนไลน์ ต่างจากการเปลี่ยนสถานะ Task (#296) เพราะคำขอที่ค้างในเครื่องจะ
  ไปถึง Operation ช้า และต้องตรวจเงื่อนไขกับข้อมูลสด
- **การ์ดใน Task Detail (Mobile) แสดงตามสถานะคำขอล่าสุดของ Task:**

| สถานะ | การ์ดแสดง | ปุ่ม |
|---|---|---|
| ไม่มีคำขอ | Config ที่จะส่ง | "ขอส่ง Config เข้าเครื่อง" |
| `pending` | "รอ Operation อนุมัติ" | "ยกเลิกคำขอ" |
| `sending` | "อนุมัติแล้ว กำลังส่ง รอกล่องยืนยัน" | - |
| `succeeded` | "กล่องรับ Config แล้ว" + เวลา | - |
| `failed` / `skipped_offline` / `rejected` | เหตุผล | "ขอส่งอีกครั้ง" |

- **endpoint อ่าน (ยืนยันแล้วใน Q1):**
  - `GET /tasks/{taskId}/config-apply-requests`: scope ด้วยกฎเดียวกับ `GET /tasks/{taskId}`
  - `POST /config-apply-requests/{id}/cancel`: ผู้ขอเท่านั้น ใช้ได้เฉพาะตอน `pending`

### 3.4 Web: การ์ดคำขอใน Approval Center (งาน A)

mirror การ์ด Device Config Override (#223, `device-config-override-approval-card.tsx`) ทั้งโครงสร้างและข้อความ

- **endpoint (ยืนยันแล้วใน Q1):** `GET /config-apply-requests?status=pending`, `POST /config-apply-requests/{id}/approve` และ
  `POST /config-apply-requests/{id}/reject` (body `rejectReason` บังคับ mirror #223)
- **สิทธิ์:** resource `config-apply-request` action `Approve`: **Operation เท่านั้น** · action `Read`: Operation, Auditor,
  Admin, SuperAdmin · Admin/SuperAdmin **อนุมัติไม่ได้** (RBAC_Matrix §5 ข้อ 5)
- **การ์ดแสดง:**
  - เครื่อง, Config (ชื่อ, เวอร์ชัน, deviceModel/protocol), Task และผู้ขอ
  - ผู้ผูก Config เข้า Task
  - ชื่อ field ที่จะส่ง (รวม Device Config Override ที่ approved แล้วจาก `mergeApprovedOverride`)
  - **ไม่แสดงค่าอ่อนไหว** (หลักเดียวกับ AuditLog metadata)
- **SoD ตอนอนุมัติหรือปฏิเสธ (ตรวจที่ service ทุกครั้ง ไม่พึ่ง UI ซ่อนปุ่ม):**
  1. ผู้ตัดสินต้องเป็น role **Operation** ถ้าไม่ใช่ได้ 403
  2. ผู้ตัดสิน **≠ ผู้ขอ** (`requestedBy`) ถ้าซ้ำได้ 403 (ต่าง role กันอยู่แล้ว แต่เช็ค user id ซ้ำเป็นชั้นกันอีกชั้น)
  3. ผู้ตัดสิน **≠ ผู้ผูก Config เข้า Task** (`configAssignedBy` ที่ snapshot ไว้ในคำขอ) ถ้าซ้ำได้ 403
     "ผู้ผูก Config เข้างานนี้อนุมัติการส่งเองไม่ได้ (Separation of Duty)"
  4. ถ้า `configAssignedBy` เป็น null ได้ 403 (**fail closed**) ซึ่งไม่ควรเกิดเพราะ §3.3 กันไว้ตั้งแต่ตอนสร้าง
  5. **(เพิ่มตาม Q8)** ผู้ตัดสิน **≠ ผู้อนุมัติตัว Config** (`Config.approvedBy`) ถ้าซ้ำได้ 403 — เข้มกว่า Rollout ปกติที่
     ไม่ได้ห้ามข้อนี้ · กรณี `Config.approvedBy` ว่าง (ข้อมูลเก่า/seed) ยังไม่ได้ตกลง ต้องถาม A ตอน implement
  6. การ์ดบน Web ควรปิดปุ่มให้ผู้ที่เข้าข้อ 2, 3 หรือ 5 พร้อมบอกเหตุผล แต่ backend คือด่านจริง
- **race:** ใช้ `updateMany({ where: { id, status: 'pending' } })` แล้วเช็ค `count === 0` ได้ 409 (pattern เดียวกับ #225
  และ `CampaignRolloutService.approve()`)

### 3.5 หลังอนุมัติ: ส่งเข้ากล่องจริงและ poll ผล

1. **ตรวจซ้ำแบบสด** ใน transaction เดียวกับการเปลี่ยนสถานะ (Config อาจถูกถอนอนุมัติหรือลบ Task อาจถูกยกเลิกระหว่างรอ):
   - Config ยัง `approved`/`synced` และไม่ถูกลบ
   - `Task.configId` ยังเป็นตัวเดียวกับในคำขอ
   - Task ยัง `in_progress` และผู้ขอยังเป็นผู้ถูก assign
   - Device ยัง `installed` และรุ่นยังตรง
   - เครื่องยังไม่เป็น target ของ Rollout อื่นที่ค้างอยู่
   - ถ้าไม่ผ่าน ได้ 409 และคำขอยังเป็น `pending` ให้ Operation ปฏิเสธพร้อมเหตุผล
2. **ผ่าน:**
   - คำขอเปลี่ยนเป็น `sending` บันทึก `decidedBy`/`decidedAt`
   - สร้าง Rollout เครื่องเดียว: `payloadType = Config`, `applyMode = central`, `status = active`, `createdBy = ผู้ขอ`,
     `approvedBy = ผู้อนุมัติ`
   - ผูก `rolloutId` กลับเข้าคำขอ
3. **เรียกเมธอด public ใหม่ของ `CampaignRolloutService`** (เช่น `startFieldApplyRollout()`, งาน A, Q3) ซึ่งเรียก
   `autoApplyConfig()` → `pushToCentral()` เดิม:
   - `sent`: target เก็บ `centralCommandId` แล้วรอ poll
   - `rejected`/`unavailable`: `recordTargetResult(false)` ทันที
4. **`CentralRolloutPollService` ถามผลเหมือน target ของ Rollout ปกติทุกประการ** (ไม่ต้องแก้ poll)
5. **ส่งผลกลับเข้าคำขอ:** เพิ่ม hook ใน `recordTargetResult()` / `markTargetSkippedOffline()` ว่าถ้า Rollout มีคำขอผูกอยู่
   ให้อัปเดตคำขอเป็น `succeeded`, `failed` หรือ `skipped_offline` พร้อม `resultDetail` แล้วแจ้งช่าง ทำแบบ never-throw
   เหมือน hook เดิม
6. **โหมด mock** (`DEVICE_CONFIG_APPLY_MODE=mock`, ค่าเริ่มต้น):
   - flow เดิมทุกขั้น แต่ Rollout ที่สร้างใช้ `applyMode = mock` → `MockConfigApplier` ได้ผลทันที
   - ใช้ env เดิม ไม่เพิ่ม env ใหม่ (CLAUDE.md Mock Mode Pattern)
   - โหมด `real` (device-sync pull) ใช้ flow เดียวกันได้โดยไม่ต้องแก้

**Rollout เครื่องเดียว (มติ Q4):**
- **ปิด Auto Pause** — ไม่มีความหมายกับ Rollout ที่มี target เดียว
- **ไม่สร้าง Incident** เมื่อคำขอจากหน้างานล้มเหลว — แจ้งผู้ขอผ่าน notification (`config_apply_failed`, §3.6) พอ ไม่ขึ้น
  Incident list

### 3.6 แจ้งผลกลับมือถือ

ใช้ `NotificationService.send()` และ FCM ที่มีอยู่ (`NOTIFICATION_MODE`) เพิ่ม `NotificationType` ใหม่ mirror
`config_override_*`:

| type | ผู้รับ | ตอน |
|---|---|---|
| `config_apply_pending` | Operation ทุกคน **ยกเว้น**ผู้ผูก Config เข้า Task (เขาอนุมัติไม่ได้อยู่แล้ว) | สร้างคำขอ |
| `config_apply_rejected` | ผู้ขอ | Operation ปฏิเสธ |
| `config_apply_succeeded` | ผู้ขอ | กล่องยืนยันผ่าน poll |
| `config_apply_failed` | ผู้ขอ | กล่องปฏิเสธ, ส่งไม่ได้ หรือกล่องออฟไลน์ (`skipped_offline` รวมไว้ที่นี่ แยกเหตุผลใน payload) |

- **ไม่มี `config_apply_approved` (มติ Q5):** การอนุมัติตามด้วยการส่งทันที แจ้งแค่ผลสุดท้ายพอ ส่วนการ์ดในแอปแสดง
  `sending` ให้เองเมื่อเปิดดู
- **payload:** `{ requestId, taskId, deviceId }` และ deep link ไปหน้า Task Detail (มีกลไกอยู่แล้วจาก push deep link)

### 3.7 AuditLog (mutation-only ตาม CLAUDE.md)

- **action ใหม่:** `config_apply_request`, `config_apply_approve`, `config_apply_reject` และ `config_apply_cancel`
  ใน `auditModule` ของโมดูลใหม่
- **การส่งจริง:** ลง `apply-config` พร้อม `centralCommandId` ใน `pushToCentral()` เดิม ไม่ต้องเพิ่ม
- **metadata:** เก็บแค่ชื่อ field ไม่เก็บค่า (หลักเดียวกับ `applyConfig`)

### 3.8 ปุ่มเดิม `POST /devices/{deviceId}/apply-config`

เมื่อ flow นี้พร้อมใช้ ปุ่มในแอปจะเปลี่ยนไปเรียก endpoint ใหม่ทั้งหมด ส่วน endpoint เดิม (มติ Q6):
- **โหมด `central`:** ตอบ 409 "ใช้คำขอส่ง Config แทน" เพื่อไม่ให้เหลือทางลัดที่ไม่ผ่านการอนุมัติ และไม่ให้ไปปิด target
  ของ Rollout แทนกล่องจริง (ดู §5)
- **โหมด `mock`:** คงไว้ชั่วคราวให้ E2E เดิมผ่าน แล้ว deprecate ใน openapi

### 3.9 คำขอค้าง (มติ Q9)

- **หมดอายุอัตโนมัติ:** คำขอ `pending` ที่ค้างนานเกินกำหนดถูกปิดเอง และแจ้งผู้ขอ
- **ยกเลิกอัตโนมัติเมื่อ Task ถูกยกเลิก:** คำขอ `pending` ของ Task นั้นถูกยกเลิกตาม
- **ยังไม่ได้ตกลง (ตัดสินตอน implement):** ระยะเวลาหมดอายุจริง (เดิมยกตัวอย่าง 24 ชม.) และสถานะปลายทางของคำขอที่หมดอายุ

### 3.10 ความสัมพันธ์กับมติ PULL model

- **มติ 2026-09-29** (คอมเมนต์ใน `CampaignRolloutService.release()`) ระบุว่าการรอให้ช่างกดยืนยันเป็นแค่ placeholder
  เพราะกล่องดึง Config เอง และ `docs/14` §7 ยังค้างคำถามว่าปุ่มนี้ยังจำเป็นไหม
- **แผนนี้ไม่ได้ย้อนมตินั้น:** Campaign ยังส่งเองอัตโนมัติตอนปล่อยเหมือนเดิม แผนนี้เพิ่ม**อีกช่องทาง**สำหรับกรณีหน้างาน
  (ติดตั้งหรือเปลี่ยน Config เครื่องเดียว) ที่ต้องผ่านการอนุมัติเทียบเท่า Rollout
- **ปิดคำถามใน docs/14 §7:** ปุ่มยังมีอยู่ แต่เปลี่ยนความหมายจาก "ส่ง" เป็น "ขอส่ง"

## 4. ผลกระทบต่อ schema

migration เดียว แบบ additive ล้วน (CLAUDE.md Shared Prisma Schema) ไม่แก้หรือลบ field เดิม

### 4.1 model ใหม่ `ConfigApplyRequest`

| field | type | หมายเหตุ |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `taskId` | `String` → `Task` | `onDelete: Restrict` (Task ไม่ถูกลบจริงอยู่แล้ว) |
| `deviceId` | `String` | เลขเครื่อง (`Device.deviceId`) snapshot จาก Task |
| `configId` | `String` → `Config` | snapshot จาก Task ตอนขอ |
| `configAssignedBy` | `String` → `User` | snapshot ผู้ผูก Config เข้า Task ใช้เช็ค SoD (§3.4 ข้อ 3) **ไม่ nullable** |
| `requestedBy` | `String` → `User` | ช่างผู้ขอ |
| `requestedAt` | `DateTime @default(now())` | |
| `note` | `String?` | ข้อความถึง Operation |
| `status` | `ConfigApplyRequestStatus @default(pending)` | |
| `decidedBy` | `String?` → `User` | Operation ผู้อนุมัติหรือปฏิเสธ |
| `decidedAt` | `DateTime?` | |
| `rejectReason` | `String?` | บังคับเมื่อ `rejected` |
| `rolloutId` | `String? @unique` → `CampaignRollout` | Rollout เครื่องเดียวที่สร้างตอนอนุมัติ (ทาง ค.) |
| `resultDetail` | `String?` | เหตุผลหรือผลจากกล่อง |
| `completedAt` | `DateTime?` | |
| `createdAt` / `updatedAt` | | |

- **index:** `@@index([deviceId, status])` สำหรับเช็ค "คำขอที่ยังเปิดอยู่ต่อเครื่อง" และ `@@index([taskId])`
- **กันคำขอซ้ำต่อเครื่อง:** Prisma ไม่รองรับ partial unique index จึงตรวจใน transaction พร้อม lock แถว Task
  (`lockTask` เดิม) แทน
- **enum ใหม่ `ConfigApplyRequestStatus`:** `pending`, `sending`, `succeeded`, `failed`, `skipped_offline`, `rejected`,
  `cancelled`

### 4.2 field ใหม่บน `Task`

- **`configAssignedBy String?`** (relation → `User`, `onDelete: Restrict`) และ **`configAssignedAt DateTime?`**
  - `TaskService.create()`/`update()` เขียนค่านี้ทุกครั้งที่ตั้งหรือเปลี่ยน `configId` (= `req.user.sub`)
  - ล้างเป็น null เมื่อ `configId` ถูกล้าง
- **ทำไม:** ปัจจุบันไม่มีที่ไหนบอกได้ว่าใครผูก Config (`TaskEvent` บันทึกเฉพาะสถานะ) จึงเช็ค SoD ข้อ 3 ไม่ได้
- **Task เดิมที่มี `configId` อยู่แล้ว:** ค่านี้จะเป็น null หลัง migrate ซึ่ง §3.3 จะ**ปฏิเสธ**คำขอของงานพวกนี้จนกว่า
  Operation จะผูก Config ใหม่ (fail closed) **ไม่เดาค่าย้อนหลัง** จาก AuditLog
- **ต่างจาก Data Dictionary:** ต้องใส่ comment อธิบายเหนือ field และ note ใน Data Dictionary ตาม CLAUDE.md (§Deviation)

### 4.3 อื่นๆ

- **`NotificationType`:** เพิ่ม 4 ค่าตาม §3.6 (`ALTER TYPE ... ADD VALUE` แบบ additive)
- **`CampaignRollout` (มติ Q2):** ใช้ Campaign ระบบตัวเดียวสำหรับคำขอหน้างาน — **ไม่แก้ schema** แค่ seed · ไม่ทำ
  `campaignId` ให้ nullable
- **RBAC:** seed row ของ resource `config-apply-request` (ตารางเดิม ไม่ต้อง migration) พร้อมอัปเดต RBAC_Matrix §2, §4 และ
  `openapi.yaml`

## 5. บั๊กที่พบระหว่างทาง: ต้องแก้ก่อนหรือคู่กัน (แยกจากงานออกแบบใหม่)

> **พบจากการอ่านโค้ด** ที่ `993b3d0` ของ #362 · **A ยืนยันกับโค้ดแล้วว่าเป็นบั๊กจริง** (คอมเมนต์ใน #364) · PR นี้**ไม่แก้**
> #362 — มติดูที่ §5.1

- **ตำแหน่ง:** `CampaignRolloutService.recordTargetResult()` (`campaign-rollout.service.ts` บรรทัด ~1763)
- **เงื่อนไขที่ใช้หา target:**
  - `findPendingTarget` หา target ด้วย `deviceId` + `status: 'pending'` + `rollout.status ∈ {active, paused}` +
    `rollout.configId` (และ `rolloutId` ถ้ามี)
  - **ไม่กรอง `centralCommandId`**
  - ถ้าเรียกจาก `DeviceService.applyConfig()` ซึ่งเปิด `fallbackToPayload: true` ไว้ (`device.service.ts` บรรทัด ~643)
    `rolloutId` ที่ไม่ตรงก็ยังไป match ด้วย payload ได้
- **สถานการณ์ที่พัง:**
  1. Operation ปล่อย Rollout โหมด `central` → target ของ BOX-X ได้ `centralCommandId` (ยัง `pending` รอกล่องยืนยัน)
  2. ระหว่างนั้นช่างเปิด Task ที่ผูก Config เดียวกันกับ BOX-X แล้วกดปุ่มเดิม (`apply-config`, mock)
  3. `MockConfigApplier` ตอบ `applied: true` → `recordTargetResult()` ปิด target เป็น **`success`** ทั้งที่กล่องยังไม่ยืนยัน
  4. รอบ poll ถัดไปของ `CentralRolloutPollService` ไม่เจอ target ที่ `pending` แล้ว ผลจริงจากกล่องจึงถูกทิ้ง
     ถ้ากล่องล้มเหลวจริง Campaign Monitor จะยังแสดงสำเร็จ และ Auto Pause/Incident ไม่ทำงาน
  5. ทางกลับก็พังเหมือนกัน: mock ตอบ `applied: false` (เช่น Timeout ติดลบ) จะปิด target เป็น `failed` ทั้งที่กล่องอาจรับไปแล้ว
- **แนวทางแก้ที่เสนอ (A เลือก (ข) แบบกว้าง — ดู §5.1):**
  - **(ก)** path ของ Mobile (`fallbackToPayload`) ข้าม target ที่ `centralCommandId != null` หรือข้าม Rollout ที่
    `applyMode !== 'mock'` ทั้งหมด
  - **(ข)** `DeviceService.applyConfig()` ไม่เรียก `recordTargetResult()` เลยเมื่อ Rollout ของเครื่องนั้นไม่ใช่โหมด `mock`
- **โหมด `real`:** น่าจะมีปัญหาแบบเดียวกัน (target `pending` รอกล่องดึงผ่าน device-sync แต่ปุ่ม mock ไปปิดได้) ควรเช็คด้วย
- **ทำไมต้องแก้ก่อนหรือคู่กับงานนี้:** flow ใหม่ใน §3.5 พึ่ง `recordTargetResult()` ให้บันทึกผลจากกล่อง**จริงเท่านั้น**
  ถ้าบั๊กนี้ยังอยู่ ปุ่มเดิมจะไปปิดผลของคำขอที่อนุมัติแล้วได้ (§3.8 ปิดปุ่มเดิมในโหมด `central` เป็นอีกชั้นที่กันไว้)

### 5.1 บั๊ก #362 (Q7) — มติ

- **A ตัดสินใจแล้ว: แก้ใน #362 ก่อน merge** (ยังไม่ merge พอดี แก้ที่ต้นตอสะอาดกว่าแยก PR)
- **วิธี: แนวทาง (ข) แบบกว้าง** — `DeviceService.applyConfig()` และ `DeviceService.confirmFirmwareInstall()` **ไม่เรียก
  `recordTargetResult()` เลย** ถ้า Rollout ของเครื่องนั้น `applyMode !== 'mock'`
  - ครอบคลุมทั้งโหมด `central` และ `real` ในจุดเดียว (ตอบคำถามเรื่องโหมด `real` ด้วย) ไม่ต้องเช็ค `centralCommandId` แยก
- **ผู้ทำ: A ใน #362** — ไม่ใช่งานที่ B implement ในแผนนี้ · งานของแผนนี้เริ่มได้หลังการแก้นี้เข้า main

## 6. แบ่งงาน (A ยืนยันใน Q3)

| งาน | คน | หมายเหตุ |
|---|---|---|
| migration (§4): `ConfigApplyRequest`, enum, `Task.configAssignedBy/At`, `NotificationType` | B | ไฟล์ร่วม: pull main ก่อน และ resolve conflict เอง |
| `TaskService` เขียน `configAssignedBy/At` | B | โมดูล `task` ของ B |
| โมดูล backend ใหม่ `config-apply-request`: endpoint ใน §3.3, §3.4, SoD, AuditLog, notification | B | ตามที่ตกลงว่า B ทำ endpoint ใหม่ |
| เมธอด public ใน `CampaignRolloutService` สร้าง Rollout เครื่องเดียวและเริ่มส่ง + hook ผลกลับเข้าคำขอ (§3.5 ข้อ 3, 5) รวมปิด Auto Pause ของ Rollout แบบนี้ (Q4) | **A** | โมดูล `campaign` ของ A — A เพิ่งแก้ `pushToCentral`/poll ใน #362 |
| seed Campaign ระบบ + ซ่อน Rollout ของคำขอหน้างานจาก Campaign Monitor (Q2) | A | |
| ปิด `apply-config` เดิมในโหมด `central` (§3.8) | A | โมดูล `device` ของ A |
| แก้บั๊ก §5 (มติ §5.1) | A | ใน #362 ก่อน merge |
| การ์ด Approval Center + จำนวนรออนุมัติบน Dashboard (§3.4) | A | mirror #223 |
| Mobile: การ์ด Task Detail ตามสถานะ, ยกเลิก, deep link จาก notification | B | |
| `openapi.yaml`, RBAC_Matrix, seed permission | B (A รีวิว) | redocly lint ก่อน commit |
| เทส: SoD ทุกข้อใน §3.4 (โดยเฉพาะผู้ผูก Config อนุมัติเองต้องได้ 403), race ตอนอนุมัติ, ตรวจซ้ำแบบสด, E2E Mobile โหมด mock | B + A ตามส่วนของตัวเอง | |

**ลำดับ:**
1. แก้บั๊ก §5 ใน #362 (A) แล้ว merge #362
2. ทำ migration และ `TaskService`
3. ทำ backend endpoint พร้อมกับเมธอดใน `campaign`
4. ทำ Web card และ Mobile ขนานกัน

## 7. คำถามถึง A — ตอบครบแล้ว

> A ตอบทุกข้อในคอมเมนต์ของ #364 (21 ต.ค. 2569) และ approve แผน · คำถามเดิมคงไว้ด้านล่างพร้อม**คำตอบ**ต่อท้ายแต่ละข้อ

1. **Q1 ชื่อ endpoint และ resource:** `POST /tasks/{taskId}/config-apply-requests` (ฝั่งช่าง) คู่กับ
   `/config-apply-requests/{id}/approve|reject|cancel` (ฝั่งคิว) และ resource `config-apply-request` โอเคไหม หรือ A อยาก
   ให้อยู่ใต้ `/devices/{deviceId}/...` แบบ #223
   - **คำตอบ:** เห็นด้วยตามที่เสนอ ไม่ต้องเปลี่ยน
2. **Q2 reuse Rollout หรือ model ใหม่:**
   - เห็นด้วยกับทาง ค. (Hybrid) ไหม
   - ถ้าเห็นด้วย Rollout เครื่องเดียวควรอยู่ใต้ **Campaign ระบบตัวเดียว** (seed, ไม่แก้ schema) หรือทำ `campaignId` ให้
     nullable และเพิ่ม `source`
   - Rollout แบบนี้ควรซ่อนจากหน้า Campaign Monitor ไหม
   - **คำตอบ:** เห็นด้วยทาง ค. ใช้ Campaign ระบบตัวเดียว (seed ไม่แก้ schema) และซ่อน Rollout พวกนี้จาก Campaign Monitor
3. **Q3 แบ่งงาน:**
   - เมธอด public ใน `CampaignRolloutService` และ hook ผลกลับ (§3.5) A ทำเอง หรือให้ B ทำแล้ว A รีวิว
   - โมดูล `config-apply-request` ใหม่เป็นของ B ตามตาราง §6 โอเคไหม
   - **คำตอบ:** A ทำเมธอด public และ hook ผลกลับเอง ส่วนที่เหลือตามตาราง §6 โอเค
4. **Q4 Rollout เครื่องเดียว:** ควรปิด Auto Pause ไหม และคำขอหน้างานที่ล้มเหลวควรสร้าง Incident ไหม
   - **คำตอบ:** ปิด Auto Pause และไม่สร้าง Incident แจ้งผู้ขอผ่าน notification พอ
5. **Q5 notification:** ตัด `config_apply_approved` ออก แจ้งแค่ผลสุดท้ายพอไหม
   - **คำตอบ:** เห็นด้วย ตัดออก
6. **Q6 endpoint เดิม `apply-config`:** ตอบ 409 ในโหมด `central` แล้ว deprecate โอเคไหม
   - **คำตอบ:** เห็นด้วย
7. **Q7 บั๊ก §5:** จะแก้ใน #362 ก่อน merge หรือแยก PR และเลือกแนวทาง (ก) หรือ (ข) · โหมด `real` มีปัญหาเดียวกันไหม
   - **คำตอบ:** บั๊กจริง แก้ใน #362 ก่อน merge ด้วยแนวทาง (ข) แบบกว้าง ครอบคลุม `central` และ `real` — ดู §5.1
8. **Q8 SoD เพิ่มเติม (เข้มขึ้น ไม่ใช่ผ่อน):** ควรห้ามผู้**อนุมัติตัว Config** (`Config.approvedBy`) อนุมัติคำขอส่งด้วยไหม
   ตอนนี้ Rollout ปกติไม่ได้ห้าม จึงไม่ได้ใส่ไว้ในแผน ถ้า A เห็นว่าควรห้าม เพิ่มได้ทันที
   - **คำตอบ:** เห็นด้วยให้เพิ่ม — ใส่แล้วใน §3.4 ข้อ 5
9. **Q9 คำขอค้าง:** คำขอ `pending` ควรหมดอายุเองไหม (เช่น 24 ชม.) และ Task ที่ถูกยกเลิกควรยกเลิกคำขอที่ค้างอยู่อัตโนมัติไหม
   (แผนนี้เสนอว่า "ควร" ทั้งสองข้อ)
   - **คำตอบ:** เห็นด้วยทั้งสองข้อ — ดู §3.9

## 8. นอกขอบเขต

- **Firmware:** `confirm-firmware-install` ยังไม่มี central path ใน #362 แผนนี้ครอบคลุมเฉพาะ Config
- **หน้าเว็บสร้าง Task:** ยังไม่มีตามมติยกเลิก Task Management แผนนี้ไม่เปิดคำถามนั้นใหม่
- **docs/24 (#357, กล่องจำลองในมือถือ):** อิสระจากแผนนี้ ถ้ากล่องจำลองลงทะเบียนกับ Server กลางได้ ก็ใช้ flow นี้ทดสอบได้เลย
