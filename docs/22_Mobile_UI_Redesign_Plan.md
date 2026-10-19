# แผนรื้อ UI Mobile ใหม่ทั้งแอป ให้สอดคล้องกับ Web

> **สถานะ:** แผน รอ A (paveekornkwork-dev) รีวิว · ยังไม่มีโค้ด UI ในใบนี้ (เอกสารอย่างเดียว)
>
> **แทนที่:** `docs/20_Mobile_Redesign_Phase3_Design.md` (มติ B 19 ต.ค. 2569 — token ของ docs/20 ไม่ตรงกับ
> Web จริง ดู §1)
>
> **ที่มาของข้อมูล:** สำรวจ Mobile และ Web จาก `main` ที่ `12c9856` (19 ต.ค. 2569) · ค่าสีทุกค่าในเอกสารนี้
> แปลงจาก `oklch()` จริงใน `web/src/app/globals.css` เป็น hex (sRGB) ด้วยสคริปต์ ไม่ได้ลอกจากคอมเมนต์
> ในไฟล์ (คอมเมนต์ hex บางตัวไม่ตรงกับค่าจริง ดู §4.4)
>
> **เอกสารที่เกี่ยวข้อง:** `docs/18` (สำรวจหน้าจอ Phase 1-2), `docs/21` (UX audit รอบแรก 25 ข้อ — ข้อที่ยังค้าง
> ถูกรวมเข้า batch ใน §9), `docs/19` (Device PULL model ที่เกี่ยวกับคำถามเปิดใน §10)

---

## 1. ที่มา และทำไมแทน docs/20

- docs/20 กำหนด token ชุดใหม่ของตัวเอง (Tailwind slate/blue: `primary #2563EB`, `textPrimary #0F172A`,
  `background #F8FAFC`) และระบุไว้ว่า "ไม่แก้ Web" ถ้าทำตามนั้น Mobile กับ Web จะมี design system **คนละชุด**
  ทั้งที่เป็นระบบเดียวกันที่ Operation / ST / OT ใช้สลับกันทั้งสองฝั่ง
- Web มี design system ที่ใช้งานจริงอยู่แล้ว (`globals.css` + `components/ui/*` + `PageHeader` ฯลฯ ที่ปรับใหม่ใน
  ต.ค. 2569 รวม #339, #343) และ palette เดิมของ Mobile ก็ใกล้ Web อยู่แล้ว เช่น `AppTheme.navy #12344D`
  = Web `accent-foreground #12344D` ตรงเป๊ะ
- Mobile ตอนนี้มี palette ซ้อนกัน 2 ชุด (`navy`/`textSecondary`/... ใน 16 ไฟล์ กับ `mock*` ของ Home redesign
  ที่ลามไป 8 ไฟล์) และ hardcode อีกมาก (`Color(0x` 67 ตำแหน่ง, `fontSize:` 109, `Radius.circular(` 76 —
  docs/21 ข้อ #22)
- บางหน้าไม่มีประโยชน์จริงแล้ว (§8) ควรตัดออกก่อนลงแรงรื้อดีไซน์

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย

**เป้าหมาย**
- รื้อ UI ทุกหน้าของ Mobile ให้ใช้ token, ระบบสีสถานะ, component และคำศัพท์ชุดเดียวกับ Web
- ตัดหน้าที่ไม่ใช้แล้ว (§8) และเก็บข้อที่ค้างจาก UX audit (docs/21) ไปพร้อมกัน
- เหลือ theme ชุดเดียว ไม่มี `Color(0x` นอกไฟล์ token (มีเทสดัก)

**ไม่ใช่เป้าหมาย**
- ไม่แก้ Backend (endpoint ทุกตัวที่ Mobile ใช้ยังมีอยู่ครบ)
- ไม่แก้ Web ในแผนนี้ — ถ้าเจอจุดที่ Web ควรปรับ (เช่น §5.3, §4.4) ส่งเป็นข้อสังเกตให้ A ตัดสินใจเอง
- ไม่เพิ่มฟีเจอร์ใหม่ (ฟังก์ชันของหน้าที่เก็บไว้ต้องเหมือนเดิม)

## 3. มติของ B (19 ต.ค. 2569)

1. ยกเลิก docs/20 ใช้ design system ของ Web เป็นต้นแบบ (เอกสารนี้)
2. คำเฉพาะ (ชื่อสถานะ, ชื่อเมนู/ฟีเจอร์) เปลี่ยนเป็นภาษาอังกฤษให้ตรงกับ Web · ประโยคอธิบาย ข้อความแจ้งเตือน
   ข้อความ error และปุ่มคำกริยาทั่วไป คงภาษาไทย (§6)
3. ใช้ระบบสี **Badge** ของ Web (semantic tone: neutral / success / warning / danger / info + dot) เป็นมาตรฐาน
   **ไม่ใช้** `lib/status-pill.tsx` ที่ใช้สี Tailwind ดิบ (§5)
4. ตัดหน้า `/simulator` ("ทดสอบความพร้อม Config") — เหลือแค่ปุ่ม "ทดสอบกับ Device Simulator" ใน Task Detail
5. ตัดหน้า `/device-connection-test` ("ทดสอบสัญญาณ") และหน้าลูก `/device-connection-test/pick-device` — backend
   `DEVICE_CONNECTION_TEST_MODE=real` ยัง throw ตอน startup (ไม่มีตัวจริงให้เชื่อม) ผลเป็น mock ทุก environment
6. ลบ dead code 2 จุดเป็น PR แยกก่อน — `ApiClient.simulateConfig()` และ `isNumericDataType()` (#346)

`/devices/:id/confirm-firmware` ("ยืนยันติดตั้ง Firmware") **ยังไม่ตัดสินใจ** รอคำตอบ A (§10 ข้อ A1)

---

## 4. Design tokens (ชุดเดียวกับ Web)

ใช้ค่าจาก `web/src/app/globals.css` ทุกตัว ชื่อ token ใน Flutter ตั้งตามชื่อ CSS variable ของ Web (แปลง
kebab-case เป็น camelCase เช่น `--muted-foreground` → `mutedForeground`) ให้ค้นข้ามสองฝั่งได้ตรงๆ ·
**ต่างจาก docs/20 ที่ตั้งชุดใหม่ของตัวเอง**

### 4.1 สี — โหมดสว่าง (`:root`)

| Token (Web) | oklch | hex สำหรับ Flutter | ใช้กับ |
|---|---|---|---|
| `background` | `0.979 0.003 264.5` | `#F7F8FA` | พื้นหลังแอป |
| `foreground` | `0.267 0.028 248.9` | `#1B2733` | ข้อความหลัก (14.29:1 บน background) |
| `card` / `popover` | `1 0 0` | `#FFFFFF` | การ์ด, bottom sheet, dialog |
| `card-foreground` | `0.267 0.028 248.9` | `#1B2733` | ข้อความในการ์ด |
| `primary` | `0.528 0.13 248.3` | `#1B6FB2` | ปุ่มหลัก ลิงก์ แท็บ/รายการที่เลือก (ตัวขาวบนพื้นนี้ 5.30:1) |
| `primary-foreground` | `1 0 0` | `#FFFFFF` | ตัวอักษรบนปุ่มหลัก |
| `secondary` / `muted` | `0.957 0.006 255.5` | `#EEF1F5` | พื้นปุ่มรอง, พื้น Badge neutral |
| `secondary-foreground` | `0.267 0.028 248.9` | `#1B2733` | |
| `muted-foreground` | `0.542 0.028 259.8` | `#667080` | label, ข้อความรอง (5.02:1 บนการ์ด, 4.72:1 บน background) |
| `accent` | `0.961 0.011 243.7` | `#ECF3F9` | พื้นตอนกด/รายการที่เลือก, แถวที่ยังไม่อ่าน |
| `accent-foreground` | `0.313 0.06 243.7` | `#12344D` | (= `AppTheme.navy` เดิมของ Mobile) |
| `destructive` | `0.577 0.245 27.325` | `#E7000B` | ปุ่มอันตราย, จุดของ Badge danger |
| `success` / `-foreground` / `-subtle` | | `#4E9B6C` / `#165E3C` / `#DBF6E6` | ดู §5 |
| `warning` / `-foreground` / `-subtle` | | `#CB8315` / `#824103` / `#FEF3C9` | ดู §5 |
| `info` / `-foreground` / `-subtle` | | `#287CCF` / `#075A8E` / `#DFF2FE` | ดู §5 |
| `danger-foreground` / `danger-subtle` | | `#9D1135` / `#FFF0F2` | ดู §5 (Web ไม่มี `--danger` ตัวเข้ม ใช้ `destructive` แทน) |
| `border` | `0.923 0.008 253.9` | `#E2E6EB` | ขอบการ์ด เส้นแบ่ง (ของตกแต่ง 1.25:1 ไม่ต้องถึง 3:1) |
| `input` | `0.923 0.008 253.9` | `#E2E6EB` | ⚠️ ดู §4.3 |
| `ring` | `0.528 0.13 248.3` | `#1B6FB2` | focus ring (= primary) |
| `sidebar` | `0.311 0.066 246.6` | `#0F3350` | Web ใช้กับ chrome ด้านข้าง · Mobile: ใช้กับ AppBar ถ้ายังมี AppBar สีเข้ม (§10 ข้อ B5) |

### 4.2 สี — โหมดมืด (`.dark`)

Web มีครบทุก token (เช่น `background #0F1620`, `foreground #E8ECF1`, `card #16202C`, `primary #4FA3D9`,
`muted-foreground #93A0AE`, `border #283442`, `input #2F3E4E`, semantic `-foreground`/`-subtle` ผ่าน 4.5:1 ทุกคู่
ที่ 8.47–8.96:1) · จะยก dark ทั้งชุดมาด้วยหรือล็อก `ThemeMode.light` เป็นคำถามเปิด §10 ข้อ B4 (docs/21 ข้อ #24)

### 4.3 ขอบช่องกรอก (จุดเดียวที่เสนอให้ต่างจาก Web) — ไม่แน่ใจ ต้องถาม B

- Web ใช้ `--input` = `--border` = `#E2E6EB` ได้ **1.25:1** บนพื้นขาว **ไม่ผ่าน** WCAG 1.4.11 (ขอบของ UI
  component ที่ต้องเห็นเพื่อใช้งาน ต้อง ≥ 3:1)
- Mobile เคยแก้ข้อนี้แล้วใน #335 (`AppTheme.inputBorder #778DA4` 3.43:1) ถ้ายก `--input` ของ Web มาตรงๆ จะ
  **ถอยหลัง**
- **ข้อเสนอ:** ขอบช่องกรอกของ Mobile ใช้ `muted-foreground #667080` (5.01:1) — เป็น token ที่มีอยู่แล้วใน Web
  ไม่ได้เพิ่มสีใหม่ · และแจ้ง A เป็นข้อสังเกตว่า Web มีปัญหาเดียวกัน (ไม่บังคับแก้)

### 4.4 ข้อสังเกต: คอมเมนต์ hex ใน globals.css ไม่ตรงค่าจริงบางตัว

ค่าที่ browser แสดงจริงคือ `oklch()` ไม่ใช่คอมเมนต์ ตัวที่ต่าง: `primary` (คอมเมนต์ `#1C6FB2` / จริง `#1B6FB2`),
`success` (`#3F9D6B` / `#4E9B6C`), `success-foreground` (`#1F6B45` / `#165E3C`), `warning` (`#D08A1E` / `#CB8315`),
`warning-foreground` (`#92400E` / `#824103`), `info` (`#2A78D6` / `#287CCF`), `info-foreground`, `danger-foreground`,
และ `-subtle` ทุกตัวต่างเล็กน้อย · Mobile ใช้ค่าที่แปลงจาก oklch (คอลัมน์ hex ใน §4.1) · แจ้ง A เป็นข้อสังเกต

### 4.5 Radius, ตัวอักษร, ระยะห่าง

- **Radius:** Web `--radius: 0.625rem` = **10px** และสเกล `sm 6 · md 8 · lg 10 · xl 14 · 2xl 18` (px) · การ์ด
  ปุ่ม และช่องกรอก ใช้ `lg` (10) ตาม `card.tsx` / `button.tsx` / `input.tsx` (`rounded-lg`) · ป้าย (Badge) เป็น `full`
- **ความสูงปุ่ม/ช่องกรอก (ต่างจาก Web โดยตั้งใจ):** Web ใช้ `h-8` (32px) ซึ่งเหมาะกับเมาส์ แต่ต่ำกว่าพื้นที่กด
  ขั้นต่ำบนมือถือ (Material 48dp) · Mobile คงความสูงขั้นต่ำ **48** เหมือนปุ่มหลักตอนนี้ (#335) ใช้แค่สี radius
  ตัวอักษร และ variant ตาม Web
- **ตัวอักษร:** **Noto Sans Thai Looped** (น้ำหนัก 400 / 500 / 600 / 700) แบบเดียวกับ Web (`app/layout.tsx`) ·
  ตัวเลข/รหัสเครื่องใช้ monospace (Web ใช้ Geist Mono — ฝั่ง Mobile เลือกตอน Batch 3 ว่าจะ bundle ตัวไหน)
  - **bundle เป็น asset** ใน `mobile/assets/fonts/` พร้อม `OFL.txt` (SIL Open Font License 1.1) ไม่ใช้ `google_fonts`
    ที่โหลดจากเน็ต — ช่างใช้แอปตอนออฟไลน์บ่อย ถ้าโหลดฟอนต์ไม่ได้ตัวไทยจะเป็นกล่องสี่เหลี่ยม (เหตุผลเดิมจาก
    docs/20 ยังใช้ได้)
  - ตรวจขนาด APK ที่เพิ่มขึ้นและรายงานใน PR ของ Batch 3
- **ขนาดตัวอักษร:** อิงสเกลของ Tailwind ที่ Web ใช้ (`text-xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24`) ·
  หัวหน้าจอ = `2xl` semibold ตาม `PageHeader` ของ Web (บนจอมือถืออาจลดเป็น `xl` — ตัดสินตอน Batch 4 พร้อม
  screenshot)
- **ระยะห่าง:** สเกล 4px ของ Tailwind (`1 = 4px`) · การ์ดใช้ padding 16 (`--card-spacing: spacing(4)`) ขนาดเล็ก 12

---

## 5. ระบบสีสถานะ: Badge (semantic tone + dot)

### 5.1 ค่าของแต่ละ tone (ตาม `web/src/components/ui/badge.tsx`)

| Tone | พื้น | ตัวอักษร | จุด (`dot`) | contrast ตัวอักษร (สว่าง / มืด) |
|---|---|---|---|---|
| `neutral` | `secondary #EEF1F5` | `secondary-foreground` 80% | `muted-foreground` 60% | 7.32 / 8.39 |
| `success` | `success-subtle #DBF6E6` | `success-foreground #165E3C` | `success #4E9B6C` | 6.74 / 8.78 |
| `warning` | `warning-subtle #FEF3C9` | `warning-foreground #824103` | `warning #CB8315` | 6.95 / 8.92 |
| `danger` | `danger-subtle #FFF0F2` | `danger-foreground #9D1135` | `destructive #E7000B` | 7.40 / 8.47 |
| `info` | `info-subtle #DFF2FE` | `info-foreground #075A8E` | `info #287CCF` | 6.43 / 8.96 |

ทรง: `rounded-full`, padding 8×2, ตัวอักษร 12 medium · **ป้ายสถานะใส่ `dot` เสมอ** (สีไม่ใช่สิ่งเดียวที่สื่อ
ความหมาย) · กติกาจาก Web: success/warning/danger/info = สถานะที่ผู้ใช้ต้องรู้ความหมายของสี, **neutral = ทุกอย่าง
ที่ไม่ใช่สถานะ** (ประเภท, protocol, จำนวน) · ไม่เปิดให้ส่งสีเองผ่าน prop

### 5.2 Mapping สถานะของ Mobile → tone

ยึด mapping ที่ Web ใช้อยู่แล้วใน `lib/status-pill.tsx` (เปลี่ยนแค่ tone `progress` ของ status-pill เป็น `warning`
ของ Badge เพราะ Badge ไม่มี `progress`) สถานะที่ Web ไม่มีหน้า (Task) เสนอตามหลักเดียวกัน

| กลุ่ม | ค่า (wire) | Tone | ที่มา |
|---|---|---|---|
| Task status | `pending` | neutral | เสนอ (Web ไม่มีหน้า Task) |
| | `in_progress` | warning | เสนอ — ตามหลัก "กำลังดำเนินการ" = `progress` ของ Web (เช่น `investigating`) |
| | `completed` | success | เสนอ |
| | `cancelled` | neutral | เสนอ |
| Task urgency | `overdue` | danger | เสนอ |
| | `dueSoon` | warning | เสนอ |
| Incident status | `open` | danger | Web `INCIDENT_STATUS_TONE` |
| | `investigating` | warning | Web (`progress`) |
| | `rolled_back` | info | Web |
| | `resolved` | success | Web |
| | `dismissed` | neutral | Web |
| Incident severity | `critical` | danger | Web `INCIDENT_SEVERITY_TONE` |
| | `high` | warning | Web (`progress`) |
| | `medium` | info | Web |
| | `low` | neutral | Web |
| Device lifecycle | `registered` | neutral | Web `DEVICE_STATUS_TONE` |
| | `installed` | success | Web |
| | `decommissioned` | danger | Web |
| Payload status (Config / Firmware) | `up_to_date` | success | Web `DEVICE_PAYLOAD_STATUS_TONE` |
| | `pending` | warning | Web (`progress`) |
| | `failed` | danger | Web |
| | `unknown` | neutral | Web |
| ซิงค์ในเครื่อง (Mobile เท่านั้น) | รอซิงก์ (`PendingSyncBadge`) | warning | เสนอ |
| | ซิงก์ไม่สำเร็จ (`SyncFailedBanner`) | danger | เสนอ |
| ประเภท Incident source, ประเภทแจ้งเตือน, protocol ฯลฯ | ทุกค่า | neutral | กติกา Badge (ไม่ใช่สถานะ) |

### 5.3 ข้อควรรู้: หน้าจริงของ Web ยังใช้ status-pill อยู่

สำรวจแล้ว `Badge` ของ Web **ยังไม่ถูกใช้ในหน้าจริงเลย** (มีแค่ใน `page-header.test.tsx`) หน้าจริง 20 ไฟล์ยังใช้
`StatusPill` (สี Tailwind sky/amber/emerald/rose) ผลคือหลัง Mobile เปลี่ยนเป็น Badge **สีสถานะของ Mobile กับหน้า
Web ปัจจุบันจะต่างกันเล็กน้อย** จนกว่า Web จะย้ายไป Badge เหมือนกัน · ไม่บล็อกแผนนี้ (B ตัดสินแล้วว่าใช้ Badge)
แต่ถาม A ไว้ใน §10 ข้อ A3 ว่า Web มีแผนย้ายไหม

---

## 6. ภาษา: คำศัพท์สถานะ / เมนู

**กติกา (มติ B ข้อ 2):** เปลี่ยนเฉพาะ**คำเฉพาะ** = ชื่อสถานะ และชื่อเมนู/ฟีเจอร์ ให้ตรงกับ Web · **คงภาษาไทย**:
ประโยคอธิบาย, ข้อความแจ้งเตือน/ยืนยัน, ข้อความ error ("โหลด…ไม่สำเร็จ" + "ลองใหม่" ตรงกับ Web อยู่แล้ว),
ชื่อแจ้งเตือน (Web เองก็เป็นไทย), ปุ่มคำกริยา (บันทึกสถานะ, ส่งรายงานปัญหา, ยืนยัน, ยกเลิก, ออกจากระบบ),
หัวข้อส่วน (ทางลัด, ประวัติงานล่าสุด)

label ทุกตัวในตารางนี้จะรวมไว้ไฟล์เดียว (`lib/core/ui/labels.dart` หรือชื่อที่ตกลงตอน Batch 5) พร้อมเทสว่า
ทุกค่าของ enum มี label — ไม่ให้แต่ละหน้าเขียนเอง

⚠️ = **ไม่แน่ใจ ต้องถาม B** (รวมไว้ใน §10 ส่วน B ด้วย)

### 6.1 ชื่อสถานะ (เปลี่ยน)

| กลุ่ม | ค่า (wire) | Mobile ตอนนี้ | Web ตอนนี้ | ใหม่ |
|---|---|---|---|---|
| Incident status | `open` | เปิดอยู่ | `Open` (ตัวกรอง) · `open` (ป้าย) | **Open** |
| | `investigating` | กำลังตรวจสอบ | `Investigating` · `investigating` | **Investigating** |
| | `rolled_back` | Rollback แล้ว | Rollback แล้ว | ⚠️ ตาม Web ตรงๆ = "Rollback แล้ว" (Web เป็นไทย) หรือ "Rolled back" |
| | `resolved` | แก้ไขแล้ว | `Resolved` · `resolved` | **Resolved** |
| | `dismissed` | ไม่ใช่ปัญหา/ยกเลิก | ไม่ต้องดำเนินการ | ⚠️ ตาม Web = "ไม่ต้องดำเนินการ" (Web เป็นไทย และตั้งใจไม่ใช้ "ไม่ใช่ปัญหา") หรือ "Dismissed" |
| Incident severity | `critical` / `high` / `medium` / `low` | วิกฤต / สูง / ปานกลาง / ต่ำ | ค่าดิบ `critical` … | **Critical / High / Medium / Low** ⚠️ ตัวพิมพ์ (ดูหมายเหตุ) |
| Device lifecycle | `registered` / `installed` / `decommissioned` | ลงทะเบียนแล้ว / ติดตั้งแล้ว / ปลดระวาง | ค่าดิบ `registered` … | **Registered / Installed / Decommissioned** ⚠️ ตัวพิมพ์ |
| Payload status | `up_to_date` | อัปเดตล่าสุด | เป็นปัจจุบัน | ⚠️ Web เป็นไทย — ตาม Web = "เป็นปัจจุบัน" หรือ "Up to date" |
| | `pending` | รออัปเดต | รอรับ Config / รอติดตั้ง Firmware | ⚠️ เหมือนข้อบน |
| | `failed` | ล้มเหลว | ล้มเหลว | ⚠️ เหมือนข้อบน (ตอนนี้ตรงกันอยู่แล้ว) |
| | `unknown` | ไม่ทราบ | ยังไม่เคยอยู่ใน Rollout | ⚠️ เหมือนข้อบน |
| Task status (Web ไม่มีหน้า Task) | `pending` / `in_progress` / `completed` / `cancelled` | รอดำเนินการ / กำลังทำ / เสร็จแล้ว / ยกเลิก | — | ⚠️ เสนอ **Pending / In Progress / Completed / Cancelled** |
| Task urgency (Mobile เท่านั้น) | `overdue` / `dueSoon` | เลยกำหนด / ใกล้ถึงกำหนด | — | ⚠️ เสนอ **Overdue / Due soon** หรือคงไทย (ใกล้ประโยคมากกว่าชื่อสถานะ) |
| Config status (ถ้ามีหน้าที่แสดง) | `draft` / `testing` / `approved` / `rejected` / `synced` | — | ค่าดิบ · Badge ตัวอย่างใช้ `Testing` / `Rejected` | **Draft / Testing / Approved / Rejected / Synced** |

**หมายเหตุเรื่องตัวพิมพ์ ⚠️:** Web เองยังปนกัน — ตัวกรอง Incident เขียน `Open` แต่ป้ายในตาราง/หน้ารายละเอียด
แสดงค่าดิบ `open` (เพราะ `statusLabel()` แปลแค่สถานะหลายคำ) ส่วนตัวอย่างของ Badge ใช้ `Testing` / `Rejected` ·
**เสนอ:** Mobile ใช้ตัวแรกพิมพ์ใหญ่ (`Open`, `Registered`) ตามตัวอย่าง Badge และแจ้ง A เป็นข้อสังเกต · B ยกตัวอย่าง
ในมติเป็นตัวเล็ก (`registered/installed/decommissioned`) จึงต้องยืนยันอีกครั้ง

### 6.2 ชื่อเมนู / ฟีเจอร์ / หัวหน้าจอ (เปลี่ยน)

| ที่ใช้ | Mobile ตอนนี้ | Web | ใหม่ |
|---|---|---|---|
| ทางลัด + หัวหน้า Device Search | ค้นหาอุปกรณ์ | `Device Search` (เมนู) | **Device Search** |
| ทางลัด + หัวหน้ารายการ Incident | ดู Incident / รายการ Incident | `Incident & Rollback` (เมนู) | ⚠️ "Incidents" (Mobile ไม่มี Rollback) หรือ "Incident & Rollback" ตาม Web ตรงๆ |
| ทางลัด + หัวหน้าแจ้งปัญหา | แจ้งปัญหา / แจ้งปัญหาหน้างาน | `Field Report` (ใช้ในหน้า Incident) | **Field Report** |
| หน้า Override ค่า | Override ค่าพารามิเตอร์ | `Config Override` | **Config Override** |
| หน้าขอ Firmware Override | ขอ Firmware Override | `Firmware Override` | **Firmware Override** |
| หน้ายืนยันติดตั้ง Firmware | ยืนยันติดตั้ง Firmware | — | รอ §10 ข้อ A1 |
| ทางลัด + หัวหน้ารายการงาน | งานของฉัน | — (Web ไม่มีหน้า Task) | ⚠️ เสนอ "My Tasks" |
| หัวหน้ารายการแจ้งเตือน | รายการแจ้งเตือน | (ไม่มีหน้าแยก มีแค่กระดิ่ง) | ⚠️ เสนอ "Notifications" |
| หน้าแรก | (ไม่มีชื่อ) | `Dashboard` | ⚠️ "Dashboard" หรือ "Home" (ขึ้นกับ §10 ข้อ B5 เรื่องแท็บ) |
| หัวหน้าหน้ารายละเอียด | รายละเอียดงาน / อุปกรณ์ / Incident | ใช้ชื่อ record เป็นหัวหน้า (เช่น `DEV-0001`) | ⚠️ เสนอตาม Web: หัวหน้า = ชื่องาน / เลขเครื่อง / หัวข้อ Incident |
| ป้าย Role บน Home | `ST • ช่างภาคสนาม` | `ST` (`formatRoleLabel` แยกคำ เช่น `Super Admin`) | ⚠️ ตาม Web = "ST" อย่างเดียว หรือคงคำอธิบายไทยไว้ต่อท้าย |
| ทางลัดที่ถูกตัด | ทดสอบการตั้งค่า, ทดสอบสัญญาณ | — | ตัดออก (§8) |

### 6.3 คงภาษาไทย แต่ปรับให้ตรงกับ Web

| เรื่อง | Mobile | Web | ใหม่ |
|---|---|---|---|
| การสะกด sync | ซิงค์ (9 จุด) | ซิงก์ | **ซิงก์** ตาม Web |
| ชื่อแจ้งเตือน `incident_alert` | แจ้งเตือนเหตุการณ์ | แจ้งเตือนเหตุการณ์ (เขียน Config ไม่สำเร็จ) | ตาม Web |
| ชื่อแจ้งเตือนอื่น | ตรงกับ Web อยู่แล้ว | | คงเดิม |
| ข้อความ error / ปุ่มลองใหม่ | "โหลด…ไม่สำเร็จ" + "ลองใหม่" | เหมือนกัน | คงเดิม |

---

## 7. Component ที่พอร์ตจาก Web

ทุกตัวอยู่ที่ `mobile/lib/core/ui/` (ชื่อไฟล์ตกลงตอน Batch 4) อ่านค่าจาก token ใน §4 เท่านั้น มี widget test ทุกตัว

| Web | แนวคิดที่ยกมา | Mobile (ชื่อเสนอ) | ใช้กับหน้า |
|---|---|---|---|
| `PageHeader` | หัวหน้าจอมาตรฐาน: title + status (Badge) + meta + actions · description บอกว่าหน้าใช้ทำอะไร **ไม่ใช่เรื่องสิทธิ์** · ปุ่มที่ role ทำไม่ได้ **ซ่อน** · ปุ่มที่ติดเงื่อนไขชั่วคราว **disable พร้อมเหตุผล** | `AppPageHeader` | ทุกหน้ายกเว้น Login · หน้ารายละเอียด (Task, Device, Incident) ใส่ status + meta |
| `Badge` | 5 tone + dot (§5) | `AppBadge` | ทุก pill เดิม: `TaskStatusPill`, `IncidentSeverityPill`/`IncidentStatusPill`, `DeviceStatusPill`, payload status, urgency, `PendingSyncBadge` |
| `Card` | ขอบบาง `foreground` 20% **ไม่มีเงา** · การ์ดกดได้ ขอบเข้มขึ้น 40% ตอนกด (แทน hover) · radius 10 · padding 16 / 12 | `AppCard` (+ `interactive`) | การ์ดทุกหน้า แทน `mockShadowCard` / `mockShadowRow` |
| `InfoRow` | แถว label/value (+ icon ได้) ในหน้ารายละเอียด | `AppInfoRow` | Task Detail (`_InfoCard`), Device Detail, Incident Detail |
| `EmptyState` | icon + ข้อความ + ปุ่ม action ชวนทำขั้นต่อไป แทนข้อความลอยๆ | `AppEmptyState` | รายการงาน, Device Search (ไม่พบ), รายการ Incident, แจ้งเตือน, ประวัติงานบน Home |
| `skeleton/*` | card-list / detail skeleton แทน "กำลังโหลด…" | `AppListSkeleton`, `AppDetailSkeleton` (แทน `SkeletonCard` เดิม) | ทุกหน้า list / detail ตอน fetch ครั้งแรก |
| `WizardStepIndicator` | ตัวบอกขั้นของงานหลายขั้น | `AppStepIndicator` | Task Detail ส่วน "ส่ง Config เข้าเครื่อง" (ทดสอบ → ส่ง) · Field Report ถ้าแบ่งขั้น (ตัดสินตอนทำ) |
| `SensitiveValue` | mask ค่าเป็นค่าเริ่มต้น + ปุ่มแสดง/ซ่อนที่มี label (`sensitive` เป็นแค่ flag การแสดงผล ไม่ใช่การเข้ารหัส) | `AppSensitiveValue` | Config Override (field ที่ `sensitive`) · ปิด docs/21 ข้อ #20 (ปุ่มตาไม่มี tooltip/semanticLabel) |
| `Button` variants | `default` (primary) / `outline` / `secondary` / `ghost` / `destructive` / `link` · ปุ่มหลักวางท้ายสุด | `ThemeData` button themes + `AppButton.variant` | ทุกหน้า · ปิด docs/21 ข้อ #11 (Task Detail มี FilledButton 2 ปุ่มเท่ากัน → ปุ่มหลัก 1 + outline 1) |
| (ของเดิม Mobile ที่คงไว้) | `AppErrorView`, `OfflineCacheBanner`, `SyncFailedBanner`, `SyncAuthExpiredBanner` | ย้ายมาใช้ token / `AppBadge` | ตามเดิม |

---

## 8. ตารางหน้าทั้งหมด (สถานะหลังมติ)

ทุก endpoint ที่ Mobile เรียกยังมีอยู่ใน backend (`main` `12c9856`) และไม่มีตัวไหน `deprecated` ใน `openapi.yaml`

| Route / ไฟล์ | ใครเห็น | ปุ่ม/action หลัก | API | สถานะ | Batch |
|---|---|---|---|---|---|
| `/` splash | ตอนเปิดแอป | — | — | คงเดิม | — |
| `/login` `login_page.dart` | ทุกคน | เข้าสู่ระบบ | `POST /auth/login` | รื้อดีไซน์ · แก้ hint mock mode ที่ยังอ้าง `sw`/`admin`/`audit` (docs/21 #19) | 6 |
| `/home` `home_page.dart` | ทุกคน (ST/OT เห็น banner + งานด่วน + ประวัติ) | ทางลัด, กระดิ่ง, ออกจากระบบ | `GET /tasks` | รื้อดีไซน์ · ทางลัดหลังตัด 2 ตัว: ST/OT เหลือ 4 (Device Search, Field Report, Incidents, My Tasks) · role อื่นเหลือ 2 (Device Search, Incidents) · ระยะกระดิ่ง–ปุ่ม logout (docs/21 #6) | 7 |
| `/tasks` `task_list_page.dart` | ST/OT | รายการงาน | `GET /tasks` | รื้อดีไซน์ | 8 |
| `/tasks/:id` `task_detail_page.dart` | ST/OT, Operation (เพิ่มบันทึก) | บันทึกสถานะ, timeline + เพิ่มบันทึก, ทดสอบกับ Device Simulator (ไม่บังคับ), ส่ง Config เข้าเครื่อง | `GET/PATCH /tasks/:id`, `GET /tasks/:id/events`, `POST /tasks/:id/notes`, `POST /devices/:id/simulate-config`, `POST /devices/:id/apply-config` | รื้อดีไซน์ · **เป็นที่เดียวที่เหลือของ Device Simulator** · ปุ่มหลัก/รอง (docs/21 #11) | 8 |
| `/simulator` `simulator_page.dart` | ST/OT | ทดสอบความพร้อม Config | `GET /config`, `POST /devices/:id/simulate-config` | **ตัดออก** (มติ B ข้อ 4) | 1 |
| `/device-connection-test` `device_connection_test_page.dart` | ST/OT | ทดสอบสัญญาณ | `POST /devices/:id/test-connection` | **ตัดออก** (มติ B ข้อ 5) | 2 |
| `/device-connection-test/pick-device` `company_device_picker_page.dart` | จากหน้าบนเท่านั้น | เลือกบริษัท → อุปกรณ์ | `GET /customers`, `GET /devices` | **ตัดออก** พร้อมหน้าแม่ | 2 |
| `/devices` `device_search_page.dart` | ทุกคน | ค้นหาอุปกรณ์ | `GET /devices` | รื้อดีไซน์ | 9 |
| `/devices/:id` `device_detail_page.dart` | ทุกคน | ปุ่ม Config Override (ST), Firmware Override (ST), ยืนยันติดตั้ง Firmware (ST/OT) | `GET /devices/:id`, `GET /devices/:id/status` | รื้อดีไซน์ | 9 |
| `/devices/:id/config-override` | ST | แก้ค่าเฉพาะ field แล้วส่งคำขอ | `GET /devices/:id/config`, `GET /config-definitions`, `POST /devices/:id/config-override` | รื้อดีไซน์ · ใช้ `AppSensitiveValue` (docs/21 #20) | 9 |
| `/devices/:id/firmware-override` | ST | เลือก Firmware ส่งคำขอ | `GET /firmware`, `POST /devices/:id/firmware-override` | รื้อดีไซน์ | 9 |
| `/devices/:id/confirm-firmware` | ST/OT | ยืนยันติดตั้ง Firmware | `GET /firmware`, `GET /devices/:id/status`, `POST /devices/:id/confirm-firmware-install` | **รอ A ตัดสินใจ** (§10 ข้อ A1) — รื้อดีไซน์ใน Batch 9 หรือตัดออกเป็น batch แยก | 9 / แยก |
| `/incidents` `incident_list_page.dart` | ทุกคน | ดูรายการ (อ่านอย่างเดียว) | `GET /incidents` | รื้อดีไซน์ · padding ลิงก์เลขเครื่อง (docs/21 #18) | 10 |
| `/incidents/:id` `incident_detail_page.dart` | ทุกคน | ดูรายละเอียด | `GET /incidents/:id` | รื้อดีไซน์ | 10 |
| `/incident-report` `field_report_page.dart` | ST/OT | ส่งรายงานปัญหา | `POST /incidents` | รื้อดีไซน์ | 10 |
| `/notifications` `notification_list_page.dart` | ทุกคน | ดูแจ้งเตือน, อ่านแล้ว | `GET /notifications`, `PATCH /notifications/:id/read` | รื้อดีไซน์ | 11 |
| push (`push_message_handler.dart`) | — | พาไปหน้า Task / Incident / แจ้งเตือน | `POST/DELETE /notifications/device-tokens` | ไม่มี UI ไม่ต้องรื้อ · เช็คว่าไม่ deep link ไปหน้าที่ถูกตัด | 1–2 |

**ผลพ่วงจากการตัด 2 หน้า** (สำรวจ import แล้ว ต้องทำใน Batch 1–2):
- `/simulator`: ลบ `simulator_page.dart`, `config_repository.dart` (`deployableConfigListProvider`) และ
  `ApiClient.listConfigs()` (Mobile จะไม่เรียก `GET /config` อีก) · **ต้องเก็บ** `simulator_repository.dart` และ
  `simulation_result_card.dart` เพราะ Task Detail ใช้ (ย้ายไป `features/task/` ได้) · `DeviceConfigDraft` ยังใช้
  ใน Config Override
- `/device-connection-test`: ลบทั้ง `features/device_connection_test/` · `auth_controller.dart` เรียก
  `recentDeviceIdStoreProvider.clear()` ตอน logout ต้องเอาออก และควรล้างค่าเก่าใน SharedPreferences ที่เครื่องเคย
  บันทึกไว้หนึ่งครั้ง · `ApiClient.listCustomers()` (`GET /customers`) จะไม่มีใครใช้ ลบด้วย
- เทสที่อ้างถึง 2 หน้านี้ 12 ไฟล์ เช่น `simulator_page_test.dart`, `device_connection_test_page_test.dart`,
  `home_page_test.dart` (key `shortcut_simulator` / `shortcut_device_test`), `color_contrast_test.dart`,
  `primary_button_consistency_test.dart` — แก้ในใบเดียวกับที่ตัดหน้า

---

## 9. ลำดับงาน (batch)

ใช้วิธีเดียวกับ UX audit 25 ข้อ (#329 / #331 / #333 / #334 / #335 / #338): **batch เล็ก 1 batch = 1 PR**,
**TDD** (เขียนเทสที่ fail ก่อน), แต่ละ batch แตะไฟล์ไม่ซ้อนกับ PR อื่นที่เปิดอยู่, sync `main` ผ่าน CLI ก่อนเปิด/ก่อน
merge, ใช้ผล `dart format` ของ CI (Flutter 3.47.7) ไม่แก้ format ตามเครื่องตัวเอง (3.44.8), ไม่ merge เอง

| Batch | งาน | เงื่อนไขว่าเสร็จ (คร่าวๆ) |
|---|---|---|
| 0 | ลบ dead code `simulateConfig()` / `isNumericDataType()` — **#346** | เปิดแล้ว รอรีวิว |
| 1 | ตัด `/simulator` + ผลพ่วง (§8) | route/ทางลัด/ไฟล์ออกครบ · Task Detail ยังทดสอบกับ Simulator ได้ · เทส + E2E เขียว |
| 2 | ตัด `/device-connection-test` + `/pick-device` + ผลพ่วง | เหมือน Batch 1 · logout ไม่พัง · ล้างค่า recent device id เก่า |
| 3 | Token + theme ใหม่ (`AppColors` ตามชื่อ Web, `AppTypography`, `AppTheme.v2()`), bundle Noto Sans Thai Looped + `OFL.txt` · **ยังไม่สลับทั้งแอป** | เทส contrast ทุกคู่ใน §4–§5 · ขอบช่องกรอก ≥ 3:1 · รายงานขนาด APK |
| 4 | Component กลาง (§7) | widget test ทุกตัว · ยังไม่แตะหน้าเดิม |
| 5 | ไฟล์ label กลาง (§6) + เปลี่ยน pill เดิมทุกตัวเป็น `AppBadge` | เทสว่าทุกค่า enum มี label + tone · หน้าเดิมยังใช้งานได้ |
| 6 | ย้ายหน้า Login | ใช้ token/component ใหม่ · ไม่มี `Color(0x` ในโมดูล · Key เดิมครบ |
| 7 | ย้าย Home (+ รูปแบบการนำทางตาม §10 ข้อ B5) | เหมือนข้างบน |
| 8 | ย้าย Task List + Task Detail (+ งาน Step 4.1 ใน docs/20 เดิม: แยกข้อความ ออฟไลน์ / 401 / 5xx / 4xx อื่น ยกเว้น 408/429 — ยกเงื่อนไขว่าเสร็จมาทั้งหมด) | เหมือนข้างบน + เทสแยกกรณี error ครบ |
| 9 | ย้าย Device Search / Detail / Config Override / Firmware Override (+ confirm-firmware ตามคำตอบ A1) | เหมือนข้างบน |
| 10 | ย้าย Incident List / Detail / Field Report | เหมือนข้างบน |
| 11 | ย้าย Notifications | เหมือนข้างบน |
| 12 | สลับ ThemeData ทั้งแอปเป็น v2 · ลบ token เก่า (`navy`, `mock*` ฯลฯ) · เทสดัก `Color(0x` นอกไฟล์ token · dark mode ตาม §10 ข้อ B4 · ปิด docs/21 ข้อ #21, #22, #24 · อัปเดตสถานะใน docs/21 | grep `Color(0x` ใน `lib/` เหลือแค่ไฟล์ token · E2E เขียว |

- Batch 1–2 ทำก่อน token เพื่อไม่ลงแรงรื้อหน้าที่จะถูกตัด
- Batch 6–11 สลับลำดับกันได้ แต่ทำทีละใบ และระหว่างทางครอบ theme ใหม่เฉพาะหน้าที่ย้ายแล้ว (หน้าที่โชว์จะไม่มี
  สีปนกัน)
- docs/21 ข้อ #7 / #25 (applicationId, keystore, ชื่อแอป, ไอคอน) ไม่อยู่ในแผนนี้ ต้องคุยกับทีมแยก

---

## 10. คำถามเปิด

### ถึง A

- **A1. "ยืนยันติดตั้ง Firmware" ยังจำเป็นไหมหลังเปลี่ยนเป็น PULL model?** — Web บอก Operation ตอนปล่อย
  Rollout ว่า "ระบบกำลัง apply ให้ทุกเครื่องอัตโนมัติ (PULL model) ไม่ต้องรอช่างกดยืนยันที่เครื่องอีกต่อไป"
  (`lib/status-pill.tsx`) แต่ Mobile ยังมีหน้า `/devices/:id/confirm-firmware` ให้ ST/OT กดยืนยัน
  (`POST /devices/{id}/confirm-firmware-install` ยัง active เขียน AuditLog และเช็คว่าตรงกับ Firmware ที่ Campaign
  กำหนดไหม ถ้าไม่ตรงต้องขอ Firmware Override ก่อน) — ปุ่มนี้ยังมี use case จริงไหม (เช่น ช่างเปลี่ยน
  Firmware ด้วยมือหน้างานนอก Campaign) หรือควรตัดออก · ถ้าตัด backend endpoint จะเก็บไว้หรือเลิกใช้
- **A2.** (ข้อสังเกต ไม่บล็อก) คอมเมนต์ hex ใน `globals.css` ไม่ตรงกับค่า oklch จริงหลายตัว (§4.4) และ `--input`
  ได้ 1.25:1 ไม่ถึง 3:1 สำหรับขอบช่องกรอก (§4.3)
- **A3.** หน้าจริงของ Web ยังใช้ `StatusPill` ทั้งหมด `Badge` ยังไม่ถูกใช้ (§5.3) — Web มีแผนย้ายไป Badge ไหม
  (ถ้าย้าย สีสถานะสองฝั่งจะตรงกัน) และป้ายสถานะคำเดียวที่แสดงค่าดิบตัวเล็ก (`open`, `registered`) จะเปลี่ยนเป็น
  ตัวแรกพิมพ์ใหญ่ไหม (§6.1)

### ถึง B (จุดที่เขียนว่า "ไม่แน่ใจ" ในเอกสารนี้)

- **B1.** สถานะที่ Web เองเป็นภาษาไทย (`rolled_back` = "Rollback แล้ว", `dismissed` = "ไม่ต้องดำเนินการ",
  payload status ทั้ง 4 ค่า) — ตาม Web ตรงๆ (คงไทย) หรือเปลี่ยนเป็นอังกฤษล้วน (§6.1)
- **B2.** ตัวพิมพ์ของสถานะ: `Registered` หรือ `registered` (§6.1 หมายเหตุ)
- **B3.** ชื่อที่ Web ไม่มีให้เทียบ: Task status / urgency, "My Tasks", "Notifications", หน้าแรก, Incidents vs
  "Incident & Rollback", หัวหน้าหน้ารายละเอียด, ป้าย Role (§6.1–6.2)
- **B4.** Dark mode: ยก `.dark` ของ Web มาทั้งชุด หรือล็อก `ThemeMode.light` (docs/21 #24)
- **B5.** การนำทาง: docs/20 วางแท็บด้านล่างตาม role ไว้ (ยกเลิกไปพร้อม docs/20) — แผนใหม่จะใช้แท็บด้านล่าง,
  คงหน้าแรกแบบทางลัดเหมือนตอนนี้, หรือแบบอื่น · และหน้าจอยังมี AppBar สีเข้ม (`sidebar #0F3350`) หรือใช้พื้นอ่อน
  ตาม `PageHeader` ของ Web
- **B6.** ขอบช่องกรอกใช้ `muted-foreground #667080` ต่างจาก Web (§4.3) ได้ไหม
