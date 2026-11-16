# คู่มือดูแลระบบ (Operations)

สำหรับคนที่ติดตั้ง / ดูแล backend บนเครื่องที่คนอื่นใช้งานด้วย (server จริง, เครื่องเดโม, เครื่องทดสอบร่วม)
ติดตั้งครั้งแรกดู [README หลัก](../../README.md) · ระบบเต็มชุดด้วย Docker ดู [docker-compose.md](docker-compose.md)

> **ระบบยังไม่เคยขึ้น server จริง** — คู่มือนี้รวบรวมจากการรันบนเครื่องทีมและ guard ที่มีในโค้ด
> ก่อนขึ้นจริงอ่าน [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) §1 (ผลทดสอบโหลด) ด้วย

---

## 1. env ที่ต้องตั้งก่อนเปิดสู่ภายนอก

ค่าเริ่มต้นใน `.env.example` ออกแบบมาสำหรับเครื่อง dev — ใช้บน server ตรงๆ ไม่ได้
backend มี guard หลายตัวที่ **ไม่ยอมเริ่ม** ถ้าตั้งไม่ครบ (ตั้งใจ ไม่ใช่บั๊ก)

"เปิดสู่ภายนอก" = `NODE_ENV=production` **หรือ** ตั้ง `TRUST_PROXY` (backend ใน `docker compose --profile app` เป็น production เสมอ)

| ค่า | ต้องตั้งเป็น | ถ้าไม่ตั้ง / ตั้งผิด |
|---|---|---|
| `JWT_SECRET` | ค่าสุ่มยาว ≥ 32 ตัว (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`) | **ไม่เริ่ม** · ใครรู้ค่านี้ปลอม token เป็น Admin ได้ |
| `TRUST_PROXY` | จำนวน proxy ที่อยู่หน้า backend (เช่น `1`) — **ตั้งเฉพาะเมื่อมี proxy จริง** | ไม่ตั้งทั้งที่มี proxy: IP ใน Audit Log เป็น IP ของ proxy ทุกแถว · ตั้งทั้งที่ไม่มี proxy: ผู้ใช้ปลอม IP ผ่าน `X-Forwarded-For` ได้ · ไม่ใช่จำนวนเต็มบวก: **ไม่เริ่ม** |
| `WEB_ORIGIN` | origin ของเว็บจริง (คั่นด้วย `,` ถ้าหลายค่า) | เว็บเรียก API ไม่ได้ (CORS) |
| `DATABASE_URL` | ฐานจริง (รหัสไม่ใช่ `gps_password`) | — |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `OBJECT_STORAGE_*` | ค่าใหม่ทั้งหมด | ค่าตัวอย่างอยู่ใน repo public |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` | SuperAdmin คนแรก (รหัส ≥ 12 ตัว) — seed สร้างให้เฉพาะเมื่อยังไม่มี SuperAdmin | ไม่มีใคร login ได้ |
| `SEED_TEST_USERS` | **ไม่ตั้ง** บนฐานจริง (ตั้ง `true` + `TEST_USERS_PASSWORD` เฉพาะเครื่องเดโม) | — |
| บัญชี `*.test` ที่มีอยู่แล้ว | ปิดใช้งาน หรือ `npm run test-users:set-password` | **ไม่เริ่ม** ถ้ายังมีบัญชีทดสอบใช้รหัสตั้งต้น |
| `NOTIFICATION_MODE` | `fcm` + `FCM_SERVICE_ACCOUNT_PATH` ของ project production + `FCM_ALLOW_NON_DEV_PROJECT=true` | ไฟล์ไม่เจอ / project ไม่ลงท้าย `-dev` แต่ไม่ได้ตั้ง allow: **ไม่เริ่ม** (กันยิง push จริงตอนทดสอบ) |
| `CENTRAL_MODE` + `CENTRAL_BASE_URL` + `CENTRAL_ADMIN_USERNAME` / `PASSWORD` | `real` + ค่าของ delivery-server | `real` แต่ตั้งไม่ครบ: **ไม่เริ่ม** · บัญชีนี้มีสิทธิ์เต็มบน Server กลาง ดูแลเหมือนรหัสแอดมิน |
| `DEVICE_CONFIG_APPLY_MODE` | `central` (คู่กับ `CENTRAL_MODE=real`) | `mock` = ปล่อย Rollout แล้วระบบบอกว่าสำเร็จทันทีโดยไม่ส่งถึงกล่อง |
| `TELEMETRY_INGEST_KEY_SHA256` | SHA-256 ของ key กลาง (docs/23 §7) หรือไม่ตั้งถ้าทุกกล่องมี key ของตัวเอง | ไม่ตั้ง = ปฏิเสธ telemetry ของกล่องที่ไม่มี key ของตัวเอง (fail closed) |
| `TELEMETRY_RATE_LIMIT_PER_IP` | ตามผลสำรวจซิม (ค่าเริ่มต้น 300/นาที รับได้ ~50 กล่องต่อ IP) | กล่องหลัง CGNAT เกินเพดาน = ข้อมูลหายถาวร (docs/32 §3.2) |
| `TELEMETRY_RETENTION_DAYS` | ตามนโยบาย (ค่าเริ่มต้น 7) | ดู KNOWN_ISSUES §1 — job ลบตามไม่ทันเมื่อกล่องเยอะ |
| `LEGACY_SYNC_MODE` | **คง `mock`** | ห้ามตั้ง `production` จนกว่าจะตกลงกับเจ้าของระบบเดิม (docs/07) |

`TRUST_PROXY` และ `FCM_ALLOW_NON_DEV_PROJECT` ไม่ได้กำหนดไว้ที่ไหนใน repo (ไม่มี infra-as-code) ต้องตั้งที่ระบบ hosting โดยตรง
หลัง deploy ให้เช็คหน้า Audit Log ว่า IP ของผู้ใช้ต่างคนต่างกัน

## 2. รัน backend

| วิธี | คำสั่ง |
|---|---|
| Docker (แนะนำ) | `docker compose --profile app up -d --build` — service `migrate` รัน `migrate deploy` + seed (upsert) ก่อน backend ทุกครั้ง |
| Node ตรงๆ | `npm ci && npx prisma generate && npx prisma migrate deploy && npm run build && node dist/src/main.js` |

> `npm run start:prod` ชี้ `dist/main` ซึ่งไม่มี (`nest build` วางไฟล์ที่ `dist/src/main.js`) ใช้ `node dist/src/main.js` แทน — KNOWN_ISSUES §3

เช็ค: `GET /api/v1/health` ต้องตอบ 200 · Docker มี healthcheck ที่ path เดียวกัน

## 3. ฐานข้อมูล

### backup / restore

```bash
# backup (format custom — restore ทีละตารางได้)
docker exec gps-postgres pg_dump -U gps_user -d gps_config_firmware -Fc > backup-$(date +%Y%m%d-%H%M).dump
# ตรวจว่าไฟล์อ่านได้
docker exec -i gps-postgres pg_restore -l < backup-XXXX.dump | head
# restore ลงฐานเปล่า
docker exec -i gps-postgres pg_restore -U gps_user -d <ฐานเปล่า> --no-owner < backup-XXXX.dump
```

**backup ทุกครั้งก่อน migrate** บนฐานที่มีข้อมูลจริง

### migration

- ฐานที่มีข้อมูล: **`npx prisma migrate deploy` เท่านั้น** — ห้าม `migrate dev` / `migrate reset` / `db push`
- migration ใหม่ต้องเป็นแบบเพิ่มอย่างเดียว (additive) ไม่แก้/ลบ migration เดิม (CONTRIBUTING.md)
- migration ที่เพิ่ม FK บนตารางที่มีข้อมูลอยู่แล้ว: เช็คข้อมูลกำพร้า (orphan) ก่อน · ถ้า FK จะ fail **หยุดและรายงาน ห้าม reset ฐาน**
- ห้ามรัน `npx prisma format` (เปลี่ยน format ทั้งไฟล์ ทำให้ diff อ่านไม่ออก)

### สคริปต์ข้อมูล (`backend/`)

| คำสั่ง | ทำอะไร | ใช้กับฐานจริงได้ไหม |
|---|---|---|
| `npx prisma db seed` | บทบาท, สิทธิ์, Parameter Library, (บัญชีทดสอบตามเงื่อนไข §1) — upsert รันซ้ำได้ | ✅ (seed นี้คือส่วนหนึ่งของ deploy) |
| `npm run seed:demo` | อุปกรณ์/Config/Campaign/Audit ตัวอย่าง | ❌ เดโมเท่านั้น |
| `npm run clear:sample-data` | ล้างข้อมูลตัวอย่าง — ทำงานเฉพาะฐานชื่อลงท้าย `_demo` | ❌ |
| `npm run test-users:set-password` | ตั้งรหัสบัญชี `*.test` เป็น `TEST_USERS_PASSWORD` | ✅ |
| `npm run import:central-schema` | นำเข้า Parameter Schema จาก Server กลาง (`--as <ชื่อรุ่น>`, รัน `--dry-run` ก่อน) | ✅ ระวัง |
| `backend/test/load/*.sql` | สร้างกล่องจำลอง 6,000 ตัว / telemetry เก่า | ❌ **ห้ามเด็ดขาด** — key เดาได้ |

## 4. ให้มือถือในวง LAN ใช้ backend เครื่องนี้

ใช้ตอนทดสอบด้วยมือถือจริง/เดโม (ทีมเดิมใช้วิธีนี้ทุกวัน)

1. รัน backend ตาม §2 (พอร์ต 3001) แล้วหา IP ของเครื่องในวง LAN (`ipconfig` → IPv4 ของ Wi-Fi/LAN ที่มี gateway)
2. Windows Firewall: อนุญาต `node.exe` ใน Private network
3. มือถืออยู่ Wi-Fi เดียวกัน: `flutter run --flavor dev --dart-define=API_MOCK_MODE=false --dart-define=API_BASE_URL=http://<IP>:3001/api/v1`
   (emulator บนเครื่องเดียวกันใช้ `10.0.2.2` แทน IP)
4. เว็บบนเครื่องเดียวกัน: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1` ใน `web/.env.local`

**IP เปลี่ยนเมื่อเปลี่ยนวง Wi-Fi** — ต้อง build แอปใหม่ และแก้ Config ของกล่อง (`data_server.host` ใน delivery-server) ให้ส่ง telemetry ไป IP ใหม่

## 5. Server กลางและกล่อง

ดู [arduino_gps/README.md](../../arduino_gps/README.md) — รัน, ค่าที่ต้องเปลี่ยนก่อนใช้จริง, build firmware

- backend ต่อ Server กลางด้วยบัญชี admin ของ delivery-server (`CENTRAL_ADMIN_*`) — เปลี่ยนรหัสที่ delivery-server แล้วต้องแก้ที่ backend คู่กัน
- กล่องส่ง telemetry ตรงมาที่ backend: `POST /api/v1/device-sync/{deviceId}/telemetry/{key}` (key อยู่ใน path เพราะ firmware ใส่ header ไม่ได้ — docs/23)
- หมุน key ของกล่อง: docs/23 §7.6 (เปลี่ยนที่ backend ก่อน แล้วส่ง Config ใหม่ให้กล่อง — ช่วงระหว่างนั้นกล่องได้ 401)

## 6. log และสิ่งที่ควรดู

| ที่ | ดูอะไร |
|---|---|
| `docker compose --profile app logs -f backend` | error ตอนเริ่ม (guard ใน §1), `[fcm]`, connection pool timeout |
| หน้า Audit Log (เว็บ) | การเปลี่ยนข้อมูลทุกอย่าง + IP (เช็ค `TRUST_PROXY`) |
| หน้า Dashboard (เว็บ) | Rollout ค้าง, เครื่องเงียบ, Incident |
| `arduino_gps/logs/` หรือ log ของ delivery-server / ws-gateway | คำสั่งที่ส่งถึงกล่อง, กล่องหลุด |
| ขนาดตาราง `DeviceTelemetry` | ต้องไม่โตไม่หยุด (KNOWN_ISSUES §1) |
