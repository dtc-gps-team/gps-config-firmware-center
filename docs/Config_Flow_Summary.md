# หลักการทำงาน: สร้างพารามิเตอร์ → สร้าง Config → ส่งเข้ากล่อง GPS

> สรุปจากโค้ดบน `main` ล่าสุด (`5f20a112`, 12 พ.ย. 2569) และระบบ Server กลาง `arduino_gps` (delivery-server + ws-gateway + firmware ESP32)
> เดิมทำไว้อธิบายให้พี่เลี้ยง ใช้เป็นภาพรวมสำหรับทีมที่พัฒนาต่อได้ · โหมดที่อธิบายคือโหมดใช้งานจริงกับกล่อง (`central`)

---

## 1. แนวคิดหลัก: 3 ชั้นที่ต้องแยกให้ออก

| ชั้น | คืออะไร | ใครเป็นเจ้าของ | ตัวอย่าง |
|---|---|---|---|
| **Firmware** | โปรแกรมในกล่อง กำหนดว่ากล่อง "ทำอะไรได้" | FirmwareEngineer อัปโหลด, QAEngineer อนุมัติ | 1.2.9 รองรับ GPS + ตรวจความเร็วเกิน |
| **Parameter (Schema)** | รายการค่าที่ปรับได้ใน Firmware นั้น พร้อมชนิดและกฎ | มาจาก Firmware แต่ละเวอร์ชัน → เก็บในระบบเราเป็น **Parameter Library** | `gps.send_interval_sec` จำนวนเต็ม 5–3600 |
| **Config** | ชุดค่าจริงที่จะตั้งให้กล่อง | ConfigEngineer สร้าง, Operation อนุมัติ | `gps.send_interval_sec = 20` |

**ประโยคเดียวที่ใช้อธิบาย:** Firmware บอกว่ามีปุ่มอะไรให้ปรับ (Parameter) ส่วน Config คือการตั้งค่าปุ่มเหล่านั้น
และระบบจะไม่ยอมส่งค่าของปุ่มที่ Firmware ในกล่องไม่มี

---

## 2. ส่วนประกอบของระบบ

```
 ┌──────────────┐   ┌──────────────┐
 │ Web (Next.js)│   │ Mobile       │
 │ สร้าง/อนุมัติ    │   │ ช่างหน้างาน    │
 └──────┬───────┘   └──────┬───────┘
        │   REST /api/v1   │
        ▼                  ▼
 ┌─────────────────────────────────┐
 │ Backend ของเรา (NestJS + Postgres)│  เก็บ Parameter Library, Config, คำขอ, Rollout, Audit
 └──────────────┬──────────────────┘
                │ REST (login ด้วย token)
                ▼
 ┌─────────────────────────────────┐
 │ Server กลาง (arduino_gps)          │
 │  - delivery-server: ทะเบียนกล่อง,    │  เก็บ schema ต่อรุ่น/เวอร์ชัน, เก็บ Config ที่ต้องการ
 │    schema, desired config, firmware │  (desired) ของแต่ละกล่อง, ไฟล์ firmware
 │  - ws-gateway: WebSocket กับกล่อง    │  ส่งคำสั่ง + รับสถานะ real-time
 └──────────────┬──────────────────┘
                │ WebSocket (กล่องต่อออกมาเอง) + HTTPS ดาวน์โหลด
                ▼
 ┌─────────────────────────────────┐
 │ กล่อง GPS (ESP32, BOX-0001)        │  ตรวจซ้ำ, บันทึกลง NVS, รายงานผล
 └─────────────────────────────────┘
```

- Backend ของเรา **ไม่คุยกับกล่องตรงๆ** ส่งผ่าน Server กลางเสมอ
- กล่องเป็นฝ่ายเปิด WebSocket ออกไปหา Server กลาง (ไม่ต้องเปิดพอร์ตรับบนกล่อง) และส่ง HELLO บอก
  `firmware_version`, `schema_version`, `config_version` ของตัวเอง
- ข้อมูล GPS ที่กล่องส่ง (Data Plane) แยกเส้นทางกับงานตั้งค่า (Management Plane)

---

## 3. ขั้นที่ 1: สร้างพารามิเตอร์ (Parameter Library)

ตาราง `ConfigFieldDefinition` คือคลังพารามิเตอร์ แต่ละตัวมี:

- `fieldName` (เช่น `gps.send_interval_sec`) ชื่อเดียวกับที่ Server กลางรับ
- `dataType` (`string` / `integer` / `decimal` / `boolean`), `allowedValues` (ตัวเลือก enum)
- `minValue` / `maxValue`, `defaultValue`, `unit`, `category`, `required`, `sensitive`
- `supportedModels` (ตาราง `ConfigFieldDefinitionModelSupport`) ผูกว่าใช้กับ **รุ่นอุปกรณ์ + โปรโตคอล** ใด

**เข้าคลังได้ 2 ทาง**

1. **นำเข้าจาก schema ของ Firmware (ทางหลักสำหรับกล่อง ESP32)**
   - Firmware ทุกไฟล์ฝังป้าย `@@FWVER:1.2.0;SCHEMA:3;MODEL:ESP32-DEVKIT-V1@@` และ Server กลางมีไฟล์ schema ของแต่ละเวอร์ชัน
   - backend ดึง `GET /api/admin/schemas/{model}/{version}` แล้วแปลงชนิด
     (`boolean→boolean`, `integer→integer`, `number→decimal`, `enum/string/hostname→string + allowedValues`)
     ด้วย `central-schema-import.ts`
   - **ปัจจุบันสั่งด้วยสคริปต์** `npm run import:central-schema` · แผนให้นำเข้าเองตอน QA อนุมัติ Firmware
     (docs/26) ยังไม่ได้ทำ
2. **ConfigEngineer สร้างเองบนเว็บ** (`POST /config-definitions`) ไม่ต้องอนุมัติ เพราะพารามิเตอร์ที่ผิดจะถูกจับตอนสร้าง
   Config และตอนทดสอบ/อนุมัติอยู่แล้ว · แก้ได้ทุกอย่างยกเว้นชื่อ · ลบได้เฉพาะตัวที่ไม่มี Config ใช้อยู่

---

## 4. ขั้นที่ 2: สร้าง Config และอนุมัติ

```
ConfigEngineer สร้าง (ฟอร์ม หรือ import JSON)          Operation
   draft ──[ทดสอบ simulate]──[decide: ผ่าน]──► testing ──[approve]──► approved
                                                       └─[reject]───► rejected
```

| ขั้น | เกิดอะไร |
|---|---|
| **สร้าง** `POST /config` | เลือกรุ่นอุปกรณ์ + โปรโตคอล แล้วกรอกค่า เก็บเป็น JSON แบน `{ "gps.send_interval_sec": "20", ... }` · backend ตรวจทุก field กับ Parameter Library: ต้องมีในคลัง, รองรับรุ่น/โปรโตคอลนี้, ชนิดถูก, อยู่ในตัวเลือก, อยู่ในช่วง min/max · ไม่ผ่าน = ปฏิเสธทันที (ไม่มีโหมดเตือนเฉยๆ) · สถานะ `draft` |
| **ทดสอบ** `POST /config/{id}/simulate` | ตรวจด้วย Device Simulator (ยังเป็น mock ตรวจกฎทั่วไป เช่น ต้องมีค่าอย่างน้อย 1 ตัว, interval/timeout ห้ามติดลบ) · ไม่เปลี่ยนสถานะ กดซ้ำได้ · ส่วนการเทียบกับกล่องจริงอยู่ที่ "ทดสอบรายเครื่อง" `POST /devices/{id}/simulate-config` ซึ่งตรวจกับ schema ของ Firmware ที่ **กล่องรายงานว่ารันอยู่** + เช็คสัญญาณกล่อง โดยไม่ส่งจริง |
| **ตัดสินผลทดสอบ** `POST /config/{id}/decide` | ConfigEngineer ปักว่าผ่าน → `testing` (เลือก Operation ที่อยากให้ดูได้ แต่ไม่ผูกมัด) |
| **อนุมัติ** `POST /config/{id}/approve` | **Operation เท่านั้น** (Separation of Duty: คนสร้างอนุมัติงานตัวเองไม่ได้) → `approved` และบันทึก **ConfigVersion** (snapshot ค่า ณ ตอนอนุมัติ, เลขเวอร์ชัน 1, 2, 3...) ในทรานแซกชันเดียวกัน |

- หลังพ้น `draft` แก้ค่าไม่ได้ ถ้าจะเปลี่ยนต้องสร้างหรือโคลนเป็น Config ใหม่ ค่าที่อนุมัติจึงเป็นค่าที่ผ่านการทดสอบจริง
- ทุกการกระทำที่เปลี่ยนข้อมูลลง `AuditLog`

---

## 5. ขั้นที่ 3: สั่งส่งเข้ากล่อง (2 ช่องทาง)

### 5.1 ช่างหน้างานผ่าน Mobile (คำขอส่งเข้ากล่อง, `ConfigApplyRequest`)

```
ช่างเลือกของที่จะส่ง ─┬─ Config ที่อนุมัติแล้ว ไม่แก้ค่า ───────────────► approved ทันที (direct)
                    ├─ Config + แก้ค่าเฉพาะเครื่อง (Override) ─► pending ─► Operation อนุมัติ ─► approved
                    └─ Firmware ─────────────────────────────► pending ─► Operation อนุมัติ ─► approved
                                                                                         │
ช่างกด "ส่งเข้ากล่อง" (release) ◄─────────────────────────────────────────────────────────┘
   └─► sending ─► succeeded / failed / skipped_offline
```

กติกาสำคัญ:

- คำขอผูกกับ **งาน (Task)** เสมอ และคนกดส่งต้องเป็นช่างที่ถืองานอยู่ตอนนั้น
- 1 เครื่องมีคำขอที่ยังไม่จบได้ทีละ 1 รายการ (`pending` / `approved` / `sending`)
- คำขอและคำอนุมัติมีอายุ **24 ชม.** เกินแล้ว `expired`
- ถ้าหลังอนุมัติ Config มีเวอร์ชันใหม่หรือ Firmware ถูกถอนอนุมัติ กดส่งไม่ได้ ต้องขอใหม่
- กล่องออฟไลน์ตอนกดส่ง ตอบ 409 ทันที คำขอยังเป็น `approved` ให้ลองใหม่ได้
- **ค่าที่แก้เฉพาะเครื่อง (Override) ใช้ครั้งเดียว:** มีผลเฉพาะการส่งครั้งนั้น ส่ง Config เดิมซ้ำโดยไม่แก้ กล่องได้ค่าต้นฉบับ
  ถ้าต้องการค่าพิเศษถาวรให้สร้าง Config แยก
- Operation ที่อนุมัติต้องไม่ใช่ผู้ขอ และไม่ใช่ผู้อนุมัติตัว Config (SoD ระดับคน)

### 5.2 Operation ผ่าน Web (Campaign / Rollout)

- ใช้ส่ง Config หรือ Firmware ให้ **กลุ่มเครื่อง** ทีละชุด (Pilot / Canary / Batch) ต้องอนุมัติ Rollout ก่อนปล่อย
- ใส่ค่าเฉพาะเครื่องได้ หยุดชั่วคราวได้ (Pause) และย้อนกลับได้ (rollback)

**เบื้องหลังทั้งสองช่องทางใช้กลไกเดียวกัน:** คำขอจาก Mobile ตอน release จะสร้าง Rollout เครื่องเดียวภายใต้
Campaign ของระบบ แล้ววิ่งผ่านโค้ดส่งชุดเดียวกับ Campaign ปกติ

---

## 6. ขั้นที่ 4: จาก backend ไปถึงกล่อง (หัวใจของการส่ง)

```
Backend                         Server กลาง                          กล่อง ESP32
  │ 1. ถามกล่องรัน schema ไหน      │                                     │
  │──GET schemas/{model}/{ver}──►│                                     │
  │ 2. แปลง + ตรวจค่ากับ schema     │                                     │
  │ 3. PUT devices/{id}/config ─►│ 4. สร้าง config_version ใหม่           │
  │◄──── command_id ─────────────│    + คำสั่ง UPDATE_CONFIG            │
  │                              │──WS: COMMAND (target_version=N)───►│ 5. ACKNOWLEDGED
  │                              │◄─GET /api/device/me/config─────────│ 6. ดาวน์โหลดค่า
  │                              │                                     │ 7. ตรวจเวอร์ชัน/schema/ค่า
  │                              │                                     │ 8. บันทึกลง NVS (เก็บค่าเดิมไว้ด้วย)
  │                              │◄─COMMAND_STATUS: SUCCESS/FAILED────│ 9. รายงานผล
  │ 10. poll ทุก 4 วินาที            │                                     │
  │──GET jobs/{command_id}──────►│                                     │
  │ 11. สรุปผล + แจ้งเตือน            │                                     │
```

รายละเอียดแต่ละจุด:

1. **ใช้ schema ที่กล่องรายงานว่ารันอยู่จริง** ไม่ใช่ schema ที่คาดว่าจะเป็น (กันส่งค่าของ Firmware ใหม่ให้กล่องที่ยังเป็นรุ่นเก่า)
2. **แปลงรูปแบบ** (`buildCentralSettings()`): จากคีย์แบน + ค่าเป็นข้อความ
   `{ "gps.send_interval_sec": "20" }` เป็นโครงซ้อน + ชนิดจริง `{ "gps": { "send_interval_sec": 20 } }`
   ถ้ามีคีย์ที่ schema ไม่มี หรือค่าที่แปลงชนิดไม่ได้ **ไม่ส่งเลยทั้งชุด** (ไม่ส่งครึ่งๆ กลางๆ) พร้อมเหตุผลทุกข้อ
3. **`PUT /api/admin/devices/{id}/config`**: Server กลางตรวจช่วงค่าอีกชั้น (เขาเป็นเจ้าของกฎ) สร้าง `config_version` ใหม่
   และคำสั่ง `UPDATE_CONFIG` คืน `command_id` กลับมา backend เก็บไว้ที่ target ของ Rollout
4. กล่องออนไลน์ → ส่งคำสั่งทันทีทาง WebSocket · ออฟไลน์ → Server กลางเก็บคิวไว้ (มี TTL)
5. – 8. **กล่องตรวจซ้ำเองก่อนใช้** (`doConfigUpdate()` ใน firmware):
   - `config_version` ที่ดาวน์โหลดได้ต้องตรงกับคำสั่ง ไม่ตรง = `CONFIG_VERSION_MISMATCH`
   - schema ของ Config ต้องไม่ใหม่กว่าที่ Firmware รองรับ = `SCHEMA_NOT_SUPPORTED`
   - ค่าทุกตัวต้องผ่าน `parseSettings()` ไม่ผ่าน = `UNSUPPORTED_PARAMETER:<key>` / `INVALID_VALUE:<key>`
   - ผ่าน → ใช้ค่าใหม่ทันที และบันทึกลง NVS **พร้อมเก็บค่าก่อนหน้า (known-good)** ไว้ ถ้าค่าที่เก็บอ่านไม่ได้ตอนบูต
     กล่องกลับไปใช้ค่าก่อนหน้า
9. **ผลต้องมาจากกล่องเท่านั้น** ห้ามถือว่าสำเร็จเพียงเพราะส่งคำสั่งออกไปได้
10. backend มี job poll สถานะคำสั่งทุก 4 วินาที แปลงผลเป็น `succeeded` / `failed` / `skipped` (กล่องออฟไลน์จนคำสั่งหมดอายุ)
11. บันทึก `AuditLog` (`apply-config`) · ส่ง push แจ้งช่าง · ถ้าล้มเหลวจริงเปิด **Incident** และแจ้ง Operation

**Firmware ใช้เส้นทางเดียวกัน** ต่างที่ backend ส่งไฟล์ `.bin` (`pushFirmware`) และกล่องต้องดาวน์โหลด, ตรวจ SHA-256
และลายเซ็น ECDSA, เขียน OTA partition, รีบูต และผ่าน health-check หลังบูตก่อนจะนับว่าสำเร็จ ถ้าไม่ผ่านกล่องย้อนกลับ
Firmware เดิมเอง (`ROLLED_BACK`)

---

## 7. ส่งไม่สำเร็จ: ระบบลองใหม่เอง

- ใช้กับคำขอจากหน้างานเสมอ และ Campaign ที่เปิดสวิตช์ `autoRetry`
- **สูงสุด 3 รอบ เว้น 20 วินาทีเท่ากันทุกรอบ** ส่ง "ของชุดเดิม" ไม่ต้องขออนุมัติใหม่ รอบไหนสำเร็จก็จบทันที
- ลองใหม่เฉพาะปัญหาที่น่าจะชั่วคราว: กล่องหลุด, ไม่ตอบ, ดาวน์โหลดค้าง, Firmware ย้อนกลับ, กล่องออฟไลน์, ติดต่อ Server กลางไม่ได้
- **ไม่ลองใหม่** เมื่อส่งกี่ครั้งก็ผิดเหมือนเดิม: พารามิเตอร์ไม่รองรับ, ค่าไม่ถูกต้อง, schema ไม่รองรับ, Firmware ผิดรุ่น,
  ลายเซ็นไม่ถูก (จบตั้งแต่รอบแรกพร้อมเหตุผลภาษาไทย)
- กันส่งซ้ำซ้อนด้วย claim + lease ต่อเครื่อง ถ้า backend ดับกลางทาง รอบ poll ถัดไปหยิบต่อเอง
- ทุกรอบเก็บประวัติแยก (`CampaignRolloutTargetAttempt`) ช่างเห็นในแอปว่ารอบไหนล้มเพราะอะไร

---

## 8. ด่านตรวจค่าหลายชั้น (ทำไมค่าผิดหลุดไปถึงกล่องยาก)

| ชั้น | ตรวจอะไร |
|---|---|
| 1. ฟอร์มบนเว็บ/แอป | ชนิด, ตัวเลือก, ช่วงค่า ตาม Parameter Library |
| 2. Backend ตอนสร้าง/แก้ Config | field ต้องมีในคลัง + รองรับรุ่น/โปรโตคอล + ชนิด + ช่วงค่า (hard block) |
| 3. ทดสอบ | simulate ของ Config (กฎทั่วไป) + ทดสอบรายเครื่อง (เทียบกับ schema ที่กล่องรันจริง ไม่ส่งจริง) |
| 4. คนอนุมัติ | Operation อนุมัติ Config, คำขอที่แก้ค่า, และ Firmware (SoD) |
| 5. Backend ตอนส่ง | แปลงกับ schema ที่กล่องรายงานล่าสุด ไม่ผ่าน = ไม่ส่งทั้งชุด |
| 6. Server กลาง | ตรวจช่วงค่าตาม schema ของเขา |
| 7. กล่อง | ตรวจเวอร์ชัน, schema, ค่าทุกตัวอีกรอบ และเก็บค่าเดิมไว้ย้อนกลับ |

---

## 9. ใครทำอะไร (Role)

| ขั้นตอน | Role |
|---|---|
| อัปโหลด Firmware | FirmwareEngineer |
| อนุมัติคุณภาพ Firmware | QAEngineer |
| สร้าง/แก้พารามิเตอร์, สร้าง Config, ทดสอบ, ตัดสินผลทดสอบ | ConfigEngineer |
| อนุมัติ Config, อนุมัติคำขอส่งเข้ากล่อง, อนุมัติ Rollout | **Operation เท่านั้น** (Admin/SuperAdmin ก็อนุมัติแทนไม่ได้) |
| ขอส่งและกดส่งเข้ากล่องหน้างาน | ST / OT (ช่างที่ถืองาน) |
| ดูย้อนหลัง | Auditor (อ่านอย่างเดียว) |

---

## 10. ข้อจำกัดที่รู้อยู่และสิ่งที่ยังไม่ได้ทำ

- การนำ schema ของ Firmware ใหม่เข้า Parameter Library ยังสั่งด้วยสคริปต์ (แผนอัตโนมัติ docs/26 ยังไม่ทำ)
- Config ที่มีพารามิเตอร์ของ Firmware ใหม่ ส่งให้กล่องที่ยังเป็น Firmware เก่าไม่ได้ (ถูกปฏิเสธพร้อมเหตุผล) ต้องอัปเกรด Firmware ก่อน
- กล่องที่ใช้จริงในโปรเจกต์คือ ESP32 ต้นแบบ (BOX-0001) · รุ่นเดิมของบริษัท (GT06 / ระบบ legacy) ยังเป็น mock (`config-sync-writer`)
- พารามิเตอร์ชุดสำหรับ GT06 ใน seed เป็นชุดตัวแทน ยังไม่ใช่สเปกจริงของบริษัท
- กล่องหลุดนานกว่าราว 40 วินาทีจะใช้ครบ 3 รอบก่อนกลับมา ช่างต้องกด "ส่งใหม่อีกครั้ง" เอง

---

## 11. คำถามที่พี่เลี้ยงน่าจะถาม

**ถ้าช่างแก้ค่าผิดหน้างาน จะเกิดอะไร?**
ค่านอกช่วงถูกปฏิเสธตั้งแต่กรอก และค่าที่แก้ต้องรอ Operation อนุมัติก่อนส่ง · ค่าที่แก้ใช้ครั้งเดียว ไม่ติดค้างกับ Config ต้นฉบับ

**ส่งไปแล้วรู้ได้ยังไงว่ากล่องรับจริง?**
นับสำเร็จเมื่อกล่องรายงาน `SUCCESS` กลับมาเท่านั้น (กล่องเช็ค `config_version` ตรงและบันทึกลง NVS แล้ว) ไม่ใช่แค่ส่งคำสั่งออกได้

**กล่องออฟไลน์ล่ะ?**
ตอนกดส่งจะบอกทันที (409) · ถ้าหลุดระหว่างทาง Server กลางเก็บคิวไว้ หรือหลุดเกิน 60 วินาทีนับเป็นล้มเหลวแล้วระบบลองใหม่เอง

**ทำไมไม่ให้ Admin อนุมัติแทน Operation?**
Separation of Duty: คนที่มีสิทธิ์จัดการระบบไม่ควรเป็นคนอนุมัติค่าที่ลงอุปกรณ์จริง และคนสร้างอนุมัติงานตัวเองไม่ได้

**ย้อนกลับได้ไหม?**
Config ทุกเวอร์ชันที่อนุมัติมี snapshot ใน `ConfigVersion` · Firmware มี OTA rollback ในกล่อง และ Rollout ของ Campaign สั่ง rollback ได้

---

## อ้างอิงในโค้ด/เอกสาร

| เรื่อง | ที่อยู่ |
|---|---|
| Parameter Library | `backend/src/config-definition/`, `backend/src/central-device/central-schema-import.ts` |
| Config + อนุมัติ + เวอร์ชัน | `backend/src/config/config.service.ts`, `docs/04_Phase1_A_ConfigWorkflow.md` |
| คำขอส่งเข้ากล่อง | `backend/src/config-apply-request/`, `docs/25`, `docs/27`, `docs/30` |
| ส่งให้ Server กลาง + แปลงค่า | `backend/src/central-device/central-device.service.ts` (`pushConfig`), `central-config.ts` (`buildCentralSettings`) |
| Rollout / poll / ลองใหม่ | `backend/src/campaign/campaign-rollout.service.ts`, `central-rollout-poll.service.ts`, `docs/31` |
| ฝั่งกล่อง | `arduino_gps/firmware/esp32_gps_box/mgmt.h` (`doConfigUpdate`), `device_config.h` (NVS) |
| สเปก Server กลาง | `arduino_gps/ESP32_Central_Device_Management_Spec.md` |
| สิทธิ์ | `docs/architecture/RBAC_Matrix.md`, `docs/api/openapi.yaml` |
