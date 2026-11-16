# backend — REST API (NestJS)

API ของทั้งระบบที่ `/api/v1` · NestJS 11 + Prisma 6 + PostgreSQL 16 + MinIO (เก็บไฟล์ Firmware)
ข้อกำหนด API: [`docs/api/openapi.yaml`](../docs/api/openapi.yaml) · กฎการพัฒนา: [CONTRIBUTING.md](../CONTRIBUTING.md)

## รัน

```bash
# จาก root: cp .env.example .env && docker compose up -d   (postgres :5433 / redis / minio)
cd backend
npm ci                          # postinstall รัน prisma generate ให้
npx prisma migrate deploy
npx prisma db seed              # บทบาท, สิทธิ์, Parameter Library, บัญชีทดสอบ (เครื่อง dev)
npm run seed:demo               # (ไม่บังคับ) ข้อมูลตัวอย่างสำหรับเดโม
npm run start:dev               # http://localhost:3001/api/v1/health
```

- **`.env` อยู่ที่ root ของ repo เท่านั้น** (backend ไม่มี `.env` ของตัวเอง) — `prisma.config.ts` และ `ConfigModule` อ่าน `../.env`
  ตัวแปรที่ export ไว้ในเชลล์ชนะค่าใน `.env`
- Prisma ล็อกไว้ที่ 6.x (ใช้ `prisma.config.ts` แบบ engine `classic`)
- build: `npm run build` → `node dist/src/main.js` (**`npm run start:prod` ใช้ไม่ได้** — ชี้ `dist/main` · KNOWN_ISSUES §3.1)
- รันบน server / env ที่ต้องตั้ง: [OPERATIONS.md](../docs/deploy/OPERATIONS.md)

## โครงสร้าง (`src/`)

| โมดูล | ทำอะไร |
|---|---|
| `auth`, `user` | login (JWT), จัดการผู้ใช้ |
| `common/` | guard (`JwtAuthGuard`, `PermissionGuard`), decorator, guard ตอนเริ่ม (`jwt-secret`, `trust-proxy`, `test-users`, `initial-admin`) |
| `config`, `config-definition`, `config-deletion` | Config, คลัง Parameter, คำขอลบ Config |
| `firmware` | อัปโหลด (MinIO), อนุมัติคุณภาพ, จำลอง |
| `device`, `device-model`, `customer` | ทะเบียนอุปกรณ์/รุ่น/ลูกค้า, Override เฉพาะเครื่อง, ประวัติ |
| `device-sync` | อุปกรณ์ดึงงานเอง + **รับ telemetry** `POST /device-sync/:id/telemetry/:key` (+ job ลบข้อมูลเก่า) |
| `central-device` | อ่านสถานะกล่องจาก Server กลาง (`CENTRAL_MODE`) |
| `campaign` | Campaign, Rollout, ส่งเข้ากล่องผ่าน Server กลาง, ลองใหม่อัตโนมัติ, timeout |
| `config-apply-request` | คำขอส่ง Config/Firmware จากหน้างาน → อนุมัติ → ช่างกดส่ง |
| `config-sync-writer` | ส่งเข้าระบบเดิมของบริษัท (`LEGACY_SYNC_MODE` — ใช้แค่ `mock`) |
| `task` | งานของช่าง + ประวัติ (event) |
| `incident` | Incident จากระบบและที่ช่างรายงาน |
| `notification` | แจ้งเตือนในระบบ + push FCM (`NOTIFICATION_MODE`) |
| `audit` | Audit Log (เฉพาะการเปลี่ยนข้อมูล) |
| `health`, `prisma` | health check, Prisma service |

`prisma/schema.prisma` — โครงสร้างข้อมูลทั้งหมด (ไฟล์ร่วมทั้งทีม อ่านกฎใน CONTRIBUTING §5 ก่อนแก้) · `prisma/seed.ts` — บทบาท/สิทธิ์ (RBAC อยู่ในฐานข้อมูล เพิ่มบทบาท = แก้ seed)

## เทส

| คำสั่ง | อะไร |
|---|---|
| `npm run lint` | ESLint (`*.ts` ใน src/test/prisma) — CI ตรวจ |
| `npm test` | unit test (`src/**/*.spec.ts`) |
| `npm run test:integration` | integration test (`test/integration/*.integration-spec.ts`) — **ล้างข้อมูลในฐาน** ใช้ฐานชื่อลงท้าย `_test` เท่านั้น (ตั้ง `DATABASE_URL_TEST` · setup บล็อกถ้าไม่ใช่ `_test`) |
| `backend/test/load/` | ทดสอบโหลด k6 (รันมือ) — [README](test/load/README.md) |

สร้างฐานเทสครั้งแรก:

```bash
docker exec gps-postgres createdb -U gps_user gps_config_firmware_test
DATABASE_URL=postgresql://gps_user:gps_password@localhost:5433/gps_config_firmware_test npx prisma migrate deploy
```

## สคริปต์

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run seed:demo` | ข้อมูลตัวอย่างสำหรับเดโม (ห้ามใช้กับฐานจริง) |
| `npm run clear:sample-data` | ล้างข้อมูลตัวอย่าง — เฉพาะฐานชื่อลงท้าย `_demo` |
| `npm run test-users:set-password` | ตั้งรหัสบัญชี `*.test` เป็น `TEST_USERS_PASSWORD` |
| `npm run import:central-schema` | นำเข้า Parameter Schema จาก Server กลาง (`--as <ชื่อรุ่น>`, ลอง `--dry-run` ก่อน) |
| `npm run seed:ci-fixtures` | ข้อมูลที่ E2E มือถือใน CI ใช้ |
| `npm run prisma:studio` | ดูข้อมูลผ่าน Prisma Studio |
