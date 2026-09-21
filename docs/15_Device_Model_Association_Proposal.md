# ข้อเสนอออกแบบ Device–Model Association — ผูกอุปกรณ์เข้ากับรุ่นสินค้า

> **สถานะปัจจุบัน (อัปเดต 2026-09-21):** เปิดเป็น PR #196 — เนื้อหาทั้งหมดในเอกสารนี้ (ความสัมพันธ์
> 1 Device : 1 Model, use case ทั้งหมดในหัวข้อ 4, entity `DeviceModel`) **เป็นมติที่ kittiphong
> ทวนและยืนยันแล้วจริง** และ**คำถามเปิดทั้ง 8 ข้อในหัวข้อ 6 ปิดครบแล้ว** (Paveekorn ตอบครบใน PR
> comment, kittiphong เห็นด้วยทุกข้อ — ดู "มติ" ต่อท้ายแต่ละข้อในหัวข้อ 6) **พร้อม implement**
>
> ไม่มีคำถามเปิดค้างอีกแล้ว — สิ่งที่แยกออกไปเป็นงานคนละ PR ตามมติ (สถานะ "ซ่อม" บน
> `DeviceLifecycleStatus`, `Incident.deviceId` FK) จะเปิดแยกต่างหากเมื่อถึงคิว ไม่ block การ
> implement `DeviceModel` ในเอกสารนี้

---

## 0. สรุปผลสำรวจโค้ดก่อนออกแบบ (สำคัญ — อ่านก่อนหัวข้ออื่น)

เช็คแล้วว่า **ระบบยังไม่มี concept "รุ่นสินค้า" (Model) เป็น entity แยกเลย** — สิ่งที่มีอยู่ตอนนี้คือ
field ชื่อ `deviceModel` เป็น **plain `String` freeform** กระจายอยู่ **4 จุดแยกกัน** ไม่มี FK เชื่อมกันเลย:

| ตาราง | field | ลักษณะ |
|---|---|---|
| `Device` | `deviceModel: String`, `protocol: String` | ค่าจริงตอนนี้เช่น `"GT06N"`, `"GT06L"`, `"GT06E"` |
| `Config` / `ConfigVersion` | `deviceModel: String`, `protocol: String` | Config หนึ่งตัวผูกกับรุ่น+โปรโตคอลเดียว |
| `Firmware` | `deviceModelCompatibility: String[]` | array ของรุ่นที่ compatible (ไม่มี protocol คู่ด้วย) |
| `ConfigFieldDefinitionModelSupport` | `deviceModel: String`, `protocol: String` | join table ผูก parameter definition เข้ากับคู่รุ่น/โปรโตคอลที่ใช้ได้ |

**ที่สำคัญกว่านั้น:** use case #1 ที่ kittiphong เลือกไว้ ("บังคับ config/firmware ให้ตรงรุ่นก่อน
sync") **มี logic implement จริงอยู่แล้ว** ใน `backend/src/campaign/campaign.service.ts` —
`assignConfigTarget`/`assignFirmwareTarget` เทียบ `device.deviceModel !== config.deviceModel`
และ `firmware.deviceModelCompatibility.includes(device.deviceModel)` ตรงๆ แบบ string comparison
(บรรทัด ~217, ~277) แล้วโยน `ConflictException` ถ้าไม่ตรง — มี unit test คุมพฤติกรรมนี้อยู่แล้วด้วย
(`campaign.service.spec.ts`)

**แก้ไข (พบเพิ่มจาก Paveekorn รีวิว PR นี้ — ตรวจสอบแล้วถูกต้อง):** pattern
`deviceModel !== / protocol !==` เดียวกันนี้ไม่ได้มีแค่ใน `CampaignService` จุดเดียว — ยังมีอยู่อีก
2 จุดที่พลาดไปตอนสำรวจรอบแรก: `backend/src/task/task.service.ts:281` และ
`backend/src/device/device.service.ts:187` (ทั้งคู่ throw `ConflictException` รูปแบบเดียวกันเป๊ะ)
รวมเป็น **3 จุด** ที่มี compatibility-check logic นี้ซ้ำกันอยู่ในระบบตอนนี้ — ไม่กระทบทิศทางการ
ออกแบบ (`DeviceModel.name` ยังต้องตรงกับ string เดิมเป๊ะเหมือนเดิม) แต่กระทบขนาดงานจริงถ้าตัดสินใจ
migrate ไปใช้ `modelId` ในอนาคต (คำถามเปิดข้อ 3) — blast radius ใหญ่กว่าที่เคยประเมินไว้

**ผลต่อการออกแบบ:** นี่ไม่ใช่การสร้าง use case ใหม่จากศูนย์ แต่เป็นการ **ใส่ registry ที่เป็นทางการ
(canonical) ครอบ string ที่กระจัดกระจายอยู่แล้ว** — ถ้าออกแบบให้ `DeviceModel.name` มีค่าตรงกับ
string เดิมทุกตัวเป๊ะ (`"GT06N"` ฯลฯ) โค้ด compatibility-check เดิมใน `CampaignService` จะยังทำงาน
ถูกต้องเหมือนเดิมโดยไม่ต้องแตะเลย แม้จะยังไม่ migrate Config/Firmware ไปใช้ FK ในรอบแรกก็ตาม —
รายละเอียดอยู่หัวข้อ 3 และ 5

**ไม่มี endpoint สร้าง Device เลย** — เช็ค `device.controller.ts` แล้วมีแค่ `GET /devices`,
`GET /devices/:deviceId`, และ 3 endpoint test/apply/simulate — **ไม่มี `POST /devices`**
อุปกรณ์ทั้งหมดตอนนี้เข้าระบบผ่าน `prisma/seed.ts` เท่านั้น ข้อมูลนี้เกี่ยวข้องเพราะ `docs/14`
(Device Sync Proposal, PR #190 — อนุมัติแล้วแต่ยังไม่ merge) มีแผนเพิ่ม `registerDevice` endpoint
ใน PR 1 ของ rollout นั้นพอดี — ดูหัวข้อ 6 (คำถามเปิด) เรื่องการประสานงานกับ PR นั้น

**ไม่เจอ PR/issue ที่ทำเรื่องนี้ค้างอยู่** — `gh issue list`/`gh pr list` ค้นคำว่า "รุ่น"/"model"
แล้วไม่มีอะไรตรงประเด็นนี้เลย (ผลที่เจอเป็นเรื่องอื่นที่บังเอิญมีคำว่า "model" ปนอยู่ เช่น Prisma
"model" keyword ทั่วไป) — **ไม่มีความเสี่ยงชนกับงานใคร**

`DeviceLifecycleStatus` enum ปัจจุบันมีแค่ `registered | installed | decommissioned` — **ไม่มี
สถานะ "ซ่อม" เลย** ทั้งที่ kittiphong พูดถึง "พร้อมใช้/ซ่อม/เลิกใช้" ตอนอธิบาย use case inventory —
ถือเป็น gap ที่เจอระหว่างสำรวจ ใส่เป็นคำถามเปิดไว้หัวข้อ 6 ไม่ได้ตัดสินใจเพิ่ม enum เอง

ไม่พบการพูดถึงแนวคิดนี้ใน `docs/planning/01_GPS_Build_Reference.md`, `02_GPS_Development_Plan.md`,
หรือ `docs/14_Device_Sync_Proposal.md` เลยเช่นกัน — เป็นพื้นที่ design ใหม่ทั้งหมด

**เพิ่มเติม (พบจาก Paveekorn รีวิว หลัง `GPS_Config_Firmware_Center_Design.pdf` merge เข้า repo
ผ่าน PR #194) — ตรวจสอบ PDF จริงแล้วด้วย `pdftotext` (หน้า 4-5, 13) ยืนยันตรงตามที่อ้างทุกประการ:**
เอกสารต้นฉบับจากพี่เลี้ยง §4.1-4.2 ออกแบบ "รุ่นอุปกรณ์" เป็นลำดับชั้น **4 ระดับแยก entity กันจริง**
— `Manufacturer → Product Family → Product Model → Hardware Revision → Firmware Branch` — และ
§14.1 (โครงสร้างฐานข้อมูล) ยืนยันว่าแต่ละระดับเป็นตารางแยกจริง (`manufacturers`,
`product_families`, `product_models`, `hardware_revisions`)

ปัจจุบัน `Device.deviceModel` เป็นแค่ string เดียวแบนราบมาตั้งแต่สร้าง `Device` model (PR #38) —
**ไม่มี comment อธิบาย deviation จากต้นฉบับนี้เลยสักบรรทัด** ต่างจาก `Config.name` ที่มี comment
ชัดเจนเรื่อง deviation จาก Data Dictionary — เข้าข่ายขัดกับ convention "Deviation จาก Data
Dictionary" ใน CLAUDE.md (ห้ามเบี่ยงแบบเงียบๆ โดยไม่มี comment อธิบาย) เพิ่ม comment แก้จุดนี้แล้ว
ในหัวข้อ 3 (schema snippet ของ `Device.deviceModel`)

**มุมมองสำคัญ:** ข้อเสนอ `DeviceModel` ในเอกสารนี้ไม่ได้เบี่ยงออกจากต้นฉบับเพิ่ม แต่เป็นก้าวที่พา
ระบบเข้าใกล้ต้นฉบับมากขึ้น (ยังย่อกว่าอยู่ — รวม 4 ระดับเป็น entity เดียว ไม่แยกเป็น 4 ตารางตาม
ต้นฉบับ) การย่อนี้ยังไม่ได้ตัดสินใจเปลี่ยนกลับไปแยก 4 ระดับในรอบนี้ — เก็บไว้เป็นข้อพิจารณาถ้าจะทำ
ให้ตรงต้นฉบับเป๊ะในอนาคต ไม่ใช่ scope ของ PR นี้

---

## 1. บริบท / ปัญหา

อุปกรณ์ GPS แต่ละเครื่องมี "รุ่น" (เช่น GT06N, GT06L, GT06E) ที่กำหนดว่า:
- Config/Firmware ชุดไหนใช้ได้กับเครื่องนั้น (protocol, field ที่รองรับ, compatibility)
- อุปกรณ์รุ่นนั้นมีอยู่กี่เครื่อง สถานะอะไรบ้าง (สำหรับวางแผน stock/จัดซื้อ/ซ่อม)
- ต้อง filter/report แยกตามรุ่นได้ (เช่น "อุปกรณ์รุ่น GT06N ทั้งหมดที่ยัง offline")

ปัจจุบันค่า "รุ่น" เป็นแค่ string อิสระที่พิมพ์ซ้ำๆ กันในหลายตาราง (ดูหัวข้อ 0) — ไม่มีที่เดียวที่
เป็น source of truth ว่า "รุ่นอะไรมีอยู่จริงในระบบบ้าง" ผลคือ:
- พิมพ์ผิด/สะกดต่างกันได้ (`"GT06N"` vs `"GT06n"` vs `"gt06n"`) โดยไม่มีอะไรเตือน — ตอนนี้กันด้วย
  dropdown ที่ derive จากข้อมูลที่มีอยู่แล้วเท่านั้น (เช่น `config-wizard.tsx` ดึงรายชื่อรุ่นจาก
  `ConfigFieldDefinitionModelSupport` ที่มีอยู่ ไม่ใช่จาก registry จริง) ถ้ายังไม่เคยมี Config
  ของรุ่นนั้นมาก่อน จะไม่มีที่มาของชื่อรุ่นให้เลือกเลย
- ไม่มีที่เก็บ metadata ของรุ่น (ผู้ผลิต, hardware version, สถานะ discontinued ฯลฯ)
- ไม่มีทางนับ/รายงาน inventory แยกตามรุ่นได้ตรงๆ ต้อง group by string เอาเอง

ข้อเสนอ: เพิ่ม entity ใหม่เก็บ "รุ่นสินค้า" อย่างเป็นทางการ แล้วผูก `Device` เข้ากับ entity นี้
ด้วย FK

---

## 2. ความสัมพันธ์ (Relationship)

**1 Device : 1 Model** ตามที่ kittiphong ยืนยันไว้ — อุปกรณ์หนึ่งเครื่องมีรุ่นเดียวตลอดอายุการ
ใช้งาน ไม่ใช่ many-to-many และเบื้องต้นไม่รองรับเปลี่ยนรุ่นภายหลัง

ระหว่างสำรวจโค้ดไม่เจอ use case ที่ระบบต้อง "เปลี่ยนรุ่นของอุปกรณ์ที่มีอยู่แล้ว" ตรงๆ — แต่เจอ
สถานการณ์ที่อาจต้องคิดเผื่อ: **RMA / เปลี่ยนฮาร์ดแวร์คืนที่เดิม** (เครื่องเดิมเสีย ส่งเคลม ได้เครื่อง
ทดแทนกลับมาคนละรุ่น แต่ `deviceId`/`simNumber` เดิมยังผูกกับลูกค้า/site เดิม) — เป็นแค่ความเป็นไปได้
ที่ยังไม่เจอหลักฐานในโค้ด/เอกสารว่าเคยเกิดขึ้นจริงหรือระบบรองรับอยู่แล้วในแง่ไหน จึงใส่เป็น
**คำถามเปิด** (หัวข้อ 6) ไม่ตัดสินใจเองว่าต้องรองรับหรือไม่

---

## 3. Data Model

เสนอชื่อ entity ว่า **`DeviceModel`** แทนที่จะใช้ชื่อ `Model` เฉยๆ — เหตุผล: `Model` เป็นคำทั่วไป
เกินไปในบริบท Prisma (`model` เป็น keyword ของภาษา schema เอง) และในโค้ด TypeScript ทั่วไป ชื่อ
`DeviceModel` สื่อความหมายชัดเจนกว่าและไม่ชนกับอะไร (ปรับชื่อได้ถ้า kittiphong อยากได้ชื่ออื่น)

```prisma
enum DeviceModelStatus {
  active        // ยังผลิต/สั่งซื้อได้ปกติ
  discontinued  // เลิกผลิตแล้ว แต่เครื่องที่ใช้งานอยู่ยังทำงานได้ตามปกติ
}

// ดู deviation comment เหนือ Device.deviceModel (ด้านล่าง) เรื่องความสัมพันธ์กับลำดับชั้น
// 4 ระดับใน GPS_Config_Firmware_Center_Design.pdf §4.1-4.2/§14.1 — entity นี้คือก้าวย่อ
// เข้าใกล้ต้นฉบับ ไม่ใช่การเบี่ยงเพิ่ม
model DeviceModel {
  id                 String            @id @default(uuid())
  // ค่าต้องตรงกับ string เดิมที่ใช้อยู่แล้วทุกจุดเป๊ะ (เช่น "GT06N") — ดูหัวข้อ 5
  // เรื่อง migration/backfill
  name               String            @unique
  manufacturer       String?
  hardwareVersion    String?
  // โปรโตคอลที่รุ่นนี้รองรับได้ — เก็บเป็น array เพราะ 1 รุ่นอาจรองรับได้มากกว่า 1
  // โปรโตคอล (Config ผูก protocol แยกต่างหากต่อ Config หนึ่งตัวอยู่แล้ว ไม่ได้ผูก
  // ตายตัวกับ DeviceModel — field นี้ไว้ใช้ตอน validate ว่า protocol ที่เลือกตอน
  // สร้าง Config ทำได้จริงกับรุ่นนี้ไหมเท่านั้น)
  supportedProtocols String[]
  status             DeviceModelStatus @default(active)
  // Warranty/lifecycle ต่อรุ่น (ดูหัวข้อ 4.6) — structured field แทนการพักไว้ใน
  // `notes` แบบข้อความอิสระ ทั้งคู่ optional เพราะรุ่นเก่าที่ backfill เข้ามาตอน
  // migration (หัวข้อ 5) ส่วนใหญ่ไม่มีข้อมูลนี้ให้กรอกจริง
  warrantyMonths     Int?
  endOfSupportDate   DateTime?
  notes              String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  devices Device[]
}
```

แก้ `Device`:

```prisma
model Device {
  id           String                @id @default(uuid())
  deviceId     String                @unique
  simNumber    String
  // เก็บไว้ก่อนช่วง transition (ดูหัวข้อ 5) — เป้าหมายสุดท้ายคือ deprecate แล้วอ่าน
  // ชื่อรุ่นผ่าน `model.name` แทน แต่ตอนนี้โค้ดอื่น (CampaignService, ConfigWizard
  // ฯลฯ) ยังอ้าง field นี้ตรงๆ เยอะ — ย้ายทีเดียวเสี่ยงเกินไป
  //
  // Deviation จาก GPS_Config_Firmware_Center_Design.pdf §4.1-4.2/§14.1 (เอกสารต้นฉบับ
  // พี่เลี้ยง — merge เข้า repo แล้วใน PR #194): ต้นฉบับออกแบบ "รุ่นอุปกรณ์" เป็นลำดับชั้น
  // 4 ระดับแยก entity กันจริง (Manufacturer → Product Family → Product Model →
  // Hardware Revision → Firmware Branch, แยกตาราง manufacturers/product_families/
  // product_models/hardware_revisions ตาม §14.1) — field นี้เป็น string เดียวแบนราบมา
  // ตั้งแต่ PR #38 (สร้าง Device model) ไม่เคยมี comment อธิบาย deviation นี้มาก่อนจนกว่า
  // Paveekorn รีวิว PR #196 (docs/15) นี้จะชี้ให้เห็น (2026-09-21) — DeviceModel ที่เสนอใน
  // เอกสารนี้เป็นก้าวที่พาเข้าใกล้ต้นฉบับมากขึ้น (ยังรวม 4 ระดับเป็น entity เดียว ไม่แยกตาม
  // ต้นฉบับเป๊ะ) — ดูหัวข้อ 0 ท้ายสุด
  deviceModel  String
  protocol     String
  status       DeviceLifecycleStatus @default(registered)
  registeredAt DateTime              @default(now())
  installedAt  DateTime?
  customerId   String?
  customer     Customer?             @relation(fields: [customerId], references: [id], onDelete: SetNull)

  // nullable ในช่วงแรก — อุปกรณ์เดิมทั้งหมดยังไม่มี modelId ผูกไว้จนกว่าจะ backfill
  // (ดูหัวข้อ 5) เมื่อ backfill ครบแล้วค่อยพิจารณาบังคับ NOT NULL ทีหลัง
  modelId      String?
  model        DeviceModel?          @relation(fields: [modelId], references: [id])
}
```

**หมายเหตุสำคัญ:** รอบนี้เสนอให้ผูก FK แค่ที่ `Device` เท่านั้น — **ไม่แตะ** `Config`/
`ConfigVersion`/`Firmware`/`ConfigFieldDefinitionModelSupport` ที่ยังใช้ `deviceModel: String`
เดิมต่อไป (รายละเอียดเหตุผลหัวข้อ 5) เป็นการขยายแบบ additive ล้วนๆ ไม่กระทบโค้ด/schema เดิมที่
ทำงานอยู่แล้วเลยสักจุด

---

## 4. Use case ที่ต้องรองรับ

### 4.1 กำหนด Config/Firmware ที่ใช้ได้ตามรุ่น (บังคับก่อน sync)

**สถานะปัจจุบัน:** ทำงานอยู่แล้วจริงผ่าน string matching ใน `CampaignService` (ดูหัวข้อ 0)

**หลัง DeviceModel:** ไม่บังคับต้องแก้ logic เดิมทันที — เพราะ `device.deviceModel` (string) ยัง
คงอยู่และค่ายังตรงกับที่ `DeviceModel.name` เก็บไว้เป๊ะ โค้ดเดิมทำงานเหมือนเดิมทุกประการ

สิ่งที่ **ได้เพิ่มขึ้นจริง** จากการมี `DeviceModel`:
- `Device.modelId` ให้ผลตรวจสอบที่แน่นอนกว่า string เดิม (join แล้วรู้ทันทีว่ารุ่นนี้"มีอยู่จริง"
  ในระบบไหม ไม่ใช่แค่ "เคยมีใครพิมพ์ค่านี้มาก่อน")
- เปิดทางให้ในอนาคต (เฟสถัดไป — ไม่ใช่รอบนี้) ย้าย `CampaignService`, `ConfigWizard` ไปเทียบ
  `modelId` แทน string โดยตรง ลดความเสี่ยงเรื่องพิมพ์ผิด/case-sensitivity

### 4.2 กรอง/ค้นหา/รายงานตามรุ่น

`GET /devices` มี query param `deviceModel` อยู่แล้ว (`query-device.dto.ts`) — filter ตาม string
ตรงตัว ใช้งานได้ต่อเนื่องได้เลยไม่ต้องแก้ (ค่ายังตรงกับ `DeviceModel.name`)

สิ่งที่เสนอเพิ่ม (ไม่บังคับ, ทำทีหลังได้): เพิ่ม endpoint ใหม่ `GET /device-models` (list รุ่นทั้งหมด
พร้อมจำนวนอุปกรณ์ต่อรุ่น) ให้หน้าเว็บใช้ทำ dropdown filter ที่เป็น "รายการรุ่นที่มีจริงในระบบ" แทนการ
derive จากข้อมูลที่บังเอิญมีอยู่ (แก้ปัญหาที่ `config-wizard.tsx`'s `deviceModelOptions` เจอตอนนี้ —
ถ้ายังไม่เคยมี Config ของรุ่นไหนมาก่อน รุ่นนั้นจะไม่โผล่ใน dropdown เลย)

### 4.3 จัดการ inventory/สต๊อกตามรุ่น

เสนอ endpoint สรุปเช่น `GET /device-models/{id}/inventory` หรือ `GET /device-models` ที่แนบ
`deviceCount` แยกตาม `DeviceLifecycleStatus` มาด้วย (`registered`/`installed`/`decommissioned`) —
**แต่ enum นี้ยังไม่มีสถานะ "ซ่อม" ตามที่ kittiphong อธิบาย use case ไว้** (ดูหัวข้อ 0 และคำถามเปิด
หัวข้อ 6) รอบนี้เสนอโครง endpoint ไว้ก่อน ส่วนจะเพิ่ม enum value ใหม่หรือไม่ขอให้ kittiphong ตัดสินใจ

### 4.4 Provisioning default ตอนลงทะเบียนอุปกรณ์ใหม่

**สถานะ: รอ dependency ก่อน — implement ตอนนี้เลยไม่ได้** ต่างจาก 4.1-4.3 ที่ทำได้ทันทีเพราะมี
`Device` อยู่ในระบบแล้ว ข้อนี้ต้องพึ่ง `registerDevice` endpoint จาก Device Sync PR 1
(`docs/14` §5) ก่อน — เช็คแล้วยืนยันอีกครั้งว่า **ตอนนี้ยังไม่มี `POST /devices` เลยในระบบ**
(`device.controller.ts` มีแค่ GET 2 ตัว + test/apply/simulate 3 ตัว) อุปกรณ์ทั้งหมดเข้าระบบผ่าน
`prisma/seed.ts` เท่านั้น — ดังนั้นฟีเจอร์นี้ไม่มี endpoint ให้ "เสียบ" logic เข้าไปเลยจนกว่า PR 1
จะ merge

**Flow ที่ตั้งใจไว้ (หลัง PR 1 merge แล้ว):** `registerDevice` DTO รับ `modelId` (หรือชื่อรุ่นแล้ว
lookup เป็น `modelId` ในนั้น) → ถ้า `DeviceModel.supportedProtocols` มีค่าเดียว ให้ตั้ง
`Device.protocol` เป็นค่านั้นอัตโนมัติโดยไม่ต้องให้ผู้ใช้กรอกซ้ำ (ถ้ามีมากกว่า 1 ค่ายังต้องเลือกเอง
เหมือนเดิม) — ลด field ที่กรอกมือได้บางส่วน ไม่ใช่ auto-fill ทั้งหมด

**มติเรื่อง sequencing (คำถามเปิดข้อ 5/6 — ปิดแล้ว):** **ไม่เริ่มพร้อมกับ Device Sync PR 1** —
ให้ PR 1 เดินหน้าด้วย `deviceModel` string เดิมก่อนเลย (พร้อม 100% แล้ว ไม่ควรค้างรอ) รอ
`DeviceModel` นิ่ง (ผ่านการ implement จริงแล้ว) ค่อยกลับมา **retrofit** `registerDevice` DTO
เพิ่ม `modelId` เป็น **optional field** ทีหลัง — เป็น additive migration ปกติ ไม่ breaking
เพราะ endpoint เดิม (ที่ยังไม่มี `modelId`) จะยังใช้งานได้ต่อเนื่อง

### 4.5 Failure rate / Incident แยกตามรุ่น

**แก้ไขจากที่เคยเสนอไว้ตอนเป็นข้อเสนอ (หัวข้อ 5 เดิม) — เช็คโค้ด `Incident` จริงแล้วพบว่าสมมติฐาน
เดิมผิด:** ตอนนั้นเขียนว่า "join Device→DeviceModel→Incident ผ่าน relation ที่มีอยู่แล้ว" แต่
**`Incident` ไม่มี FK ไปหา `Device` เลยสักจุด** (`backend/prisma/schema.prisma` บรรทัด ~701-723) —
มีแค่ `relatedConfigId`/`relatedFirmwareId` เป็น FK จริง ส่วนอุปกรณ์ที่เกี่ยวข้องถ้ามีจะอยู่ใน
`Incident.metadata` (Json, unstructured) เป็น key `deviceIdentifier?: string` ซึ่ง comment ใน
`incident-metadata.ts` ระบุชัดว่าเป็น **"ตัวระบุกล่องในระบบเดิม"** — ไม่รับประกันว่าตรงกับ
`Device.deviceId` ปัจจุบันรูปแบบเดียวกัน (Incident สร้างได้จาก 2 ทางคือ `config-sync-writer` กับ
`mobile-simulator-test` เท่านั้นตอนนี้ ตาม `INCIDENT_SOURCE` ในไฟล์เดียวกัน)

**ผลคือ:** การทำ "failure rate by model" ให้เชื่อถือได้จริง ต้อง **เพิ่ม FK ใหม่ `Incident.deviceId`**
(nullable, ผูกกับ `Device`) เป็นงานที่มากกว่าที่เคยประเมินไว้ตอนเป็นข้อเสนอ (ตอนนั้นคิดว่าไม่ต้องแก้
อะไรเพิ่มเลยนอกจาก query) — เป็น schema change ที่ตัว `Incident` เอง ไม่ใช่ที่ `DeviceModel`
ยังคง additive (nullable FK ใหม่) แต่ต้องนับเป็นงานแยกก่อนจะ query "join Device→DeviceModel→
Incident" ได้จริง ดูคำถามเปิดข้อ 7

หลังมี `Incident.deviceId` แล้ว endpoint ที่เสนอ: `GET /device-models/{id}/incident-summary` นับ
จำนวน Incident แยกตาม `severity`/`status` ของอุปกรณ์ทุกเครื่องที่ผูกกับรุ่นนั้น

### 4.6 Warranty/lifecycle ต่อรุ่น

เพิ่ม field ลงใน `DeviceModel` ตรงๆ (อัปเดต schema snippet ในหัวข้อ 3 แล้ว) แทนการพักไว้ใน
`notes` แบบข้อความอิสระเหมือนตอนเป็นข้อเสนอ:
- `warrantyMonths Int?` — จำนวนเดือนรับประกันมาตรฐานของรุ่นนี้
- `endOfSupportDate DateTime?` — วันที่เลิกซัพพอร์ต (ใช้คู่กับ `DeviceModelStatus.discontinued`
  ได้ — discontinued คือเลิกผลิต/สั่งซื้อ ส่วนวันนี้คือเลิกซัพพอร์ต อาจคนละวันกัน)

ยังไม่ลงรายละเอียด RMA policy เป็น structured data (เช่น ขั้นตอนเคลม, ผู้รับผิดชอบ) — ดูคำถามเปิด
ข้อ 8 ว่าต้อง structured กว่านี้ไหม

### 4.7 Compatibility matrix แบบดูภาพรวม

เสนอ endpoint ใหม่ `GET /device-models/{id}/compatibility` รวม Config version + Firmware
version ที่ใช้ได้กับรุ่นนั้นไว้ที่เดียว — **ต้อง join ด้วย string เทียบ `DeviceModel.name` กับ
`deviceModel`/`deviceModelCompatibility` เดิม ไม่ใช่ FK ตรงๆ** เพราะตัดสินใจไว้แล้วในหัวข้อ 3/5
ว่ารอบนี้ไม่ migrate `Config`/`ConfigVersion`/`Firmware` ไปใช้ `modelId`:
- ส่วน Config: query `ConfigVersion` ที่ `deviceModel === DeviceModel.name` (คืน
  `versionNumber`/`approvedAt` ล่าสุดต่อ Config แต่ละตัว)
- ส่วน Firmware: query `Firmware` ที่ `deviceModelCompatibility` array มี `DeviceModel.name`
  รวมอยู่ (คืน `version`/`uploadStatus`/`approvalStatus`)

ผลลัพธ์เป็น read-only view รวมข้อมูลจาก 2 แหล่งที่มีอยู่แล้ว ไม่เพิ่ม state ใหม่ ไม่กระทบ
`CampaignService`'s compatibility-check เดิมเลย (คนละ endpoint กัน)

---

## 5. Migration

เสนอ 2 ทางเลือก ให้ kittiphong เลือก (ไม่ฟันธง):

**ทางเลือก A — nullable ก่อน แล้วค่อย backfill (แนะนำ):**
1. Migration เพิ่ม `DeviceModel` table + `Device.modelId` เป็น **nullable** (additive ล้วน
   ตาม convention ใน CLAUDE.md — ไม่กระทบข้อมูลเดิม)
2. Backfill: สร้าง `DeviceModel` row จากค่า `deviceModel` string ที่ distinct อยู่แล้วในตาราง
   `Device` (และเผื่อไล่เช็ค `Config`/`Firmware`/`ConfigFieldDefinitionModelSupport` ด้วยว่ามีชื่อ
   รุ่นไหนที่ไม่เคยโผล่ใน `Device` เลยบ้าง เพื่อให้ registry ครบ) แล้ว `UPDATE` เซ็ต `modelId` ให้ตรง
3. หลัง backfill ครบ — ค่อยพิจารณา migration ที่ 2 เปลี่ยน `modelId` เป็น `NOT NULL` (ทำแยก PR
   แยกจังหวะ กันความเสี่ยง ตาม convention "Migration Safety" ใน CLAUDE.md เรื่อง FK ใหม่บนตารางที่
   มีข้อมูลอยู่แล้ว)

**ทางเลือก B — บังคับกรอก `modelId` ตั้งแต่ migration แรก:** ทำได้ถ้ามั่นใจว่า backfill script รัน
เสร็จสมบูรณ์ในทีเดียวก่อน deploy จริง (ไม่มีช่วงเวลาที่ Device แถวไหนไม่มี modelId เลย) ความเสี่ยง
คือถ้า data จริงมีชื่อรุ่นเพี้ยน/พิมพ์ต่างกันที่ยังไม่เคยรู้ตัวมาก่อน migration จะ fail กลางทาง

ไม่ว่าเลือกทางไหน **ไม่แตะ** `Config.deviceModel`/`Firmware.deviceModelCompatibility`/
`ConfigFieldDefinitionModelSupport.deviceModel` เดิมเลยในรอบนี้ — ทั้ง 3 จุดนี้ยังเป็น string ต่อไป
จนกว่าจะมีการตัดสินใจแยกต่างหากว่าจะ migrate ให้ครบทั้งระบบหรือไม่ (เฟสถัดไป ถ้าต้องการ)

---

## 6. คำถามเปิด (Open Questions)

1. **เปลี่ยนรุ่นของอุปกรณ์ที่มีอยู่แล้วได้ไหม (RMA/สลับฮาร์ดแวร์)?** — ตามที่ kittiphong สั่งไว้ว่า
   1 Device : 1 Model ตายตัว แต่เจอสถานการณ์ RMA ที่อาจต้องคิดเผื่อ (ดูหัวข้อ 2) — ถ้าต้องรองรับ
   จะกระทบ design (ต้องมี "history" ของ modelId เดิมไหม หรือแค่ update ตรงๆ พอ) รอ kittiphong
   ยืนยันว่าเข้าข่ายในระบบนี้จริงไหม หรือไม่เคยเกิดขึ้นเลยในทางปฏิบัติ
   **มติ (Paveekorn ตอบ, kittiphong เห็นด้วย — PR #196 comment 2026-09-21):** ไม่รองรับตอนนี้ —
   ไม่มีหลักฐานว่าเคยเกิดขึ้นจริงในโค้ด/เอกสาร คง 1:1 แบบง่ายไว้ก่อน ถ้าเจอเคสจริงทีหลังค่อยเปิดให้
   แก้ `modelId` ผ่าน `PATCH` ธรรมดา ไม่ต้องมี history table แยกตั้งแต่ตอนนี้
2. **`DeviceLifecycleStatus` ต้องเพิ่มสถานะ "ซ่อม" ไหม?** — enum ปัจจุบันไม่มี ใช้แค่
   `registered/installed/decommissioned` แต่ use case inventory ที่ kittiphong อธิบายพูดถึง
   "พร้อมใช้/ซ่อม/เลิกใช้" — ถ้าต้องเพิ่มจริง เป็นงานแยกจาก DeviceModel (แก้ enum บน `Device` เอง)
   แต่กระทบ endpoint inventory summary ในหัวข้อ 4.3 โดยตรง อยากให้ยืนยันก่อนเริ่ม implement
   **มติ:** แยกออกจาก PR นี้โดยสิ้นเชิง — คนละเรื่องกับ `DeviceModel` (แก้ enum บน `Device` เอง
   ไม่เกี่ยวกับ Model registry) 4.3 (inventory summary) รายงานแค่ 3 สถานะเดิมไปก่อน เพิ่ม "ซ่อม"
   เป็น follow-up แยกทีหลัง (Postgres `ALTER TYPE ... ADD VALUE` ไม่ต้อง migrate ข้อมูลเดิม)
3. **ต้อง migrate `Config`/`Firmware`/`ConfigFieldDefinitionModelSupport` ไปใช้ `modelId` ด้วย
   ในเฟสนี้เลยไหม หรือเก็บไว้เป็นเฟสถัดไป?** — เอกสารนี้เสนอให้แยกเฟส (แค่ `Device` ก่อน) เพื่อลด
   ความเสี่ยง แต่ถ้า kittiphong อยากทำให้ครบทีเดียวจะกระทบขอบเขต/effort เยอะขึ้นมาก (ต้องแก้
   `CampaignService`, `ConfigWizard`, `parameter-library-view.tsx` ฯลฯ ที่อ้าง string ตรงๆ อยู่)
   **มติ:** แยกเฟส เก็บไว้ทีหลังตามที่เอกสารเสนอไว้เดิม — `DeviceModel.name` ตั้งใจให้ตรงกับ
   string เดิมเป๊ะอยู่แล้ว พอถึงเวลาจริงแค่เพิ่ม FK คู่ขนานไปก่อน ไม่ต้องแตะ logic เทียบ string
   เดิมเลยจนกว่าจะพร้อมสลับจริง
4. **ใครมีสิทธิ์สร้าง/แก้ `DeviceModel`?** — ยังไม่ได้ออกแบบ RBAC resource ใหม่ให้ (ไม่มีใน
   `RBAC_Matrix.md` ตอนนี้) เดาเบื้องต้นว่าน่าจะเป็น Admin/SuperAdmin (ข้อมูล master data) แต่ยัง
   ไม่ยืนยัน — ต้องออกแบบคู่กับ RBAC Matrix ถ้าตัดสินใจทำจริง
   **มติ:** Admin/SuperAdmin ตามที่เดาไว้เดิม — mirror pattern เดียวกับ `user-management` เพราะ
   เป็น master/reference data ที่เพิ่มไม่บ่อย (ต่างจาก `ConfigFieldDefinition` ที่ ConfigEngineer
   self-service ได้เพราะเพิ่มบ่อยตามงานจริง) ถ้าเปลี่ยนใจทีหลังแค่เพิ่ม grant ใน `seed.ts` ไม่มี
   migration (Role/RolePermission เป็นข้อมูลใน DB ไม่ใช่โค้ด)
5. **ประสานงานกับ `docs/14` (Device Sync PR 1 — `registerDevice` endpoint):** PR 1 ของ Device
   Sync (อนุมัติแล้ว รอเปิด implement) จะเพิ่ม endpoint ลงทะเบียนอุปกรณ์ใหม่พอดี ถ้าฟีเจอร์นี้เริ่ม
   ทำพร้อมๆ กันหรือหลังจากนั้นไม่นาน `registerDevice` DTO ควรรับ `modelId` ตั้งแต่ต้นเลยไหม หรือ
   ปล่อยให้ PR 1 เสร็จก่อนด้วย `deviceModel` string เดิม แล้วค่อยตามมาแก้ทีหลัง — เป็นเรื่อง
   sequencing ระหว่าง 2 งานที่ควรคุยกับ Paveekorn (A) ด้วยถ้าตัดสินใจเริ่มทำ
   **มติ:** ไม่เริ่มพร้อมกัน — ให้ Device Sync PR 1 เดินหน้าด้วย `deviceModel` string เดิมไปก่อน
   เลย (พร้อม 100% แล้ว ไม่ควรค้างรอ DeviceModel) รอ `DeviceModel` นิ่งค่อย retrofit
   `registerDevice` DTO เพิ่ม `modelId` เป็น optional field ทีหลัง (non-breaking, additive migration
   ปกติ)
6. **Provisioning default (4.4) ต้องรอ PR 1 merge ก่อนถึงจะ implement ได้จริง** — ต่อเนื่องจาก
   คำถามข้อ 5 โดยตรง: จะเริ่ม implement 4.4 พร้อมกับ Device Sync PR 1 เลย (เผื่อ `registerDevice`
   DTO ไว้ตั้งแต่ต้น) หรือรอ PR 1 merge เสร็จสมบูรณ์ก่อนค่อยกลับมาต่อ — ผลกระทบต่อลำดับงานทั้ง
   2 ฝั่งโดยตรง ต้องตัดสินใจคู่กับข้อ 5
   **มติ:** ปิดพร้อมข้อ 5 โดยอนุโลม — ไม่เริ่มพร้อมกัน รอ `DeviceModel` นิ่งก่อนค่อย retrofit
   `registerDevice` DTO
7. **`Incident.deviceId` — ต้องเพิ่ม FK ใหม่ก่อน 4.5 ถึงจะทำได้จริง** — เช็คโค้ดแล้วพบว่า
   `Incident` ไม่มี FK ไปหา `Device` เลย (มีแค่ `relatedConfigId`/`relatedFirmwareId` และ
   `metadata.deviceIdentifier` แบบ JSON ที่อ้างอิงระบบเดิม ไม่รับประกันตรงกับ `Device.deviceId`
   ปัจจุบัน — ดูหัวข้อ 4.5) เป็นงานเพิ่มที่ไม่เคยถูกประเมินไว้ตอนเสนอเป็น use case เสริม — ต้อง
   ตัดสินใจว่าจะทำ migration เพิ่ม FK นี้ในรอบเดียวกับ `DeviceModel` เลย หรือแยกเป็นอีก PR ต่างหาก
   **มติ:** แยกเป็น PR ต่างหาก ไม่รวมกับ `DeviceModel` — คนละ concern กัน (แก้ gap ของ `Incident`
   module ไม่ใช่เรื่อง Model registry) ยึดบทเรียนจาก scope ปนกันใน PR #187/#188 ให้แต่ละ PR แคบ
   และตรวจสอบง่าย
8. **Warranty/lifecycle (4.6) — field ที่เพิ่มพอไหม?** — `warrantyMonths`/`endOfSupportDate` เป็น
   scalar field ธรรมดา ยังไม่รองรับ RMA policy แบบมีขั้นตอน/ผู้รับผิดชอบเป็นโครงสร้าง ถ้าต้องการ
   ระดับนั้นจริงอาจต้องแยกเป็น entity ใหม่ (เช่น `DeviceModelWarrantyPolicy`) แทนที่จะเป็นแค่ 2
   field บน `DeviceModel` — รอ kittiphong ยืนยันว่าระดับ scalar พอสำหรับตอนนี้ไหม
   **มติ:** พอแล้ว ไม่ต้องแยก entity (YAGNI) — ไม่มี workflow/ผู้รับผิดชอบจริงที่ต้องรองรับตอนนี้
   ถ้ามี requirement จริงทีหลังค่อยย้ายไป `DeviceModelWarrantyPolicy` แยก (ข้อมูลระดับ "1 แถวต่อ
   1 รุ่นสินค้า" ปริมาณน้อยมาก ไม่ใช่ต่ออุปกรณ์ — ย้ายทีหลังไม่หนัก)

**สรุป:** ทุกมติยึดหลัก additive-first — ไม่มีข้อไหนที่การเลื่อนออกไปตอนนี้จะทำให้ต้องรื้อของที่
implement ไปแล้วทีหลัง (ดู PR #196 comment 2026-09-21 ฉบับเต็ม)

---

## 7. Out of Scope (รอบนี้)

- ไม่แตะโค้ด/PR ของ Device Sync rollout (`docs/14`, PR 1/2/3) เลย — คนละเรื่องกัน ถึงจะมีจุด
  ประสานงานกัน (ดูคำถามเปิดข้อ 5-6)
- ไม่ migrate `Config`/`ConfigVersion`/`Firmware`/`ConfigFieldDefinitionModelSupport` ไปใช้
  `modelId` FK ในรอบนี้ (ดูหัวข้อ 5 และคำถามเปิดข้อ 3)
- ไม่ออกแบบ RBAC resource ใหม่สำหรับจัดการ `DeviceModel` ในเอกสารนี้ (คำถามเปิดข้อ 4) — รอ
  ตัดสินใจ scope ก่อนแล้วค่อยออกแบบแยก
- ไม่เพิ่ม/แก้ `DeviceLifecycleStatus` enum ในเอกสารนี้ (คำถามเปิดข้อ 2)
- ไม่ implement จริง ไม่มี migration file จริง ไม่เปิด PR — รอ kittiphong รีวิว draft นี้ก่อน
