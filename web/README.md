# web — เว็บสำหรับเจ้าหน้าที่ (Next.js)

Next.js 16 (App Router) + React 19 + shadcn/ui + Tailwind · คุยกับ backend ผ่าน REST เท่านั้น
type ใน `src/lib/*-api.ts` ต้องตรงกับ [`docs/api/openapi.yaml`](../docs/api/openapi.yaml)

## รัน

```bash
# backend ต้องรันอยู่ (ดู backend/README.md)
cd web
echo NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1 > .env.local
npm ci
npm run dev                     # http://localhost:3000
```

| env | ค่า |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | ที่อยู่ API · ไม่ตั้ง = `/api/v1` ของ origin เดียวกัน (แบบที่ใช้หลัง Caddy ใน `docker compose --profile app`) · ฝังตอน build |

login ด้วยบัญชีทดสอบ `*.test` (รายชื่อ [HANDOVER §4](../docs/HANDOVER.md#4-บัญชีทดสอบ)) · backend ต้องอนุญาต origin ของเว็บใน `WEB_ORIGIN`

build: `npm run build` (ได้ `output: "standalone"` → `node .next/standalone/server.js` แบบที่ `web/Dockerfile` ใช้)

## โครงสร้าง (`src/`)

| ที่ | อะไร |
|---|---|
| `app/(auth)/` | หน้า login |
| `app/(app)/` | หน้าหลังล็อกอิน: Dashboard (`page.tsx` + `dashboard-*.tsx`), `approvals` (Approval Center), `config`, `parameters`, `firmware`, `devices`, `device-models`, `customers`, `campaigns`, `incidents`, `audit-log`, `users` |
| `lib/*-api.ts` | เรียก API แต่ละหมวด (ผ่าน `lib/api.ts` — ใส่ token, จัดการ 401 → กลับหน้า login) |
| `lib/permissions.ts` | เงื่อนไขแสดงปุ่ม/หน้าตามบทบาท (ต้องตรงกับ RBAC ฝั่ง backend — backend คือตัวตัดสินจริง) |
| `lib/nav.ts` | เมนูตามบทบาท |
| `hooks/use-*.ts` | ดึงข้อมูล + polling (หน้าเว็บอัปเดตด้วยการ poll ไม่มี push) |
| `components/ui/` | shadcn/ui · `components/` อื่นคือ component ร่วมของระบบ |

ระบบดีไซน์ของเว็บ: [`docs/ui-renovation/DESIGN.md`](../docs/ui-renovation/DESIGN.md)

## เทส

```bash
npm run lint
npm run build       # ต้องมาก่อน tsc — Next.js สร้าง type ของ route (เช่น LayoutProps) ตอน build
npx tsc --noEmit
npm test            # vitest (*.test.ts / *.test.tsx อยู่ข้างไฟล์ที่ทดสอบ)
```

CI (`web-ci.yml`) รันทั้ง 4 คำสั่งตามลำดับนี้ทุก PR · บนเครื่องใหม่ถ้ารัน `tsc` ก่อน build จะเจอ `Cannot find name 'LayoutProps'`
(ไม่ใช่โค้ดเสีย) — หรือสร้าง type อย่างเดียวด้วย `npx next typegen` แล้วค่อย `tsc`
