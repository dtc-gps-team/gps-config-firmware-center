# ข้อเสนอออกแบบ Device Sync — อุปกรณ์ดึง Config/Firmware ตรงจาก Backend

> เอกสารนี้สรุปรวมข้อเสนอที่ A ตอบไว้ใน [issue #157](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/157)
> แบบ async ทีละ comment (2026-09-15 ถึง 2026-09-17) ให้เป็นเอกสารเดียว พร้อมออกแบบเพิ่มในส่วนที่
> วาระประชุมยังไม่เคยพูดถึง (แบ่งงานเอกสาร, Timeline/ลำดับ PR, ร่าง endpoint contract จริง) —
> เป้าหมายคือให้ kittiphong (B) รีวิวแนวทางทั้งหมดในที่เดียวผ่าน PR แทนการคุยกันเป็น comment
> ต่อเนื่องเรื่อยๆ ตาม pattern เดียวกับ `docs/13_Role_Redesign_Proposal.md` — ยัง**ไม่ใช่มติสุดท้าย**
> จนกว่า B จะรีวิวและเห็นด้วย (โดยเฉพาะเรื่อง Auth ที่ A เองเคย flag ไว้ว่าควรผ่านพี่เลี้ยงก่อน)

---

## 1. ที่มา

Issue #157 (kittiphong, 2026-09-15): พี่เลี้ยงยืนยันว่า **อุปกรณ์ GPS จะดึง/อัปเดต Config และ
Firmware ตรงจาก Backend เอง ไม่ผ่าน Legacy System (`config.dtc.co.th`) อีกต่อไป** — ของเดิม
อุปกรณ์คุยกับ Legacy System เท่านั้น (Backend เขียนค่าที่อนุมัติแล้วเข้า Legacy ผ่าน
`config-sync-writer` — ดู `docs/07_ConfigSyncWriter_Proposal.md`) ของใหม่ตัด Legacy ออกจาก flow
นี้ทั้งหมด

kittiphong ตั้งวาระคุย 5 ข้อ (comment 2026-09-17T02:22): sync mechanism, auth, ชะตากรรม
`config-sync-writer`, เอกสารที่ต้องอัปเดต, และ timeline — เอกสารนี้ตอบครบทั้ง 5 ข้อ (3 ข้อแรก
เคยตอบใน issue ไปแล้ว คัดลอกมาพร้อมเหตุผลเต็มๆ ในข้อ 3, 2 ข้อหลังเป็นข้อเสนอใหม่ในข้อ 4-5)

---

## 2. คำถามที่ตอบได้แล้วโดยไม่ต้องรอใคร — Legacy System ไม่มีอะไรอื่นต้อง sync

ก่อนเริ่ม A เคยถามค้างไว้ว่า Legacy System ยังมีอย่างอื่น (เช่น Customer/Device master data) ที่
ต้อง sync อยู่ไหม ก่อนจะเสนอ deprecate `config-sync-writer` เต็มตัว — เช็คโค้ด/เอกสารออกแบบ
ตัวเองแล้วตอบได้เลยว่า **ไม่มี**: interface `ConfigSyncWriter` (`docs/07` §3,
`docs/planning/01_GPS_Build_Reference.md`) มีแค่ 2 เมธอดตั้งแต่ต้น —
`writeConfigToLegacySystem()` และ `writeFirmwarePointerToLegacySystem()` — ไม่เคยมี method
สำหรับ Customer/Device master data เลยสักจุด และ Customer data ที่มีในระบบตอนนี้ก็ยืนยันแล้ว
(docs/12 เฟส B) ว่าเป็น mock data ที่ A สร้างเอง ไม่เคยดึงจาก Legacy จริง

**สรุป:** ปิดคำถามนี้ได้เลย ไม่ใช่ open question อีกต่อไป

---

## 3. คำตอบ 3 ข้อแรกของวาระ (โพสต์ไว้ใน issue แล้ว คัดมาพร้อมเหตุผล)

### 3.1 Sync mechanism — เริ่มที่ pull ก่อน

ออกแบบ interface กลาง (`DeviceSyncChannel` — ดูข้อ 6) ให้รองรับได้ทั้ง pull และ push แต่
**implement แค่ pull ในรอบแรก**

**เหตุผล:** pull สร้างและเทสได้จริงตอนนี้เลยโดยจำลองอุปกรณ์ยิง request เข้ามา (integration test
ปกติ ไม่ต้องมีฮาร์ดแวร์จริง) ตรงกับที่ `docs/planning/01_GPS_Build_Reference.md` §4.2 เขียนไว้
อยู่แล้วว่า "กล่องเช็ค Config ของตัวเองตอนเปิดเครื่องครั้งถัดไป" — พฤติกรรม pull-on-boot นี้เป็น
design เดิมที่มีอยู่แล้ว ไม่ใช่แนวคิดใหม่ ส่วน push (Backend ยิงเข้าไปหาอุปกรณ์ทันทีตอนอนุมัติ)
เก็บไว้เป็นแค่ interface ที่ยังไม่มี implementation จริง — ต่อยอดทีหลังได้โดยไม่ต้องรื้อโครงสร้าง
เพราะ caller (`ConfigService`/`FirmwareService`) จะเรียกผ่าน interface เดียวกันเสมอ

### 3.2 Auth — API key ต่อเครื่อง

**เสนอ:** API key ต่ออุปกรณ์ 1 ตัว (`Device.apiKeyHash`) แนบผ่าน header (เช่น
`X-Device-Api-Key`) แยก guard ใหม่ `DeviceApiKeyGuard` คนละตัวกับ `JwtAuthGuard` เดิม (คนละ
actor type — อุปกรณ์ ไม่ใช่ staff ที่มี username/password/role)

**เหตุผล:** ระบุตัวตน + ยืนยันสิทธิ์ได้ครบ ไม่ผูกกับ protocol เดียว ใช้ได้ทั้งตอนเป็น pull
(แนบ header ทุก request) และถ้าต่อยอดเป็น push ทีหลัง (แนบตอน connect/handshake) ก็ใช้กลไก
เดียวกันต่อเนื่องได้โดยไม่ต้องคิดระบบ auth ใหม่อีกรอบ

**⚠️ ยังไม่ใช่มติสุดท้าย** — นี่คือจุดที่ A เคย flag ไว้ตั้งแต่ comment แรกว่าเป็นการออกแบบ
security ระดับ production สำหรับอุปกรณ์จริงหลายพันตัว ซึ่งเกินขอบเขตงานฝึกงานที่ตกลงกันไว้แต่
แรก (ดู `internship-scope-mock-only` — production integration เป็นส่วนที่พี่เลี้ยงต่อยอดเอง) —
สิ่งที่ทำได้ในรอบนี้คือ**ออกแบบ interface ให้รองรับ** (guard แยกต่างหาก, ไม่ผูกกับ JWT) ส่วน
**implementation จริง (การ generate/แจกจ่าย/หมุนเวียน API key ให้อุปกรณ์จริงหลายพันตัว ต้องรอ
พี่เลี้ยง sign-off ก่อนเริ่ม** — รายละเอียดที่ยังไม่ได้คิด: จะ generate key ตอนไหน (ตอน
`registerDevice`? มี endpoint แยกต่างหาก?), เก็บ/ส่ง key ให้ทีมช่างหน้างานยังไง, หมุนเวียน/เพิกถอน
ได้ไหมถ้า key หลุด

### 3.3 `config-sync-writer` — deprecate ทันที ไม่ทำ transition period

**เสนอ:** ตัด `config-sync-writer` ออกจาก flow หลักทันทีตอน endpoint ใหม่ (pull) พร้อมใช้งาน —
ไม่ทำช่วง transition ที่เขียนเข้าทั้ง Legacy System (dual-write) พร้อมกับรองรับอุปกรณ์คุยตรง

**เหตุผล:** ไม่มีกล่องจริงในสนามให้ทดสอบ dual-write ได้เลยตอนนี้ — ถ้าทำ dual-write จะเพิ่มความ
ซับซ้อนของโค้ด (ต้องดูแล 2 เส้นทางพร้อมกัน) แต่ไม่มีทางพิสูจน์ได้จริงว่าทำงานถูกต้องทั้งคู่ สู้ทำ
เส้นทางเดียวที่สะอาดและเทสผ่านครบดีกว่า — `LEGACY_SYNC_MODE` (mock/docker/production) ที่มีอยู่
แล้วเป็นจุดต่อขยายในตัว ถ้าวันหน้ามีเหตุผลต้องกลับมาทำ dual-write จริงก็เพิ่มได้โดยไม่ต้องรื้อ
โครงเดิม — **ไม่ลบโค้ด `config-sync-writer` ทิ้ง** เก็บไว้เป็น reference/mock mode เดิม แค่ไม่ผูก
กับ flow หลักของ Config/Firmware อีกต่อไป

---

## 4. เอกสารที่ต้องอัปเดต + แบ่งงาน (ข้อเสนอใหม่ — วาระข้อ 4 ที่ยังไม่เคยคุย)

| เอกสาร | ใครแก้ | เหตุผล |
|---|---|---|
| `docs/planning/01_GPS_Build_Reference.md` §4.1/§4.2 | A | เจ้าของเดิมของ Section นี้ (`config-sync-writer`/device apply flow) |
| `docs/architecture/RBAC_Matrix.md` §2/§4.1 | A | resource ใหม่ (`device-sync`) + endpoint ใหม่เป็นของโมดูล `device`/`config`/`firmware` ที่ A ดูแล |
| `GPS_Module_Ownership.md` | A ร่าง แล้วให้ B ยืนยัน | เปลี่ยน scope ของ `config-sync-writer` (โมดูลร่วม → deprecated) กระทบทั้งคู่ |
| Diagram สถาปัตยกรรม (`docs/architecture/diagrams/`) | B (ตามที่เกริ่นไว้ในคอมเมนต์แรกว่าจะแนบไฟล์ `.drawio`) แล้ว A รวมกับ ER diagram ที่ทำไว้แล้ว | B เป็นคนเริ่มอัปเดต diagram นี้ไว้ก่อนแล้วตามที่บอกใน issue |
| `docs/planning/02_GPS_Development_Plan.md` (Sprint Checklist) | A | เพิ่มแถวงานใหม่ตาม PR breakdown ข้อ 5 |

**หมายเหตุ:** diagram ที่ B บอกจะแนบเข้า comment ถัดไปยังไม่มาจริง (เช็คแล้วทั้ง issue และ
`docs/architecture/diagrams/` มีแค่ `er-diagram.drawio` คนละไฟล์) — รบกวนแนบก่อนเริ่ม PR แรกด้วย
จะได้เทียบกับโครงที่ A ทำไว้แล้วให้ตรงกัน

---

## 5. Timeline / แบ่ง PR (ข้อเสนอใหม่ — วาระข้อ 5 ที่ยังไม่เคยคุย)

เสนอแบ่งเป็น **3 PR ต่อเนื่อง** (mirror pattern 3-PR ของ Role Redesign ที่เพิ่งทำสำเร็จ) แทนที่
จะทำทีเดียวก้อนใหญ่:

1. **PR 1 — Schema + `DeviceApiKeyGuard` (interface เปล่า)**: เพิ่ม `Device.apiKeyHash`, guard
   ใหม่ที่ verify key แต่ยังไม่ผูกกับ endpoint ไหน + unit test ของ guard เอง — ปลดล็อกให้ทำ PR 2
   ได้โดยไม่ต้องรอ auth mechanism ตัวจริงชัดเจน 100% ก่อน (ยังแก้ทีหลังได้ถ้าพี่เลี้ยงเปลี่ยนใจ)
2. **PR 2 — `GET /devices/{deviceId}/config`, `GET /devices/{deviceId}/firmware`**: endpoint
   pull จริง ผูก `DeviceApiKeyGuard` จาก PR 1 (ดู contract ร่างในข้อ 6) — เจ้าของ A (โมดูล
   `config`/`firmware`)
3. **PR 3 — status-report endpoint + ตัด `config-sync-writer` ออกจาก flow หลัก**:
   `POST /devices/{deviceId}/sync-status` (อุปกรณ์รายงานผล apply กลับ) + ปิด
   `LEGACY_SYNC_MODE` default (ไม่เรียก `configSyncWriter` อัตโนมัติหลัง approve อีกต่อไป) — ทำ
   เป็น PR สุดท้ายเพราะเป็น breaking change ต่อ flow `ConfigService.approve()` เดิม อยากให้ 2 PR
   แรกเสถียรก่อน

**ใครทำอะไร:** ทั้ง 3 PR อยู่ในโมดูล `config`/`firmware`/`device` ของ A ทั้งหมด (B ไม่เคยแตะ) — B
มีส่วนแค่รีวิว + อัปเดต diagram ตามข้อ 4 ไม่มีงาน implementation ฝั่ง B ในชุดนี้ ตรงกับที่ยืนยัน
กันไว้แล้วว่าโมดูลนี้เป็นของ A ล้วน (เหมือน `customer` หลัง PR #153)

---

## 6. ร่าง Endpoint Contract (ยังไม่เคยเขียนไว้ที่ไหน — ร่างขึ้นใหม่ให้ B เห็นภาพรูปธรรม)

```ts
// PR 1 — DI token/interface กลาง มิเรอร์ ConfigApplier/DeviceSimulator ที่มีอยู่แล้ว
export interface DeviceSyncChannel {
  pullConfig: (deviceId: string) => Promise<DeviceConfigPayload | null>;
  pullFirmware: (deviceId: string) => Promise<DeviceFirmwarePayload | null>;
  reportStatus: (deviceId: string, report: DeviceSyncReport) => Promise<void>;
  // push เป็น placeholder ยังไม่ implement — ดูข้อ 3.1
}
```

**`GET /devices/{deviceId}/config`** (resource ใหม่ `device-sync`, `DeviceApiKeyGuard`)
- คืน Config ล่าสุดที่ `approved`/`synced` ของอุปกรณ์นี้ (mirror `APPLICABLE_CONFIG_STATUSES`
  จาก `config-applier.ts` ที่มีอยู่แล้ว) — `null`/404 ถ้าไม่มี Config ผูกกับอุปกรณ์นี้เลย
- response: `{ configId, version, fields, deviceModel, protocol }` (ตัด field ที่อุปกรณ์ไม่ต้อง
  รู้ เช่น `createdBy`/`approvedBy` ออก — mirror `UserSummary` ที่ตัด sensitive field)

**`GET /devices/{deviceId}/firmware`**
- คืน Firmware ล่าสุดที่ `uploadStatus: stored` **และ** `approvalStatus: approved` (ใช้เงื่อนไข
  เดียวกับที่ Campaign ใช้เช็คตอนนี้ — ดู `firmware-status.ts`) ที่รองรับ `deviceModel` ของ
  อุปกรณ์นี้
- response: `{ firmwareId, version, objectKey }` — อุปกรณ์เอา `objectKey` ไปโหลดไฟล์จริงจาก
  Object Storage เอง (ไม่ proxy ไฟล์ผ่าน endpoint นี้)

**`POST /devices/{deviceId}/sync-status`**
- body: `{ type: 'config' | 'firmware', targetId: string, result: 'success' | 'failed', detail?: string }`
- สำเร็จ → อัปเดต `Device`/`Task` ที่เกี่ยวข้อง (รายละเอียด schema เพิ่มยังไม่ลง เพราะเกี่ยวกับ
  `deviceUpdateStatus`/Campaign Monitor ที่ยังเป็น open question แยกอีกเรื่อง)
- ล้มเหลว → สร้าง `Incident` (mirror ที่ `config-sync-writer-queue.service.ts` ทำตอนนี้ — ย้าย
  logic การสร้าง Incident จากจุดนั้นมาที่นี่แทน)

---

## 7. คำถามเปิดที่ยังไม่ได้ตอบในเอกสารนี้

- **ความสัมพันธ์กับปุ่ม "ยืนยันส่ง Config เข้าเครื่อง" (`applyConfigToDevice`) ที่ ST/OT กดบน
  Mobile ตอนนี้** — ถ้าอุปกรณ์ pull เอง (§4.2 ของ Build Reference) แล้วปุ่มนี้ยังจำเป็นอยู่ไหม
  หรือกลายเป็นคนละ flow กัน (ช่างกดยืนยันว่า "ติดตั้งกล่องเสร็จแล้ว" ส่วนกล่อง pull config เองตอน
  boot ครั้งถัดไปแยกกันไปเลย)? ยังไม่เคยคุยประเด็นนี้กับ B เลย
- Campaign Monitor's real Failure Rate (ดูคำถามที่คุยกันก่อนหน้านี้) จะต่อกับ
  `POST /devices/{deviceId}/sync-status` นี้โดยตรงไหม หรือเป็นงานแยกทีหลัง
- รายละเอียด API key lifecycle (generate/rotate/revoke) — รอพี่เลี้ยง

---

*เอกสารนี้เป็นข้อเสนอสรุปจาก async comment ใน issue #157 + งานออกแบบเพิ่มของ A เอง (เทียบกับ
`docs/07_ConfigSyncWriter_Proposal.md` และ `docs/planning/01_GPS_Build_Reference.md` §4) — ยังไม่
ได้รับการยืนยันจาก kittiphong หรือพี่เลี้ยงในหัวข้อ Auth (§3.2) รอรีวิว PR นี้ก่อนเริ่ม
implementation จริงตามลำดับ PR ในข้อ 5*
