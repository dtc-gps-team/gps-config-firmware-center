# 07 — config-sync-writer: ข้อเสนอ + วาระประชุม #32

> เสนอโดย: paveekornk (A) — 2026-09-04
> สถานะ: **เอกสารเตรียมประชุม ยังไม่ได้เขียนโค้ดจริง** — เป็นงานร่วม A + B
> ตาม `02_GPS_Development_Plan.md` แถวที่ 9 (Sprint 2) ต้องคุยกันก่อนเริ่ม (issue #32)
>
> **ขอบเขตงาน A+B = `ConfigSyncWriter` interface + `mock` implementation เท่านั้น**
> โหมด `docker` / `production` เขียนไว้ในเอกสารนี้เพื่อให้ interface ออกแบบมารองรับได้
> ตั้งแต่ต้น — ตัว implementation จริงเป็นงาน handoff (ต้องรอ TBD คำสั่งเขียน + สิทธิ์ +
> เครื่องทดสอบของ DTC + ไฟเขียวจากทีม) ไม่อยู่ในขอบเขตงานฝึกงาน

---

## 1. โมดูลนี้ทำอะไร

`config-sync-writer` มีหน้าที่เดียว: **เขียน Config / Firmware pointer ที่ผ่านการอนุมัติแล้ว
เข้า "data กลาง" ของระบบเดิม** (`config.dtc.co.th:909`)

กล่อง GPS ไปดึงค่าจาก data กลางนี้เองตอนเปิดเครื่อง แล้วอัปเดตตัวเองถ้าพบว่าเก่ากว่า
(เป็นพฤติกรรม firmware ของกล่อง ไม่ใช่สิ่งที่ระบบเราสร้าง — Build Reference §1)
**ระบบเราไม่กระตุ้นกล่อง ไม่คุยกับกล่องโดยตรง** หน้าที่จบแค่ "เขียนเข้า data กลางให้ถูกและทันเวลา"

เป็นจุดเชื่อมสุดท้ายที่ทำให้ระบบมีผลกับโลกจริง — ถ้าไม่มีตัวนี้ Config ที่สร้าง/อนุมัติทั้งหมด
ก็อยู่แค่ในฐานข้อมูลเรา ไม่ไปถึงกล่อง

---

## 2. ขอบเขต: อะไรเป็นงาน A+B / อะไรเป็น handoff

| ส่วน | งาน A+B (ขอบเขตงานฝึกงาน) | handoff (คนที่ทำต่อ) |
|---|---|---|
| `ConfigSyncWriter` interface | ✅ | |
| โหมด `mock` (เขียน log แทนการยิงจริง) | ✅ | |
| เชื่อม "Operation อนุมัติ → เรียก writer เป็น background job" | ✅ | |
| retry logic + สร้าง Incident อัตโนมัติเมื่อ fail (ทดสอบด้วย mock) | ✅ | |
| โหมด `docker` (ยิง TCP เข้า `127.0.0.1:801`) | ออกแบบ interface ให้รองรับ | implementation — ต้องรู้คำสั่งเขียน (TBD) + มีเครื่องทดสอบของ DTC |
| โหมด `production` (ยิงเข้า `config.dtc.co.th:909`) | ออกแบบ interface ให้รองรับ | implementation — คำสั่งเขียน + สิทธิ์ + **คำสั่งเริ่มจากทีม** (ชะลอไว้ v3.4) |

**หมายเหตุ:** Checkpoint Sprint 2 เขียนว่า *"เห็น Log การเขียนเข้าระบบเดิม (โหมด mock และ
docker)"* แต่ในทางปฏิบัติ docker ก็ทำไม่ได้จนกว่าจะรู้คำสั่งเขียน + มีเครื่องทดสอบ `:801`
ของ DTC (เป็น infra ของทีม ไม่ใช่สิ่งที่เด็กฝึกงาน spin เอง และงานฝึกงานนี้ไม่แตะการทดสอบ
กับ hardware/ระบบเดิม) — แผนอนุญาตให้ผ่านเฉพาะ mock ได้
(`02_GPS_Development_Plan.md` §หมายเหตุแถวที่ 9) → **ผลตรวจ Sprint 2 = mock ผ่าน,
docker/production เปิด backlog แยก**

---

## 3. Interface ที่เสนอ

ยึดตาม Build Reference §4.1 เพิ่มรายละเอียดพารามิเตอร์:

```typescript
// backend/src/config-sync-writer/config-sync-writer.interface.ts

/** ข้อมูลที่ writer ต้องใช้ประกอบคำสั่งเขียน 1 กล่อง */
export interface LegacyConfigWrite {
  /** เลขระบุกล่องในระบบเดิม — Device.simNumber (ICCID) เว้นแต่ทีมยืนยันเป็นอย่างอื่น */
  deviceIdentifier: string;
  deviceModel: string;
  protocol: string;
  /** ค่าที่จะเขียน — Config.fields (key = ชื่อ field ตามระบบเดิม) */
  fields: Record<string, string | number>;
  /** เวอร์ชันที่อนุมัติ — ไว้ log / ตรวจสอบย้อนหลัง */
  configId: string;
  versionNumber: number;
}

export interface ConfigSyncWriter {
  writeConfigToLegacySystem(input: LegacyConfigWrite): Promise<void>;
  writeFirmwarePointerToLegacySystem(input: LegacyFirmwareWrite): Promise<void>;
}

export const CONFIG_SYNC_WRITER = Symbol('CONFIG_SYNC_WRITER');
```

- DI token เป็น `Symbol` + property-function type (ไม่ใช่ method shorthand) เพื่อเลี่ยง
  `@typescript-eslint/unbound-method` — pattern เดียวกับ `MockDeviceSimulator` /
  `MockDeviceConnectionTester` / `MockConfigApplier`
- โยน error ถ้าเขียนไม่สำเร็จ (ให้ชั้น background job จับไป retry / สร้าง Incident)

---

## 4. สามโหมด (env `LEGACY_SYNC_MODE`)

> **A+B สร้างแค่ `mock` · `docker`/`production` เขียนไว้เพื่อให้ interface รองรับ
> ไม่ได้อยู่ในขอบเขตงานนี้** (§2) — ตารางนี้ให้เห็นภาพรวมว่า implementation ที่ทำต่อ
> ทีหลังจะเสียบเข้าที่ตรงไหน

| โหมด | พฤติกรรม | ใช้เมื่อ |
|---|---|---|
| `mock` (default) | เขียน log `[mock] จะเขียน APN1=... ให้ <sim> เข้า config.dtc.co.th:909` — ไม่ยิง TCP | dev / demo / เทสต์ flow |
| `docker` | เปิด TCP ไป `LEGACY_SYSTEM_HOST:LEGACY_SYSTEM_PORT` (127.0.0.1:801) ส่งคำสั่งจริง | ยืนยันว่าเขียนถูกก่อนแตะ production |
| `production` | ยิงเข้า `config.dtc.co.th:909` | ห้ามใช้จนกว่าจะยืนยันคำสั่ง + สิทธิ์ + ได้ไฟเขียวจากทีม |

`docker` / `production` ที่ยังไม่ implement ให้ **throw ตอน startup** (pattern เดียวกับ
`DEVICE_SIMULATOR_MODE=real` / `DEVICE_CONFIG_APPLY_MODE=real`) — ไม่ fail เงียบ

env ที่เกี่ยวข้อง (มีใน `.env.example` แล้ว): `LEGACY_SYNC_MODE`, `LEGACY_SYSTEM_HOST`,
`LEGACY_SYSTEM_PORT`

---

## 5. Trigger: เขียนเมื่อไหร่

```
Operation กด approve
  └─ ConfigService.approve() — ใน $transaction เดิม:
       ├─ เปลี่ยน status -> approved
       └─ เขียน ConfigVersion snapshot (มีแล้ว, PR #70)
  └─ หลัง transaction commit: enqueue background job "sync config <id> v<n>"
       └─ job เรียก configSyncWriter.writeConfigToLegacySystem(...)
```

- **ไม่เขียนใน transaction เดียวกับ approve** — การอนุมัติต้องสำเร็จแม้ระบบเดิมล่ม
  (สถานะเป็น `approved` ก่อน แล้วค่อย sync แยก)
- Config มีสถานะ `synced` อยู่แล้วใน enum — เสนอ: เปลี่ยน `approved` -> `synced`
  เมื่อ writer สำเร็จ (ยังไม่ทำใน Phase 1 — Build Reference / doc 04 ระบุว่า `synced` เป็น Phase 2)
- background job runner: เสนอใช้ **BullMQ + Redis** (มี Redis ใน docker-compose แล้ว)
  หรือถ้าจะเบากว่านั้นในช่วง mock ใช้ in-process queue ก่อนก็ได้ — **หัวข้อประชุม**

---

## 6. Retry + Incident + Alert (สัญญาระหว่าง A ↔ B)

```
writer throw (TCP timeout / ระบบเดิมตอบ error)
  └─ retry N ครั้ง (เสนอ N=3, backoff แบบ exponential)
       └─ ยังพัง:
            ├─ [A] incident module สร้าง Incident อัตโนมัติ
            │      { source: 'config-sync-writer', configId, versionNumber,
            │        deviceIdentifier, reason, attempts, lastError }
            └─ [B] notification: ยิง alert ให้ Operation
                   (ใช้ NotificationType ที่มี — เสนอเพิ่ม 'sync_failed')
```

**จุดที่ A กับ B ต้องตกลงก่อนเขียนโค้ด:**

1. **รูปแบบข้อมูล Incident** ที่ A ส่งให้ B — Incident มาได้ 2 ทาง:
   `config-sync-writer` (ฝั่ง A) และ Mobile Simulator Test (ฝั่ง B, Phase 5)
   → ต้องเป็น shape เดียวกัน
2. **NotificationType ใหม่** สำหรับ sync failure (`sync_failed`?) — ต้องเพิ่มใน
   Prisma enum + `openapi.yaml` + Mobile `NotificationType` พร้อมกัน
3. retry อยู่ชั้นไหน — ใน writer เอง หรือใน background job runner

---

## 7. แบ่งงาน A / B (เฉพาะส่วนที่เป็นงาน A+B ตาม §2)

| ส่วน | คนหลัก | เหตุผล |
|---|---|---|
| `ConfigSyncWriter` interface + mock impl + unit test | **ร่วมกัน** (pair / review ด้วยกัน) | critical infra — CLAUDE.md ห้ามแก้เดี่ยว |
| เชื่อม `ConfigService.approve()` → enqueue job | **A** | `config` module ของ A |
| background job runner setup | **ร่วมกัน** | กระทบทั้งระบบ |
| retry policy | **ร่วมกัน** | |
| Incident อัตโนมัติเมื่อ fail | **A** | `incident` module ของ A |
| Alert เข้า notification + NotificationType ใหม่ | **B** | `notification` module ของ B |
| `writeFirmwarePointerToLegacySystem()` | **A** | `firmware` module ของ A (Phase 3) |
| docker / production impl | **handoff** | รอ TBD + ไฟเขียวทีม |

---

## 8. Checklist ส่งมอบ — ข้อมูลที่ "คนทำ docker/production ต่อ" ต้องขอจากทีม

> ⚠️ **ส่วนนี้ไม่ใช่งานของ A+B** — เป็นรายการคำถามที่ต้องเอาไปถามทีม/พี่ที่ดูแลระบบเดิม
> ก่อนจะเริ่มเขียน implementation จริง (โหมด docker/production) · A+B ไม่ต้องทำอะไร
> เพื่อ "รองรับ" ข้อพวกนี้ — รายละเอียดโปรโตคอลทั้งหมดอยู่**ข้างในตัว implementation
> จริง** ที่คนอื่นเขียนทีหลัง ซ่อนหลัง `ConfigSyncWriter` interface (§3) · หน้าที่ A+B
> คือทำ interface ให้ส่งข้อมูลผ่านครบ (SIM / fields / model / protocol — มีแล้วใน
> `LegacyConfigWrite`) แล้วก็จบ
>
> แนบลิสต์นี้ไปกับรายงานฝึกงานในหัวข้อ "สิ่งที่ต้องดำเนินการต่อเพื่อขึ้นระบบจริง"

**คำสั่งเขียน (บล็อก docker + production)**
1. คำสั่ง Write/Set หน้าตาจริง 1 ตัวอย่าง (เทียบกับคำสั่งอ่าน `##A,V=940,S=...$` ที่มีแล้ว)
2. เขียนทีละ field หรือหลาย field ในคำสั่งเดียว / ต้องส่งครบ 262 field ทุกครั้งไหม
3. ตัวระบุกล่องในคำสั่งเขียน — SIM (ICCID) หรือ Device ID / IMEI
4. ระบบเดิมตอบ ack ยังไงเมื่อสำเร็จ / error (คำสั่งอ่านตอบ `#A,V=...!oKoK`)
5. timeout ที่เหมาะสม

**ก่อนเปิด production**
6. เขียนเข้าระบบเดิมต้องขอสิทธิ์/ล็อกอินก่อนไหม — ถ้าใช่ ขอ credential + วิธีเก็บปลอดภัย
7. ระบบเดิมรับ connection พร้อมกันได้กี่ตัว / มี rate limit ไหม (กระทบการ sync หลายกล่องพร้อมกัน)
8. มีเครื่องทดสอบ Local/Docker (`127.0.0.1:801`) ให้เชื่อมจริงไหม

**รายการ field (บล็อก #68 — คนละเรื่อง แต่ค้างเหมือนกัน)**
9. เอกสารรายการ Config field ทั้ง ~262 ตัว (ชื่อ, ชนิด, จำเป็น/ไม่, ช่วงค่า)

---

## 9. วาระประชุม #32

1. Interface `ConfigSyncWriter` — ตกลง shape (§3)
2. background job runner — BullMQ+Redis หรือ in-process ช่วง mock (§5)
3. เปลี่ยน `approved` → `synced` เมื่อ sync สำเร็จ ทำใน scope นี้เลยไหม (§5)
4. retry policy — ชั้นไหน, N ครั้ง, backoff (§6)
5. **รูปแบบข้อมูล Incident ที่ใช้ร่วมกัน** A↔B (§6 ข้อ 1) — สำคัญสุด
6. NotificationType ใหม่สำหรับ sync failure (§6 ข้อ 2)
7. ความสัมพันธ์กับ `POST /devices/{deviceId}/apply-config` (#81) — apply-config เป็น
   fire-and-forget mock ต่อกล่องเดียว, config-sync-writer เป็น batch เข้า data กลาง
   → เขียนซ้ำหน้าที่กันไหม / คนละเลเยอร์
8. ใครเริ่มเขียน mock impl ก่อน + timeline

---

## 10. อ้างอิง

- `01_GPS_Build_Reference.md` §1, §4.1, §5 (โปรโตคอลระบบเดิม), §8 (รายการ TBD)
- `02_GPS_Development_Plan.md` แถวที่ 9 + §หมายเหตุแถวที่ 9
- `03_GPS_Detailed_Build_Steps.md` Phase 2 (Checkpoint) + Phase 3 ข้อ 3 (firmware pointer) + Phase 4 ข้อ 1 (rollback เรียก writer)
- `docs/04_Phase1_A_ConfigWorkflow.md` (สถานะ `synced` = Phase 2)
- issue #32 (นัดประชุม), #28 (Incident & Rollback), #68 (field catalog backfill)
