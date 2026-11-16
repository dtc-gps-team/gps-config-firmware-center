# GPS Config & Firmware Center

ระบบกลางจัดการ **Config** และ **Firmware** ของกล่อง GPS — สร้าง → อนุมัติ → ส่งเข้ากล่องจริง → ติดตามผล
พร้อมแอปมือถือสำหรับช่างหน้างาน

> **ทีมที่รับช่วงต่อ อ่าน [docs/HANDOVER.md](docs/HANDOVER.md) ก่อน** — สถานะระบบ, ค่าลับที่ต้องรับ, งานที่ควรทำต่อ

```
 เจ้าหน้าที่ ──► web/ (Next.js :3000) ─┐
                                      ├──► backend/ (NestJS :3001, /api/v1) ──► PostgreSQL :5433 · MinIO :9000
 ช่าง ST/OT ──► mobile/ (Flutter) ────┘            │                ▲
                                                    ▼                │ telemetry
                                 arduino_gps/ Server กลาง (:3019 / :3018) ──WebSocket──► กล่อง ESP32
```

| โฟลเดอร์ | คืออะไร | เทคโนโลยี |
|---|---|---|
| [`backend/`](backend/README.md) | REST API + ฐานข้อมูล | NestJS 11 + Prisma 6 + PostgreSQL 16 |
| [`web/`](web/README.md) | เว็บสำหรับเจ้าหน้าที่ | Next.js 16 + shadcn/ui |
| [`mobile/`](mobile/README.md) | แอปช่างหน้างาน (Android) | Flutter 3.47 |
| [`arduino_gps/`](arduino_gps/README.md) | Server กลาง ส่ง Config/Firmware เข้ากล่อง + firmware ESP32 | Node.js 20 + Arduino |
| [`docs/`](docs/README.md) | เอกสารออกแบบ, ข้อกำหนด API (`docs/api/openapi.yaml`), สิทธิ์ (`docs/architecture/RBAC_Matrix.md`) | Markdown / OpenAPI |

web และ mobile คุยกับ backend ผ่าน REST API เท่านั้น (ไม่ import โค้ดข้ามโปรเจกต์) ·
ทุกส่วนที่ต่อของจริงมีโหมด `mock` เป็นค่าเริ่มต้น จึงรันได้โดยไม่ต้องมี Server กลางหรือกล่อง

## สิ่งที่ต้องติดตั้ง

| โปรแกรม | เวอร์ชัน | ใช้กับ |
|---|---|---|
| Docker Desktop | ล่าสุด | ทุกวิธี (PostgreSQL / Redis / MinIO) |
| Node.js | 20 | backend, web, Server กลาง |
| Flutter | 3.47.x (CI ใช้ 3.47.9) | mobile (ไม่บังคับ) |

## วิธี A: ทั้งระบบด้วย Docker คำสั่งเดียว (ดูระบบ / เดโม)

ได้ฐานข้อมูล, backend, เว็บ และ reverse proxy (Caddy) ครบที่พอร์ตเดียว — รายละเอียด [docs/deploy/docker-compose.md](docs/deploy/docker-compose.md)

1. `cp .env.example .env` แล้วตั้งค่า:
   ```env
   JWT_SECRET=<สุ่ม: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
   SEED_TEST_USERS=true
   TEST_USERS_PASSWORD=<รหัสที่ตั้งเอง อย่างน้อย 12 ตัวอักษร>
   ```
2. `docker compose --profile app up -d --build` (ครั้งแรก build หลายนาที)
3. เปิด `http://localhost:8080` แล้ว login ด้วยบัญชีทดสอบ เช่น `admin.test` / `operation.test` (รหัส = `TEST_USERS_PASSWORD`)

```bash
docker compose --profile app ps              # สถานะ
docker compose --profile app logs -f backend # log
docker compose --profile app down            # ปิด (ข้อมูลยังอยู่)
```

## วิธี B: โหมดนักพัฒนา

```bash
cp .env.example .env            # ค่าตัวอย่างใช้ในเครื่องได้เลย
docker compose up -d            # postgres (5433) / redis / minio เท่านั้น

cd backend
npm ci
npx prisma migrate deploy
npx prisma db seed              # ข้อมูลตั้งต้น + บัญชีทดสอบทุกบทบาท
npm run seed:demo               # (ไม่บังคับ) อุปกรณ์/Config/Campaign ตัวอย่าง
npm run start:dev               # http://localhost:3001/api/v1/health ต้องตอบ 200

cd ../web
echo NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1 > .env.local
npm ci
npm run dev                     # http://localhost:3000
```

บัญชีทดสอบ 11 บัญชีครบทุกบทบาท (`*.test`) — รายชื่อใน [docs/HANDOVER.md §4](docs/HANDOVER.md#4-บัญชีทดสอบ)
รหัสตั้งต้นสำหรับเครื่อง dev อยู่ใน `backend/src/common/test-users.ts`

มือถือ (Android emulator บนเครื่องเดียวกัน) ต้องมี `google-services.json` ก่อน build — ไฟล์จริงไม่อยู่ใน repo
ใช้ไฟล์ของ Firebase project (`--flavor dev`) หรือไฟล์ stub แล้ว build แบบไม่ใส่ `--flavor` (push ใช้ไม่ได้) — ขั้นตอนเต็ม
ใน [mobile/README.md](mobile/README.md)

```bash
cd mobile && flutter pub get && dart run build_runner build --delete-conflicting-outputs
# มีไฟล์ Firebase dev:
flutter run --flavor dev --dart-define=API_MOCK_MODE=false --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
# ใช้ stub:
flutter run --dart-define=PUSH_NOTIFICATIONS_ENABLED=false --dart-define=API_MOCK_MODE=false --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
```

Server กลาง + กล่องจริง: ดู [arduino_gps/README.md](arduino_gps/README.md) แล้วตั้ง `CENTRAL_MODE=real` +
`DEVICE_CONFIG_APPLY_MODE=central`

## เทส

| ส่วน | คำสั่ง | ใน CI |
|---|---|---|
| backend | `npm run lint` · `npm test` · `npm run test:integration` (ฐาน `_test` แยก) | ✅ ทุก PR |
| web | `npm run lint` · `npm run build` · `npx tsc --noEmit` · `npm test` | ✅ ทุก PR |
| mobile | `dart format --output=none --set-exit-if-changed .` · `flutter analyze` · `flutter test` (+ `--dart-define=API_MOCK_MODE=false`) | ✅ ทุก PR |
| mobile E2E | `integration_test/` บน emulator | ทุกคืน (ไม่ใช่ required check) |
| Server กลาง | `npm test` ใน `arduino_gps/delivery-server`, `arduino_gps/ws-gateway` | ❌ |
| ทดสอบโหลด | [`backend/test/load/README.md`](backend/test/load/README.md) | ❌ (รันมือ) |

## เอกสารต่อ

- [docs/HANDOVER.md](docs/HANDOVER.md) — สถานะ, ค่าลับ, งานค้าง
- [CONTRIBUTING.md](CONTRIBUTING.md) — กฎ branch / PR / migration / RBAC / API
- [docs/deploy/OPERATIONS.md](docs/deploy/OPERATIONS.md) — env บน production, backup, migrate, เปิดให้มือถือในวง LAN ใช้
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) — ปัญหาที่รู้แล้ว
- [docs/README.md](docs/README.md) — สารบัญเอกสารทั้งหมด

## ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| พอร์ต 5432 ชน | โปรเจกต์ใช้ `POSTGRES_PORT=5433` อยู่แล้ว ถ้าชนอีกให้เปลี่ยนเลข และแก้ใน `DATABASE_URL` ให้ตรง |
| เว็บขึ้น 500 "Module not found" | `npm ci` ใหม่ในโฟลเดอร์ `web` |
| login ไม่ได้ / เว็บต่อ API ไม่ได้ | backend ต้องตอบ `/api/v1/health` และ `NEXT_PUBLIC_API_BASE_URL` ใน `web/.env.local` ต้องถูก |
| วิธี A: backend ไม่ยอมเริ่ม | `JWT_SECRET` ยังเป็นค่าตัวอย่าง หรือบัญชีทดสอบยังใช้รหัสตั้งต้น |
| มือถือ build ไม่ผ่าน "`*.g.dart` not found" | `dart run build_runner build` |
