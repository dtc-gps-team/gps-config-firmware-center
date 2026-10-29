# UI Renovation: GPS Center (Config & Firmware Management)

เอกสารนี้คือแหล่งอ้างอิงเดียวของงานรีโนเวท UX/UI 3 รอบ รอบ 2 และ 3 อ่านไฟล์นี้ต่อได้เลยโดยไม่ต้องสำรวจใหม่
Web อยู่ที่ `web/` (Next.js 16 App Router, TypeScript, Tailwind 4, shadcn/ui บน Base UI) อ่าน `web/AGENTS.md` ก่อนแตะ API ของ Next

## 1. กฎเหล็ก

1. ห้ามทำให้ฟังก์ชันเดิมพัง ห้ามแก้ API call, business logic, data model, route path โดยไม่จำเป็น ถ้าจำเป็นให้ระบุเหตุผล
2. ห้าม hardcode สี/ระยะ/duration/easing ใน component ใช้ tokens เท่านั้น (ดู §5 และ `web/src/lib/motion.ts`)
3. นี่ไม่ใช่ wording pass คงข้อความเดิม ยกเว้นข้อความของ component ที่สร้างใหม่ (empty/error state, ConfirmDialog, tooltip) ให้สั้น ภาษาเดียว ไม่โฆษณา ไม่มี emoji หัวข้อสองภาษาซ้อนกันให้เหลือภาษาเดียว แจ้งในสรุปทุกครั้ง
4. ห้ามสร้างข้อมูลปลอมใน UI ถ้าไม่มี API ให้ข้ามหรือทำ empty state
5. ห้ามบอกว่าเสร็จก่อนรันและดูผลจริง
6. ตัดสินใจเองด้วย best practice ไม่ถามกลับ ยกเว้นเรื่องที่กระทบข้อมูลจริง
7. จำกัดทรัพยากร: สำรวจด้วย grep/glob ก่อน, screenshot เท่าที่ระบุ, วนแก้สูงสุด 2 รอบ, รายงานสั้น

ข้อควรระวังเฉพาะโปรเจกต์ (จาก `CLAUDE.md` ราก): ห้ามแตะ API contract, Role มี 9 ค่า (ห้าม `SW`/`FieldTechnician`), เมนูกรองด้วย `allowedRoles` ใน `web/src/lib/nav.ts`

## 2. กฎ Git

- ก่อนเริ่มรอบ ตรวจ `git status` ถ้ามีการแก้ไขที่ยังไม่ commit ให้แจ้งเจ้าของและหยุด (ไฟล์ `.postman/`, `postman/` ที่ untracked เป็นของเจ้าของ ห้าม add)
- ทำงานบน branch `ui-renovation/round-N-...` ห้าม commit ตรงบน main
- commit เป็นก้อนเชิงตรรกะ ข้อความภาษาอังกฤษ imperative สั้น ห้ามรวมทั้งรอบเป็นก้อนเดียว commit หลัง build/lint/typecheck ผ่านเท่านั้น
- **ห้าม push, เปิด PR, merge, ลบ branch** จนกว่าเจ้าของสั่งชัดเจน ห้าม amend/rebase/reset --hard
- ห้ามเก็บความลับ/token/`.env` ใน commit และ screenshot
- screenshot ตรวจรับอยู่ที่ `docs/ui-renovation/screenshots/` (อยู่ใน `.gitignore` ไม่ commit)

## 3. เครื่องมือตรวจ (อยู่ใน `docs/ui-renovation/tools/`)

ไม่ต้องมี backend: สคริปต์ mock `/api/v1/*` ด้วย Playwright route และใส่ JWT ปลอมที่หมดอายุไกลใน localStorage fixture อยู่ใน `fixtures.mjs` (ใช้เฉพาะเครื่องมือตรวจ ไม่เกี่ยวกับตัวแอป)

```
cd web && npx next dev -p 3100            # เซิร์ฟเวอร์ตรวจ (หยุดก่อนรัน next build)
node docs/ui-renovation/tools/shoot.mjs after http://localhost:3100 dashboard,config,devices
node docs/ui-renovation/tools/check-motion.mjs http://localhost:3100
```

- `shoot.mjs <label> <url> <หน้า,...>`: ถ่าย 1440 light/dark (`THEMES=dark` เลือกธีมเดียว) และ (เฉพาะ dashboard) มือถือ 390 + เมนู หน้าที่ระบุ `extra: ["mobile","light"]` ถ่าย 390 light เพิ่มด้วย ชื่อหน้าที่รองรับ: `dashboard`, `config`, `config-edit`, `config-edit-json`, `devices`, `devices-select`, `device-detail`, `device-config-tab`, `approvals`, `approvals-diff`, `parameters`, `firmware`, `firmware-compare` และรอบ 3: `audit-log`, `audit-log-detail`, `incidents`, `incident-detail`, `campaigns`, `campaign-detail`, `rollout-new-1`, `rollout-new-3`, `rollout-detail`, `rollout-rollback`, `users`, `device-models`, `forbidden`, `not-found`, `login` (target ระบุ `role`/`anon` เฉพาะได้) เพิ่มได้ในตัวแปร `targets` (แต่ละหน้ามี `act` ทำขั้นก่อนถ่ายได้) หน้าแก้ Config ต้องใช้ `ROLE=ConfigEngineer`
- `check-flows.mjs [url]`: เดินงานหลัก 2 งานด้วย API จำลอง (A: หาอุปกรณ์ → แก้ Config → ทดสอบ → ส่งขออนุมัติ, B: ดู diff → เลือกทั้งหมด → อนุมัติหลายรายการ) นับคลิกและตรวจผล 15 ข้อ
- `check-virtual.mjs [url]`: `FLEET=300` ตรวจว่า Device Search ทำ windowing เมื่อเกิน 200 แถว (ไม่เกินไม่ทำ)
- `check-login-intro.mjs`: ตรวจแอนิเมชันเปิดหน้า Login (การ์ดค่อยๆ เข้า, ช่องกรอกโฟกัสทันที, สั่นเมื่อกรอกผิด, เล่นซ้ำทุกครั้งที่เข้า/รีเฟรช, ลดการเคลื่อนไหวแล้วไม่มี fade) และถ่ายเฟรมไทม์ไลน์ไว้ดู
- `check-motion.mjs`: ตรวจ page transition, ไม่มี layout shift, command palette เปิด/ปิด, sidebar ยุบ/ขยาย, สลับธีมและจำค่า, hover ไม่กระตุก, reduced-motion เหลือ fade
- ข้อจำกัด: fixture คืน `[]` สำหรับ endpoint ที่ไม่ได้ระบุ รอบ 2 เพิ่ม fixture ของ config (มี `fields`), `/config-definitions`, `/device-models`, `/devices/:id` (+ central/status/history), firmware (มี checksum) แล้ว หน้าใหม่ที่เรียก endpoint อื่นต้องเพิ่มให้ตรง shape ก่อนถ่าย
- ถ้า `:3000` ของเจ้าของรันอยู่ (dev server ตัวเดียวต่อโฟลเดอร์ `web/`) ใช้ `:3000` ถ่ายได้เลย (ดึงโค้ดชุดเดียวกัน API ถูก mock ใน Playwright) และห้ามรัน `next build` ใน `web/` ให้ copy `web/` (ไม่เอา `node_modules`/`.next`) ไปที่อื่นแล้วทำ junction `node_modules` + `next build --webpack` (Turbopack ไม่ยอม symlink ออกนอก root)
- Next dev indicator (ปุ่ม N มุมซ้ายล่าง) ทับปุ่มมุมซ้ายล่างได้ ให้ละเว้น ใช้ `dispatchEvent("click")` ในสคริปต์

## 4. หน้าทั้งหมดและฟีเจอร์ที่ต้องรักษา

เส้นทางอยู่ใต้ `web/src/app/(app)/` (ยกเว้น `/login`) ทุกหน้าห่อด้วย `AuthGuard` + `AppShell` ผ่าน `(app)/layout.tsx`

| Route | โมดูล | ฟีเจอร์ที่ต้องรักษา |
|---|---|---|
| `/` | Dashboard | การ์ดความเสี่ยง (Rollout หยุด, Incident, ออฟไลน์, Config ไม่ตรง), ผล Deploy, การเชื่อมต่อ, ตัวเลขนิ่ง, สถานะ Config, กิจกรรมล่าสุด, แถบรออนุมัติ, ซ่อนการ์ด Campaign เมื่อไม่มีสิทธิ์ `campaign:Read` |
| `/devices`, `/devices/[deviceId]`, `/devices/new` | Device Search/Detail/ลงทะเบียน | ค้นหา+กรอง, ตาราง, สถานะกล่อง (central), ประวัติ, ขอแก้ค่าเฉพาะเครื่อง, ฟอร์มลงทะเบียน (Admin) |
| `/config`, `/config/new`, `/config/[id]`, `/config/[id]/edit` | Config Editor | ตาราง, wizard สร้าง/แก้, import/export JSON, review panel, ส่งอนุมัติ, clone, version, diff, เตือนก่อนออกจากหน้าที่ไม่บันทึก |
| `/parameters` | Parameter Library | รายการ+สร้าง field definition (เฉพาะ role ที่มีสิทธิ์) |
| `/approvals`, `/approvals/config/[id]`, `/approvals/config-override/[id]`, `/approvals/firmware-override/[id]` | Approval Center | คิวรวม 4 ประเภท, อนุมัติ/ปฏิเสธ + Separation of Duty, หน้ารายละเอียด |
| `/firmware`, `/firmware/[id]` | Firmware Repository | อัปโหลด, ตาราง, compatibility, simulate, approval ของ QA |
| `/campaigns`, `/campaigns/new`, `/campaigns/[id]`, `/campaigns/[id]/rollouts/new`, `/campaigns/[id]/rollouts/[rolloutId]` | Campaign | กลุ่ม, rollout wizard, อนุมัติ, release, pause/resume, rollout progress, incident panel, rollback |
| `/incidents`, `/incidents/[id]` | Incident & Rollback | รายการ, รายละเอียด, field report decision, retry sync, ปิด incident, rollback |
| `/audit-log` | Audit Log | ตาราง+filter (module, action, ผู้ทำ, ช่วงวัน), แบ่งหน้า |
| `/users` | User Management | รายการ, สร้าง, แถว action (Admin/SuperAdmin) |
| `/device-models` | Device Model | รายการ+สร้าง+แถว action (Admin) |
| `/login` | Login | ฟอร์ม + พื้นหลังแบบมีชีวิต (`components/auth/login-background.tsx`) |

State/API: hook ต่อ endpoint อยู่ใน `web/src/hooks/use-*.ts` (token จาก `useAuth()`), client ใน `web/src/lib/*-api.ts`, ทุก hook โหลดข้อมูลใช้ `useRefetchOnFocus` (ฟังสัญญาณ refresh จาก `lib/refresh-bus.ts` ด้วย), คิวรออนุมัติ poll ผ่าน `use-poll-interval.ts`, สิทธิ์ทั้งหมดอยู่ใน `lib/permissions.ts`

## 5. Design tokens (อยู่ใน `web/src/app/globals.css`)

ฐานสีมาจากโทนเดิม (Harbor Palette) ไม่เปลี่ยนสี

| กลุ่ม | token | ค่า (light) |
|---|---|---|
| พื้น/ตัวหนังสือ | `--background` / `--foreground` | `oklch(0.979 0.003 264.5)` / `oklch(0.267 0.028 248.9)` |
| Accent | `--primary` (= `--brand-600`) | `oklch(0.528 0.13 248.3)` |
| Sidebar | `--sidebar` (= `--brand-900`) | `oklch(0.311 0.066 246.6)` |
| สเกลแบรนด์ | `--brand-50` ถึง `--brand-950` (`bg-brand-*`) | hue 248 ไล่ L 0.975 ถึง 0.251 |
| สถานะ | `--success`, `--warning`, `--destructive`, `--info`, `--status-offline` + `-foreground`/`-subtle` | เขียว/อำพัน/แดง/น้ำเงิน/เทา |
| พื้นรอง | `--surface-sunken`, `--muted`, `--secondary` | |
| Dark | `.dark` ชุดเดียวกัน กรมท่าเข้ม `oklch(0.198 0.023 257.3)` ไม่ใช่ดำสนิท | |
| Radius | `--radius` = 8px (`rounded-sm/md/lg` คำนวณจากค่านี้) | |
| เงา | `shadow-overlay` (เฉพาะ popover/dialog/sheet/floating bar), `shadow-raised` | การ์ดทั่วไปใช้ ring/เส้นขอบ ไม่ใช้เงา |
| z-index | `--z-sticky` 30, `--z-sidebar` 40, `--z-overlay` 50, `--z-toast` 60 | ใช้ `z-(--z-overlay)` |
| Spacing | Tailwind scale 4px (4/8 grid) | |
| Motion CSS | `--duration-instant/fast/base/slow/page` = 100/150/220/320/400ms, `--ease-standard`, `--ease-emphasized` | ใช้ `duration-(--duration-fast) ease-(--ease-standard)` |
| Typography | ไทย/UI = Anuphan (`font-sans`), mono = Geist Mono (`font-mono`, `.font-instrument`), ขนาดเล็กสองระดับปรับ +1px (`text-xs` 13px, `text-sm` 15px) | `.label-caps` ป้ายกำกับ letter-spacing, `data-tabular`/`table` = tabular-nums |
| Utility | `animate-led` (LED ping), `animate-shimmer` (skeleton) | ปิดเองเมื่อ prefers-reduced-motion |

Motion ใน JS: `web/src/lib/motion.ts` ไฟล์เดียว (duration, ease, spring 300/30, variants `fadeIn/fadeUp/scaleIn/slideInRight/staggerContainer/listItem/pageEnter`, `lift`, `press`) `MotionProvider` ตั้ง `reducedMotion="user"` ทั้งแอป

กฎ motion: animate เฉพาะ transform/opacity (ยกเว้น layout animation ของ motion), ตอบสนองการกระทำไม่เกิน 400ms, ไม่บล็อกผู้ใช้, ข้าม count-up/chart draw-in/row flash ไว้ก่อน

## 6. Personas และ top tasks (อนุมานจากโค้ดและ `RBAC_Matrix.md` ไม่มีข้อมูลผู้ใช้จริง)

| Role | ทำอะไรเป็นหลัก | ความถี่ | ความกังวลสูงสุด | Top tasks |
|---|---|---|---|---|
| ConfigEngineer | สร้าง/แก้ Config, ทดสอบ, ส่งอนุมัติ | ทุกวัน | ส่งค่าผิดไปทั้งกลุ่ม, อนุมัติงานตัวเองไม่ได้ (SoD) | แก้ config แล้วส่ง, ดูสถานะที่ส่งอนุมัติ, import/export JSON |
| FirmwareEngineer | อัปโหลด Firmware, กำหนด compatibility | สัปดาห์ละหลายครั้ง | Firmware ผิดรุ่นหลุดไปอุปกรณ์ | อัปโหลด, ตั้ง compatibility, ดูผล simulate |
| QAEngineer | ตรวจและอนุมัติ/ปฏิเสธ Firmware | ตามรอบ release | ปล่อย Firmware ที่ยังไม่ผ่านคุณภาพ | อนุมัติ/ปฏิเสธ Firmware, อ่านผลทดสอบ |
| Operation | ผู้อนุมัติหลัก, เปิด Campaign, ตามผลและ rollback | ทุกวัน เปิดค้างทั้งวัน | ปล่อยผิดทั้งกลุ่ม, ไม่เห็นว่าอะไรผิดปกติ | ดูว่าอะไรผิดปกติ, อนุมัติ, เปิด Campaign/Rollout, ตาม Incident แล้ว rollback, หาอุปกรณ์ |
| ST / OT | ช่างหน้างาน/ซัพพอร์ต ดูอุปกรณ์ แจ้ง field report | ทุกวัน | หาเครื่องไม่เจอ, ค่าที่ขอแก้ไม่ถูกส่ง | หาอุปกรณ์, ดูสถานะเครื่อง, ขอแก้ค่าเฉพาะเครื่อง, ติดตามคำขอ |
| Auditor | ตรวจประวัติ | ตามรอบ | หลักฐานไม่ครบ | กรอง/ส่งออก Audit Log |
| Admin | จัดการผู้ใช้, Device Model, ลงทะเบียนอุปกรณ์ | สัปดาห์ละไม่กี่ครั้ง | ให้สิทธิ์ผิด | สร้างผู้ใช้, จัดการโมเดล, ลงทะเบียนอุปกรณ์ |
| SuperAdmin | ทุกอย่างของ Admin + จัดการ Admin | น้อย | ล็อกตัวเอง/สิทธิ์เกิน | จัดการบัญชี Admin |

Top tasks ข้ามบทบาท: ดูว่าอะไรผิดปกติ, หาอุปกรณ์, แก้ config แล้วส่ง, ขอ/อนุมัติ, เปิด campaign, ตาม incident แล้ว rollback, ตรวจประวัติ

## 7. Art Direction: "Industrial Instrument"

- สะอาด มืออาชีพ เหมือนเครื่องมือทีมปฏิบัติการ โทนกรมท่า accent น้ำเงิน พื้นอ่อน
- ห้าม: gradient ม่วง-น้ำเงิน, glow ฟุ้ง, การ์ดลอยโค้งใหญ่เงานุ่มเรียงกริดเท่ากันทั้งหน้า, หัวข้อโฆษณา/ทักทาย/emoji, ข้อมูลตัวอย่างสไตล์ John Doe / Device 1
- radius 6-8px, เส้นขอบบางแทนเงา, ความหนาแน่นสูงแต่จัดลำดับดี
- แต่ละหน้ามีองค์ประกอบเด่นหนึ่งอย่าง ขนาดบล็อกไม่เท่ากันตามความสำคัญ (ตัวอย่าง: Dashboard การ์ดที่ต้องลงมือ ค่า > 0 กว้างกว่า ค่า 0 หดเป็น "ปกติ")
- ลายเซ็น GPS: จุดสถานะ LED (`StatusLed`), ตัวบอกการเชื่อมต่อ, ค่าเครื่องวัด (IMEI, serial, version, timestamp, พิกัด, payload) ใช้ `.font-instrument`, ตัวเลขชิดขวาในตาราง, ป้ายกำกับ `.label-caps`
- สีอื่นใช้เฉพาะสถานะ: เขียว=ปกติ, อำพัน=เตือน, แดง=ผิดปกติ, เทา=ออฟไลน์ พื้น badge อ่อน ตัวหนังสือเข้ม
- ไอคอน lucide-react ชุดเดียว stroke เท่ากัน ข้อความ empty/error สั้น บอกขั้นต่อไป

## 8. หลักการ UX

หน้าแรกตอบ "ตอนนี้มีอะไรต้องให้ฉันทำ", งานหลัก ≤ 3 คลิก, กันพลาดแพง (preview ผลกระทบ + diff ก่อนส่ง config/firmware, bulk/อันตราย type-to-confirm, rollback เห็นชัด), สถานะระบบมองเห็นเสมอ, progressive disclosure, Command Palette, จำค่าที่ตั้ง (try/catch), URL เป็น source of truth (แท็บ/ฟิลเตอร์/sort), เตือนก่อนออกจากหน้าที่ไม่บันทึก (`hooks/use-unsaved-changes-warning.ts` มีแล้ว), ทุกหน้ามี loading (skeleton) / empty (บอกขั้นต่อไป) / error (สาเหตุ + Retry)

### แอนิเมชันเปิดหน้า Login

ไทม์ไลน์ราว 1.4 วินาที (ช่องกรอกใช้งานได้ตั้งแต่เฟรมแรก): พื้นหลังจางเข้า → การ์ดลอยขึ้น → โลโก้ประกอบตัว (หมุดตกเด้ง, LED ผุด, วงโคจรวาด, ดาวเทียมวิ่งหนึ่งรอบแล้วจอดตรงตำแหน่งโลโก้นิ่ง) → ข้อความและช่องกรอกเข้าทีละช่อง · กรอกผิด = การ์ดสั่น + ข้อความ error จางเข้า · สำเร็จ = การ์ดเลื่อนจางออกพร้อมเปลี่ยนหน้า · เล่นทุกครั้งที่เปิดหน้าหรือรีเฟรช (`components/auth/login-intro.ts` ข้ามเฉพาะเมื่อตั้ง reduced-motion) · ปิดเมื่อ prefers-reduced-motion · โลโก้เคลื่อนไหวคือ `components/brand/animated-logo-mark.tsx` ใช้เรขาคณิตชุดเดียวกับ `logo-mark.tsx`

## 9. Component กลาง

| Component | ไฟล์ | สถานะ |
|---|---|---|
| Tokens, motion | `globals.css`, `lib/motion.ts`, `components/motion/*` | รอบ 1 เสร็จ |
| ThemeProvider/ThemeToggle | `components/theme/*` | รอบ 1 เสร็จ (next-themes, จำค่า, Sonner ตามธีม) |
| PageTransition | `components/motion/page-transition.tsx` + `(app)/template.tsx` | รอบ 1 เสร็จ (เฉพาะขาเข้า) |
| AppShell | `components/app-shell/*` | รอบ 1 เสร็จ (sidebar ยุบ+spring+indicator, badge งานค้าง, top bar, command palette, ตัวบอก Server กลาง) |
| PageHeader | `components/page-header.tsx` | มีเดิม ใช้ `RefreshControl` ใน `actions` เมื่อหน้าต้องการรีเฟรช |
| RefreshControl | `components/refresh-control.tsx` | รอบ 1 (ปุ่มส่งสัญญาณผ่าน `lib/refresh-bus.ts`) |
| SegmentBar | `components/segment-bar.tsx` | รอบ 1 (การ์ดหน้า Dashboard อยู่ใน `app/(app)/dashboard-*.tsx`) |
| RingGauge | `components/ring-gauge.tsx` | รอบ 1 (วงแหวนสัดส่วน ส่วนโค้งยืดออกตอนโหลด) |
| CountUp, ChangeFlash | `components/motion/count-up.tsx`, `change-flash.tsx` | รอบ 1 (ตัวเลขนับขึ้น, วาบ opacity เมื่อค่าเปลี่ยน) ข้ามเมื่อ prefers-reduced-motion ในเทส `vitest.setup.ts` จำลอง matchMedia ให้เป็น reduced เพื่อให้เทสอ่านค่าจริงได้ |
| Fleet LED grid | `app/(app)/dashboard-fleet.tsx` + `fleetDots`/`capFleetDots` ใน `lib/dashboard-metrics.ts` | รอบ 1 (1 เครื่อง = 1 จุด เรียงเครื่องที่ต้องสนใจก่อน เกิน 300 เครื่องวาดเฉพาะที่ต้องสนใจ) |
| StatusBadge, StatusLed, ConnectionIndicator | `components/status-badge.tsx`, `components/ui/status-led.tsx`, `components/connection-indicator.tsx` | รอบ 1 (รอบ 3: `StatusPill` ใน `lib/status-pill.tsx` แปลง enum → tone แล้ว render ผ่าน `StatusBadge` ตัวเดียว ป้ายสถานะทั้งระบบจึงเป็น LED + ข้อความแบบเดียวกัน สถานะ `progress` LED เต้น) |
| EmptyState, ErrorState | `components/empty-state.tsx`, `components/error-state.tsx` | รอบ 2 ใช้ ErrorState แทน error เขียนเองใน Approval Center, Device Search, Config, Firmware, Parameter Library, Config wizard (หน้ารอบ 3 ยังเขียนเอง) |
| ConfirmDialog (type-to-confirm) | `components/confirm-dialog.tsx` | รอบ 2 ใช้กับอนุมัติ/ปฏิเสธ Config, อนุมัติหลายรายการ (พิมพ์ `APPROVE`), รีเซ็ตการแก้ไขใน Config Editor · รอบ 3: ปล่อย Rollout (ยืนยันธรรมดา ไม่ต้องพิมพ์ เพราะต้องผ่านการอนุมัติจากอีกคนก่อนแล้ว) และ Rollback (ยืนยันธรรมดา บอกจำนวนเครื่องที่จะถูกแตะ + เลือกเครื่องได้ ปุ่มยืนยันปิดเมื่อไม่เหลือเครื่อง) เพิ่ม prop `confirmDisabled` และ `onConfirm` คืน `false` = ไม่ปิดกล่อง (ใช้เมื่อ API ล้มเหลวให้ผู้ใช้แก้แล้วลองใหม่) |
| CopyButton, RelativeTime | `components/copy-button.tsx`, `components/relative-time.tsx` | รอบ 2 ใช้ใน Device Search/Detail, Firmware, Parameter drawer |
| FloatingActionBar | `components/floating-action-bar.tsx` | รอบ 2 ใช้ผ่าน DataTable (`selectable`) และ bulk approve |
| Button (loading, hover/active) | `components/ui/button.tsx` | รอบ 1 |
| Skeleton shimmer | `components/ui/skeleton.tsx` | รอบ 1 |
| Dialog/Sheet/Popover/Tooltip/Select | `components/ui/*` | รอบ 1 ปรับ duration/ease/เงาเป็น token |
| **DataTable** | `components/data-table/*` | รอบ 2 ต่อยอดจากของเดิม (props เสริมทั้งหมด หน้าเดิมไม่ต้องแก้): `urlSync` (ค้นหา/sort/ฟิลเตอร์อยู่ใน URL: `q`, `sort`, `f.`/`m.`/`r.` + `lib/table-url-state.ts`), `savedViewsKey` (มุมมองที่บันทึกใน localStorage), `columnToggle` + `initialColumnVisibility`, `selectable` (checkbox + FloatingActionBar), `renderCard` (card list ต่ำกว่า 768px), windowing อัตโนมัติเมื่อแถวหลังกรองเกิน 200 (`lib/virtual-window.ts`, ความสูงแถวคงที่ 52px) ใช้ `urlSync` แล้ว: Device Search, Config, Firmware, Parameter Library |
| **DiffViewer / DiffCounts** | `components/diff-viewer.tsx` | รอบ 2 ตารางค่าเดิม→ใหม่ + ตัวเลขเพิ่ม/แก้ไข/ลบ (ต่อกับ `lib/config-diff.ts`) ใช้ใน Approval Center (การ์ด + หน้ารายละเอียด), Config Editor, เปรียบเทียบ Firmware |
| **UrlTabs** | `components/url-tabs.tsx` | รอบ 2 แท็บที่เก็บใน `?tab=` (replaceState), ลูกศร/Home/End สลับแท็บ, indicator ใช้ `layoutId` + spring, render เฉพาะแท็บที่เปิด ใช้ใน Device Detail, Approval Center |
| **ProgressBar, FileDropzone** | `components/progress-bar.tsx`, `components/file-dropzone.tsx` | รอบ 2 ProgressBar animate ด้วย scaleX + `role=progressbar` · FileDropzone ใช้ input file จริงข้างใน (คีย์บอร์ดได้) ใช้ในอัปโหลด Firmware (ความคืบหน้าจริงผ่าน `apiUpload` ใน `lib/api.ts` ซึ่งเป็น XHR ไป endpoint เดิม) |
| **CommandStatusSteps** | `components/command-status-steps.tsx` | รอบ 2 รอส่ง → ส่งแล้ว → อุปกรณ์ตอบรับ → สำเร็จ/ล้มเหลว จากสถานะคำสั่งของ Server กลาง (สถานะที่ไม่รู้จักไม่แสดง) ใช้ในแท็บ Config/Firmware/Logs ของอุปกรณ์ |
| Config Editor libs | `lib/config-field-validation.ts` (Zod), `lib/config-raw.ts` | รอบ 2 ตรวจค่าแบบ real-time (ตัวเลข/จำนวนเต็ม/json/array/allowedValues) · โหมด JSON + ไฮไลต์สี + ปิดค่าอ่อนไหวเป็น `********` |
| **useUrlParams** | `hooks/use-url-params.ts` | รอบ 3 เก็บตัวกรอง/มุมมองใน query string (replaceState, ค่า default ไม่ลง URL) ใช้ใน Audit Log, Incident · ตารางใช้ `DataTable urlSync` (Campaign, Users, Device Model เพิ่มรอบ 3) · `defaults` ต้องเป็นค่าคงที่ระดับโมดูล · เทสต้อง `history.replaceState(null, "", path)` ใน `beforeEach` เพราะ URL ค้างข้ามเทส |
| **EventTimeline** | `components/event-timeline.tsx` | รอบ 3 เส้นเวลาแนวตั้ง (LED + เวลา + รายละเอียด, เข้าทีละแถว) ผู้เรียกส่งเฉพาะเหตุการณ์ที่มีข้อมูลจริง ใช้ในหน้า Incident |
| **StatusPage** | `components/status-page.tsx` | รอบ 3 หน้าแจ้งสถานะ (รหัส 404/403/500 + ข้อความ + ปุ่มขั้นต่อไป) ใช้โดย `app/not-found.tsx`, `(app)/error.tsx`, `global-error.tsx`, `RoleGuard` (403) |
| **csv helper** | `lib/csv.ts` | รอบ 3 `toCsv`, `downloadCsv` (BOM ให้ Excel อ่านไทยถูก) ใช้ใน Device Search และ Audit Log |
| Rollout wizard | `app/(app)/campaigns/campaign-rollout-create-form.tsx` | รอบ 3 สี่ขั้น: เป้าหมาย → เวอร์ชัน/Config → ตรวจสอบผลกระทบ (`SegmentBar` ได้รับ/ข้าม/เอาออกเอง + เหตุผลรายเครื่อง) → ยืนยัน ใช้ `WizardStepIndicator` เตือนก่อนออกเมื่อกรอกค้าง |
| **ยังไม่ทำ** | | Accordion, Toast motion, undo toast |

### มุมมองตาม Role (Dashboard, `web/src/lib/dashboard-view.ts`)

ออกแบบจากงานของแต่ละ Role ไม่ใช่การกรองการ์ด ทุก Role ใช้โครงเดียวกัน: แถวบน **งานที่ต้องดำเนินการ** (คิวงานเรียงผิดปกติ → ต้องตัดสินใจ → รับทราบ ค้างนานขึ้นก่อน กดไปทำได้ ไม่มีงาน = "ไม่มีงานค้างตอนนี้") + **สถานะระบบ** (แถว LED สั้นๆ) แถวถัดไปเป็นแผงรายละเอียด ตารางเดียวกำหนดว่าใครเห็นอะไร (แก้ที่ไฟล์นี้ ไม่ต้องแก้ component) กฎที่ derive จากสิทธิ์จริง: FirmwareEngineer/QAEngineer ไม่มี `campaign:Read` (ไม่มีแผง/แถว Campaign), ConfigEngineer/FirmwareEngineer/QAEngineer เข้า Audit Log ไม่ได้ (ไม่มีแผงกิจกรรม) Role ที่ไม่รู้จักได้มุมมอง Auditor

| Role | งานที่ต้องดำเนินการ | แผงรายละเอียด |
|---|---|---|
| Operation | Rollout ที่ระบบหยุดเอง, Incident, Config/Rollout/คำขอเฉพาะเครื่องรออนุมัติ, Rollout รอปล่อย | Rollout, อุปกรณ์เงียบ, สถานะ Config, กิจกรรม |
| ST / OT | Incident, อุปกรณ์ออฟไลน์, Config ยังไม่อัปเดต | อุปกรณ์เงียบ, Rollout, กิจกรรม |
| ConfigEngineer | Config ของฉันที่ถูกปฏิเสธ / ฉบับร่าง / รอผู้อนุมัติ | สถานะ Config, Rollout |
| FirmwareEngineer | Firmware ของฉันที่ถูกปฏิเสธ / รอ QA | สถานะ Firmware |
| QAEngineer | Firmware รอตรวจคุณภาพ (ทุกตัว) | สถานะ Firmware |
| Auditor / Admin / SuperAdmin | ไม่มีคิว: กิจกรรมล่าสุดนำแทน | Rollout, อุปกรณ์เงียบ, สถานะ Config |

ความมีชีวิต (ข้อมูลจริงทั้งหมด): กริดจุด LED ของอุปกรณ์ทั้งกอง, วงแหวน % เชื่อมต่อ/% Deploy สำเร็จ, ตัวเลขนับขึ้น, แถวคิวเข้าทีละแถว, วาบเมื่อค่าเปลี่ยนจากการรีเฟรช, ตัวบอก "อัปเดต N วินาทีที่แล้ว" ที่หัวหน้า (อ้างจากการ poll สถานะกล่องสำเร็จล่าสุดผ่าน `markDataLoaded` ใน `lib/refresh-bus.ts`) ไม่ใช้กราฟแนวโน้มเพราะไม่มี API ประวัติย้อนหลัง · ลดข้อความ: ประโยคอธิบายย้ายไป tooltip (`QueueItem.hint`) คำอธิบายใต้หัวข้อแผงเปลี่ยนเป็นตัวเลขที่มุมขวา

เจตนาที่เอาออก: แถบ "รออนุมัติ" เดิม (ซ้ำกับคิว), ตัวเลขนิ่ง (จำนวนโมเดล ฯลฯ ไม่ช่วยตัดสินใจ), KpiCard hook ที่ใช้ร่วมกันเรียกครั้งเดียวใน `dashboard-summary.tsx` แล้วส่ง props ลงแผง

หน้าอื่นยังไม่ปรับตาม Role นอกจากที่มีอยู่เดิม (เมนูกรองด้วย `allowedRoles`, ปุ่มกรองด้วย `lib/permissions.ts`) รอบ 2 และ 3 ใช้หลักเดียวกัน: ใช้ฟังก์ชันใน `permissions.ts` ตัดสินว่าจะซ่อน แสดง หรือ disable + เหตุผล และเริ่มหน้าด้วยงานที่ Role นั้นต้องทำ

## 10. เช็คลิสต์ประจำหน้า (ใช้ทุกหน้าในรอบ 2 และ 3)

- [ ] ใช้ `PageHeader` อันเดียว ไม่มีชื่อหน้าซ้ำกับ top bar
- [ ] ไม่มีสี/ระยะ/duration hardcode (`grep -n "#[0-9a-f]\{3,6\}\|bg-\(amber\|emerald\|red\|sky\)-"` ต้องว่าง)
- [ ] loading = skeleton ขนาดเท่าเนื้อหาจริง (ไม่มี layout shift), empty บอกขั้นต่อไป, error มีสาเหตุ + Retry
- [ ] ตารางตัวเลขชิดขวา, ค่าเครื่องวัดเป็น mono
- [ ] ปุ่ม: hover/active/focus/disabled/loading ครบ, ปุ่มที่ role ทำไม่ได้เลยซ่อน, ปุ่มที่ติดเงื่อนไขชั่วคราว disable + `DisabledWithReason`
- [ ] action ที่แก้กลับยากมี preview ผลกระทบ + `ConfirmDialog` (type-to-confirm เมื่อเป็น bulk/อันตราย)
- [ ] ฟิลเตอร์/แท็บ/sort อยู่ใน URL (รอบ 2: Device Search/Detail, Approval Center, Config, Firmware, Parameter Library · รอบ 3: Campaign list, Incident, Audit Log, Users, Device Model ทำแล้วทั้งหมด)
- [ ] มือถือ 390 ไม่มี horizontal scroll, dark mode ตรวจแล้ว
- [ ] test เดิมผ่าน, เพิ่ม test เมื่อเพิ่มพฤติกรรม

## 11. ความคืบหน้า

| หน้า / ส่วน | รอบ 1 | รอบ 2 | รอบ 3 |
|---|---|---|---|
| Tokens, motion, theme | เสร็จ | | |
| Shared components | เสร็จ (ส่วนที่ shell/dashboard ใช้) | เสร็จ: DataTable, DiffViewer, UrlTabs, ProgressBar, FileDropzone, CommandStatusSteps, ใช้ ConfirmDialog/ErrorState/CopyButton/RelativeTime/FloatingActionBar | StatusPill→StatusBadge, Accordion |
| App Shell | เสร็จ | | |
| Dashboard | เสร็จ (รวมมุมมองตาม Role, Rollout ที่กำลังดำเนินการ, อุปกรณ์ที่เงียบเกิน 24 ชม.) | | |
| Device Search / Detail / ลงทะเบียน | ยังไม่แตะ | เสร็จทั้ง 3 (ลงทะเบียน: grid ตอบสนอง, ลำดับช่องใหม่, CopyButton, ปุ่มยกเลิก) | |
| Config Editor (list/wizard/detail) | ยังไม่แตะ | เสร็จทั้ง 3: wizard 2 ขั้น (ขั้น 1 สองการ์ด + สรุปจำนวนพารามิเตอร์ของรุ่น, ขั้น 2 แถบสรุป + แถบบันทึกติดจอ, JSON mode เป็นช่องเดียวที่ระบายสีขณะพิมพ์ `components/json-editor.tsx`, dialog นำเข้าไฟล์แบบ dropzone) · detail เป็นแถบขั้น (ร่าง → รออนุมัติ → อนุมัติแล้ว `components/config/lifecycle-steps.tsx`) + การ์ดตัวเลข + แท็บ พารามิเตอร์ (จัดกลุ่มหมวด) / ประวัติเวอร์ชัน (เทียบกับค่าปัจจุบัน, ใส่ค่าเวอร์ชันเก่ากลับเข้า draft ผ่าน PUT เดิม), โคลนเป็นปุ่มหลักของ Config ที่แก้ตรงๆ ไม่ได้, ลบผ่าน ConfirmDialog | |
| Approval Center + detail | ยังไม่แตะ | เสร็จ: Center, รายละเอียด Config (DiffViewer), Override ทั้งสองแบบ (ConfirmDialog + ช่องเหตุผลปฏิเสธ, ErrorState) | |
| Firmware | ยังไม่แตะ | เสร็จ: list, อัปโหลด, เทียบเวอร์ชัน, detail (2 คอลัมน์, อนุมัติ QA ผ่าน ConfirmDialog, สถานะพร้อมปล่อยเดียว) | |
| Campaign + Rollout | ยังไม่แตะ | ผูก ConfirmDialog กับแผงอนุมัติ/ปล่อย Rollout แล้ว (ปล่อยเข้าอุปกรณ์ใช้ยืนยันธรรมดา) | เสร็จ: รายการ (urlSync), รายละเอียดกลุ่ม, wizard 4 ขั้น, รายละเอียด Rollout (ตัวเลขนับขึ้น, วาบเมื่อสถานะรายเครื่องเปลี่ยน, ErrorState/skeleton), Rollback ผ่าน ConfirmDialog ยืนยันธรรมดา |
| Incident & Rollback | ยังไม่แตะ | | เสร็จ: รายการ (แท็บ/ตัวกรองใน URL, ขอบการ์ดตามความรุนแรงด้วย token), รายละเอียด 2 คอลัมน์ (ผลกระทบ + รายละเอียด ซ้าย / ไทม์ไลน์ + ข้อมูลอ้างอิง ขวา, ปุ่มดำเนินการที่หัวหน้า) |
| Audit Log | ยังไม่แตะ | | เสร็จ: ตัวกรองทั้งหมด + หน้าอยู่ใน URL, แถวกด/Enter เปิด drawer รายละเอียด (ผู้ทำ โมดูล IP รหัส + metadata), ส่งออก CSV ตามตัวกรอง (ดึงทุกหน้า สูงสุด 5,000 แถว) |
| Parameter Library, Users, Device Model | ยังไม่แตะ | Parameter Library เสร็จ: รายการ + drawer + หน้าสร้างแยก `/parameters/new` (การ์ดเดียว เต็มความกว้าง, ตัวเลือกโมเดลแบบค้นหา, ค่าที่เลือกได้พิมพ์บรรทัดละค่า) | Users, Device Model เสร็จ: ตารางเต็มความกว้างไม่ห่อการ์ด, urlSync, RefreshControl, ErrorState |
| Login | ยังไม่แตะ | | เสร็จ: คงแอนิเมชันเดิม ปรับเฉพาะเงาการ์ดเป็น token `shadow-overlay` และสีพื้นหลังเป็น token (ไม่มี rgb/sky ตรงๆ) |
| 404 / 500 / 403 | ไม่มี | | เสร็จ: `StatusPage` ทั้งสามแบบ (404 อยู่นอก shell เพราะ route ไม่ตรง, 500 อยู่ใน shell, 403 จาก RoleGuard) |

ข้อจำกัดที่รับรู้หลังรอบ 1

- ลิงก์ลึกจาก Dashboard ไปหน้ารายการที่ "กรองไว้" ยังทำไม่ได้ เพราะไม่มีหน้ารายการไหนอ่าน query string (ลิงก์ไปหน้ารายการเฉยๆ) รอบ 2 ต้องทำ URL state ที่หน้ารายการก่อน
- badge งานค้างและตัวบอก Server กลางเรียก hook ซ้ำกับ Dashboard (poll ซ้ำสองชุด) ถ้าต้องลดให้ยกเป็น context เดียวในรอบ 2
- ไม่มี backend ให้ทดสอบ: ทุกการตรวจผ่าน API mock ตรวจพฤติกรรมกับ backend จริงไม่ได้
- ไม่มี Tabs ในแอปตอนนี้ การตรวจ "สลับแท็บ" จึงยังไม่ได้ทำ

## 12. บันทึกรอบ 2 (หน้าทำงานหลัก)

ข้อจำกัดที่รู้ (ตัดสินใจไม่ทำเพราะไม่มี API หรือจะต้องแก้ contract ซึ่งเป็นกฎเหล็กข้อ 1/4)

- **เหตุผลตอนอนุมัติ/ปฏิเสธ Config**: `POST /config/{id}/reject` ไม่รับ body (ดู `rejectConfig` ใน `config-api.ts`) จึงยังใส่เหตุผลไม่ได้ ถ้าจะทำต้องเพิ่ม field ที่ backend + openapi ก่อน (คำขอ apply มี `rejectReason` อยู่แล้วแต่ยังไม่มี UI ในเว็บ)
- **Template ของ Config** = โคลน Config ที่มีอยู่ แล้วแก้บางค่า (`/config/new?from={id}` ส่ง `clonedFromId`) ไม่มีระบบแม่แบบแยก ตรวจเส้นทางโคลนด้วย `check-flows.mjs` (งาน C)
- **Changelog ของ Firmware**: `Firmware` ใน openapi ไม่มี field changelog จึงไม่มีช่องกรอก/แสดง (version, checksum, สถานะ release, เทียบเวอร์ชันมี)
- **ช่วงค่าต่ำสุด/สูงสุดของ Parameter**: `ConfigFieldDefinition` ยังไม่มี min/max (มี branch `feat/config-definition-min-max` ที่ยังไม่ merge) drawer แสดง ค่าที่ยอมรับ (allowedValues) และค่าเริ่มต้น และ Zod ตรวจชนิดตัวเลข/จำนวนเต็ม/JSON ตามที่ backend ตรวจ
- **Telemetry / Logs ของอุปกรณ์**: ไม่มี API ส่งค่าจากกล่อง (พิกัด แรงดัน สัญญาณ) และ Server กลางเก็บคำสั่งล่าสุดคำสั่งเดียว แท็บ Telemetry เป็น empty state บอกสาเหตุ แท็บ Logs แสดงคำสั่งล่าสุด
- **ฟิลเตอร์ที่เก็บเป็นมุมมอง (saved views)** เก็บใน localStorage ของเครื่องนั้น ไม่ซิงก์ข้ามเครื่อง/ผู้ใช้
- **Firmware ล้าสมัย** คำนวณจากเวอร์ชันที่กล่องรายงาน (Server กลาง) เทียบ Firmware ล่าสุดที่ผ่าน QA และอัปโหลดสำเร็จของโมเดลเดียวกัน (เทียบเลขทีละส่วน) ไม่มีข้อมูลรายงาน = ไม่ตัดสิน
- Bulk ใน Device Search มีเฉพาะ คัดลอก Device ID และส่งออก CSV (ไม่มี endpoint สั่งงานเป็นกลุ่ม) อนุมัติหลายรายการมีเฉพาะ Config
- **Firmware ไม่แสดงให้ ConfigEngineer**: RBAC_Matrix ระบุ "-" ที่แถว Firmware Repository เมนูถูกซ่อน (`allowedRoles` ใน `nav.ts`) หน้า `/firmware` และ `/firmware/[id]` ครอบด้วย `RoleGuard` (`canReadFirmware`) และ Device Search/Detail ไม่ยิง `GET /firmware` ให้ role นี้
- **Dialog / AlertDialog เป็น bottom sheet บนมือถือ** (< 640px) ใน `components/ui/dialog.tsx`, `alert-dialog.tsx` จอใหญ่เป็นกล่องกลางจอเหมือนเดิม
- **เตือนก่อนออกจากหน้าที่กรอกค้าง** ใช้ `useUnsavedChangesWarning` ครบ: Config wizard, สร้าง Parameter, ลงทะเบียนอุปกรณ์ (ปุ่มยกเลิกถามก่อน, รีเฟรช/ปิดแท็บขึ้น prompt ของเบราว์เซอร์)
- **URL เก็บมุมมองย่อยของ Approval Center** `?view=mine` (หมวดอยู่ที่ `?tab=`)
- **หน้า server ส่งฟังก์ชันให้ client component ไม่ได้**: RoleGuard ที่ต้องการ `allow` ให้ห่อเป็น client component ก่อน (ตัวอย่าง `firmware/firmware-access-guard.tsx`) · ตรวจด้วย `check-firmware-access.mjs` และ build ที่ prerender หน้านั้น เทสระดับ view อย่างเดียวไม่เจอ
- **ยังไม่ได้ทำในรอบ 2:** undo toast (การอนุมัติ/ลบย้อนกลับไม่ได้ จึงไม่มีที่ใส่จริง), รวมหัวข้อสองภาษาเป็นภาษาเดียว, ตรวจ accessibility ด้วยเครื่องมือ (axe/contrast AA)
- **เครื่องมือตรวจ:** `check-flows.mjs` (งาน A/B/C), `check-virtual.mjs`, `check-firmware-access.mjs` · อย่ารัน `next dev` สองตัวในโฟลเดอร์ `web/` พร้อมกัน ไฟล์ type ที่ Next สร้างใน `.next/dev/types` จะเขียนทับกันจนเสีย (typecheck พัง ลบส่วนท้ายไฟล์ที่เกินหรือรีสตาร์ท dev server)

## 13. บันทึกรอบ 3 และสถานะสุดท้าย

**ขอบเขตที่ทำ:** Campaign (รายการ, รายละเอียด, wizard 4 ขั้น, Rollout, Rollback), Incident (รายการ, รายละเอียด), Audit Log, Users, Device Model, Login (token), 404/500/403, รวม `StatusPill` เข้า `StatusBadge`, `font-mono` ทั้งหมดเป็น `font-instrument` (ค่าเครื่องวัดชุดเดียว)

**ที่ไม่ได้ทำ เพราะไม่มี API (กฎเหล็กข้อ 1 และ 4):**

- Staged rollout / กำหนดเวลา: `POST /campaigns/{id}/rollouts` ไม่รับเวลาหรือเฟส ไม่ทำ UI หลอก
- Pause / Cancel / Retry ด้วยมือ: client มีเฉพาะ `resume` และ `rollback` (Rollout หยุดเองเมื่อ Failure Rate เกิน 5%) จึงไม่มีปุ่ม Pause/Cancel/Retry
- ระดับความรุนแรงของ Incident ใช้ค่า `severity` ที่ backend ส่ง (low/medium/high/critical) ไม่คำนวณเอง
- Audit Log diff ก่อน/หลัง: `AuditLogEntry` ไม่เก็บค่าเดิม/ใหม่ มีเฉพาะ `metadata` (ตอนนี้ `apply-config` มี `fieldNames`) drawer จึงแสดง metadata ตามจริง และบอกเมื่อ action นั้นไม่มีรายละเอียด
- ไทม์ไลน์ Incident แสดงเฉพาะ ตรวจพบ → ตัดสินใจ/สถานะปัจจุบัน เพราะ API ไม่เก็บประวัติเปลี่ยนสถานะรายขั้น
- Chart draw-in: ไม่มีกราฟแนวโน้ม (ไม่มี API ประวัติย้อนหลัง) · Lazy load กราฟ/editor/แผนที่: ไม่มีไลบรารีเหล่านี้ในแอป (กราฟเป็น CSS/SVG เอง) Next แยก bundle ตาม route อยู่แล้ว
- 404 ของ route ที่ไม่มีอยู่แสดงนอก AppShell (Next ใช้ root `not-found`) · ตรวจ accessibility ด้วย axe/contrast ยังไม่ได้ทำ (ใช้ token ชุดเดียวกัน ตรวจด้วยตาและคีย์บอร์ดเท่านั้น)
- ข้อความที่แก้ตามกฎข้อ 3: ลบหัวการ์ด "ประวัติการทำงาน (n)" ใน Audit Log และ "รายการ Incident (n)" (ซ้ำกับตัวเลขในแท็บ/แถบตัวกรอง) · empty state ของ Audit Log, Campaign, Incident ต่อท้ายด้วยขั้นต่อไป · ข้อความ 403 ยังเดิม

**ตรวจโดยเครื่องมือ (mock API ไม่มี backend จริง):** `check-flows.mjs` A–E 31 ข้อผ่าน (D: Campaign → wizard 4 ขั้น → POST, E: Incident → Rollout ต้นทาง → Rollback ต้องพิมพ์ยืนยัน), `check-motion.mjs` ผ่านทุกข้อ (CLS 0.001), ไม่มี horizontal scroll ที่ 390 ในหน้ารอบ 3 ทุกหน้า, `vitest` 555 เทสผ่าน, `eslint` และ `tsc --noEmit` สะอาด, `next build --webpack` ผ่าน

### แนวทางเมื่อเพิ่มหน้าใหม่ในอนาคต

1. เริ่มด้วย `PageHeader` (ปุ่มรีเฟรช = `RefreshControl` ใน `actions`) ไม่ห่อตารางด้วยการ์ดซ้อน ตารางรายการใช้ `DataTable urlSync`
2. ตัวกรอง/แท็บ/หน้าที่ไม่ใช่ตารางใช้ `useUrlParams` (หรือ `UrlTabs`) ไม่ใช้ `useState` ล้วน
3. สถานะ 4 แบบเสมอ: loading = skeleton (`TableSkeleton`/`DetailSkeleton`), empty = `EmptyState` บอกขั้นต่อไป, error = `ErrorState` + ลองใหม่, ไม่มีสิทธิ์ = `RoleGuard` (403)
4. สถานะ enum ใช้ `StatusPill` + ตาราง tone ใน `lib/status-pill.tsx` สถานะอื่นใช้ `StatusBadge` ค่าเครื่องวัดทุกตัว (ID, IMEI, เวอร์ชัน, เวลา, payload) ใช้ `.font-instrument`
5. action ที่แก้กลับยาก ใช้ `ConfirmDialog` บอกผลกระทบเป็นตัวเลข และ `confirmText` เมื่อเป็น bulk/ปล่อยจริง/Rollback
6. motion: ใช้ variants จาก `lib/motion.ts` (`staggerContainer`/`listItem`), `CountUp` กับตัวเลขสรุป, `ChangeFlash` กับแถวที่ข้อมูลเปลี่ยนจากการรีเฟรชจริงเท่านั้น ห้ามใส่ถ้าไม่มีข้อมูล real-time
7. สีใช้ token (`bg-warning`, `text-danger-foreground`, `border-l-info`) ห้าม palette ตรง ตรวจด้วย grep ในเช็คลิสต์ §10
8. หน้าใหม่ที่เรียก endpoint ใหม่ ต้องเพิ่ม fixture ใน `tools/fixtures.mjs` และ target ใน `shoot.mjs` ก่อนถ่าย
