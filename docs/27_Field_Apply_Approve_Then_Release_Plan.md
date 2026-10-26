# แผนคำขอส่งเข้ากล่องจากหน้างาน v2: อนุมัติแล้วช่างกดส่งเอง + Firmware + กล่องหลุด

> **สถานะ:** แผน — B กับ A ตกลงทิศทางร่วมกันแล้ว (26 ต.ค. 2569) เอกสารนี้บันทึกมติและแบ่งงาน
>
> **ผู้เขียน/ผู้รีวิว:** ร่างโดย B (kittiphong) 26 ต.ค. 2569 · ขอ A (paveekornkwork-dev) รีวิว เพราะแตะ `campaign`,
> `device`, `central-device` และ Approval Center บน Web
>
> **ต่อจาก:** docs/25 (คำขอส่ง Config จากหน้างาน — #364, #370) · เอกสารนี้**แก้มติบางข้อของ docs/25** ระบุไว้ที่ §2.1
>
> **เงื่อนไขที่ห้ามผ่อน (เหมือน docs/25):** คนขอกับคนอนุมัติต้องไม่ใช่คนเดียวกัน และคนอนุมัติคำขอ Config ต้องไม่ใช่
> Operation ที่ผูก Config เข้า Task — ตรวจไม่ได้ให้ **ปฏิเสธ (fail closed)**
>
> **ที่มาของข้อมูล:** `main` ที่ `dd524b0` + ws-gateway ของ arduino_gps ที่ `b3b8c86` (local) + ผลทดสอบกับ BOX-0001
> จริงวันที่ 26 ต.ค. 2569 (§1.1)

---

## 1. ปัญหา

### 1.1 สิ่งที่เจอจากการทดสอบจริง (26 ต.ค. 2569)
1. **อนุมัติแล้วระบบส่งทันที (docs/25)** — ถ้า Operation อนุมัติตอนช่างไม่อยู่หน้ากล่องแล้ว คำสั่งจะไปถึงกล่องตอนไม่มี
   ใครดูแล ถ้ากล่องปิดหรือหลุดก็ล้มเหลวโดยไม่มีใครแก้ได้ทันที
2. **Mobile ไม่มีทางสั่งอัปเดต Firmware เข้ากล่องจริง** — ช่างกด "ยืนยันติดตั้ง Firmware" 1.0.0 แล้วขอ Firmware Override
   → Operation อนุมัติบน Web → **ไม่มีอะไรถูกส่งไปที่กล่อง** (ตามสเปก Override "ไม่ apply เข้าอุปกรณ์ให้อัตโนมัติ")
3. **ข้อมูลเพี้ยนในโหมด central** — `confirm-firmware-install` ยังเขียน Dual Partition ได้ ทำให้ระบบบันทึกว่า BOX-0001
   เป็น 1.0.0 ทั้งสอง partition ทั้งที่กล่องรัน 1.2.0 (แก้ DB กลับแล้ว) — เหตุผลเดียวกับที่ docs/25 §3.8 ปิด
   `apply-config` ในโหมด central
4. **กล่องหลุดกลางทางรู้ช้า** — เดิม ws-gateway รอ 3 นาที (`DEVICE_NO_RESPONSE`) ก่อนแจ้งล้มเหลว และไม่บอกว่าเพราะหลุด

### 1.2 เป้าหมาย
- ช่างที่อยู่หน้ากล่องเป็นคน**กดส่ง**หลังได้รับอนุมัติ — ใช้ได้ทั้ง **Config และ Firmware**
- กล่องออฟไลน์ตอนกดส่ง → บอกทันที ไม่สร้างคำสั่ง
- กล่องหลุดระหว่างทำเกิน 1 นาที → ล้มเหลวพร้อมเหตุผล "กล่องหลุด" แจ้งทั้ง Web/Mobile และเปิด Incident
- ปิดช่องทางที่บันทึกข้อมูลโดยไม่มีอะไรเกิดขึ้นจริงกับกล่อง (โหมด central)

---

## 2. มติ

| # | เรื่อง | มติ |
|---|---|---|
| D1 | ใครกดส่ง | ช่าง (ST/OT) ที่**ถือ Task อยู่ตอนนี้** (`Task.assignedTo`) เท่านั้น — ถ้า Task ถูกโอน คนขอเดิมกดไม่ได้ |
| D2 | อายุคำอนุมัติ | **24 ชม.** นับจากอนุมัติ เกินแล้ว `expired` ต้องขอใหม่ |
| D3 | ของที่ขอได้ | **Config** (ของ Task) และ **Firmware** (approved + stored + รองรับรุ่นกล่อง) ในคำขอแบบเดียวกัน |
| D4 | ของเปลี่ยนหลังอนุมัติ | Config มีเวอร์ชันใหม่ / ไม่ approved แล้ว หรือ Firmware ไม่ approved แล้ว → **กดส่งไม่ได้ ต้องขอใหม่** |
| D5 | Firmware ถอยเวอร์ชัน | **ขอได้ แต่เตือนชัด** ทั้งตอนขอ (Mobile) ตอนอนุมัติ (Web — ป้าย "ถอยเวอร์ชัน") และตอนกดส่ง |
| D6 | กล่องออฟไลน์ตอนกดส่ง | ตอบ 409 ทันที คำขอยัง `approved` อยู่ ช่างลองใหม่ได้จนหมดอายุ |
| D7 | กล่องหลุดระหว่างทำ | ws-gateway: หลุดเกิน 60 วินาทีระหว่าง `DELIVERED`→`VALIDATING` → `FAILED DEVICE_DISCONNECTED` (**ทำแล้ว** §7.1) |
| D8 | แจ้งเตือนเมื่อล้มเหลว | Web (Operation ที่อนุมัติ), Mobile push (ช่างที่ถือ Task) และ **เปิด Incident** |
| D9 | ล้มเหลวแล้วกล่องกลับมา | **ไม่ส่งใหม่เอง** — ช่างกดขอใหม่ |
| D10 | โหมด central | ปิด `confirm-firmware-install` และ Firmware Override (409) — ใช้ flow นี้แทน |

### 2.1 มติของ docs/25 ที่เปลี่ยน
| docs/25 | เดิม | ใหม่ |
|---|---|---|
| §3.2 ทาง ค. / §3.5 | อนุมัติ = สร้าง Rollout เครื่องเดียวและส่งทันที | อนุมัติ = เปลี่ยนสถานะเป็น `approved` เท่านั้น · Rollout สร้างตอน **release** |
| Q4 | คำขอหน้างานไม่สร้าง Incident | **สร้าง Incident** เมื่อผลเป็น `failed` (ไม่รวม `skipped_offline`/`cancelled`/`expired`) |
| §3.1 | Config เท่านั้น | Config **และ Firmware** |
| §3.9 | หมดอายุเฉพาะ `pending` | หมดอายุทั้ง `pending` (24 ชม. จากขอ) และ `approved` (24 ชม. จากอนุมัติ) |

---

## 3. Flow

```
ช่างขอ ─────► Operation อนุมัติ ─────► ช่างกด "ส่งเข้ากล่อง" ─────► กล่องรับ
pending        approved                 sending                     succeeded
  │ 24 ชม.       │ 24 ชม. → expired       │                           failed ── Incident
  │ → expired    │ ของเปลี่ยน → ต้องขอใหม่  │ ออฟไลน์ตอนกด → 409       skipped_offline
  │ rejected     │ ช่างยกเลิกได้            │   (ยัง approved)
  │ cancelled    │ cancelled               │
```

| จาก | ไป | ใคร | หมายเหตุ |
|---|---|---|---|
| — | `pending` | ST/OT ที่ถือ Task | Task `in_progress`, Device `installed`, ไม่มีคำขอ active ของเครื่องนี้ |
| `pending` | `approved` | Operation (SoD §5.3) | snapshot เวอร์ชัน Config / เวอร์ชัน Firmware ปัจจุบันของกล่อง |
| `pending` | `rejected` | Operation | ต้องมี `rejectReason` (เดิม) |
| `pending`/`approved` | `cancelled` | ช่างที่ถือ Task | เดิมยกเลิกได้แค่ `pending` |
| `pending`/`approved` | `expired` | job | `expiresAt < now` |
| `approved` | `sending` | ช่างที่ถือ Task (**release**) | ผ่านการตรวจ §5.4 ทั้งหมด |
| `sending` | `succeeded`/`failed`/`skipped_offline` | ผลจาก Rollout | เดิม |
| Task ถูกยกเลิก/ปิด | `cancelled` | ระบบ | ขยายจาก `pending` ให้รวม `approved` |

**คำขอ active ต่อเครื่อง** = `pending` + `approved` + `sending` (เดิม `pending` + `sending`) — มีได้ 1 รายการต่อเครื่อง

---

## 4. Data model (migration additive)

ยังใช้ model `ConfigApplyRequest` และ path `/config-apply-requests` เดิม — **ไม่เปลี่ยนชื่อ** แม้จะรับ Firmware ด้วย
(เปลี่ยนชื่อ = แก้ทั้ง migration, openapi, Web, Mobile โดยไม่ได้อะไรเพิ่ม) · ใส่ comment เหนือ model อธิบายว่าชื่อเป็น
Config แต่ครอบคลุม Firmware ตั้งแต่ docs/27

```prisma
enum ConfigApplyRequestStatus {
  pending
  approved          // ใหม่: อนุมัติแล้ว รอช่างกดส่ง
  sending
  ...               // เดิม
}

enum FieldApplyKind { config  firmware }   // ใหม่

model ConfigApplyRequest {
  kind                  FieldApplyKind @default(config)   // ใหม่ — แถวเดิมทั้งหมดเป็น config
  configId              String?        // เดิม NOT NULL → nullable (firmware ไม่มี)
  configAssignedBy      String?        // เดิม NOT NULL → nullable · kind=config ยังบังคับที่ service (fail closed)
  firmwareId            String?        // ใหม่ FK Firmware (Restrict) · บังคับเมื่อ kind=firmware
  approvedConfigVersion Int?           // ใหม่ snapshot ConfigVersion.versionNumber ล่าสุดตอนอนุมัติ (D4)
  fromFirmwareVersion   String?        // ใหม่ เวอร์ชันที่กล่องรายงานตอนขอ (Server กลาง) — แสดงบน Web
  isDowngrade           Boolean @default(false)  // ใหม่ คำนวณตอนขอ ตรวจซ้ำตอน release
  releasedBy            String?        // ใหม่ FK User (Restrict)
  releasedAt            DateTime?      // ใหม่
  expiresAt             DateTime       // เดิม — ความหมายขยาย: "เส้นตายของขั้นที่รออยู่"
                                       //   pending: requestedAt+24h · approved: decidedAt+24h
}
```

- `configId`/`configAssignedBy` เปลี่ยนเป็น nullable = `ALTER COLUMN ... DROP NOT NULL` ไม่กระทบแถวเดิม
- `NotificationType` เพิ่ม `config_apply_approved` (§8)
- **ข้อมูลเดิมตอน deploy:** คำขอ `pending` ที่ค้างอยู่ — อนุมัติหลัง deploy จะเป็น `approved` และต้องกดส่ง · คำขอ
  `sending` ไม่กระทบ

---

## 5. API

### 5.1 สร้างคำขอ — `POST /tasks/{taskId}/config-apply-requests` (เดิม + body ใหม่)
```json
{ "kind": "config", "note": "..." }                       // ไม่ส่ง kind = config (เข้ากันได้กับ Mobile เดิม)
{ "kind": "firmware", "firmwareId": "<uuid>", "note": "..." }
```
ตรวจเพิ่มสำหรับ `firmware`:
- Firmware `approvalStatus=approved`, `uploadStatus=stored`, `deviceModelCompatibility` มีรุ่นของกล่อง → ไม่ผ่าน 409
- อ่านเวอร์ชันที่กล่องรายงานจาก Server กลาง → เก็บ `fromFirmwareVersion` · ตรงกับเป้าหมาย → 409 `ALREADY_ON_VERSION` ·
  ต่ำกว่า → `isDowngrade=true` · อ่านไม่ได้ (Server กลางล่ม) → 503 ไม่สร้างคำขอ (fail closed — ไม่รู้ว่าถอยหรือไม่)

### 5.2 คิว / รายการ (เดิม) — response เพิ่ม `kind`, `firmware{ id, version }`, `fromFirmwareVersion`,
`isDowngrade`, `approvedConfigVersion`, `releasedBy`, `releasedAt` · query `status=approved` ใช้ได้

### 5.3 อนุมัติ — `POST /config-apply-requests/{id}/approve` (พฤติกรรมเปลี่ยน)
- SoD: `kind=config` — ผู้อนุมัติ ∉ {ผู้ขอ, `configAssignedBy`} (เดิม) · `kind=firmware` — ผู้อนุมัติ ≠ ผู้ขอ
- ตรวจสด (เดิม) + snapshot `approvedConfigVersion` (config)
- **ไม่สร้าง Rollout** → `status=approved`, `decidedBy/At`, `expiresAt = now + 24h`
- response 200 คืนคำขอ (`status: approved`)

### 5.4 ส่งเข้ากล่อง — `POST /config-apply-requests/{id}/release` (ใหม่)
- resource `config-apply-request` action **`Create`** (ST, OT — กลุ่มเดียวกับขอ/ยกเลิก · ดู §12.1 ข้อ 1)
- ผู้เรียกต้องเป็น `Task.assignedTo` **ปัจจุบัน** ไม่งั้น 404 (ไม่เปิดเผยว่ามีคำขอ — pattern เดียวกับ cancel)

ตรวจตามลำดับ (ทุกข้อ 409 ยกเว้นระบุ):

| # | ตรวจ | error (`code`) | ผลกับคำขอ |
|---|---|---|---|
| 1 | `status = approved` | `NOT_APPROVED` | — |
| 2 | `expiresAt > now` | `APPROVAL_EXPIRED` | ตั้ง `expired` |
| 3 | Task `in_progress` | `TASK_NOT_IN_PROGRESS` | — |
| 4 | config: Config `approved`/`synced` และ `versionNumber` ล่าสุด = `approvedConfigVersion` | `CONFIG_CHANGED` | ตั้ง `cancelled` + เหตุผล |
| 4 | firmware: ยัง `approved` + `stored` | `FIRMWARE_NOT_AVAILABLE` | ตั้ง `cancelled` + เหตุผล |
| 5 | Device `installed` | `DEVICE_NOT_INSTALLED` | — |
| 6 | Server กลาง: กล่อง `online` | `DEVICE_OFFLINE` (D6) · Server กลางติดต่อไม่ได้ → 503 | ยัง `approved` |
| 7 | ไม่มี Rollout/คำสั่งอื่นค้างของเครื่องนี้ | `DEVICE_BUSY` | — |
| 8 | firmware: `isDowngrade` ยังตรงกับเวอร์ชันปัจจุบันของกล่อง | `FIRMWARE_STATE_CHANGED` | ตั้ง `cancelled` (สถานะกล่องเปลี่ยนหลังอนุมัติ) |

ผ่านแล้ว (ใน transaction เดียว): `status=sending`, `releasedBy/At`, `createFieldApplyRollout(tx, …)` (§6) → หลัง commit
`startFieldApplyRollout()` (เหมือน docs/25 เดิม แค่ย้ายจาก approve มาที่นี่) · response 200 (`status: sending`, `rolloutId`)

### 5.5 ยกเลิก — `POST /config-apply-requests/{id}/cancel` — ขยายให้ยกเลิก `approved` ได้ · ผู้เรียก = ผู้ถือ Task ปัจจุบัน
(เดิม = ผู้ขอ — ให้ตรงกับ D1)

### 5.6 โหมดการส่ง — `GET /central/status` (A) — เพิ่ม `applyMode: "mock" | "real" | "central"` (ค่า
`DEVICE_CONFIG_APPLY_MODE`) ให้ Mobile ซ่อนปุ่มที่ใช้ไม่ได้ในโหมด central (§9)

---

## 6. ฝั่ง campaign (A)

- `createFieldApplyRollout(tx, input)` รับ `kind` + `firmwareId` + `allowDowngrade` เพิ่ม · Firmware ใช้ Campaign ระบบ
  ตัวเดียวกับ Config (มติ Q2 ของ docs/25) · `payloadType = Firmware`
- `FieldApplyRolloutStarter` (interface ฝั่ง B ใน `field-apply-rollout.ts`) ขยาย input ตามนี้ — B แก้ interface, A implement
- `allowDowngrade = isDowngrade` ส่งไปที่ Server กลาง (กลไกเดียวกับ Rollback ใน #362)
- ผลสำเร็จของ Firmware ผ่าน `confirmCentralFirmwareSuccess()` (Dual Partition bookkeeping) เหมือน Rollout ปกติ

---

## 7. กล่องหลุด / ออฟไลน์

### 7.1 ws-gateway (arduino_gps — **ทำแล้ว** โดย B, รีวิวแล้ว, ทดสอบ 20/20)
- กล่องหลุด (WS close / ping ไม่ตอบ) ระหว่าง `DELIVERED`, `ACKNOWLEDGED`, `DOWNLOADING`, `VALIDATING` เกิน
  `COMMAND_DISCONNECT_GRACE_SEC` (60) → `FAILED`, `error_code = DEVICE_DISCONNECTED`
- `INSTALLING`/`REBOOTING` ใช้ `COMMAND_REBOOT_TIMEOUT_SEC` (300) — กล่องเขียน flash/รีบูตเองได้โดยไม่ต้องใช้เน็ต
- ต่อกลับภายใน 60 วินาที = ไม่นับว่าหลุด · กล่องรายงานผลหลังคำสั่งจบแล้ว = บันทึก event `LATE_REPORT` ไม่เปลี่ยนผล (D9)
- `HEARTBEAT_INTERVAL_SEC` 30 → 10 · เวลาจากหลุดจริงถึงแจ้งล้มเหลว ≈ 70–80 วินาที

### 7.2 backend แปลผล (A — `central-rollout-poll.service.ts`)
`FAILED` ของ gateway แปลงเป็น `failed` อยู่แล้ว เพิ่มแค่ข้อความใน `resultDetail` ตาม `error_code`:

| error_code | ผล | ข้อความ (`resultDetail`) |
|---|---|---|
| `DEVICE_DISCONNECTED` | failed | กล่องหลุดการเชื่อมต่อเกิน 1 นาที — ส่งไม่ผ่าน |
| `DEVICE_NO_RESPONSE` | failed | กล่องไม่ตอบกลับภายในเวลาที่กำหนด |
| `ROLLED_BACK` / `NEW_FIRMWARE_FAILED_HEALTH_CHECK` | failed | Firmware ใหม่ไม่ผ่านการตรวจหลังรีบูต กล่องย้อนกลับเวอร์ชันเดิม |
| `DOWNLOAD_TIMEOUT` | failed | ดาวน์โหลด Firmware ค้าง (เน็ตช้าหรือหลุด) |
| อื่นๆ | failed | `error_message` จาก Server กลาง |
| `DEVICE_OFFLINE`, `TTL_EXPIRED` | skipped_offline | กล่องออฟไลน์ คำสั่งไปไม่ถึง |

---

## 8. แจ้งเตือนและ Incident

| เหตุการณ์ | ใครได้ | ช่องทาง | เจ้าของ |
|---|---|---|---|
| คำขอใหม่ | Operation (ยกเว้นผู้ผูก Config) | Web + `config_apply_pending` (เดิม) | B |
| **อนุมัติแล้ว** | ผู้ถือ Task | push `config_apply_approved` (**ใหม่**) "อนุมัติแล้ว — กดส่งเข้ากล่องได้ภายใน …" | B |
| ไม่อนุมัติ / หมดอายุ | ผู้ถือ Task | push `config_apply_rejected` / `_expired` (เดิม — เปลี่ยนผู้รับจากผู้ขอเป็นผู้ถือ Task) | B |
| สำเร็จ / ล้มเหลว | ผู้ถือ Task + Operation ที่อนุมัติ | push `_succeeded` / `_failed` + Web | B (push) / A (Web) |
| **ล้มเหลว** | — | **Incident** ผูก Device + Rollout · ข้อความตาม §7.2 | A (กลับมติ Q4) |

---

## 9. Mobile (B)

การ์ด "ส่งเข้ากล่อง" ในหน้ารายละเอียดงาน — สถานะเดียวต่อครั้ง ปุ่มหลักปุ่มเดียว:

| สถานะ | แสดง | ปุ่มหลัก | ปุ่มรอง |
|---|---|---|---|
| ไม่มีคำขอ | — | **ขอส่งค่าเข้ากล่อง** (ถ้า Task มี Config) | ขออัปเดต Firmware |
| `pending` | รอหัวหน้าอนุมัติ · หมดอายุ … | — | ยกเลิกคำขอ |
| `approved` | อนุมัติแล้ว · กดส่งได้ถึง … (ถอยเวอร์ชัน: แถบเตือนสีส้ม) | **ส่งเข้ากล่อง** | ยกเลิกคำขอ |
| `sending` | กำลังส่ง… | — | — |
| `succeeded` | กล่องรับแล้ว ✓ | — | — |
| `failed` | ข้อความจาก §7.2 | **ขอส่งอีกครั้ง** | — |
| `rejected` / `expired` / `cancelled` | เหตุผล | ขอใหม่ | — |

- **ขออัปเดต Firmware:** bottom sheet แสดงเวอร์ชันปัจจุบันของกล่อง + รายการ Firmware ที่ขอได้ · เลือกเวอร์ชันต่ำกว่า →
  dialog ยืนยัน "ถอยเวอร์ชันจาก X เป็น Y — ค่าบางอย่างที่ firmware เก่าไม่รู้จักจะใช้ไม่ได้"
- กดส่งแล้วได้ `DEVICE_OFFLINE` → snackbar "กล่องยังไม่ออนไลน์ — ตรวจไฟและสัญญาณแล้วลองใหม่" การ์ดยังเป็น `approved`
- **รีเฟรชเอง:** poll ทุก 5 วินาทีขณะอยู่ในหน้าและสถานะเป็น `pending`/`approved`/`sending` (พบจากทดสอบ — push ไม่มาใน
  `NOTIFICATION_MODE=mock`)
- `applyMode = central` (§5.6) → ซ่อน "ยืนยันติดตั้ง Firmware" และ "ขอ Firmware Override"

## 10. Web (A)
- การ์ดคำขอใน Approval Center (docs/25 §3.4 — ยังไม่ได้ทำ) รองรับทั้ง 2 ชนิด: เครื่อง, Task, ผู้ขอ, Config + เวอร์ชัน
  หรือ Firmware `จาก → เป็น`, **ป้ายแดง "ถอยเวอร์ชัน"** เมื่อ `isDowngrade`
- รายการ "อนุมัติแล้ว รอช่างส่ง" พร้อมเส้นตาย · จำนวนรออนุมัติบน Dashboard
- ผลล้มเหลวแสดงข้อความ §7.2 + ลิงก์ Incident

## 11. ปิดช่องทางเดิมในโหมด central (A — `device`)
- `POST /devices/{id}/confirm-firmware-install`, `POST /devices/{id}/firmware-override` และ `.../approve` → 409
  "โหมด central ใช้คำขอส่งเข้ากล่องแทน" (mirror `apply-config` ใน docs/25 §3.8)
- คำขอ Firmware Override ที่ `approved` ค้างอยู่ (เช่นของ BOX-0001 วันที่ 26 ต.ค.) ไม่ต้องย้อนแก้ — ใช้ไม่ได้เพราะ endpoint ปิด

---

## 12. แบ่งงานและลำดับ PR

| ลำดับ | PR | เจ้าของ | ขึ้นกับ |
|---|---|---|---|
| 1 | docs/27 (ใบนี้) | B | — |
| 2 | **B1** backend: migration §4, approve→`approved`, `release`, cancel/expire ขยาย, notification `config_apply_approved`, openapi + RBAC (`Release`) — **เฉพาะ kind=config** | B | 1 |
| 3 | **A1** campaign/device/central: firmware payload ใน `createFieldApplyRollout` (§6), ข้อความ §7.2, Incident (§8), ปิดช่องทาง §11, `applyMode` §5.6 | A | 1 (ขนานกับ B1 ได้) |
| 4 | **B2** backend: เปิด kind=firmware (§5.1, release #4/#8) | B | B1 + A1 |
| 5 | **A2** Web: การ์ดอนุมัติ §10 | A | B1 (config), B2 (firmware) |
| 6 | **B3** Mobile §9 | B | B1 (config), B2 (firmware) |

ระหว่าง B1 merge แล้วแต่ A2 ยังไม่เสร็จ: อนุมัติผ่าน API ได้ (Postman) เหมือนตอนนี้

### 12.1 ที่ปรับตอน implement B1 (#381)
1. **ไม่เพิ่ม action `Release`** — ใช้ `Create` แทน (§5.4) เพราะ `ActionType` เป็น enum ทั้งระบบ เพิ่มค่าแล้วกระทบ RBAC
   ทุก resource · กลุ่มคนที่ได้สิทธิ์เท่ากันพอดี (ST/OT) และ service เช็คผู้ถือ Task อีกชั้นเหมือน cancel
2. **คอลัมน์ฝั่ง Firmware ของ §4** (`kind`, `firmwareId`, `fromFirmwareVersion`, `isDowngrade`, `configId`/`configAssignedBy`
   nullable) **ย้ายไป B2** — B1 ยังไม่ใช้ ใส่ก่อนต้องเปลี่ยน `configId` เป็น nullable ทั่วโมดูลโดยไม่จำเป็น
3. **Mobile ส่วน Config (§9 แถว `approved`/ปุ่ม "ส่งเข้ากล่อง"/poll 5 วินาที) อยู่ใน B1 เลย** — parser ของ Mobile
   throw กับสถานะที่ไม่รู้จัก ถ้า backend deploy ก่อน หน้า Task พังทันที · B3 เหลือเฉพาะส่วน Firmware และซ่อนปุ่มโหมด central

## 13. เทสที่ต้องมี
- **SoD:** ผู้ผูก Config อนุมัติเอง 403 · ผู้ขออนุมัติเอง 403 (ทั้ง 2 ชนิด)
- **release:** คนที่ไม่ได้ถือ Task 404 · Task ถูกโอนแล้วคนขอเดิม 404 · หมดอายุ → `expired` · Config มีเวอร์ชันใหม่ →
  `CONFIG_CHANGED` + `cancelled` · กล่องออฟไลน์ → 409 ยัง `approved` · Server กลางล่ม → 503 · race กดส่งพร้อมกัน 2 ครั้ง →
  สร้าง Rollout ครั้งเดียว
- **firmware:** ไม่รองรับรุ่น 409 · เวอร์ชันเดียวกับที่รัน 409 · ถอยเวอร์ชัน → `isDowngrade` + `allowDowngrade` ถูกส่ง
- **กับกล่องจริง (BOX-0001):** Config ส่งสำเร็จ · Firmware 1.2.0 → 1.3.0 สำเร็จ · ถอดปลั๊กตอนดาวน์โหลด ~30% →
  `failed` + "กล่องหลุด…" + Incident ภายใน ~80 วินาที · เสียบกลับแล้วกล่องยังเวอร์ชันเดิม ไม่ส่งซ้ำเอง
