# แผนให้ Config Override ส่งเข้ากล่องจริงผ่านคำขอส่งเข้ากล่อง (โหมด central)

> **สถานะ:** แผน — B ตัดสินมติ §2 แล้ว (27 ต.ค. 2569) · ขอ A (paveekornkwork-dev) รีวิว เพราะแตะ `device`
> (Override), `config-definition` และ Approval Center บน Web
>
> **ต่อจาก:** docs/25 (คำขอส่ง Config จากหน้างาน), docs/27 (อนุมัติแล้วช่างกดส่งเอง) · ไม่แก้มติเดิมของสองฉบับนั้น
>
> **เงื่อนไขที่ห้ามผ่อน (เหมือน docs/25/27):** คนขอกับคนอนุมัติต้องไม่ใช่คนเดียวกัน · คนอนุมัติต้องไม่ใช่ Operation ที่ผูก
> Config เข้า Task และไม่ใช่ผู้อนุมัติตัว Config · ตรวจไม่ได้ให้ปฏิเสธ (fail closed)
>
> **ที่มาของข้อมูล:** `main` ที่ `f4b4c31` + ผลส่ง Config เข้า BOX-0001 จริง 27 ต.ค. 2569 (§1.1)

---

## 1. ปัญหา

### 1.1 สิ่งที่เจอ
1. **Override ที่อนุมัติแล้วไม่ไปถึงกล่องในโหมด central** — หลัง Operation อนุมัติ แอปบอกให้ช่าง "ใส่ Config เข้าเครื่อง
   อีกครั้ง" ซึ่งหมายถึง `apply-config` ที่ docs/25 §3.8 ปิดไว้แล้วในโหมด central (ตอบ 409) ช่างไม่มีทางรู้ว่าต้องไปขอ
   ส่ง Config ตัวเดิมผ่านหน้าเลือกสิ่งที่จะส่งเข้ากล่อง และต้องรอ Operation อนุมัติ**อีกรอบ**
2. **ฝั่ง backend พร้อมอยู่แล้วครึ่งหนึ่ง** — Rollout ของคำขอส่งเข้ากล่อง merge Override ที่ approved ล่าสุดของ
   (เครื่อง, Config) ทับค่า base ก่อนส่งเข้า Server กลาง (`mergeApprovedOverride()` ใน
   `campaign-rollout.service.ts`) ที่ขาดคือ "ทาง" ที่พา Override เข้าคำขอ
3. **ค่าที่ Firmware รับไม่ได้ผ่านการอนุมัติได้** — `speed_limit.max_kmh` ใน schema ของ ESP32 (schema 2+) รับ 1–200
   แต่ `ConfigFieldDefinition` ไม่มีขอบเขตตัวเลข ค่า 500 ผ่านการอนุมัติแล้วไปล้มตอน Server กลางตรวจ
4. **ฟิลด์ที่อยากให้ช่างปรับหน้างานยังปิดอยู่** — `speed_limit.max_kmh` / `speed_limit.enabled` ตั้ง
   `stOverridable = false`

**ทดสอบจริง 27 ต.ค. 2569:** ส่ง Config ใหม่ (ระยะส่งพิกัด 20 → 15 วินาที) เข้า BOX-0001 ผ่านคำขอส่งเข้ากล่องสำเร็จ
(CMD-10069) วัดจาก telemetry ได้ 15.0–15.2 วินาที · Config นั้นจงใจ**ไม่มี** `data_server` เพราะ delivery-server
merge กับค่าเดิมในกล่อง ปลายทาง telemetry จึงไม่ถูกทับ — Override ใช้หลักเดียวกัน (ส่งเฉพาะ field ที่มีใน Config)

### 1.2 เป้าหมาย
- ช่างขอ Override ค่าหน้างาน → Operation อนุมัติ**ครั้งเดียว** → ช่างกด "ส่งเข้ากล่อง" ในหน้างาน → ผลจากกล่องจริง
- ค่าที่นอกขอบเขตที่ Firmware รับ ถูกปฏิเสธตั้งแต่ตอนกรอก ไม่ใช่ตอนส่ง

### 1.3 ไม่ใช่เป้าหมาย
- โหมด legacy/mock — Override แบบเดิม (อนุมัติแล้วกด `apply-config`) ไม่เปลี่ยน
- Firmware Override — ปิดในโหมด central แล้ว (#392) ใช้คำขอส่ง Firmware (docs/27) แทน
- นำเข้า min/max จาก schema ของ Firmware อัตโนมัติ — เป็นส่วนของ docs/26 (auto-import) ทำตามหลัง แผนนี้แค่เพิ่มช่องเก็บ

## 2. มติ (B, 27 ต.ค. 2569)

| # | คำถาม | มติ | เหตุผล |
|---|---|---|---|
| 1 | อนุมัติกี่รอบ | **รอบเดียว** — อนุมัติคำขอ = อนุมัติ Override ที่ผูกกัน | Operation เห็นค่าที่จะส่งครบในคำขอเดียว รอบที่สองไม่ได้ข้อมูลเพิ่ม แค่ทำให้ช่างรอ |
| 2 | ขอบเขตค่า | **เพิ่ม `minValue`/`maxValue` ใน `ConfigFieldDefinition`** ตรวจทุกจุดที่ใช้ `validateFields()` | กันค่าผิดตั้งแต่กรอก ไม่ใช่ไปล้มที่กล่อง |
| 3 | ฟิลด์ที่ช่างแก้ได้ | เปิด `speed_limit.max_kmh` + `speed_limit.enabled` ก่อน | max_kmh มีผลเฉพาะเมื่อ enabled · ขยายทีหลังได้ทาง Config Definition (ไม่ต้องแก้โค้ด) |

## 3. Flow (โหมด `DEVICE_CONFIG_APPLY_MODE=central`)

```
ช่าง (Mobile)                    Operation (Web)                 ระบบ / กล่อง
หน้า Override แก้ค่า + เหตุผล
  └─ POST /devices/{id}/config-override
       → DeviceConfigOverride (pending)
       → ConfigApplyRequest (pending, kind=config,
         configId = Config ปัจจุบันของเครื่อง,
         overrideId = แถวข้างบน) ในทรานแซกชันเดียวกัน
                                  Approval Center: การ์ดคำขอเดียว
                                  เห็นค่า base + ค่าที่ Override
                                  อนุมัติ → request approved
                                         + override approved
หน้างาน: "อนุมัติแล้ว กดส่งเข้ากล่องได้"
  └─ ส่งเข้ากล่อง (release เดิม)                                  Rollout merge override → Server กลาง
                                                                  → succeeded / failed (+Incident #392)
```

- **ต้องมีงาน:** คำขอผูกกับ Task เสมอ (docs/25) — ถ้าช่างเปิด Override จากหน้ากล่องโดยไม่มีงานเปิดอยู่ ให้เริ่มงานให้
  ด้วยกฎเดียวกับ `POST /tasks/start` (docs/28) · ถ้ามีงานเปิดอยู่แล้วใช้งานนั้น
- **คำขอค้างต่อเครื่อง:** ถ้าเครื่องมีคำขอที่ยังไม่จบอยู่แล้ว (`pending`/`approved`/`sending`) ปฏิเสธ Override 409
  ข้อความบอกชนิดคำขอที่ค้าง (เหมือน #393)
- **ปฏิเสธ / ยกเลิก / หมดอายุ:** ปฏิเสธคำขอ → Override เป็น `rejected` ด้วย · ช่างยกเลิกคำขอก่อนอนุมัติ → Override
  `rejected` (เหตุผล "ช่างยกเลิกคำขอ") · ยกเลิกหรือหมดอายุ**หลัง**อนุมัติ → Override คง `approved` (ค่าถูกอนุมัติแล้ว)
  และจะติดไปกับการส่ง Config ตัวนี้ครั้งถัดไป — ตรงกับพฤติกรรม merge เดิม · แสดงข้อความนี้ในการ์ดหน้างาน
- **ทางเข้าเดิม:** `POST /device-config-overrides/{id}/approve|reject` ตรงๆ ในโหมด central สำหรับ Override ที่มีคำขอผูก
  → ตอบ 409 ให้ไปตัดสินที่คำขอแทน (กันอนุมัติสองที่ไม่ตรงกัน) · Override เก่าที่ไม่มีคำขอผูก (สร้างก่อนแผนนี้) ยัง
  ตัดสินแบบเดิมได้

## 4. Data model (migration additive)

```prisma
model ConfigApplyRequest {
  // ... เดิม
  overrideId String? @unique   // Override ที่คำขอนี้พาเข้ากล่อง (null = คำขอปกติ)
  override   DeviceConfigOverride? @relation(fields: [overrideId], references: [id], onDelete: Restrict)
}

model ConfigFieldDefinition {
  // ... เดิม
  minValue Float?   // ใช้กับ integer/decimal เท่านั้น · null = ไม่จำกัด
  maxValue Float?
}
```

- ไม่ต้อง backfill (คอลัมน์ใหม่ nullable ทั้งหมด) · ไม่มี FK ใหม่บนตารางที่มีข้อมูลเดิมให้ orphan
- ตั้งค่า `speed_limit.max_kmh` = 1–200, `stOverridable = true` ทั้งสองฟิลด์ผ่าน endpoint Config Definition เดิม
  (ข้อมูล ไม่ใช่โค้ด) และใส่ใน `seed.ts` ถ้าฟิลด์นั้นมาจาก seed

## 5. API

| Endpoint | เปลี่ยนอะไร |
|---|---|
| `POST /devices/{deviceId}/config-override` | โหมด central: สร้างคำขอผูกกัน คืน Override พร้อม `applyRequestId` และ `taskId` · 409 ถ้ามีคำขอค้าง · โหมดอื่นเหมือนเดิม |
| `POST /config-apply-requests/{id}/approve` · `/reject` · `/cancel` | ถ้ามี `overrideId` อัปเดต Override ในทรานแซกชันเดียวกัน (§3) · SoD เดิมทุกข้อ (ผู้ขอ = ผู้ขอ Override) |
| `GET /config-apply-requests` · `/tasks/{taskId}/config-apply-requests` | เพิ่ม `override: { id, fields, reason } \| null` ให้การ์ดอนุมัติ/หน้างานแสดงค่าที่จะเปลี่ยน |
| `POST /device-config-overrides/{id}/approve` · `/reject` | โหมด central + มีคำขอผูก → 409 (§3) |
| Config Definition (create/update) + `validateFields()` | รับ/ตรวจ `minValue`/`maxValue` · ข้อความ "ต้องอยู่ระหว่าง 1–200 กม./ชม." |

openapi: เลขเวอร์ชันถัดจาก PR ที่ merge ก่อน (ตอนเขียน v3.67 = #394, v3.68 = #396, #395 เสนอ v3.69)

## 6. Mobile (B)
- หน้า Override: ส่งแล้วไปที่หน้างานของคำขอ (ไม่ค้างหน้าเดิม) · ข้อความหลังส่งเปลี่ยนจาก "ใส่ Config เข้าเครื่องอีกครั้ง"
  เป็น "รอ Operation อนุมัติ แล้วกดส่งเข้ากล่องจากหน้างาน" ในโหมด central
- การ์ดคำขอในหน้างาน: แสดงค่าที่ Override (`field: เดิม → ใหม่`) และเหตุผล
- ช่องกรอกตัวเลขบอกขอบเขต (เช่น "1–200 กม./ชม.") และตรวจก่อนส่ง · banner Override ค้างในหน้ากล่องใช้ข้อความโหมด central

## 7. Web (A)
- Approval Center: การ์ดคำขอที่มี `override` แสดงตารางค่าเดิม → ใหม่ + เหตุผล · ไม่แสดงการ์ด Override แยกซ้ำ
- หน้ารายละเอียด Override (#380): ในโหมด central ถ้ามีคำขอผูก ซ่อนปุ่มอนุมัติ/ปฏิเสธ และลิงก์ไปที่คำขอ
- ฟอร์ม Config Definition: ช่อง min/max สำหรับชนิดตัวเลข

## 8. แบ่งงานและลำดับ PR
1. **P1 (B, backend):** migration + Override → คำขอผูกกัน + approve/reject/cancel ผูก Override + 409 ทางเดิม + `override` ใน view
   + min/max ใน `validateFields()` และ Config Definition DTO · openapi + RBAC_Matrix (ไม่เปลี่ยนสิทธิ์)
2. **P2 (B, Mobile):** §6 — merge หลัง P1
3. **P3 (A, Web):** §7 — merge หลัง P1
4. **ข้อมูล:** เปิด `stOverridable` + ตั้ง 1–200 ให้ `speed_limit.*` หลัง P1 deploy

## 9. เทสที่ต้องมี
- unit: สร้าง Override ในโหมด central → มีคำขอผูก + ใช้งานเปิดอยู่/เริ่มงานให้ · มีคำขอค้าง → 409 · อนุมัติคำขอ → Override
  approved ในทรานแซกชันเดียวกัน · ปฏิเสธ/ยกเลิกก่อนอนุมัติ → Override rejected · ยกเลิกหลังอนุมัติ → Override คง approved
  · approve Override ตรงๆ เมื่อมีคำขอผูก → 409 · โหมด mock ไม่สร้างคำขอ · min/max: ต่ำกว่า/สูงกว่า/ขอบพอดี/ไม่ใช่ตัวเลข
- integration: HTTP จริงครบ flow Override → approve คำขอ → release (Server กลาง mock) → fields ที่ส่งมีค่า Override
- **ทดสอบกับกล่องจริง:** BOX-0001 ตั้ง `speed_limit.max_kmh` 80 → 60 ผ่าน Override · ตรวจ `configs.BOX-0001.settings`
  ใน delivery-server และ `config_version` ที่กล่องรายงาน · `data_server` ต้องไม่เปลี่ยน (telemetry ยังเข้า)

## 10. คำถามถึง A
1. Approval Center ตอนนี้ดึงรายการ Override pending แยก — โอเคไหมที่จะซ่อน Override ที่มีคำขอผูกออกจากรายการนั้น
   (กรองฝั่ง backend ด้วย `applyRequest: null`) แทนการแก้ฝั่ง Web อย่างเดียว
2. `minValue`/`maxValue` เป็น `Float` พอไหม หรืออยากได้ `Decimal` ให้ตรงกับ `dataType: decimal`
