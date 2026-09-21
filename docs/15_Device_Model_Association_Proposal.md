# ข้อเสนอออกแบบ Device–Model Association — ผูกอุปกรณ์เข้ากับรุ่นสินค้า

> เอกสารนี้เป็น **draft สำหรับให้ kittiphong รีวิว** — ยังไม่ใช่มติสุดท้าย ยังไม่ implement
> จริง และยังไม่เปิด PR จนกว่าจะรีวิว/แก้ไขตามที่ต้องการก่อน (ต่างจาก `docs/14` ที่เปิดเป็น PR
> ให้รีวิวคู่กับโค้ดจริง — อันนี้เป็นเอกสารเปล่าอยู่ในเครื่อง)

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

**ผลต่อการออกแบบ:** นี่ไม่ใช่การสร้าง use case ใหม่จากศูนย์ แต่เป็นการ **ใส่ registry ที่เป็นทางการ
(canonical) ครอบ string ที่กระจัดกระจายอยู่แล้ว** — ถ้าออกแบบให้ `DeviceModel.name` มีค่าตรงกับ
string เดิมทุกตัวเป๊ะ (`"GT06N"` ฯลฯ) โค้ด compatibility-check เดิมใน `CampaignService` จะยังทำงาน
ถูกต้องเหมือนเดิมโดยไม่ต้องแตะเลย แม้จะยังไม่ migrate Config/Firmware ไปใช้ FK ในรอบแรกก็ตาม —
รายละเอียดอยู่หัวข้อ 3 และ 6

**ไม่มี endpoint สร้าง Device เลย** — เช็ค `device.controller.ts` แล้วมีแค่ `GET /devices`,
`GET /devices/:deviceId`, และ 3 endpoint test/apply/simulate — **ไม่มี `POST /devices`**
อุปกรณ์ทั้งหมดตอนนี้เข้าระบบผ่าน `prisma/seed.ts` เท่านั้น ข้อมูลนี้เกี่ยวข้องเพราะ `docs/14`
(Device Sync Proposal, PR #190 — อนุมัติแล้วแต่ยังไม่ merge) มีแผนเพิ่ม `registerDevice` endpoint
ใน PR 1 ของ rollout นั้นพอดี — ดูหัวข้อ 7 (คำถามเปิด) เรื่องการประสานงานกับ PR นั้น

**ไม่เจอ PR/issue ที่ทำเรื่องนี้ค้างอยู่** — `gh issue list`/`gh pr list` ค้นคำว่า "รุ่น"/"model"
แล้วไม่มีอะไรตรงประเด็นนี้เลย (ผลที่เจอเป็นเรื่องอื่นที่บังเอิญมีคำว่า "model" ปนอยู่ เช่น Prisma
"model" keyword ทั่วไป) — **ไม่มีความเสี่ยงชนกับงานใคร**

`DeviceLifecycleStatus` enum ปัจจุบันมีแค่ `registered | installed | decommissioned` — **ไม่มี
สถานะ "ซ่อม" เลย** ทั้งที่ kittiphong พูดถึง "พร้อมใช้/ซ่อม/เลิกใช้" ตอนอธิบาย use case inventory —
ถือเป็น gap ที่เจอระหว่างสำรวจ ใส่เป็นคำถามเปิดไว้หัวข้อ 7 ไม่ได้ตัดสินใจเพิ่ม enum เอง

ไม่พบการพูดถึงแนวคิดนี้ใน `docs/planning/01_GPS_Build_Reference.md`, `02_GPS_Development_Plan.md`,
หรือ `docs/14_Device_Sync_Proposal.md` เลยเช่นกัน — เป็นพื้นที่ design ใหม่ทั้งหมด

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
**คำถามเปิด** (หัวข้อ 7) ไม่ตัดสินใจเองว่าต้องรองรับหรือไม่

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

model DeviceModel {
  id                 String            @id @default(uuid())
  // ค่าต้องตรงกับ string เดิมที่ใช้อยู่แล้วทุกจุดเป๊ะ (เช่น "GT06N") — ดูหัวข้อ 6
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
  // เก็บไว้ก่อนช่วง transition (ดูหัวข้อ 6) — เป้าหมายสุดท้ายคือ deprecate แล้วอ่าน
  // ชื่อรุ่นผ่าน `model.name` แทน แต่ตอนนี้โค้ดอื่น (CampaignService, ConfigWizard
  // ฯลฯ) ยังอ้าง field นี้ตรงๆ เยอะ — ย้ายทีเดียวเสี่ยงเกินไป
  deviceModel  String
  protocol     String
  status       DeviceLifecycleStatus @default(registered)
  registeredAt DateTime              @default(now())
  installedAt  DateTime?
  customerId   String?
  customer     Customer?             @relation(fields: [customerId], references: [id], onDelete: SetNull)

  // nullable ในช่วงแรก — อุปกรณ์เดิมทั้งหมดยังไม่มี modelId ผูกไว้จนกว่าจะ backfill
  // (ดูหัวข้อ 6) เมื่อ backfill ครบแล้วค่อยพิจารณาบังคับ NOT NULL ทีหลัง
  modelId      String?
  model        DeviceModel?          @relation(fields: [modelId], references: [id])
}
```

**หมายเหตุสำคัญ:** รอบนี้เสนอให้ผูก FK แค่ที่ `Device` เท่านั้น — **ไม่แตะ** `Config`/
`ConfigVersion`/`Firmware`/`ConfigFieldDefinitionModelSupport` ที่ยังใช้ `deviceModel: String`
เดิมต่อไป (รายละเอียดเหตุผลหัวข้อ 6) เป็นการขยายแบบ additive ล้วนๆ ไม่กระทบโค้ด/schema เดิมที่
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
หัวข้อ 7) รอบนี้เสนอโครง endpoint ไว้ก่อน ส่วนจะเพิ่ม enum value ใหม่หรือไม่ขอให้ kittiphong ตัดสินใจ

---

## 5. ข้อเสนอ Use Case เพิ่มเติม (ให้ kittiphong พิจารณาว่าจะเอาเข้า scope ไหม)

ไม่ใช่มติ เป็นแค่สิ่งที่เจอระหว่างไล่โค้ดแล้วดูเข้าข่ายเกี่ยวข้องกับการมี `DeviceModel` เป็น registry:

1. **Provisioning default ตอนลงทะเบียนอุปกรณ์ใหม่** — `docs/14` (Device Sync, PR #190 อนุมัติ
   แล้ว) กำลังจะเพิ่ม `registerDevice` endpoint ใน PR 1 ถ้ามี `DeviceModel` แล้ว ตอน register
   อุปกรณ์ใหม่สามารถ derive ค่า default บางอย่างจากรุ่นได้เลย (เช่น protocol เริ่มต้นถ้ารุ่นนั้น
   รองรับ protocol เดียว) ลดฟิลด์ที่ต้องกรอกมือ
2. **Failure rate / Incident แยกตามรุ่น** — ตอนนี้ `Incident` ผูกกับ `Device`/`Firmware` แต่ไม่มี
   มุมมอง "รุ่นไหนมี Incident บ่อยผิดปกติ" ถ้ามี `DeviceModel` จะ query ง่ายขึ้นมาก (join
   Device→DeviceModel→Incident) เป็นข้อมูลที่มีประโยชน์เชิงคุณภาพฮาร์ดแวร์
3. **Warranty/lifecycle ต่อรุ่น** — เก็บวันที่ end-of-support หรือ RMA policy ต่อรุ่น (field เผื่อไว้
   ใน `DeviceModel.notes` ตอนนี้ ถ้าต้องการ structured field จริงค่อยเพิ่มทีหลัง)
4. **Compatibility matrix แบบดูภาพรวม** — หน้าเว็บที่โชว์ "รุ่นนี้ใช้ได้กับ Config version ไหนบ้าง,
   Firmware version ไหนบ้าง" รวมในที่เดียว (ตอนนี้ต้องไล่ดูทีละ Config/Firmware เอาเอง)

---

## 6. Migration

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

## 7. คำถามเปิด (Open Questions)

1. **เปลี่ยนรุ่นของอุปกรณ์ที่มีอยู่แล้วได้ไหม (RMA/สลับฮาร์ดแวร์)?** — ตามที่ kittiphong สั่งไว้ว่า
   1 Device : 1 Model ตายตัว แต่เจอสถานการณ์ RMA ที่อาจต้องคิดเผื่อ (ดูหัวข้อ 2) — ถ้าต้องรองรับ
   จะกระทบ design (ต้องมี "history" ของ modelId เดิมไหม หรือแค่ update ตรงๆ พอ) รอ kittiphong
   ยืนยันว่าเข้าข่ายในระบบนี้จริงไหม หรือไม่เคยเกิดขึ้นเลยในทางปฏิบัติ
2. **`DeviceLifecycleStatus` ต้องเพิ่มสถานะ "ซ่อม" ไหม?** — enum ปัจจุบันไม่มี ใช้แค่
   `registered/installed/decommissioned` แต่ use case inventory ที่ kittiphong อธิบายพูดถึง
   "พร้อมใช้/ซ่อม/เลิกใช้" — ถ้าต้องเพิ่มจริง เป็นงานแยกจาก DeviceModel (แก้ enum บน `Device` เอง)
   แต่กระทบ endpoint inventory summary ในหัวข้อ 4.3 โดยตรง อยากให้ยืนยันก่อนเริ่ม implement
3. **ต้อง migrate `Config`/`Firmware`/`ConfigFieldDefinitionModelSupport` ไปใช้ `modelId` ด้วย
   ในเฟสนี้เลยไหม หรือเก็บไว้เป็นเฟสถัดไป?** — เอกสารนี้เสนอให้แยกเฟส (แค่ `Device` ก่อน) เพื่อลด
   ความเสี่ยง แต่ถ้า kittiphong อยากทำให้ครบทีเดียวจะกระทบขอบเขต/effort เยอะขึ้นมาก (ต้องแก้
   `CampaignService`, `ConfigWizard`, `parameter-library-view.tsx` ฯลฯ ที่อ้าง string ตรงๆ อยู่)
4. **ใครมีสิทธิ์สร้าง/แก้ `DeviceModel`?** — ยังไม่ได้ออกแบบ RBAC resource ใหม่ให้ (ไม่มีใน
   `RBAC_Matrix.md` ตอนนี้) เดาเบื้องต้นว่าน่าจะเป็น Admin/SuperAdmin (ข้อมูล master data) แต่ยัง
   ไม่ยืนยัน — ต้องออกแบบคู่กับ RBAC Matrix ถ้าตัดสินใจทำจริง
5. **ประสานงานกับ `docs/14` (Device Sync PR 1 — `registerDevice` endpoint):** PR 1 ของ Device
   Sync (อนุมัติแล้ว รอเปิด implement) จะเพิ่ม endpoint ลงทะเบียนอุปกรณ์ใหม่พอดี ถ้าฟีเจอร์นี้เริ่ม
   ทำพร้อมๆ กันหรือหลังจากนั้นไม่นาน `registerDevice` DTO ควรรับ `modelId` ตั้งแต่ต้นเลยไหม หรือ
   ปล่อยให้ PR 1 เสร็จก่อนด้วย `deviceModel` string เดิม แล้วค่อยตามมาแก้ทีหลัง — เป็นเรื่อง
   sequencing ระหว่าง 2 งานที่ควรคุยกับ Paveekorn (A) ด้วยถ้าตัดสินใจเริ่มทำ

---

## 8. Out of Scope (รอบนี้)

- ไม่แตะโค้ด/PR ของ Device Sync rollout (`docs/14`, PR 1/2/3) เลย — คนละเรื่องกัน ถึงจะมีจุด
  ประสานงานกัน (ดูคำถามเปิดข้อ 5)
- ไม่ migrate `Config`/`ConfigVersion`/`Firmware`/`ConfigFieldDefinitionModelSupport` ไปใช้
  `modelId` FK ในรอบนี้ (ดูหัวข้อ 6 และคำถามเปิดข้อ 3)
- ไม่ออกแบบ RBAC resource ใหม่สำหรับจัดการ `DeviceModel` ในเอกสารนี้ (คำถามเปิดข้อ 4) — รอ
  ตัดสินใจ scope ก่อนแล้วค่อยออกแบบแยก
- ไม่เพิ่ม/แก้ `DeviceLifecycleStatus` enum ในเอกสารนี้ (คำถามเปิดข้อ 2)
- ไม่ implement จริง ไม่มี migration file จริง ไม่เปิด PR — รอ kittiphong รีวิว draft นี้ก่อน
