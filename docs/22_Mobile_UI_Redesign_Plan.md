# แผนรื้อ UI Mobile ใหม่ทั้งแอป ให้สอดคล้องกับ Web

> **สถานะ:** แผน — A (paveekornkwork-dev) รีวิวและ approve แล้ว (#347) · ร่างแรก 19 ต.ค. 2569
> · ปรับตามการตัดสินใจรอบ 2 ของ B วันเดียวกัน (§3) · อัปเดตตามคำตอบของ A (§10) และมติ §5.2 ของ B วันเดียวกัน
> (§3 ข้อ 17–18) · อัปเดตตามค่าจริงของ Web หลัง #344 merge (§3 ข้อ 19–21)
> · **ความคืบหน้า:** Batch 0 merge แล้ว (#346) · **Batch 1 implement แล้วใน #349 (รอ A รีวิว)** ดู §9
>
> **แทนที่:** `docs/20_Mobile_Redesign_Phase3_Design.md` (มติ B 19 ต.ค. 2569 — token ของ docs/20 ไม่ตรงกับ
> Web จริง ดู §1)
>
> **ที่มาของข้อมูล:** สำรวจ Mobile และ Web จาก `main` ที่ `12c9856` (19 ต.ค. 2569) · ค่าสีทุกค่าในเอกสารนี้
> แปลงจาก `oklch()` จริงใน `web/src/app/globals.css` เป็น hex (sRGB) ด้วยสคริปต์ ไม่ได้ลอกจากคอมเมนต์
> ในไฟล์ (คอมเมนต์ hex บางตัวไม่ตรงกับค่าจริง ดู §4.4)
>
> **เอกสารที่เกี่ยวข้อง:** `docs/18` (สำรวจหน้าจอ Phase 1-2), `docs/21` (UX audit รอบแรก 25 ข้อ — ข้อที่ยังค้าง
> ถูกรวมเข้า batch ใน §9), `docs/19` (Device PULL model ที่เกี่ยวกับ §10 ข้อ A1)

---

## 0. เป้าหมายและหลักการ: "สอดคล้องกับ Web" หมายถึงอะไร

**สอดคล้องเรื่องหน้าตาและภาษา ไม่ใช่การเชื่อม flow การทำงานของสองแอปเข้าด้วยกัน**

- **Mobile กับ Web เป็นแอปคนละตัว คนละกลุ่มผู้ใช้** — Mobile = ช่างภาคสนาม (ST / OT) และ Operation ที่ใช้งาน
  นอกโต๊ะ · Web = Operation / Admin / ConfigEngineer / FirmwareEngineer / QAEngineer / Auditor / SuperAdmin ·
  ทั้งสองคุยกับ backend API ชุดเดียวกัน ข้อมูลจึง**เชื่อมกันอยู่แล้วโดยธรรมชาติผ่าน backend** (งานที่ Operation
  สร้างบน Web ไปโผล่ที่มือถือช่าง, รายงานปัญหาที่ช่างส่งไปโผล่ใน Approval / Incident ของ Web) — **แผนนี้ไม่เปลี่ยน
  ส่วนนี้เลย**
- **สิ่งที่เปลี่ยนคือ "หน้าตา" ของ Mobile** ให้ดูเป็นผลิตภัณฑ์ตระกูลเดียวกับ Web:
  - ใช้สี / token / ตัวอักษร / radius ชุดเดียวกัน (§4)
  - ใช้ component แบบเดียวกัน: Badge, Card, PageHeader ฯลฯ (§5, §7)
  - ใช้**คำศัพท์เดียวกันสำหรับสิ่งที่ทั้งสองแอปมีคู่กันจริง** เช่น สถานะ Incident, สถานะอุปกรณ์ (§6) · สิ่งที่
    Web ไม่มีคู่เทียบ คงภาษาไทยเดิม
- **โครงสร้างฟีเจอร์ของ Mobile ไม่เปลี่ยน** — ยังมีเฉพาะฟีเจอร์ที่ช่างหน้างานใช้ **ไม่เพิ่มเมนู/ฟีเจอร์ของ Web
  เข้ามาใน Mobile** (เช่น ไม่มี Approval Center, Campaign, Config Editor, Audit Log บนมือถือ) · ที่ลดลงคือหน้าที่ไม่มี
  ประโยชน์จริงแล้ว (§8) และการจัดวางที่เปลี่ยนเป็นแท็บด้านล่าง (§7.2)

## 1. ที่มา และทำไมแทน docs/20

- docs/20 กำหนด token ชุดใหม่ของตัวเอง (Tailwind slate/blue: `primary #2563EB`, `textPrimary #0F172A`,
  `background #F8FAFC`) และระบุไว้ว่า "ไม่แก้ Web" ถ้าทำตามนั้น Mobile กับ Web จะมี design system **คนละชุด**
- Web มี design system ที่ใช้งานจริงอยู่แล้ว (`globals.css` + `components/ui/*` + `PageHeader` ฯลฯ ที่ปรับใหม่ใน
  ต.ค. 2569 รวม #339, #343) และ palette เดิมของ Mobile ก็ใกล้ Web อยู่แล้ว เช่น `AppTheme.navy #12344D`
  = Web `accent-foreground #12344D` ตรงเป๊ะ
- Mobile ตอนนี้มี palette ซ้อนกัน 2 ชุด (`navy`/`textSecondary`/... ใน 16 ไฟล์ กับ `mock*` ของ Home redesign
  ที่ลามไป 8 ไฟล์) และ hardcode อีกมาก (`Color(0x` 67 ตำแหน่ง, `fontSize:` 109, `Radius.circular(` 76 —
  docs/21 ข้อ #22)
- บางหน้าไม่มีประโยชน์จริงแล้ว หรือซ้ำกับที่อื่น (§8) ควรตัดออกพร้อมการรื้อ

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย

**เป้าหมาย** (ตามหลักการใน §0)
- รื้อ UI ทุกหน้าของ Mobile ให้ใช้ token, ระบบสีสถานะ, component และคำศัพท์ชุดเดียวกับ Web
- เปลี่ยนการนำทางเป็นแท็บด้านล่าง และรวมรายการงานเข้าหน้าแรก (§7.2)
- ตัดหน้าที่ไม่ใช้แล้ว (§8) และเก็บข้อที่ค้างจาก UX audit (docs/21) ไปพร้อมกัน
- เหลือ theme ชุดเดียว (โหมดสว่าง) ไม่มี `Color(0x` นอกไฟล์ token (มีเทสดัก)

**ไม่ใช่เป้าหมาย**
- ไม่เปลี่ยนการเชื่อมต่อ/flow ระหว่าง Mobile กับ Web และไม่เพิ่มฟีเจอร์ของ Web เข้ามา (§0)
- ไม่แก้ Backend (endpoint ทุกตัวที่ Mobile ใช้ยังมีอยู่ครบ)
- ไม่แก้ Web ในแผนนี้ — จุดที่ Web ควรปรับ (§4.3, §4.4, §5.3) ส่งเป็นข้อสังเกตให้ A ตัดสินใจเอง
- ไม่ทำ dark mode ในรอบนี้ (§4.2)

## 3. มติของ B (19 ต.ค. 2569)

**รอบแรก**
1. ยกเลิก docs/20 ใช้ design system ของ Web เป็นต้นแบบ (เอกสารนี้)
2. คำเฉพาะ (ชื่อสถานะ, ชื่อเมนู/ฟีเจอร์) ใช้ภาษาอังกฤษให้ตรงกับ Web · ประโยคอธิบาย ข้อความแจ้งเตือน ข้อความ
   error และปุ่มคำกริยาทั่วไป คงภาษาไทย (§6)
3. ใช้ระบบสี **Badge** ของ Web (semantic tone: neutral / success / warning / danger / info + dot) เป็นมาตรฐาน
   **ไม่ใช้** `lib/status-pill.tsx` ที่ตอนนั้นใช้สี Tailwind ดิบ (§5) — หลัง #344 `StatusPill` ใช้ token ชุดเดียวกับ
   Badge แล้ว สีสถานะสองฝั่งตรงกัน (§5.3)
4. ตัดหน้า `/simulator` ("ทดสอบความพร้อม Config") — เหลือแค่ปุ่ม "ทดสอบกับ Device Simulator" ใน Task Detail
5. ตัดหน้า `/device-connection-test` ("ทดสอบสัญญาณ") และหน้าลูก `/device-connection-test/pick-device` — backend
   `DEVICE_CONNECTION_TEST_MODE=real` ยัง throw ตอน startup (ไม่มีตัวจริงให้เชื่อม) ผลเป็น mock ทุก environment
6. ลบ dead code 2 จุดเป็น PR แยกก่อน — `ApiClient.simulateConfig()` และ `isNumericDataType()` (#346 — ลบแค่
   2 ฟังก์ชันนี้ **ยังไม่ได้ตัดหน้า `/simulator`**)

**รอบ 2**
7. สถานะที่ Web เองเป็นภาษาไทย (`rolled_back`, `dismissed`, payload status ทั้ง 4) **คงภาษาไทยตาม Web**
8. คำอังกฤษที่เปลี่ยนตาม Web ใช้ **ตัวแรกพิมพ์ใหญ่** (`Open`, `Registered`) ไม่ใช่ตัวเล็กล้วน
9. คำ/หน้าที่ **Web ไม่มีคู่เทียบ** (Task status / urgency, แจ้งเตือน, หน้าแรก, หัวหน้าหน้ารายละเอียด) **คงภาษาไทย**
10. เมนูของ Mobile ชื่อ **"Incidents"** แยกจาก "Incident & Rollback" ของ Web (Mobile ไม่มีฟีเจอร์ rollback)
11. ป้าย Role ใช้ **"ST"** เดี่ยวๆ ตาม Web · คำอธิบายเต็ม "ช่างภาคสนาม" แยกไปเป็นบรรทัดย่อย
12. **ตัดหน้า "งานของฉัน" (`/tasks`) รวมเข้าหน้าแรก**
13. การนำทางเป็น **แท็บด้านล่าง** · ยกเลิก AppBar สีกรมท่า ใช้หัวหน้าจอเรียบแบบ `PageHeader` ของ Web
14. **ล็อกโหมดสว่างอย่างเดียว** ไม่พอร์ต `.dark` ในรอบนี้
15. ขอบช่องกรอกใช้ **`muted-foreground`** ของ Web (ตอนนั้น `#667080` — ค่าเปลี่ยนเป็น `#576171` ตามข้อ 19)
16. **ลบหน้า `/simulator` ใน Batch 3** พร้อมหน้าแรกใหม่ (เดิมวางไว้ Batch 5) — ทางลัดเดียวที่เข้าหน้านี้หายไปกับ
    หน้าแรกใหม่ใน Batch 3 ถ้าเก็บหน้าไว้ถึง Batch 5 จะเป็น route ค้างที่ไม่มีทางเข้า และปุ่ม "ทดสอบกับ Device
    Simulator" ใน Task Detail ไม่ได้พึ่งหน้านี้อยู่แล้ว

**รอบ 3 — ตามคำตอบของ A (19 ต.ค. 2569)**
17. **เก็บหน้า `/devices/:id/confirm-firmware` ("ยืนยันติดตั้ง Firmware") ไว้ รื้อดีไซน์ตามปกติใน Batch 4** ต่อจาก
    Device Detail · backend ไม่แก้ · ทบทวนอีกครั้งตอนทำ Firmware PULL จริง — เหตุผลจาก A (§10 ข้อ A1): PULL ของ
    Firmware ยังไม่ได้สร้าง (ขั้นที่ 2 ของ docs/19) ข้อความบน Web ที่ว่าไม่ต้องรอช่างกดยืนยันเป็นการจำลอง และยังมี
    use case จริงคือช่างเปลี่ยน Firmware ด้วยมือหน้างานนอก Campaign
18. **Task `cancelled` ใช้โทน `danger`** ตาม `TASK_STATUS_TONE` ของ Web (ไม่ใช้ `neutral` ที่ร่างแรกเสนอ) — §5.2

**รอบ 4 — ตามค่าใหม่ของ Web หลัง #344 merge (19 ต.ค. 2569)**
19. **`muted-foreground` / ขอบช่องกรอก = `#576171`** ตามค่าใหม่ของ Web (`oklch(0.49 0.028 259.8)` จาก #344 เข้มขึ้นจาก
    `#667080`) — 6.26:1 บนการ์ด, 5.89:1 บน background · §4.1, §4.3 · implement แล้วใน #349
20. **`text-xs` / `text-sm` = 13 / 15** ตาม Web (#344 ขยายจาก 12 / 14 ของ Tailwind) — §4.5 · implement แล้วใน #349
21. **ฟอนต์ = Anuphan ตาม Web** — A ตอบแล้วใน #344: Web ยังทดลอง Anuphan (ไม่ใช่ทางการ — เปลี่ยนเพราะ Noto Sans Thai
    Looped ดูไม่ทันสมัย ยังไม่ได้เทียบความอ่านชัดตอนตัวเล็ก) mobile ไม่ต้องตาม — **B ตัดสินใจเปลี่ยนเป็น Anuphan ตามเว็บ
    ด้วย** (implement ใน PR #349) · แทน Noto Sans Thai Looped ที่แผนเดิมเลือกไว้ · ถ้า Web เปลี่ยนฟอนต์อีกค่อยทบทวน (§4.5)

---

## 4. Design tokens (ชุดเดียวกับ Web)

ใช้ค่าจาก `web/src/app/globals.css` (`:root`) ชื่อ token ใน Flutter ตั้งตามชื่อ CSS variable ของ Web (แปลง
kebab-case เป็น camelCase เช่น `--muted-foreground` → `mutedForeground`) ให้ค้นข้ามสองฝั่งได้ตรงๆ ·
**ต่างจาก docs/20 ที่ตั้งชุดใหม่ของตัวเอง**

### 4.1 สี (โหมดสว่าง)

| Token (Web) | oklch | hex สำหรับ Flutter | ใช้กับ |
|---|---|---|---|
| `background` | `0.979 0.003 264.5` | `#F7F8FA` | พื้นหลังแอป |
| `foreground` | `0.267 0.028 248.9` | `#1B2733` | ข้อความหลัก (14.29:1 บน background) |
| `card` / `popover` | `1 0 0` | `#FFFFFF` | การ์ด, แถบแท็บด้านล่าง, bottom sheet, dialog |
| `card-foreground` | `0.267 0.028 248.9` | `#1B2733` | ข้อความในการ์ด |
| `primary` | `0.528 0.13 248.3` | `#1B6FB2` | ปุ่มหลัก ลิงก์ แท็บที่เลือก (ตัวขาวบนพื้นนี้ 5.30:1) |
| `primary-foreground` | `1 0 0` | `#FFFFFF` | ตัวอักษรบนปุ่มหลัก |
| `secondary` / `muted` | `0.957 0.006 255.5` | `#EEF1F5` | พื้นปุ่มรอง, พื้น Badge neutral |
| `secondary-foreground` | `0.267 0.028 248.9` | `#1B2733` | |
| `muted-foreground` | `0.49 0.028 259.8` | `#576171` | label, ข้อความรอง (6.26:1 บนการ์ด, 5.89:1 บน background), แท็บที่ไม่ได้เลือก, **ขอบช่องกรอก (§4.3)** · ค่าใหม่จาก #344 (เดิม `#667080`) ตรงกับที่ implement ใน #349 |
| `accent` | `0.961 0.011 243.7` | `#ECF3F9` | พื้นตอนกด/รายการที่เลือก, แถวที่ยังไม่อ่าน, พื้นแท็บที่เลือก |
| `accent-foreground` | `0.313 0.06 243.7` | `#12344D` | (= `AppTheme.navy` เดิมของ Mobile) |
| `destructive` | `0.577 0.245 27.325` | `#E7000B` | ปุ่มอันตราย, จุดของ Badge danger |
| `success` / `-foreground` / `-subtle` | | `#4E9B6C` / `#165E3C` / `#DBF6E6` | ดู §5 |
| `warning` / `-foreground` / `-subtle` | | `#CB8315` / `#824103` / `#FEF3C9` | ดู §5 |
| `info` / `-foreground` / `-subtle` | | `#287CCF` / `#075A8E` / `#DFF2FE` | ดู §5 |
| `danger-foreground` / `danger-subtle` | | `#9D1135` / `#FFF0F2` | ดู §5 (Web ไม่มี `--danger` ตัวเข้ม ใช้ `destructive` แทน) |
| `border` | `0.923 0.008 253.9` | `#E2E6EB` | ขอบการ์ด เส้นแบ่ง เส้นบนแถบแท็บ (ของตกแต่ง 1.25:1 ไม่ต้องถึง 3:1) |
| `ring` | `0.528 0.13 248.3` | `#1B6FB2` | focus ring (= primary) |

ไม่ยก token ของ sidebar (`--sidebar*`) และ chart (`--chart-*`) มา — Mobile ไม่มี sidebar (ใช้แท็บด้านล่าง) และไม่มีกราฟ

### 4.2 โหมดมืด — ไม่อยู่ใน scope รอบนี้

**ล็อก `ThemeMode.light` อย่างเดียว** (มติ B ข้อ 14 · ปิด docs/21 ข้อ #24 ที่แอปรองรับ dark โดยไม่ตั้งใจ) · **ไม่พอร์ต
`.dark` ของ Web** · ถ้าจะทำ dark mode ทีหลังเป็นงานแยก (Web มี `.dark` ครบทุก token และคู่สีผ่าน contrast แล้ว
ยกมาใช้ได้ตอนนั้น) · ระหว่างนี้ไม่ต้องเก็บ `AppTheme.dark()` ไว้ให้ build ได้ · **ล็อก `ThemeMode.light` ใน Batch 6**
ตอนสลับทั้งแอปเป็น v2 ไม่ใช่ Batch 1 (ถ้าล็อกก่อน หน้าตาทั้งแอปจะเปลี่ยนทันทีกับเครื่องที่ตั้ง dark mode ทั้งที่หน้ายังเป็น
theme เดิม) · `AppTheme.v2()` ใน #349 เป็นโหมดสว่างอย่างเดียวแล้ว

### 4.3 ขอบช่องกรอก: ใช้ `muted-foreground #576171` (ต่างจาก Web โดยตั้งใจ)

- ขอบช่องกรอกของ Mobile = **`muted-foreground #576171`** ได้ **6.26:1** บนพื้นขาว (5.89:1 บน background) ผ่าน WCAG
  1.4.11 (ขอบของ UI component ต้อง ≥ 3:1) — เป็น token ที่มีอยู่แล้วใน Web ไม่ได้เพิ่มสีใหม่ · ค่าใหม่หลัง #344 (เดิม
  `#667080` 5.01:1) มติ B ข้อ 19 · implement ใน #349 เป็น `AppColors.inputBorder` (= `mutedForeground`)
- เหตุผลที่ไม่ยก `--input` ของ Web: ได้แค่ 1.25:1 (เท่ากับ `--border`) ไม่ผ่านเกณฑ์ และ Mobile เคยแก้ปัญหานี้แล้วใน
  #335 ถ้ายกมาตรงๆ จะถอยหลัง · แจ้ง A เป็นข้อสังเกต (§10 ข้อ A2)

### 4.4 ข้อสังเกต: คอมเมนต์ hex ใน globals.css ไม่ตรงค่าจริงบางตัว

ค่าที่ browser แสดงจริงคือ `oklch()` ไม่ใช่คอมเมนต์ ตัวที่ต่าง: `primary` (คอมเมนต์ `#1C6FB2` / จริง `#1B6FB2`),
`success` (`#3F9D6B` / `#4E9B6C`), `success-foreground` (`#1F6B45` / `#165E3C`), `warning` (`#D08A1E` / `#CB8315`),
`warning-foreground` (`#92400E` / `#824103`), `info` (`#2A78D6` / `#287CCF`), `info-foreground`, `danger-foreground`,
และ `-subtle` ทุกตัวต่างเล็กน้อย · หลัง #344 เพิ่ม `muted-foreground` (คอมเมนต์ `≈#5A6473` / จริง `#576171` — แจ้ง A
ไว้ในรีวิว #344) · Mobile ใช้ค่าที่แปลงจาก oklch (คอลัมน์ hex ใน §4.1 — แปลงซ้ำจาก main `d487763` หลัง #344 ตรงกับ
#349) · แจ้ง A เป็นข้อสังเกต

### 4.5 Radius, ตัวอักษร, ระยะห่าง

- **Radius:** Web `--radius: 0.625rem` = **10px** และสเกล `sm 6 · md 8 · lg 10 · xl 14 · 2xl 18` (px) · การ์ด
  ปุ่ม และช่องกรอก ใช้ `lg` (10) ตาม `card.tsx` / `button.tsx` / `input.tsx` (`rounded-lg`) · ป้าย (Badge) เป็น `full`
- **ความสูงปุ่ม/ช่องกรอก (ต่างจาก Web โดยตั้งใจ):** Web ใช้ `h-8` (32px) ซึ่งเหมาะกับเมาส์ แต่ต่ำกว่าพื้นที่กด
  ขั้นต่ำบนมือถือ (Material 48dp) · Mobile คงความสูงขั้นต่ำ **48** เหมือนปุ่มหลักตอนนี้ (#335) ใช้แค่สี radius
  ตัวอักษร และ variant ตาม Web
- **ตัวอักษร:** **Anuphan** (Cadson Demak) ตาม Web (`app/layout.tsx` หลัง #344) — A ตอบแล้วใน #344: Web ยังทดลอง
  Anuphan (ไม่ใช่ทางการ) mobile ไม่ต้องตาม — B ตัดสินใจเปลี่ยนเป็น Anuphan ตามเว็บด้วย (implement ใน PR #349, §3 ข้อ 21)
  · **ค่าเดิมที่เปลี่ยนไปแล้ว:** แผนเดิมใช้ Noto Sans Thai Looped (ตอนนั้นเป็นฟอนต์ของ Web เลือกเพราะมีหัว อ่านชัดตอน
  ตัวเล็ก) · ตัวเลข/รหัสเครื่องใช้ monospace (Web ใช้ Geist Mono — ฝั่ง Mobile ยังไม่ได้เลือก ทำตอนมีหน้าที่ใช้จริง)
  - **bundle เป็น asset** ใน `mobile/assets/fonts/` พร้อม `OFL.txt` (SIL Open Font License 1.1) ไม่ใช้ `google_fonts`
    ที่โหลดจากเน็ต — ช่างใช้แอปตอนออฟไลน์บ่อย ถ้าโหลดฟอนต์ไม่ได้ตัวไทยจะเป็นกล่องสี่เหลี่ยม (เหตุผลเดิมจาก
    docs/20 ยังใช้ได้) · #349 ใช้ `Anuphan[wght].ttf` จาก google/fonts เป็น variable font ไฟล์เดียว (แกน wght 100–700)
    `FontWeight` เลือกน้ำหนักให้เอง ไม่ต้องแยกไฟล์ต่อน้ำหนัก
  - ขนาด APK ที่เพิ่มขึ้น (#349, release prod): **+119,066 bytes (≈116 KB, +0.19%)**
- **ขนาดตัวอักษร:** อิงสเกลที่ Web ใช้ (`text-xs 13 · sm 15 · base 16 · lg 18 · xl 20 · 2xl 24`) — `xs` / `sm` ขยาย
  1px ตาม #344 (Tailwind ปกติ 12 / 14, มติ B ข้อ 20) · implement ใน #349 (`AppTypography`) · หัวหน้าจอ = `2xl`
  semibold ตาม `PageHeader` ของ Web (#349 ใช้ `2xl` ไปก่อน บนจอมือถืออาจลดเป็น `xl` — ตัดสินตอน Batch 2 ที่ใช้กับ
  หน้าจริงพร้อม screenshot)
- **ระยะห่าง:** สเกล 4px ของ Tailwind (`1 = 4px`) · การ์ดใช้ padding 16 (`--card-spacing: spacing(4)`) ขนาดเล็ก 12

---

## 5. ระบบสีสถานะ: Badge (semantic tone + dot)

### 5.1 ค่าของแต่ละ tone (ตาม `web/src/components/ui/badge.tsx`)

| Tone | พื้น | ตัวอักษร | จุด (`dot`) | contrast ตัวอักษร |
|---|---|---|---|---|
| `neutral` | `secondary #EEF1F5` | `secondary-foreground` 80% | `muted-foreground` 60% | 7.32 |
| `success` | `success-subtle #DBF6E6` | `success-foreground #165E3C` | `success #4E9B6C` | 6.74 |
| `warning` | `warning-subtle #FEF3C9` | `warning-foreground #824103` | `warning #CB8315` | 6.95 |
| `danger` | `danger-subtle #FFF0F2` | `danger-foreground #9D1135` | `destructive #E7000B` | 7.40 |
| `info` | `info-subtle #DFF2FE` | `info-foreground #075A8E` | `info #287CCF` | 6.43 |

ทรง: `rounded-full`, padding 8×2, ตัวอักษร 12 medium · **ป้ายสถานะใส่ `dot` เสมอ** (สีไม่ใช่สิ่งเดียวที่สื่อ
ความหมาย) · กติกาจาก Web: success/warning/danger/info = สถานะที่ผู้ใช้ต้องรู้ความหมายของสี, **neutral = ทุกอย่าง
ที่ไม่ใช่สถานะ** (ประเภท, protocol, จำนวน) · ไม่เปิดให้ส่งสีเองผ่าน prop

### 5.2 Mapping สถานะของ Mobile → tone

ยึด mapping ที่ Web ใช้อยู่แล้วใน `lib/status-pill.tsx` (เปลี่ยนแค่ tone `progress` ของ status-pill เป็น `warning`
ของ Badge เพราะ Badge ไม่มี `progress`) · Task status ใช้ `TASK_STATUS_TONE` ของ Web (มีใน `status-pill.tsx` ใช้กับ
`demo-data.ts` เท่านั้น Web ไม่มีหน้า Task จริง) ให้สีของสถานะเดียวกันตรงกันสองฝั่ง (มติ B ข้อ 18) · สถานะที่ Web
ไม่มีเลย (Task urgency, ซิงก์ในเครื่อง) เสนอตามหลักเดียวกัน · ข้อความบนป้ายดู §6

| กลุ่ม | ค่า (wire) | Tone | ที่มา |
|---|---|---|---|
| Task status | `pending` | neutral | Web `TASK_STATUS_TONE` |
| | `in_progress` | warning | Web (`progress`) |
| | `completed` | success | Web |
| | `cancelled` | danger | Web — **ร่างแรกเสนอ neutral** · B ตัดสินใช้ danger ตาม Web ให้สองฝั่งตรงกัน (มติ B ข้อ 18) |
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
| ซิงก์ในเครื่อง (Mobile เท่านั้น) | รอซิงก์ (`PendingSyncBadge`) | warning | เสนอ |
| | ซิงก์ไม่สำเร็จ (`SyncFailedBanner`) | danger | เสนอ |
| ประเภท Incident source, ประเภทแจ้งเตือน, protocol ฯลฯ | ทุกค่า | neutral | กติกา Badge (ไม่ใช่สถานะ) |

### 5.3 ข้อควรรู้: หน้าจริงของ Web ยังใช้ status-pill อยู่ (แต่สีตรงกับ Badge แล้ว)

`Badge` ของ Web **ยังไม่ถูกใช้ในหน้าจริง** หน้าจริง 19 ไฟล์ใช้ `StatusPill` (นับบน main `d487763`) · **หลัง #344
merge `StatusPill` ใช้ token ชุดเดียวกับ Badge แล้ว** (ตรวจใน `lib/status-pill.tsx`: `neutral` = `bg-secondary
text-secondary-foreground/80`, `info` / `success` / `danger` = `*-subtle` + `*-foreground`, `progress` =
`warning-subtle` + `warning-foreground`) เลิกใช้สี Tailwind ดิบ (sky/amber/emerald/rose) แล้ว **สีสถานะของ Mobile
(`AppBadge`) กับหน้า Web จึงตรงกัน** · ที่ยังต่าง: `StatusPill` ใช้ไอคอนนำหน้า ส่วน Badge ใช้ `dot` · การย้ายหน้า Web ไป
เรียก Badge ตรงๆ ยังไม่ได้ตัดสินใจ (§10 ข้อ A3) ไม่บล็อกแผนนี้

---

## 6. ภาษา: คำศัพท์สถานะ / เมนู

**กติกา (มติ B ข้อ 2, 7–11):**
1. **มีคู่เทียบใน Web → ใช้คำเดียวกับ Web** ทั้งชื่อสถานะ และชื่อเมนู/ฟีเจอร์
   - Web เป็นอังกฤษ → อังกฤษ **ตัวแรกพิมพ์ใหญ่** (`Open`, `Registered`) แม้หน้า Web บางจุดจะแสดงค่าดิบตัวเล็ก
   - Web เป็นไทย → **คงไทยตาม Web** (เช่น `Rollback แล้ว`, `ไม่ต้องดำเนินการ`, payload status)
2. **ไม่มีคู่เทียบใน Web → คงภาษาไทยเดิม** (Task status / urgency, แจ้งเตือน, หน้าแรก, หัวหน้าหน้ารายละเอียด)
3. **คงภาษาไทยเสมอ:** ประโยคอธิบาย, ข้อความแจ้งเตือน/ยืนยัน, ข้อความ error ("โหลด…ไม่สำเร็จ" + "ลองใหม่" ตรงกับ
   Web อยู่แล้ว), ชื่อแจ้งเตือน (Web เองก็เป็นไทย), ปุ่มคำกริยา (บันทึกสถานะ, ส่งรายงานปัญหา, ยืนยัน, ยกเลิก,
   ออกจากระบบ), หัวข้อส่วน (ประวัติงานล่าสุด)

label ทุกตัวในตารางนี้รวมไว้ไฟล์เดียว (`lib/core/ui/labels.dart` หรือชื่อที่ตกลงตอนทำ — ไม่อยู่ใน #349 สร้างใน batch แรกที่มีหน้าใช้จริง) พร้อมเทสว่าทุกค่าของ
enum มี label — ไม่ให้แต่ละหน้าเขียนเอง

### 6.1 ชื่อสถานะ

| กลุ่ม | ค่า (wire) | Mobile ตอนนี้ | Web ตอนนี้ | ใหม่ | เหตุผล |
|---|---|---|---|---|---|
| Incident status | `open` | เปิดอยู่ | `Open` (ตัวกรอง) · `open` (ป้าย) | **Open** | ตาม Web |
| | `investigating` | กำลังตรวจสอบ | `Investigating` | **Investigating** | ตาม Web |
| | `rolled_back` | Rollback แล้ว | Rollback แล้ว | **Rollback แล้ว** | Web เป็นไทย คงตาม Web (ตรงกันอยู่แล้ว) |
| | `resolved` | แก้ไขแล้ว | `Resolved` | **Resolved** | ตาม Web |
| | `dismissed` | ไม่ใช่ปัญหา/ยกเลิก | ไม่ต้องดำเนินการ | **ไม่ต้องดำเนินการ** | Web เป็นไทย คงตาม Web (Web ตั้งใจไม่ใช้ "ไม่ใช่ปัญหา" เพราะฟังเหมือนบอกว่าช่างแจ้งผิด) |
| Incident severity | `critical` / `high` / `medium` / `low` | วิกฤต / สูง / ปานกลาง / ต่ำ | ค่าดิบ `critical` … | **Critical / High / Medium / Low** | ตาม Web + ตัวแรกพิมพ์ใหญ่ |
| Device lifecycle | `registered` / `installed` / `decommissioned` | ลงทะเบียนแล้ว / ติดตั้งแล้ว / ปลดระวาง | ค่าดิบ `registered` … | **Registered / Installed / Decommissioned** | ตาม Web + ตัวแรกพิมพ์ใหญ่ |
| Payload status | `up_to_date` | อัปเดตล่าสุด | เป็นปัจจุบัน | **เป็นปัจจุบัน** | Web เป็นไทย คงตาม Web |
| | `pending` | รออัปเดต | รอรับ Config / รอติดตั้ง Firmware | **รอรับ Config** (payload Config) / **รอติดตั้ง Firmware** (payload Firmware) | Web แยกคำตามชนิด payload — Mobile ต้องแยกตามกันด้วย |
| | `failed` | ล้มเหลว | ล้มเหลว | **ล้มเหลว** | ตรงกันอยู่แล้ว |
| | `unknown` | ไม่ทราบ | ยังไม่เคยอยู่ใน Rollout | **ยังไม่เคยอยู่ใน Rollout** | Web เป็นไทย คงตาม Web |
| Config status (ถ้ามีหน้าที่แสดง) | `draft` / `testing` / `approved` / `rejected` / `synced` | — | ค่าดิบ · ตัวอย่าง Badge `Testing` / `Rejected` | **Draft / Testing / Approved / Rejected / Synced** | ตาม Web + ตัวแรกพิมพ์ใหญ่ |
| Task status | `pending` / `in_progress` / `completed` / `cancelled` | รอดำเนินการ / กำลังทำ / เสร็จแล้ว / ยกเลิก | — | **คงเดิม** | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** (Web ไม่มีหน้า Task) |
| Task urgency | `overdue` / `dueSoon` | เลยกำหนด / ใกล้ถึงกำหนด | — | **คงเดิม** | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** |

### 6.2 ชื่อเมนู / ฟีเจอร์ / หัวหน้าจอ

| ที่ใช้ | Mobile ตอนนี้ | Web | ใหม่ | เหตุผล |
|---|---|---|---|---|
| แท็บ + หัวหน้าค้นหาอุปกรณ์ | ค้นหาอุปกรณ์ | `Device Search` (เมนู) | **Device Search** | ตาม Web |
| แท็บ + หัวหน้ารายการ Incident | ดู Incident / รายการ Incident | `Incident & Rollback` (เมนู) | **Incidents** | ชื่อของ Mobile เอง (มติ B ข้อ 10) — Mobile ไม่มีฟีเจอร์ rollback ความหมายไม่ตรงกับเมนูของ Web |
| ปุ่ม + หัวหน้าแจ้งปัญหา | แจ้งปัญหา / แจ้งปัญหาหน้างาน | `Field Report` (ใช้ในหน้า Incident) | **Field Report** | ตาม Web |
| หน้า Override ค่า | Override ค่าพารามิเตอร์ | `Config Override` | **Config Override** | ตาม Web |
| หน้าขอ Firmware Override | ขอ Firmware Override | `Firmware Override` | **Firmware Override** | ตาม Web |
| หน้ายืนยันติดตั้ง Firmware | ยืนยันติดตั้ง Firmware | — | **คงไทย** (ยืนยันติดตั้ง Firmware) | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** · หน้าเก็บไว้ตาม §3 ข้อ 17 |
| แท็บ + หัวหน้าหน้าแรก (รวมรายการงาน §7.2) | (ไม่มีชื่อ) · "งานของฉัน" (หน้าแยก ถูกตัด) | — | **คงไทย** (เช่น "หน้าแรก" — ตั้งชื่อตอน Batch 3) | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** (Dashboard ของ Web เป็นภาพรวมของ Operation คนละอย่างกับรายการงานของช่าง) |
| แท็บ + หัวหน้าแจ้งเตือน | รายการแจ้งเตือน | (ไม่มีหน้าแยก มีแค่กระดิ่ง) | **คงไทย** (แท็บ "แจ้งเตือน", หัวหน้า "รายการแจ้งเตือน") | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** |
| หัวหน้าหน้ารายละเอียด | รายละเอียดงาน / รายละเอียดอุปกรณ์ / รายละเอียด Incident | (ใช้ชื่อ record เป็นหัวหน้า) | **คงเดิม** | **ไม่มีคู่เทียบใน Web จึงคงภาษาไทย** · ชื่อ record (ชื่องาน / เลขเครื่อง / หัวข้อ) อยู่ใน meta ของ `AppPageHeader` |
| ป้าย Role | `ST • ช่างภาคสนาม` (รวมในป้ายเดียว) | `ST` (`formatRoleLabel` แยกคำ เช่น `Super Admin`) | ป้าย **`ST`** · บรรทัดย่อยใต้ชื่อผู้ใช้ "ช่างภาคสนาม" | มติ B ข้อ 11 · Operation = ป้าย `Operation` + บรรทัดย่อย "ฝ่ายปฏิบัติการ" |
| ทางลัดเดิมบนหน้าแรก | ทดสอบการตั้งค่า, ทดสอบสัญญาณ, งานของฉัน | — | ตัดออก (§8) · ทางลัดที่เหลือย้ายไปเป็นแท็บ (§7.2) | |

### 6.3 คงภาษาไทย แต่ปรับให้ตรงกับ Web

| เรื่อง | Mobile | Web | ใหม่ |
|---|---|---|---|
| การสะกด sync | ซิงค์ (9 จุด) | ซิงก์ | **ซิงก์** ตาม Web |
| ชื่อแจ้งเตือน `incident_alert` | แจ้งเตือนเหตุการณ์ | แจ้งเตือนเหตุการณ์ (เขียน Config ไม่สำเร็จ) | ตาม Web |
| ชื่อแจ้งเตือนอื่น | ตรงกับ Web อยู่แล้ว | | คงเดิม |
| ข้อความ error / ปุ่มลองใหม่ | "โหลด…ไม่สำเร็จ" + "ลองใหม่" | เหมือนกัน | คงเดิม |

---

## 7. Component และการนำทาง

### 7.1 Component ที่พอร์ตจาก Web

ทุกตัวอยู่ที่ `mobile/lib/core/ui/` อ่านค่าจาก token ใน §4 เท่านั้น มี widget test ทุกตัว · **Batch 1 สร้างเฉพาะ
`AppBadge`, `AppCard`, `AppPageHeader`** (+ แถบแท็บใน Batch 3) ตัวที่เหลือสร้างใน batch แรกที่มีหน้าใช้จริง

| Web | แนวคิดที่ยกมา | Mobile (ชื่อเสนอ) | สร้างใน | ใช้กับหน้า |
|---|---|---|---|---|
| `PageHeader` | หัวหน้าจอมาตรฐาน **แทน AppBar สีกรมท่าเดิม** (พื้นเดียวกับ background ไม่ทึบ): title + status (Badge) + meta + actions · description บอกว่าหน้าใช้ทำอะไร **ไม่ใช่เรื่องสิทธิ์** · ปุ่มที่ role ทำไม่ได้ **ซ่อน** · ปุ่มที่ติดเงื่อนไขชั่วคราว **disable พร้อมเหตุผล** · หน้าลูกมีปุ่มย้อนกลับในแถวเดียวกับ title | `AppPageHeader` | Batch 1 | ทุกหน้ายกเว้น Login · หน้ารายละเอียด (Task, Device, Incident) ใส่ status + meta |
| `Badge` | 5 tone + dot (§5) | `AppBadge` | Batch 1 | ทุก pill เดิม: `TaskStatusPill`, `IncidentSeverityPill`/`IncidentStatusPill`, `DeviceStatusPill`, payload status, urgency, `PendingSyncBadge`, ป้าย Role |
| `Card` | ขอบบาง `foreground` 20% **ไม่มีเงา** · การ์ดกดได้ ขอบเข้มขึ้น 40% ตอนกด (แทน hover) · radius 10 · padding 16 / 12 | `AppCard` (+ `interactive`) | Batch 1 | การ์ดทุกหน้า แทน `mockShadowCard` / `mockShadowRow` |
| `InfoRow` | แถว label/value (+ icon ได้) ในหน้ารายละเอียด | `AppInfoRow` | Batch 2 (Incident Detail) | Incident Detail, Device Detail, Task Detail (`_InfoCard`) |
| `EmptyState` | icon + ข้อความ + ปุ่ม action ชวนทำขั้นต่อไป แทนข้อความลอยๆ | `AppEmptyState` | Batch 2 | แจ้งเตือน, Incidents, รายการงานบนหน้าแรก, Device Search (ไม่พบ) |
| `skeleton/*` | card-list / detail skeleton แทน "กำลังโหลด…" | `AppListSkeleton`, `AppDetailSkeleton` (แทน `SkeletonCard` เดิม) | Batch 2 | ทุกหน้า list / detail ตอน fetch ครั้งแรก |
| `Button` variants | `default` (primary) / `outline` / `secondary` / `ghost` / `destructive` / `link` · ปุ่มหลักวางท้ายสุด | `ThemeData` button themes (#349) + `AppButton.variant` (batch แรกที่มีหน้าใช้) | Batch 1 (theme) | ทุกหน้า · ปิด docs/21 ข้อ #11 ใน Batch 5 (Task Detail มี FilledButton 2 ปุ่มเท่ากัน → ปุ่มหลัก 1 + outline 1) |
| `SensitiveValue` | mask ค่าเป็นค่าเริ่มต้น + ปุ่มแสดง/ซ่อนที่มี label (`sensitive` เป็นแค่ flag การแสดงผล ไม่ใช่การเข้ารหัส) | `AppSensitiveValue` | Batch 4 (Config Override) | Config Override (field ที่ `sensitive`) · ปิด docs/21 ข้อ #20 |
| `WizardStepIndicator` | ตัวบอกขั้นของงานหลายขั้น | `AppStepIndicator` | Batch 5 (ถ้าใช้) | Task Detail ส่วน "ส่ง Config เข้าเครื่อง" (ทดสอบกับ Device Simulator → ส่ง) — ตัดสินตอนทำ |
| (ของเดิม Mobile ที่คงไว้) | `AppErrorView`, `OfflineCacheBanner`, `SyncFailedBanner`, `SyncAuthExpiredBanner` | ย้ายมาใช้ token / `AppBadge` | ตาม batch ของหน้าที่ใช้ | ตามเดิม |

### 7.2 การนำทาง: แท็บด้านล่าง (แทนหน้าแรกแบบทางลัด + AppBar สีกรมท่า)

**รวมรายการงานเข้าหน้าแรก:** หน้า "งานของฉัน" (`/tasks`) ถูกตัด (มติ B ข้อ 12) — แท็บหน้าแรกแสดง**งานทั้งหมดของ
ช่าง**ในหน้าเดียว (สรุปค้าง/ด่วน + banner ซิงก์ + รายการงานทั้งหมด จัดกลุ่ม/กรองตามสถานะ + ประวัติงานที่เสร็จ) แทน
ที่จะมีแค่ "งานค้างวันนี้" แล้วต้องกด "ดูทั้งหมด" ไปอีกหน้า · หน้า Task Detail (`/tasks/:id`) ยังอยู่ (เปิดจากรายการ
บนหน้าแรก, แจ้งเตือน, push)

**แท็บตาม role** (Mobile login ได้แค่ ST / OT / Operation — `webOnlyRoles` บล็อก Admin / Auditor / SuperAdmin
อยู่แล้ว · role Engineer ทั้ง 3 เป็น Web-only)

| Role | แท็บ (ซ้าย → ขวา) | หมายเหตุ |
|---|---|---|
| ST / OT | **หน้าแรก** (งาน) · **Device Search** · **Incidents** · **แจ้งเตือน** | ปุ่ม **Field Report** อยู่ใน actions ของหัวหน้าแท็บ Incidents และในหน้า Device Detail (ส่ง `?deviceId=` pre-fill ได้อยู่แล้ว) |
| Operation | **Device Search** · **Incidents** · **แจ้งเตือน** | ไม่มีแท็บงาน: `GET /tasks` ไม่ได้ self-scope ให้ Operation (Home ตอนนี้ก็ไม่แสดงงานให้ role อื่นอยู่แล้ว) · ยังเปิด Task Detail จากแจ้งเตือนเพื่อเพิ่มบันทึกได้ตามเดิม · เปิดแอปมาที่ Device Search |

- **แถบแท็บ:** พื้น `card` + เส้นบน `border` · แท็บที่เลือก = ไอคอน/ตัวอักษร `primary` บนพื้น `accent` · ที่ไม่เลือก =
  `muted-foreground` · แท็บแจ้งเตือนมีตัวเลขยังไม่อ่าน (แทนกระดิ่งบน AppBar เดิม)
- **บัญชีผู้ใช้ / ออกจากระบบ:** ปุ่ม avatar มุมขวาของ `AppPageHeader` ในหน้าระดับแท็บ เปิด bottom sheet: ชื่อผู้ใช้
  + ป้าย Role (`ST`) + บรรทัดย่อย "ช่างภาคสนาม" + ปุ่มออกจากระบบ (คงการยืนยันแบบเดิมจาก #326) · ปิด docs/21 ข้อ #6
  (ระยะกระดิ่งกับปุ่ม logout แคบ) เพราะสองปุ่มไม่อยู่ติดกันแล้ว
- **หน้าลูก** (Task Detail, Device Detail, Override, Field Report, Incident Detail): push ทับแท็บ มีปุ่มย้อนกลับใน
  `AppPageHeader` · back ของระบบกลับแท็บเดิม
- **โครงสร้าง router:** ใช้ `StatefulShellRoute` ของ go_router (แต่ละแท็บเก็บ stack ของตัวเอง) · deep link จาก push /
  แจ้งเตือนต้องยังเปิดหน้าลูกได้ถูก และ back กลับแท็บที่เกี่ยวข้อง (ไม่ปิดแอป — เคยเป็นบั๊กใน docs/21 ข้อ #4)

---

## 8. ตารางหน้าทั้งหมด (สถานะหลังมติ)

ทุก endpoint ที่ Mobile เรียกยังมีอยู่ใน backend (`main` `12c9856`) และไม่มีตัวไหน `deprecated` ใน `openapi.yaml`

| Route / ไฟล์ | ใครเห็น / ทางเข้า (หลังรื้อ) | ปุ่ม/action หลัก | API | สถานะ | Batch |
|---|---|---|---|---|---|
| `/` splash | ตอนเปิดแอป | — | — | คงเดิม | — |
| `/login` `login_page.dart` | ทุกคน | เข้าสู่ระบบ | `POST /auth/login` | รื้อดีไซน์ · แก้ hint mock mode ที่ยังอ้าง `sw`/`admin`/`audit` (docs/21 #19) | 2 |
| `/notifications` `notification_list_page.dart` | ทุกคน / แท็บแจ้งเตือน | ดูแจ้งเตือน, อ่านแล้ว | `GET /notifications`, `PATCH /notifications/:id/read` | รื้อดีไซน์ (ทำในโครงหน้าเดิมก่อน ย้ายเข้าแท็บใน Batch 3) | 2 |
| `/incidents` `incident_list_page.dart` | ทุกคน / แท็บ Incidents | ดูรายการ (อ่านอย่างเดียว) · ST/OT: ปุ่ม Field Report | `GET /incidents` | รื้อดีไซน์ · padding ลิงก์เลขเครื่อง (docs/21 #18) | 2 |
| `/incidents/:id` `incident_detail_page.dart` | ทุกคน / จากรายการ, แจ้งเตือน, push | ดูรายละเอียด | `GET /incidents/:id` | รื้อดีไซน์ | 2 |
| `/home` `home_page.dart` | ST/OT / แท็บหน้าแรก | สรุปงาน + **รายการงานทั้งหมด** + ประวัติ | `GET /tasks` | **รื้อใหม่ + รวมรายการงานจาก `/tasks` + เปลี่ยนเป็นแท็บ + ตัด AppBar/ทางลัดเดิม** (§7.2) | 3 |
| `/tasks` `task_list_page.dart` | (เดิม ST/OT จากทางลัด, "ดูทั้งหมด", banner) | รายการงาน | `GET /tasks` | **ตัดออก รวมเข้า Home** (มติ B ข้อ 12) | 3 |
| `/device-connection-test` `device_connection_test_page.dart` | (เดิม ST/OT จากทางลัด) | ทดสอบสัญญาณ | `POST /devices/:id/test-connection` | **ตัดออก** (มติ B ข้อ 5) — ทางลัดหายไปพร้อมหน้าแรกใหม่ | 3 |
| `/device-connection-test/pick-device` `company_device_picker_page.dart` | (จากหน้าบนเท่านั้น) | เลือกบริษัท → อุปกรณ์ | `GET /customers`, `GET /devices` | **ตัดออก** พร้อมหน้าแม่ | 3 |
| `/devices` `device_search_page.dart` | ทุกคน / แท็บ Device Search | ค้นหาอุปกรณ์ | `GET /devices` | รื้อดีไซน์ (โครงแท็บมาใน Batch 3 ส่วนเนื้อหาหน้าใน Batch 4) | 4 |
| `/incident-report` `field_report_page.dart` | ST/OT / ปุ่มในแท็บ Incidents, Device Detail | ส่งรายงานปัญหา | `POST /incidents` | รื้อดีไซน์ | 4 |
| `/devices/:id/firmware-override` | ST / Device Detail | เลือก Firmware ส่งคำขอ | `GET /firmware`, `POST /devices/:id/firmware-override` | รื้อดีไซน์ | 4 |
| `/devices/:id` `device_detail_page.dart` | ทุกคน / Device Search, Task Detail, Incident, แจ้งเตือน | ปุ่ม Config Override (ST), Firmware Override (ST), ยืนยันติดตั้ง Firmware (ST/OT), Field Report (ST/OT) | `GET /devices/:id`, `GET /devices/:id/status` | รื้อดีไซน์ | 4 |
| `/devices/:id/confirm-firmware` `confirm_firmware_install_page.dart` | ST/OT / Device Detail | ยืนยันติดตั้ง Firmware | `GET /firmware`, `GET /devices/:id/status`, `POST /devices/:id/confirm-firmware-install` | **เก็บไว้ รื้อดีไซน์ปกติ** (§3 ข้อ 17 · §10 ข้อ A1) — ทำต่อจาก Device Detail · ทบทวนอีกครั้งตอนทำ Firmware PULL | 4 |
| `/devices/:id/config-override` | ST / Device Detail | แก้ค่าเฉพาะ field แล้วส่งคำขอ | `GET /devices/:id/config`, `GET /config-definitions`, `POST /devices/:id/config-override` | รื้อดีไซน์ · ใช้ `AppSensitiveValue` (docs/21 #20) | 4 |
| `/tasks/:id` `task_detail_page.dart` | ST/OT, Operation (เพิ่มบันทึก) / หน้าแรก, แจ้งเตือน, push | บันทึกสถานะ, timeline + เพิ่มบันทึก, **ทดสอบกับ Device Simulator** (ไม่บังคับ), ส่ง Config เข้าเครื่อง | `GET/PATCH /tasks/:id`, `GET /tasks/:id/events`, `POST /tasks/:id/notes`, `POST /devices/:id/simulate-config`, `POST /devices/:id/apply-config` | รื้อดีไซน์ (หน้าซับซ้อนสุด) · **เป็นที่เดียวที่เหลือของ Device Simulator** · ปุ่มหลัก/รอง (docs/21 #11) | 5 |
| `/simulator` `simulator_page.dart` | (เดิม ST/OT จากทางลัด) | ทดสอบความพร้อม Config | `GET /config`, `POST /devices/:id/simulate-config` | **ตัดออก** (มติ B ข้อ 4) · ลบทางลัด + route + หน้า + ผลพ่วงพร้อมกันใน Batch 3 (มติ B ข้อ 16) | 3 |
| push (`push_message_handler.dart`) | — | พาไปหน้า Task Detail / Incident / แจ้งเตือน / หน้าแรก | `POST/DELETE /notifications/device-tokens` | ไม่มี UI ไม่ต้องรื้อ · ปรับให้ deep link เข้าโครงแท็บใหม่ (Batch 3) | 3 |

### 8.1 ผลพ่วงของการตัดหน้า (สำรวจ import / link แล้ว — บันทึกไว้ ทำตอน implement)

- **`/tasks` → หน้าแรก** (Batch 3)
  - link ไป `/tasks` ตรงๆ มี 3 จุด **อยู่ในหน้าแรกทั้งหมด**: ทางลัด "งานของฉัน" (`home_page.dart`), ปุ่ม "ดูทั้งหมด"
    (`home_page.dart`) และ banner สรุปงาน (`home_status_banners.dart`) — หายไปพร้อมหน้าแรกใหม่ (banner ให้เลื่อน/
    กรองรายการบนหน้าเดียวกันแทน)
  - **push / แจ้งเตือนไม่มีจุดไหนพาไป `/tasks`** (พาไป Task Detail / Incident / แจ้งเตือน / หน้าแรก) — ตอน implement
    ให้ตรวจซ้ำ ถ้าเจอให้พาไปแท็บหน้าแรกแทน
  - ลบ `task_list_page.dart` และ `AppRoutes.myTasks` · เทสที่อ้างถึง: `task_list_page_test.dart`,
    `home_page_test.dart`, `home_task_summary_test.dart`, `large_text_layout_test.dart`, `offline_cache_banner_test.dart`
    และ **E2E `integration_test/task_flow_test.dart`** (ย้ายเทสที่ยังมีความหมายมาที่หน้าแรก ไม่ใช่ลบทิ้ง)
- **`/device-connection-test` + `/pick-device`** (Batch 3)
  - ลบทั้ง `features/device_connection_test/` · `auth_controller.dart` เรียก `recentDeviceIdStoreProvider.clear()` ตอน
    logout ต้องเอาออก และควรล้างค่าเก่าใน SharedPreferences ที่เครื่องเคยบันทึกไว้หนึ่งครั้ง
  - `ApiClient.listCustomers()` (`GET /customers`) จะไม่มีใครใช้ ลบด้วย
  - เทส: `device_connection_test_page_test.dart`, `recent_device_id_store_test.dart`, key `shortcut_device_test` ใน
    `home_page_test.dart` ฯลฯ
- **`/simulator`** (Batch 3 — มติ B ข้อ 16)
  - ลบทางลัด "ทดสอบการตั้งค่า" (หายไปกับหน้าแรกใหม่), `AppRoutes.simulator` + route ใน `app_router.dart`,
    `simulator_page.dart`, `config_repository.dart` (`deployableConfigListProvider`) และ `ApiClient.listConfigs()`
    (Mobile จะไม่เรียก `GET /config` อีก) · **ต้องเก็บ** `simulator_repository.dart` และ `simulation_result_card.dart`
    เพราะ Task Detail ใช้ (ย้ายไป `features/task/`) · `DeviceConfigDraft` ยังใช้ใน Config Override
  - เทส: `simulator_page_test.dart` · `task_detail_simulator_test.dart` / `task_detail_simulator_checklist_test.dart`
    ต้องยังผ่าน (เป็นตัวยืนยันว่าปุ่มใน Task Detail ครอบหน้าที่ถูกตัด)
  - ทำใน Batch 3 ไม่รอ Batch 5 เพราะทางลัดเดียวที่เข้าหน้านี้หายไปกับหน้าแรกใหม่ ถ้ารอจะมี route ค้างที่ไม่มีทางเข้า
    และปุ่มใน Task Detail ใช้ได้อยู่แล้วโดยไม่พึ่งหน้านี้ (`simulator_repository.dart` / `simulation_result_card.dart`
    ย้ายไป `features/task/` ใน Batch 3 ด้วย ส่วนการรื้อดีไซน์ของปุ่มรอ Batch 5)
- เทสกลางที่อ้าง 2 หน้าที่ถูกตัด: `color_contrast_test.dart`, `primary_button_consistency_test.dart`,
  `auth_controller_test.dart`, `session_expiry_flow_test.dart`, `offline_sync_flow_test.dart`, `models_test.dart`
  — แก้ในใบเดียวกับที่ตัดหน้า

---

## 9. ลำดับงาน (batch)

ใช้วิธีเดียวกับ UX audit 25 ข้อ (#329 / #331 / #333 / #334 / #335 / #338): **batch เล็ก 1 batch = 1 PR** (batch
ใหญ่แตกเป็นหลายใบได้ เช่น 2a / 2b), **TDD** (เขียนเทสที่ fail ก่อน), แต่ละใบแตะไฟล์ไม่ซ้อนกับ PR อื่นที่เปิดอยู่,
sync `main` ผ่าน CLI ก่อนเปิด/ก่อน merge, ใช้ผล `dart format` ของ CI (Flutter 3.47.7) ไม่แก้ format ตามเครื่องตัวเอง
(3.44.8), ไม่ merge เอง

| Batch | งาน | เงื่อนไขว่าเสร็จ (คร่าวๆ) |
|---|---|---|
| 0 | ลบ dead code `simulateConfig()` / `isNumericDataType()` — **#346** (ไม่ได้ตัดหน้าไหน) | merge แล้ว (`9cfa1d1`) |
| 1 | **Token + component กลาง** — `AppColors` (ชื่อตาม Web §4.1), `AppTypography` (13 / 15, Anuphan), `AppTheme.v2()` (โหมดสว่าง, ขอบช่องกรอก `#576171`, ปุ่มตาม variant), mapping สถานะ → tone (§5.2) · สร้าง **`AppBadge`, `AppCard`, `AppPageHeader`** · **ยังไม่แก้หน้าไหนจริง** · **implement แล้วใน #349 (รอ A รีวิว)** + bundle ฟอนต์ Anuphan + `OFL.txt` (APK +≈116 KB — §4.5, §3 ข้อ 21) · **ยังค้าง:** ล็อก `ThemeMode.light` ย้ายไป Batch 6 (§4.2) · ไฟล์ label กลาง (§6) และ `AppButton.variant` ทำใน batch แรกที่มีหน้าใช้จริง | มีแค่ widget ใหม่ + เทสของ widget เอง · เทส contrast ทุกคู่ใน §4–§5 · ขอบช่องกรอก ≥ 3:1 · เทสว่าทุกค่า enum มี tone (เทส label มากับไฟล์ label) |
| 2 | **หน้าง่ายก่อน** เพื่อพิสูจน์ pattern: Login → Notifications → Incident List → Incident Detail (+ `AppInfoRow`, `AppEmptyState`, skeleton) · แตกเป็น 2a (Login + Notifications) / 2b (Incidents) ได้ | ใช้ token/component ใหม่ · ไม่มี `Color(0x` ในโมดูล · Key เดิมครบ · E2E เขียว |
| 3 | **หน้าแรกใหม่ + แท็บด้านล่าง** — รวมรายการงานจาก `/tasks`, `StatefulShellRoute` ตาม role (§7.2), ตัด AppBar สีกรมท่าและทางลัดเดิม, avatar/บัญชีผู้ใช้, deep link ของ push เข้าโครงแท็บ · ตัด `/tasks`, `/device-connection-test`, `/pick-device`, **`/simulator`** + ผลพ่วง (§8.1) | หน้าแรกแสดงงานทั้งหมดได้ · ทุกแท็บเปิดได้ตาม role · back ไม่ปิดแอป · ไม่มี link ไป route ที่ถูกตัด · เทส simulator ใน Task Detail ยังผ่าน · เทส + E2E เขียว |
| 4 | **หน้าที่เหลือ เรียงจากง่ายไปซับซ้อน** (วัดจากขนาดไฟล์ตอนนี้): Device Search (256 บรรทัด) → Field Report (291) → Firmware Override (329) → Device Detail (420) → **Confirm Firmware Install (317)** → Config Override (722, + `AppSensitiveValue`) · Confirm Firmware Install วางต่อจาก Device Detail ไม่ใช่ตามขนาดไฟล์ เพราะเป็นหน้าลูกที่เปิดจากปุ่มใน Device Detail (§3 ข้อ 17) · แตกหลายใบได้ | เหมือน Batch 2 |
| 5 | **Task Detail** (หน้าซับซ้อนสุด 909 บรรทัด) — รื้อดีไซน์ทั้งหน้า รวมส่วน "ทดสอบกับ Device Simulator" (ที่เดียวของ Simulator หลังหน้า `/simulator` ถูกลบใน Batch 3) · ปุ่มหลัก/รอง (docs/21 #11) · งาน Step 4.1 ที่เคยอยู่ใน docs/20: แยกข้อความ ออฟไลน์ / 401 / 5xx / 4xx อื่น ยกเว้น 408 และ 429 (ยกเงื่อนไขว่าเสร็จมาทั้งหมด) | เหมือน Batch 2 + เทส simulator ใน Task Detail ผ่าน + เทสแยกกรณี error ครบ |
| 6 | **ปิดงาน** — สลับ ThemeData ทั้งแอปเป็น v2 + ล็อก `ThemeMode.light` (§4.2) · ลบ token เก่า (`navy`, `mock*` ฯลฯ) และ `AppTheme.dark()` · เทสดัก `Color(0x` นอกไฟล์ token · ปิด docs/21 ข้อ #21, #22, #24 · อัปเดตสถานะใน docs/21 | grep `Color(0x` ใน `lib/` เหลือแค่ไฟล์ token · E2E เขียว |

- ระหว่างทาง (Batch 2–5) ครอบ theme ใหม่เฉพาะหน้าที่ย้ายแล้ว หน้าที่โชว์จะไม่มีสีปนกัน · สลับทั้งแอปใน Batch 6
- docs/21 ข้อ #7 / #25 (applicationId, keystore, ชื่อแอป, ไอคอน) ไม่อยู่ในแผนนี้ ต้องคุยกับทีมแยก

---

## 10. คำถามถึง A และคำตอบ (ไม่มีคำถามเปิดเหลือ)

### ถึง A — ตอบครบแล้ว (19 ต.ค. 2569)

- **A1. "ยืนยันติดตั้ง Firmware" ยังจำเป็นไหมหลังเปลี่ยนเป็น PULL model?**
  - **คำตอบของ A: ยังจำเป็น เก็บไว้ก่อน** — PULL ของ Firmware ยังไม่ได้สร้าง (docs/19 ทำ Config ก่อน Firmware เป็น
    ขั้นที่ 2) ข้อความบน Web ที่ว่า "ไม่ต้องรอช่างกดยืนยัน" เป็นการจำลองว่ากล่องดึงค่าไปใช้เอง ยังไม่ใช่ของจริง ·
    ยังมี use case จริงคือช่างเปลี่ยน Firmware ด้วยมือหน้างานนอก Campaign และ endpoint `confirm-firmware-install`
    เขียน AuditLog กับเช็คว่าตรงกับ Firmware ที่ Campaign กำหนด · **ผล:** Mobile เก็บหน้านี้และรื้อดีไซน์ตามปกติ
    (A อ้าง "Batch 9" ซึ่งเป็นเลขของร่างแรก = **Batch 4** ของแผนนี้ ต่อจาก Device Detail — §3 ข้อ 17, §9) ·
    backend ไม่แตะ · ทบทวนอีกครั้งตอนทำ Firmware PULL จริง · **A จะปรับข้อความบน Web เอง**ให้ไม่ขัดกับหน้านี้
  - คำถามเดิม: Web บอก Operation ตอนปล่อย
    Rollout ว่า "ระบบกำลัง apply ให้ทุกเครื่องอัตโนมัติ (PULL model) ไม่ต้องรอช่างกดยืนยันที่เครื่องอีกต่อไป"
    (`lib/status-pill.tsx`) แต่ Mobile ยังมีหน้า `/devices/:id/confirm-firmware` ให้ ST/OT กดยืนยัน
    (`POST /devices/{id}/confirm-firmware-install` ยัง active เขียน AuditLog และเช็คว่าตรงกับ Firmware ที่ Campaign
    กำหนดไหม ถ้าไม่ตรงต้องขอ Firmware Override ก่อน) — ปุ่มนี้ยังมี use case จริงไหม (เช่น ช่างเปลี่ยน
    Firmware ด้วยมือหน้างานนอก Campaign) หรือควรตัดออก · ถ้าตัด backend endpoint จะเก็บไว้หรือเลิกใช้
- **A2.** (ข้อสังเกต ไม่บล็อก) คอมเมนต์ hex ใน `globals.css` ไม่ตรงกับค่า oklch จริงหลายตัว (§4.4) และ `--input`
  ได้ 1.25:1 ไม่ถึง 3:1 สำหรับขอบช่องกรอก (§4.3 — Mobile ใช้ `muted-foreground` แทนแล้ว) · **A รับทราบ**
- **A3.** (ข้อสังเกต ไม่บล็อก) หน้าจริงของ Web ยังใช้ `StatusPill` ทั้งหมด `Badge` ยังไม่ถูกใช้ (§5.3) — Web มี
  แผนย้ายไป Badge ไหม (ถ้าย้าย สีสถานะสองฝั่งจะตรงกัน) และป้ายสถานะคำเดียวที่แสดงค่าดิบตัวเล็ก (`open`,
  `registered`) จะเปลี่ยนเป็นตัวแรกพิมพ์ใหญ่แบบที่ Mobile ใช้ (§6.1) ไหม
  - **คำตอบของ A:** Web ยังใช้ `StatusPill` ต่อในรอบนี้ แต่ #344 เปลี่ยนสีของ `StatusPill` ไปใช้ token ชุดเดียวกับ
    Badge สีสถานะสองฝั่งจึงตรงกัน (ดู note ใน §5.3) · การย้ายหน้าจริงไปเรียก `Badge` ตรงๆ และการเปลี่ยนป้ายคำเดียว
    เป็นตัวแรกพิมพ์ใหญ่ ยังไม่ได้ตัดสินใจ (ไม่บล็อกแผนนี้)

### ถึง B — ตัดสินครบแล้ว (19 ต.ค. 2569 รอบ 2)

ข้อ B1–B6 ในร่างแรกได้คำตอบหมดแล้ว รวมไว้ใน §3 ข้อ 7–15 และปรับเนื้อหาทั้งเอกสารตามนั้น
(B1 สถานะที่ Web เป็นไทย → คงไทย · B2 ตัวพิมพ์ → ตัวแรกพิมพ์ใหญ่ · B3 คำที่ไม่มีคู่เทียบ → คงไทย, "Incidents",
ป้าย Role `ST` · B4 dark mode → ล็อกโหมดสว่าง · B5 การนำทาง → แท็บด้านล่าง ไม่มี AppBar สีกรมท่า · B6 ขอบช่องกรอก →
`muted-foreground` ตอนนั้น `#667080` ภายหลังเป็น `#576171` ตาม §3 ข้อ 19) · และย้ายการลบหน้า `/simulator` มาไว้ Batch 3 (§3 ข้อ 16)
