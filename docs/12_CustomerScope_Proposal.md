# 12 — Customer Scope (ลูกค้า / โปรเจกต์ / รถ) — Proposal

> **จาก:** paveekornk (A) — **ถึง:** kittiphong (B) + พี่เลี้ยง
> **มติต้นทาง:** ยังไม่มี — เอกสารนี้เป็น **ร่างตั้งต้น** ไว้คุยในรีวิวรายอาทิตย์ (ปรับแก้ได้เรื่อย ๆ)
> **สถานะ:** DRAFT — ยังไม่ลงมือแก้โค้ด · รอทีม + พี่เลี้ยงเคาะว่าจะเริ่มเฟสไหนเมื่อไหร่
> **จุดประสงค์:** ให้ทั้งทีมเข้าใจตรงกันว่า "ส่วนลูกค้า" ที่หายไปจากระบบตอนนี้คืออะไร หายไปเพราะอะไร และถ้าจะเติมกลับ ทำเป็นสเต็ปยังไง

---

## 1. ปัญหา

ในโลกจริง บริษัทมีลูกค้าหลายราย แต่ละรายมีรถหลายคัน แต่ละคันมีกล่อง GPS หนึ่งตัว:

```
ลูกค้า "ขนส่ง ก."
  └─ โปรเจกต์ "สัญญาปี 2569"
       └─ รถ "70-1234"
            └─ กล่อง GPS "DEV-0042"
```

**Data Dictionary** (`docs/database/GPS_Data_Dictionary.xlsx` — พิมพ์เขียวที่ออกแบบไว้ตั้งแต่ต้น) มีโครงสร้างนี้ครบ และบังคับว่า **กล่องทุกตัวต้องรู้ว่าเป็นของลูกค้าไหน** (`DEVICE.customer_id` — NOT NULL)

**ระบบที่เราสร้างจริงตอนนี้** ตัดส่วนนี้ออกทั้งหมด:

| สิ่งที่ DD ออกแบบไว้ | ระบบตอนนี้ |
|---|---|
| ตาราง `CUSTOMER`, `PROJECT`, `VEHICLE` | **ไม่มีเลย** |
| `DEVICE.customer_id` (บังคับ) | `Device` ไม่มี field นี้ |
| `DEVICE.vehicle_id` → รถ → โปรเจกต์ → ลูกค้า | `Device` มีแค่ `deviceId / simNumber / deviceModel / protocol / status` |
| Config ผูกกับ "ระดับชั้น" (ลูกค้า/โปรเจกต์/รถ/กล่อง) | `Config` เป็นก้อนแบน ๆ — ไม่รู้ว่าเป็นของใคร |
| RBAC มีกฎ "ช่างเห็นเฉพาะลูกค้าตัวเอง" | `RBAC_Matrix.md` ไม่มีคำว่า "customer" เลย |

ผลตอนนี้: เปิดหน้า Config หรือหน้า Device แล้ว **บอกไม่ได้ว่าอันไหนเป็นของลูกค้าราย ไหน** — ทุกคนเห็นทุกอย่างเท่ากันหมด

---

## 2. ภาพที่ Data Dictionary ออกแบบไว้ (เป้าหมายเต็ม)

### 2.1 ลำดับชั้น (Hierarchy)

```
CUSTOMER ──1:N──> PROJECT ──1:N──> VEHICLE ──1:N──> DEVICE
   │                                                  ▲
   └──────────────────1:N─────────────────────────────┘
        (DEVICE.customer_id ชี้ตรงถึงลูกค้าด้วย — denormalize ไว้ query เร็ว)
```

| ตาราง | field หลัก (จาก DD) |
|---|---|
| `CUSTOMER` | `company_name`, `contact_name`, `email`, `phone`, `address`, `priority_tier` (P1–P4, แก้ได้เฉพาะ Admin) |
| `PROJECT` | `customer_id` (FK), `project_name`, `description`, `status` |
| `VEHICLE` | `project_id` (FK), `plate_number` (unique), `brand`, `model`, `status` |
| `DEVICE` | `vehicle_id` (FK), `customer_id` (FK, **บังคับ**), `imei`, `serial_number`, `hardware_revision_id`, `criticality` |

### 2.2 Config แบบหลายระดับชั้น (`CONFIG_SCOPE_LEVELS`)

DD ออกแบบให้ Config Template ผูกกับ "ระดับชั้น" 7 ชั้น เรียงจากกว้าง→แคบ:

```
GLOBAL  →  MANUFACTURER  →  MODEL  →  CUSTOMER  →  PROJECT  →  VEHICLE_GROUP  →  DEVICE
(ทั้งระบบ)                              (ลูกค้า ก.)              (กลุ่มรถ)        (กล่องเดียว)
```

ค่าจากชั้นแคบกว่า **override** ชั้นกว้างกว่า เช่น:
- ชั้น GLOBAL ตั้ง `report_interval = 60`
- ชั้น CUSTOMER "ขนส่ง ก." ตั้ง `report_interval = 30`
- → กล่องของขนส่ง ก. ใช้ `30`, กล่องคนอื่นใช้ `60`

ตารางที่เกี่ยว: `CONFIG_TEMPLATE` (มี `scope_level_id`), `CONFIG_TEMPLATE_VERSION` (เก็บ `config_values` JSONB + `status` DRAFT/APPROVED), `CONFIG_SCOPE_LEVELS` (นิยาม 7 ชั้น + `sort_order`)

---

## 3. ทำไมตอนแรกถึงตัดออก (ไม่ใช่ความผิดพลาด)

- **MVP ยังไม่ต้องใช้** — Sprint 1–3 โฟกัสที่ flow สร้าง/ทดสอบ/อนุมัติ Config ให้ครบก่อน
- **สร้าง FK ไปตารางที่ยังไม่มีไม่ได้** — ถ้าจะใส่ `Device.customerId` ต้องมีตาราง `Customer` ก่อน ซึ่งลากตาม `Project` / `Vehicle` มาทั้งพวง
- **ยังไม่รู้ business จริง** — ลูกค้าใน MVP มีกี่ราย? ต้องแยกสิทธิ์ตามลูกค้าจริงไหม? ยังไม่มีคำตอบ
- **มี comment กำกับไว้แล้ว** ว่าเป็น deviation โดยตั้งใจ + จะเติมทีหลัง:
  - [`backend/prisma/schema.prisma` — `model Device`](../backend/prisma/schema.prisma) : *"เบี่ยงจาก DD ... จะเพิ่ม FK ไปยัง Vehicle/Customer/HardwareRevision ทีหลังเมื่อ model เหล่านั้นถูกสร้างจริง"*
  - [`model Config`](../backend/prisma/schema.prisma) : *"model Config ทั้งตัวเป็นเวอร์ชันย่อของดีไซน์ template-based ใน DD"*

เอกสารนี้คือ "ทีหลัง" ที่ comment พูดถึง

---

## 4. แผนเติมกลับแบบ 3 เฟส (additive ทุกเฟส — ไม่ทำลายของเดิม)

| เฟส | ทำอะไร | schema เปลี่ยน | ขนาด | breaking? |
|---|---|---|---|---|
| **A** | เพิ่มช่อง **"ชื่อลูกค้า" เป็นข้อความเปล่า** ใน Config | `Config.customerName String?` | เล็ก | ไม่ |
| **B** | สร้างตาราง `Customer` จริง + ให้ Config/Device ชี้ไปหา (nullable) | `Customer` model ใหม่ + `Config.customerId String?` + `Device.customerId String?` | กลาง | ไม่ (nullable) |
| **C** | ระบบ scope เต็ม + คุมสิทธิ์ตามลูกค้า | `Project` / `Vehicle` / `ConfigScopeLevel` + resolve logic + RBAC | ใหญ่ | อาจมี |

### เฟส A — "ป้ายชื่อลูกค้า" (ทำได้เลยถ้าทีมโอเค)

- เพิ่ม `Config.customerName String?` — เป็นแค่ข้อความ ไม่เชื่อมกับตารางอะไร
- Frontend: ช่องกรอก "ลูกค้า (ไม่บังคับ)" ใน wizard สร้าง Config (step 1) + คอลัมน์ในตาราง Config + filter
- **ได้อะไร:** ผู้ใช้เห็นทันทีว่า Config เป็นของลูกค้าไหน, filter/ค้นหาตามลูกค้าได้
- **ยังไม่ได้อะไร:** ไม่มี master list ลูกค้า (พิมพ์ชื่อเองทุกครั้ง — สะกดไม่ตรงกันได้), ไม่มีการคุมสิทธิ์
- **migration:** `ALTER TABLE "Config" ADD COLUMN "customerName" TEXT;` — additive ล้วน เหมือน `description` ใน #117

### เฟส B — "ทะเบียนลูกค้าจริง"

- ตาราง `Customer` (เอา field จาก DD: `companyName`, `contactName`, `email`, `phone`, `priorityTier`)
- `Config.customerId String?` + `Device.customerId String?` — **nullable** (ของเดิมที่ไม่มีลูกค้ายังอยู่ได้)
- ย้ายข้อมูลจากเฟส A: ถ้า `customerName` ตรงกับ `Customer.companyName` → เซ็ต `customerId` ให้
- หน้าจอ "จัดการลูกค้า" (ใครทำ? — น่าจะ Admin, ต้องเพิ่มใน RBAC)
- **ก่อนทำต้องเช็ค orphan:** ตอนเพิ่ม FK ให้ค่าเป็น nullable ไว้ก่อน ไม่บังคับ — ตาม `CLAUDE.md` §Migration Safety
- **ได้อะไร:** เลือกลูกค้าจาก dropdown, ข้อมูลลูกค้าอยู่ที่เดียว, พร้อมต่อยอดเฟส C

### เฟส C — "scope เต็ม + คุมสิทธิ์"

- ตาราง `Project`, `Vehicle`, `ConfigScopeLevel` (7 ชั้น)
- `Device.vehicleId` → รถ → โปรเจกต์ → ลูกค้า (ตอนนี้ค่อยทำให้ `customerId` เป็น NOT NULL ได้)
- Config resolve logic: รวมค่าจากชั้น GLOBAL → ... → DEVICE
- RBAC: `ST` / `OT` เห็นเฉพาะ Device/Config ของลูกค้าที่ตัวเองรับผิดชอบ (ต้องมี mapping user ↔ customer)
- **breaking ที่เป็นไปได้:** `GET /config` เดิมคืนทุกอัน → ต้อง filter ตาม scope; openapi ต้องเพิ่ม field; mobile ต้องส่ง customer context
- **นี่คือส่วนที่ใหญ่สุด** — ควรเป็น proposal แยกของตัวเองตอนจะทำจริง

---

## 5. Trigger point — เริ่มเฟสถัดไปเมื่อไหร่

| เฟส | เริ่มเมื่อ |
|---|---|
| A | ทีมโอเค + มี slot ว่าง (ต้นทุนต่ำ ทำเมื่อไหร่ก็ได้) |
| B | มีลูกค้าจริงในระบบ **มากกว่า 1 ราย** และเริ่มสับสนว่า Config อันไหนของใคร / ต้องการรายงานแยกตามลูกค้า |
| C | ต้องการให้ `ST` / `OT` เห็นเฉพาะงานลูกค้าตัวเอง **หรือ** ต้องการ Config หลายระดับชั้น (ตั้งค่าทีเดียวใช้ทั้งลูกค้า) |

---

## 6. ผลกระทบข้ามทีม

| เฟส | A (Web + config/device) | B (Mobile + task/notification) | เอกสาร |
|---|---|---|---|
| A | wizard + ตาราง Config | — | openapi `ConfigWriteInput` / `DeviceConfigDraft` |
| B | หน้าจัดการลูกค้า + dropdown | Device Registration flow (เลือกลูกค้าตอนลงทะเบียนกล่อง) | openapi + `RBAC_Matrix.md` (สิทธิ์จัดการลูกค้า) + DD (mark ว่า implement แล้ว) |
| C | filter scope ทุกหน้า + resolve logic | task/notification ต้องรู้ customer context · Mobile filter ตามลูกค้า | `RBAC_Matrix.md` §2 + §4 ใหญ่ · openapi ทุก endpoint ที่คืน Config/Device |

---

## 7. ข้อเสนอ

1. **เฟส A — เริ่มได้เลยถ้าทีมโอเค** (เพิ่ม `Config.customerName` เป็น label) — ต้นทุนต่ำ ช่วย UX ทันที ไม่ผูกมัดอะไร
2. **เฟส B / C — รอพี่เลี้ยงเคาะตาม business need** — ไม่ทำล่วงหน้าเพราะ schema กว้างและยังไม่รู้ว่าจะใช้แบบไหนจริง
3. เอกสารนี้อัปเดตทุกรีวิวรายอาทิตย์ที่มีข้อมูลใหม่ (จำนวนลูกค้าจริง, ความต้องการแยกสิทธิ์ ฯลฯ)

---

## 8. คำถามเปิด (ถึงพี่เลี้ยง)

| # | คำถาม | ทำไมต้องรู้ |
|---|---|---|
| 1 | MVP มีลูกค้าจริงกี่ราย? | ถ้า 1 ราย เฟส A ก็พอไปได้ยาว · ถ้าหลายราย ควรวางแผนเฟส B เร็วขึ้น |
| 2 | ต้องการให้ `ST` / `OT` เห็นเฉพาะลูกค้าตัวเองไหม? | เป็นตัวตัดสินว่าต้องทำเฟส C หรือไม่ (ถ้าไม่ ก็หยุดที่ B ได้) |
| 3 | ต้องการ Config แบบ "ตั้งทีเดียวใช้ทั้งลูกค้า" (scope levels) ไหม? หรือตั้งรายกล่องพอ? | ถ้าตั้งรายกล่องพอ ไม่ต้องทำ `CONFIG_SCOPE_LEVELS` เต็มรูปแบบ |
| 4 | `priority_tier` (P1–P4) ของลูกค้า มีผลกับ flow ไหนบ้างใน MVP? | DD บอกว่ากระทบ SLA/Contract — ถ้า MVP ยังไม่มี SLA ก็เลื่อน field นี้ไปเฟสหลัง |

---

## 9. ไฟล์ที่ต้องแตะ (ตอน implement จริง)

### เฟส A
- `backend/prisma/schema.prisma` — `Config.customerName String?` + comment
- `backend/prisma/migrations/<...>_add_config_customer_name/migration.sql` — 1 บรรทัด `ADD COLUMN`
- `backend/src/config/dto/create-config.dto.ts` + `update-config.dto.ts` — `@IsOptional() @IsString() @MaxLength(...)`
- `backend/src/config/config.service.ts` — `customerName: dto.customerName` ใน create/update
- `web/src/lib/config-api.ts` — `customerName: string | null` + `ConfigWriteInput`
- `web/src/app/(app)/config/config-wizard.tsx` — ช่องกรอก step 1
- `web/src/app/(app)/config/config-table.tsx` + `config-detail-view.tsx` — คอลัมน์ / แสดงผล
- `docs/api/openapi.yaml` — `DeviceConfigDraft` + `ConfigWriteInput` + `redocly lint`
- `docs/database/GPS_Data_Dictionary.xlsx` — mark `CONFIG_TEMPLATE.customer` เทียบเท่า (หรือ note deviation)

### เฟส B / C
- (ระบุตอนเปิด proposal แยก — scope ใหญ่เกินกว่าจะ freeze ตอนนี้)

---

## Changelog

| วันที่ | โดย | หมายเหตุ |
|---|---|---|
| 2026-09-09 | paveekornk | ร่างแรก — วางแผน 3 เฟส A/B/C ไว้คุยรีวิวรายอาทิตย์ |
