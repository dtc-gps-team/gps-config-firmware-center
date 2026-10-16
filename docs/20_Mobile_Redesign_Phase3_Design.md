# ข้อเสนอออกแบบ: Mobile Redesign Phase 3 (Design System, Bottom Navigation, ย้ายหน้าจอทั้งแอป)

> เอกสารนี้เป็น**ข้อเสนอ ยังไม่ใช่มติ** เขียนให้ A (paveekornkwork-dev) รีวิวก่อนลงมือทำ ตาม pattern
> เดียวกับ `docs/17` และ `docs/19` ในเอกสารนี้ยังไม่มีโค้ดแอป ใบนี้แก้เอกสารอย่างเดียว
>
> **ความสัมพันธ์กับเอกสารอื่น:** ต่อจาก `docs/18` (Phase 1-2: สำรวจหน้าจอและ gap ของข้อมูล) ซึ่ง
> คำถามเปิดทั้ง 3 ข้อได้คำตอบใน #303 แล้ว เอกสารนี้คือ Phase 3 ที่ `docs/18` บรรทัดสุดท้ายบอกไว้ว่า
> "โครงร่างหน้าจอใหม่"
>
> **ที่มาของตัวเลข:** นับจาก `main` ที่ `570a32e` (16 ต.ค. 2569)

---

## 1. ปัญหา

gap ของข้อมูลที่ `docs/18` ลิสต์ไว้ส่วนใหญ่ปิดไปแล้ว (imei, serial, ชื่อลูกค้า, unit, ความเข้ากันได้ของ
firmware, reviewNote, online) ที่เหลือคือ**การจัดระเบียบและการนำเสนอ** ซึ่งทำให้แอปดูไม่ดีทุกหน้า:

| ปัญหา | ตัวเลขจริง |
|---|---|
| หน้าตาสองยุคปนกัน | สีชุดเก่า (`navy`, `textPrimary`, `iconBg` ฯลฯ) ใช้ใน **20 ไฟล์** สีชุด `mock*` ใช้ใน **6 ไฟล์** (หลักๆ คือ Home) |
| สีฝังเป็น hex ตรงๆ | `Color(0x` **44 จุดใน 8 ไฟล์** (`incident_ui.dart` 17, `task_status_ui.dart` 12, `device_status_ui.dart` 6 ฯลฯ) |
| ไม่มี theme กลาง | `AppTheme._base()` ตั้งแค่ `colorScheme`, `inputDecorationTheme` และขนาดปุ่ม `FilledButton` ไม่ได้ตั้งตัวอักษร การ์ด chip หรือ AppBar เลย |
| ไม่มีเมนูด้านล่าง | **17 route** ทุกหน้าเข้าจากทางลัดบน Home แล้วซ้อนกันไปเรื่อยๆ จะสลับจากงานไปอุปกรณ์หรือแจ้งเตือน ต้องกดกลับมาที่ Home ทุกครั้ง |

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย / ถือว่าล้มเหลว

**เป้าหมาย**
- ทั้งแอปใช้ design system ชุดเดียว ในหน้าจอไม่มีสีฝัง hex เหลืออยู่เลย
- ช่างใช้งานกลางแจ้งได้: ตัวอักษรทุกคู่สีผ่าน contrast 4.5:1 และพื้นที่กดทุกจุดสูงอย่างน้อย 48dp
- เมนูด้านล่างปรับตาม role สลับไปมาระหว่างงาน อุปกรณ์ และแจ้งเตือนได้ในแตะเดียว
- เขียนทุกหน้าใหม่บนฐานเดียวกันทั้งหน้า ไม่แก้แบบปะผุทีละจุด

**ไม่ใช่เป้าหมาย**
- ไม่แก้ Backend และ Web ในรอบนี้ (ยกเว้นถ้า §8 ข้อ 1 ตัดสินว่าต้องมี endpoint ใหม่)
- ไม่เพิ่มฟีเจอร์ business ใหม่ ยกเว้น `activePartition` / `hardwareRevisionCode` บนหน้า Device Detail ที่ค้างจาก `docs/18` ข้อ 6
- ไม่ทำหน้าตัดสินใจของ Operation บนมือถือ (มติ #303 ข้อ 2: ทำบนเว็บ)
- dark mode เก็บ `AppTheme.dark()` ไว้ให้ build ได้ แต่ไม่ลงแรงขัดเกลา

**ถือว่าล้มเหลว (แม้จะทำงานได้)**
- PR ก้อนเดียวใหญ่จนรีวิวไม่ได้
- ช่วงเปลี่ยนผ่านมี build พัง หรือเทส / E2E ต้องปิดไว้ชั่วคราว
- push notification deep link พาไปผิดหน้า หรือกด back แล้วหลุดออกจากแอป (regression ของ #331 ข้อ #4)
- ทำงานออฟไลน์แล้วฟอนต์ไทยกลายเป็นกล่องสี่เหลี่ยม

## 3. ข้อจำกัด

- **ทุกขั้นต้องรวมเข้า `main` ได้และ build ผ่าน** ทุก PR ต้องมี approve จาก A และ CI เขียว (CLAUDE.md)
  และ `main` ตั้ง `dismiss_stale_reviews` ไว้ PR จึงต้องเล็กพอให้รีวิวจบในรอบเดียว
- **ห้ามแตะหน้าจอเดิมจนกว่า Step 1-2 จะเสร็จ**
- **เขียนเทสก่อนทุกครั้ง (TDD)** และเก็บ widget `Key` เดิมไว้ทุกตัว เทสเดิมกับ `integration_test/` จะได้ยังจับได้
- Flutter ในเครื่อง (3.44.8) กับ CI (3.47.7) จัด `dart format` ต่างกัน ต้องยึดผลจาก CI
- PR ของ Mobile ที่ยังเปิดอยู่ตอนเขียนเอกสารนี้: #324, #325, #326, #329, #331, #333, #334, #335 ทุกใบแตะหน้าจอที่จะเขียนใหม่ (§6 Step 0)

## 4. มติที่ตกลงแล้ว (B, 16 ต.ค. 2569)

### 4.1 Design tokens

แนวทาง: **Clean, High-Contrast & Utilitarian Field Service**

| Token | ค่า | ใช้กับ |
|---|---|---|
| `primary` | `#2563EB` | ปุ่มหลัก ลิงก์ แท็บที่เลือก (ตัวอักษรขาวบนพื้นนี้ได้ 5.17:1) |
| `background` | `#F8FAFC` | พื้นหลังของแอป |
| `surface` | `#FFFFFF` | การ์ด |
| `border` | `#E2E8F0` (1px) | ขอบการ์ด |
| `textPrimary` | `#0F172A` | ข้อความหลัก (17.06:1 บน background) |
| `textSecondary` | `#475569` | label และข้อความรอง (7.58:1 บนพื้นขาว) |
| `textMuted` | `#94A3B8` | **ของตกแต่งเท่านั้น** เช่น placeholder หรือเส้นแบ่ง ห้ามใช้กับข้อความที่ต้องอ่าน (2.56:1) |

**สีสถานะ:** แต่ละ tone มี 3 ค่า ค่า `fg` เข้มกว่าที่ brief เสนอหนึ่งระดับ เพราะค่าใน brief ไม่ผ่าน 4.5:1
เมื่อเป็นตัวอักษรบนพื้นอ่อน (มติ B ว่าให้ดันค่าให้ผ่านเกณฑ์กลางแจ้ง):

| Tone | `fg` (ข้อความ) | `icon` (ไอคอน/ขอบ) | `bg` (พื้น) | contrast ของ `fg` บน `bg` | ค่าใน brief บน `bg` |
|---|---|---|---|---|---|
| success | `#047857` | `#059669` | `#ECFDF5` | **5.21** ✅ | 3.58 ❌ |
| warning | `#B45309` | `#D97706` | `#FFFBEB` | **4.84** ✅ | 3.07 ❌ |
| danger | `#B91C1C` | `#DC2626` | `#FEF2F2` | **5.91** ✅ | 4.41 ❌ |
| neutral | `#475569` | `#64748B` | `#F1F5F9` | **6.92** ✅ | 4.34 ❌ |
| info | ใช้ `primary` | `primary` | ตัดสินตอน Step 1 | ต้องผ่าน 4.5 | — |

- **ตัวอักษร:** bundle ฟอนต์ **Noto Sans Thai** เป็น asset ในแอป (ไม่ใช้ `google_fonts` ที่โหลดจากเน็ต)
- **ขนาดกด:** ขั้นต่ำ 48dp ตั้งไว้ที่ระดับ theme (`materialTapTargetSize`, `minimumSize` ของปุ่ม)
- **โหมด:** โฟกัส light mode

### 4.2 Shared components (Step 2)

| Component | สัญญา (contract) |
|---|---|
| `StatusTone` | `enum { success, warning, danger, neutral, info }` เป็นตัวเดียวที่รู้จักสีสถานะ |
| `AppStatusBadge` | รับ `StatusTone` + `label` (+ `icon` ไม่บังคับ) **ไม่รับ enum ของ domain ตรงๆ** |
| extension ของแต่ละ domain | เช่น `TaskStatus.tone` / `.label`, `IncidentStatus.tone`, สถานะ config/firmware ของอุปกรณ์ เขียนเป็น `switch` ที่ไม่มี `default` ถ้ามีค่า enum ใหม่ที่ยังไม่ได้ map compiler จะฟ้องทันที ไฟล์ `*_ui.dart` เดิมจะย้ายมาอยู่ตรงนี้ |
| `AppCard` | มุมมน 12px มี padding ในตัว ใช้ `surface` + `border` 1px กดได้แบบไม่บังคับ (ripple ไม่ล้นขอบ) |
| `AppInfoRow` | คู่ label ↔ value มีปุ่ม copy แบบไม่บังคับ (ใช้กับ Serial, IMEI, deviceId) กดแล้วลง clipboard และขึ้น snackbar ปุ่ม copy เองก็ต้องได้ขนาดกด 48dp |
| `AppPrimaryButton` / `AppSecondaryButton` | เต็มความกว้าง สูงอย่างน้อย 48dp มีสถานะ loading (กดซ้ำไม่ได้) และสถานะ disabled ที่**ดูต่างจากปุ่มปกติชัดเจน** (ปัญหาที่ `docs/18` ข้อ 3 เจอ) |

### 4.3 แท็บด้านล่างตาม role

**ไม่รวม Home เข้ากับแท็บงาน** เพราะ Home ยังเป็น dashboard ภาพรวมและจุดรวมทางลัด

| Role | แท็บ |
|---|---|
| ST / OT | **หน้าหลัก** · **งาน** · **อุปกรณ์** · **แจ้งเตือน** |
| Operation / Auditor / Admin | **หน้าหลัก** · **อุปกรณ์** · **แจ้งเตือน** · **เมนูอื่น ๆ** (ไม่มีแท็บงานเลย ไม่แสดงแท็บว่าง) |

- ใช้ `StatefulShellRoute` ของ go_router ให้แต่ละแท็บจำ stack กับตำแหน่งที่เลื่อนไว้
- หน้าย่อย (Task Detail, Device Detail, Override, Confirm Install, Field Report ฯลฯ) เปิดซ้อน**เต็มจอ ทับเมนู**
- SuperAdmin ยังถูกบล็อกที่หน้า login เหมือนเดิม

## 5. สถาปัตยกรรม

```
mobile/lib/core/design/            ← ใหม่ (Step 1-2)
  app_colors.dart                  tokens + StatusTone colors
  app_typography.dart              TextTheme บน Noto Sans Thai
  app_theme.dart                   ThemeData M3 (ย้าย/แทนของเดิมใน core/theme)
  components/
    app_status_badge.dart
    app_card.dart
    app_info_row.dart
    app_buttons.dart
mobile/lib/features/<module>/<module>_status_tone.dart   ← แทน *_ui.dart (Step 4)
mobile/lib/core/router/app_shell.dart                   ← ใหม่ (Step 3)
mobile/assets/fonts/NotoSansThai-*.ttf                  ← ใหม่ (Step 1)
```

ช่วงเปลี่ยนผ่าน: `AppTheme.navy` / `mock*` ฯลฯ **ยังอยู่** แต่ติด `@Deprecated('ใช้ AppColors แทน — docs/20')`
ถ้าใช้จะขึ้น warning แต่ build ไม่พัง หลังย้ายหน้าจอครบแล้วค่อยลบทิ้งใน Step 5

## 6. ลำดับงาน (ทำตามลำดับ ห้ามข้าม 1 ขั้นต่อ 1 PR ยกเว้น Step 4 ที่เป็น 1 โมดูลต่อ 1 PR)

| Step | สิ่งที่ทำ | เงื่อนไขว่าเสร็จ |
|---|---|---|
| **0. เคลียร์ทาง** | merge PR Mobile ที่ค้างอยู่ใน §3 ให้หมด และให้ A รีวิว/approve เอกสารนี้ | ไม่มี PR Mobile ที่แตะ `features/` ค้างอยู่ |
| **1. Tokens + Theme** | `AppColors`, `AppTypography`, `ThemeData` M3 พร้อม component theme (Card, Chip, FilledButton, OutlinedButton, Input, AppBar, NavigationBar, SnackBar), bundle ฟอนต์, ติด `@Deprecated` ให้ token เก่า | เทส contrast ของทุกคู่สีใน §4.1 ต้องผ่าน ≥ 4.5 · ทุกหน้าเดิมยัง render ได้ · E2E เขียว |
| **2. Shared components** | 4 component + `StatusTone` ตาม §4.2 **ยังไม่มีหน้าไหนเรียกใช้** | widget test ครบทุก component (tone → สี, copy → clipboard + snackbar, loading/disabled, ขนาดกด ≥ 48dp) |
| **3. Shell + Bottom Nav** | `app_shell.dart`, ย้าย route เข้า `StatefulShellRoute`, แท็บตาม role §4.3, ย้าย logic deep link ของ push (จาก #331) มาใช้กับ shell | เทสที่ใช้ `routerProvider` จริงของ #331 ผ่านทุกกรณี · แตะ push แล้ว back กลับแท็บได้ ไม่หลุดออกจากแอป · role อื่นไม่เห็นแท็บงาน |
| **4.1 Task** | Task List + Detail (รวม timeline) | ไม่มี `Color(0x` / token เก่าในโมดูล · Key เดิมครบ |
| **4.2 Device** | Device Search + Detail + เพิ่ม `activePartition` / `hardwareRevisionCode` | เหมือนข้างบน + parse field ใหม่ตรงกับ `openapi.yaml` |
| **4.3 Home + Notifications** | Home dashboard (สรุปสถานะด่วน + ทางลัด) และหน้าแจ้งเตือน | เหมือนข้างบน |
| **4.4 ที่เหลือ** | Config/Firmware Override, Confirm Install, Incident (list/detail/field report), Simulator, Connection Test + Picker, Login, หน้า "เมนูอื่น ๆ" | เหมือนข้างบน |
| **5. ปิดงาน** | ลบ token เก่า + `core/theme/app_theme.dart` เดิม, เพิ่มเทสที่ไล่ทุกไฟล์ใน `lib/features/` แล้ว fail ถ้าเจอ `Color(0x` | `flutter analyze` ไม่มี deprecation warning · เทสดัก hex เขียว |

ทุก Step: รัน `flutter test` ทั้งสองโหมด (mock / `API_MOCK_MODE=false`) และรัน E2E บน emulator ก่อนขอรีวิว

## 7. ส่วนที่ปล่อยให้คนทำตัดสินใจ

- ขนาดตัวอักษรแต่ละระดับ ระยะห่าง และ elevation (ยึดแนวทาง utilitarian: ข้อมูลแน่นแต่อ่านง่าย)
- ไอคอนของแต่ละแท็บ และของแต่ละ tone
- ค่า `info` tone ตราบใดที่ผ่าน 4.5:1
- จะแยก Step 4.4 เป็นกี่ PR ขอแค่แต่ละใบรีวิวจบได้ในรอบเดียว

## 8. คำถามเปิด (ไม่ติด Step 0-3 ตอบก่อนถึง Step 4.3 ก็พอ)

1. ❓ **"สแกน QR" บน Home** — ตอนนี้แอปยังไม่มีการสแกนใดๆ เลย (ไม่มี package กล้อง) ต้องตอบ:
   QR บนเครื่องเก็บค่าอะไร (deviceId? IMEI?) สแกนแล้วพาไปหน้าไหน และนับเป็นฟีเจอร์ในรอบนี้หรือแยกเป็นงานรอบหลัง
   ถ้าไม่มีคำตอบ: ไม่ทำในรอบนี้ และไม่วางปุ่มที่ยังกดไม่ได้ไว้บน Home
2. ❓ **ในแท็บ "เมนูอื่น ๆ" มีอะไร** — ข้อเสนอ: ข้อมูลผู้ใช้ + role, ดู Incident, ออกจากระบบ
   (ปุ่ม logout ต้องกดค้างตาม #326) ส่วน ST/OT ไม่มีแท็บนี้ logout ยังอยู่ที่หัว Home
3. ❓ **"สรุปสถานะด่วน" บน Home ของ role อื่น** — ST/OT มีงานค้างให้สรุป แต่ role อื่นไม่มีงาน
   ข้อเสนอ: แสดงจำนวนแจ้งเตือนที่ยังไม่อ่านกับ Incident ที่ยังเปิดอยู่ (ใช้ endpoint ที่มีอยู่แล้ว)

## 9. ข้อตัดสินใจของผู้เขียน (ค้านได้)

- เพิ่ม tone `info` ให้ชุดสถานะใน brief ที่มี 4 ค่า สำหรับข้อความประเภท "กำลังดำเนินการ" ที่ไม่ใช่ทั้ง warning และ success
- ใช้ขอบการ์ด `#E2E8F0` ตาม brief ถ้าทดสอบกลางแจ้งตอน Step 4.1 แล้วมองขอบการ์ดไม่เห็น (contrast ของเส้นขอบบนพื้นขาวได้แค่ 1.23:1) จะเสนอเปลี่ยนเป็น `#CBD5E1`
- วาง design system ไว้ที่ `core/design/` แยกจาก `core/theme/` เดิม จะได้ลบของเก่าทิ้งทั้งโฟลเดอร์ใน Step 5 ได้สะอาด
