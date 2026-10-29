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

- `shoot.mjs <label> <url> <หน้า,...>`: ถ่าย 1440 light/dark และ (เฉพาะ dashboard) มือถือ 390 + เมนู ชื่อหน้าที่รองรับ: `dashboard`, `config`, `devices` เพิ่มได้ในตัวแปร `targets`
- `check-motion.mjs`: ตรวจ page transition, ไม่มี layout shift, command palette เปิด/ปิด, sidebar ยุบ/ขยาย, สลับธีมและจำค่า, hover ไม่กระตุก, reduced-motion เหลือ fade
- ข้อจำกัด: fixture คืน `[]` สำหรับ endpoint ที่ไม่ได้ระบุ หน้า `/approvals` พังด้วยข้อมูลนี้ (`Cannot convert undefined or null to object`) ต้องเพิ่ม fixture ให้ตรง shape ก่อนถ่ายหน้านั้น
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

## 9. Component กลาง

| Component | ไฟล์ | สถานะ |
|---|---|---|
| Tokens, motion | `globals.css`, `lib/motion.ts`, `components/motion/*` | รอบ 1 เสร็จ |
| ThemeProvider/ThemeToggle | `components/theme/*` | รอบ 1 เสร็จ (next-themes, จำค่า, Sonner ตามธีม) |
| PageTransition | `components/motion/page-transition.tsx` + `(app)/template.tsx` | รอบ 1 เสร็จ (เฉพาะขาเข้า) |
| AppShell | `components/app-shell/*` | รอบ 1 เสร็จ (sidebar ยุบ+spring+indicator, badge งานค้าง, top bar, command palette, ตัวบอก Server กลาง) |
| PageHeader | `components/page-header.tsx` | มีเดิม ใช้ `RefreshControl` ใน `actions` เมื่อหน้าต้องการรีเฟรช |
| RefreshControl | `components/refresh-control.tsx` | รอบ 1 (ปุ่มส่งสัญญาณผ่าน `lib/refresh-bus.ts`) |
| KpiCard, SegmentBar | `components/kpi-card.tsx`, `components/segment-bar.tsx` | รอบ 1 |
| StatusBadge, StatusLed, ConnectionIndicator | `components/status-badge.tsx`, `components/ui/status-led.tsx`, `components/connection-indicator.tsx` | รอบ 1 (`StatusPill` เดิมใน `lib/status-pill.tsx` ยังใช้กับ lifecycle enum ต่อ รอบ 2 ให้ย้ายเข้าตัวเดียวกัน) |
| EmptyState, ErrorState | `components/empty-state.tsx`, `components/error-state.tsx` | EmptyState มีเดิม ErrorState ใหม่ รอบ 2 เปลี่ยนทุกหน้าที่เขียน error เอง |
| ConfirmDialog (type-to-confirm) | `components/confirm-dialog.tsx` | สร้างแล้ว ยังไม่ถูกใช้ รอบ 2 ผูกกับ release/rollback/bulk |
| CopyButton, RelativeTime | `components/copy-button.tsx`, `components/relative-time.tsx` | สร้างแล้ว รอบ 2 ใช้ในหน้า Device/Config |
| FloatingActionBar | `components/floating-action-bar.tsx` | สร้างแล้ว รอบ 2 ใช้กับ bulk select |
| Button (loading, hover/active) | `components/ui/button.tsx` | รอบ 1 |
| Skeleton shimmer | `components/ui/skeleton.tsx` | รอบ 1 |
| Dialog/Sheet/Popover/Tooltip/Select | `components/ui/*` | รอบ 1 ปรับ duration/ease/เงาเป็น token |
| **ยังไม่ทำ (รอบ 2)** | | DataTable (sort/filter/column visibility/saved views/bulk select: มี `components/data-table/*` เดิม ต้องต่อยอด), DiffViewer (มี `lib/config-diff.ts`), Stepper (มี `wizard-step-indicator.tsx`), Tabs (ยังไม่มีในแอป ใช้ `layoutId` ตอนมีหน้าที่ใช้), Accordion, Progress animate, Toast motion |

### มุมมองตาม Role (Dashboard, `web/src/lib/dashboard-view.ts`)

ตารางเดียวกำหนดว่า Role ไหนเห็นการ์ด/แผงอะไรและเรียงอย่างไร (แก้ที่ไฟล์นี้ ไม่ต้องแก้ component) กฎที่ derive จากสิทธิ์จริง: FirmwareEngineer/QAEngineer ไม่มี `campaign:Read` (ไม่มีแผง Campaign), ConfigEngineer/FirmwareEngineer/QAEngineer เข้า Audit Log ไม่ได้ (ไม่มีแผงกิจกรรม) Role ที่ไม่รู้จักได้มุมมองอ่านอย่างเดียว

| Role | แผงเฉพาะ | ความเสี่ยง |
|---|---|---|
| Operation | Rollout รอปล่อย/กำลังส่ง, อุปกรณ์เงียบ, ผล Deploy, การเชื่อมต่อ, สถานะ Config, กิจกรรม | ครบ 4 |
| ST / OT | อุปกรณ์เงียบ + การเชื่อมต่อ ขึ้นก่อน, Rollout, ผล Deploy, กิจกรรม | ครบ 4 |
| ConfigEngineer | Config ของฉันที่ยังไม่จบ + สถานะ Config ขึ้นบนสุด, Rollout, ผล Deploy | Incident, Rollout หยุด |
| FirmwareEngineer | Firmware ของฉันที่รอตรวจ/ถูกปฏิเสธ | Incident |
| QAEngineer | Firmware ที่รอตรวจคุณภาพ (ทุกตัว) | Incident |
| Auditor / Admin / SuperAdmin | อ่านอย่างเดียว: ผล Deploy, การเชื่อมต่อ, Rollout, อุปกรณ์เงียบ, สถานะ Config, กิจกรรม | ครบ 4 |

หน้าอื่นยังไม่ปรับตาม Role นอกจากที่มีอยู่เดิม (เมนูกรองด้วย `allowedRoles`, ปุ่มกรองด้วย `lib/permissions.ts`) รอบ 2 และ 3 ต้องใช้หลักเดียวกันกับทุกหน้า: ใช้ฟังก์ชันใน `permissions.ts` ตัดสินว่าจะซ่อน แสดง หรือ disable + เหตุผล

## 10. เช็คลิสต์ประจำหน้า (ใช้ทุกหน้าในรอบ 2 และ 3)

- [ ] ใช้ `PageHeader` อันเดียว ไม่มีชื่อหน้าซ้ำกับ top bar
- [ ] ไม่มีสี/ระยะ/duration hardcode (`grep -n "#[0-9a-f]\{3,6\}\|bg-\(amber\|emerald\|red\|sky\)-"` ต้องว่าง)
- [ ] loading = skeleton ขนาดเท่าเนื้อหาจริง (ไม่มี layout shift), empty บอกขั้นต่อไป, error มีสาเหตุ + Retry
- [ ] ตารางตัวเลขชิดขวา, ค่าเครื่องวัดเป็น mono
- [ ] ปุ่ม: hover/active/focus/disabled/loading ครบ, ปุ่มที่ role ทำไม่ได้เลยซ่อน, ปุ่มที่ติดเงื่อนไขชั่วคราว disable + `DisabledWithReason`
- [ ] action ที่แก้กลับยากมี preview ผลกระทบ + `ConfirmDialog` (type-to-confirm เมื่อเป็น bulk/อันตราย)
- [ ] ฟิลเตอร์/แท็บ/sort อยู่ใน URL (ยังไม่มีหน้าไหนทำ: งานรอบ 2 เริ่มจาก Device Search)
- [ ] มือถือ 390 ไม่มี horizontal scroll, dark mode ตรวจแล้ว
- [ ] test เดิมผ่าน, เพิ่ม test เมื่อเพิ่มพฤติกรรม

## 11. ความคืบหน้า

| หน้า / ส่วน | รอบ 1 | รอบ 2 | รอบ 3 |
|---|---|---|---|
| Tokens, motion, theme | เสร็จ | | |
| Shared components | เสร็จ (ส่วนที่ shell/dashboard ใช้) | DataTable, DiffViewer, Stepper, ใช้ ConfirmDialog/EmptyState/ErrorState | |
| App Shell | เสร็จ | | |
| Dashboard | เสร็จ (รวมมุมมองตาม Role, Rollout ที่กำลังดำเนินการ, อุปกรณ์ที่เงียบเกิน 24 ชม.) | | |
| Device Search / Detail / ลงทะเบียน | ยังไม่แตะ | | |
| Config Editor (list/wizard/detail) | ยังไม่แตะ | | |
| Approval Center + detail | ยังไม่แตะ | | |
| Firmware | ยังไม่แตะ | | |
| Campaign + Rollout | ยังไม่แตะ | | |
| Incident & Rollback | ยังไม่แตะ | | |
| Audit Log | ยังไม่แตะ | | |
| Parameter Library, Users, Device Model | ยังไม่แตะ | | |
| Login | ยังไม่แตะ | | |

ข้อจำกัดที่รับรู้หลังรอบ 1

- ลิงก์ลึกจาก Dashboard ไปหน้ารายการที่ "กรองไว้" ยังทำไม่ได้ เพราะไม่มีหน้ารายการไหนอ่าน query string (ลิงก์ไปหน้ารายการเฉยๆ) รอบ 2 ต้องทำ URL state ที่หน้ารายการก่อน
- badge งานค้างและตัวบอก Server กลางเรียก hook ซ้ำกับ Dashboard (poll ซ้ำสองชุด) ถ้าต้องลดให้ยกเป็น context เดียวในรอบ 2
- ไม่มี backend ให้ทดสอบ: ทุกการตรวจผ่าน API mock ตรวจพฤติกรรมกับ backend จริงไม่ได้
- ไม่มี Tabs ในแอปตอนนี้ การตรวจ "สลับแท็บ" จึงยังไม่ได้ทำ
