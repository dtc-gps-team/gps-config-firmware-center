# Proposal: config_simulator Phase 2 — เช็ค Device + Config พร้อมกัน (v2 — หลัง A review)

**จาก:** kittiphong (B) — **ถึง:** paveekornkwork-dev (A)
**เกี่ยวข้อง:** `config_simulator` (mobile, B) ⟷ module `device` (backend, A)
**สถานะปัจจุบัน:** Phase 1 merge แล้ว (PR #91) — v1 ของเอกสารนี้เสนอต่อยอด `/config/:id/simulate`, **A รีวิวแล้วขอเปลี่ยนเป็น endpoint แยก** — เอกสารนี้เป็นฉบับปรับตาม feedback ของ A

---

## 1. ปัญหา

หน้า "ทดสอบความพร้อม" (`SimulatorPage`, mobile) ตอนนี้เรียก `POST /config/:id/simulate` ซึ่งเช็ค**เฉพาะตัว config เอง** (status เป็น draft/testing ไหม, field ครบไหม) — ไม่เอา device ที่เลือกไปเช็คด้วยว่า deviceModel/protocol ตรงกับ config หรือเปล่า และไม่เช็คสัญญาณเครื่องจริงประกอบ

หมายเหตุ: device selector ที่จำกัดให้เลือกได้เฉพาะอุปกรณ์ที่ถูกมอบหมาย (ผ่าน `Task.deviceId`) ทำเสร็จแล้วใน Phase 1 — ไม่ใช่ scope ของเอกสารนี้

## 2. เหตุผลที่เปลี่ยนจาก "ต่อยอด /simulate" เป็น endpoint แยก (ตาม A)

v1 เสนอเพิ่ม `deviceId` (optional) เข้า `POST /config/:id/simulate` — A ชี้ปัญหา 3 จุดที่ทำให้แนวทางนั้นไปต่อไม่ได้:

1. **Config status ชนกัน** — `/simulate` รับแค่ `draft`/`testing` (`SIMULATABLE_CONFIG_STATUSES`, `config-status.ts`) แต่ config ที่ช่างหน้างานทดสอบก่อนอัพโหลดจริงจะเป็น `approved`/`synced` เสมอ (ผ่านอนุมัติมาแล้ว) → ต่อยอด `/simulate` ก็ยังโดน 409 ทุกครั้ง เคยบันทึกไว้แล้วใน `docs/architecture/RBAC_Matrix.md` Section 6 ตอนรีวิว Stage 3
2. **RBAC แบบมีเงื่อนไขใน service เลี่ยง pattern ทีม** — CLAUDE.md (Auth Pattern) ใช้ `@RequirePermission` ที่ระดับ endpoint ทั้งหมด การเช็ค "ถ้ามี `deviceId` ต้องมีสิทธิ์เพิ่ม" ต้องย้าย logic ไปอยู่ใน service ซึ่งไม่ตรง pattern ที่ทีมยึดอยู่
3. **Response shape เดิมเป็น schema ร่วม Web+Mobile** — `SimulationResult { passed, details }` ใช้ร่วมกันใน openapi ระหว่าง Web (Config Editor dry-run) กับ Mobile — เปลี่ยนเป็น nested จะกระทบฝั่ง Web

## 3. Endpoint ใหม่

```
POST /devices/{deviceId}/simulate-config
Body (required): { "configId": "..." }
```

อยู่ใน `device.module` (ไม่ใช่ `config.module`) — mirror `apply-config` ทุกจุด:

- **RBAC**: `@RequirePermission('device-connection-test', ActionType.Read)` — reuse permission เดิม (ST/OT เท่านั้น) ไม่ต้อง seed เพิ่ม
- **Precondition** (mirror `applyConfig`, `device.service.ts:86-114`):
  - `device.status === 'installed'` (`TESTABLE_DEVICE_STATUS`) — ไม่งั้น 409
  - `config.status` ∈ `APPLICABLE_CONFIG_STATUSES` (`approved`/`synced`, `config-applier.ts`) — ไม่งั้น 409
  - `config.deviceModel === device.deviceModel && config.protocol === device.protocol` — ไม่งั้น 409 (compatibility check)
- **สัญญาณอุปกรณ์**: reuse `DEVICE_CONNECTION_TESTER` DI token ตัวเดิม (`device-connection-tester.ts`) — โหมด mock/real คุมด้วย `DEVICE_CONNECTION_TEST_MODE` เดิม ไม่ต้องเพิ่ม env ใหม่

### หมายเหตุ UX ที่ A ชี้ไว้

ถ้า Task เป็นงาน "ติดตั้งครั้งแรก" device จะยังสถานะ `registered` (ยังไม่ `installed`) → endpoint นี้ตอบ 409 จนกว่าจะทำ Device Registration เสร็จก่อน — เป็นพฤติกรรมที่ถูกต้องตามเงื่อนไข แต่ฝั่ง Mobile ต้องมีข้อความรองรับเคสนี้โดยเฉพาะ (ไม่ใช่ error กลางๆ) — **TODO ฝั่ง B ตอน implement มือถือ**

## 4. Response shape

Schema ใหม่เฉพาะ endpoint นี้ — **ไม่แตะ `SimulationResult` เดิม** (กันกระทบ Web):

```jsonc
{
  "passed": false,   // true เมื่อ configCheck && compatibilityCheck && connectionCheck ผ่านทั้งหมด
  "configCheck":        { "passed": true,  "details": ["..."] },
  "compatibilityCheck": { "passed": false, "details": ["deviceModel เครื่อง (GT06L) ไม่ตรงกับ config (GT06N)"] },
  "connectionCheck":    { "passed": true, "signalStrength": -65, "details": ["..."], "testedAt": "2026-09-07T10:00:00Z" }
}
```

- ทั้ง 3 ส่วนไม่เป็น `null` เลย — endpoint นี้ `deviceId` (path) และ `configId` (body) บังคับส่งเสมอ ไม่มีเคส partial เหมือน v1
- `connectionCheck` ยึด shape เดียวกับ `DeviceConnectionTestResult` เดิมทุก field (`signalStrength`, `testedAt`) — ต่างจาก `configCheck`/`compatibilityCheck` ที่มีแค่ `passed`/`details`

## 5. สรุปคำตอบ 3 คำถามเปิดจาก v1 (A ตอบแล้ว)

| คำถาม v1 | คำตอบ |
|---|---|
| RBAC แบบมีเงื่อนไข vs endpoint แยก | **endpoint แยก** — เหตุผลข้อ 2 |
| Response shape ok ไหม | **nested ok แต่เป็น schema ใหม่ของ endpoint นี้เท่านั้น** ไม่แก้ `SimulationResult` เดิม |
| reuse `device-connection-tester.ts` หรือแยกใหม่ | **reuse ทั้ง `DeviceConnectionTester` DI และ compatibility-check logic จาก `device.service.ts`** ไม่ implement ซ้ำ |

## 6. Next step

1. B ปรับ implementation ตามเอกสารนี้ (endpoint แยก + precondition + response shape ข้างต้น)
2. เพิ่ม entry `POST /devices/{deviceId}/simulate-config` ใน `docs/api/openapi.yaml` (mirror โครงของ `/devices/{deviceId}/apply-config` ที่มีอยู่แล้ว — parameters, 200/400/401/403/404/409, schema ใหม่)
3. เปิด PR ให้ A รีวิว/approve อีกรอบก่อน merge

---
*ปรับโดย B ตาม feedback ของ A บนคอมเมนต์ PR (07/09/2026) — v1 (ต่อยอด `/simulate`) ถูกแทนที่ด้วยเอกสารนี้ทั้งหมด*
