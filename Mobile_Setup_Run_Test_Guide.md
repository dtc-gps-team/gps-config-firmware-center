# คู่มือ Setup / Run / Test — Mobile (+ Backend ที่ต้องมีคู่กัน)

**ขอบเขต:** Mobile (Flutter) + Backend (NestJS) module ที่ Mobile ต้องพึ่งพา
**จัดทำเมื่อ:** 6 กันยายน 2569
**ตรวจสอบและแก้ไขล่าสุด:** 7 กันยายน 2569 — เทียบกับ `backend/package.json`, `backend/src/main.ts`,
`backend/test/integration/setup.ts`, `mobile/pubspec.yaml`, `mobile/lib/core/config/app_config.dart`,
`docker-compose.yml`, `.env.example` และ `docs/api/openapi.yaml` ของจริงในโค้ดแล้ว (ไม่ใช่ snapshot เก่า)

> **สถานะการตรวจสอบ (อัปเดต 7 กันยายน 2569 รอบ 3 — ยืนยันครบผ่าน UI จริงบน Android Emulator แล้ว):**
> รันจริงครบทุกขั้นตอนรวมถึงชั้น UI ของ Flutter เองแล้ว — `docker compose up -d`, `npm run test`
> (161 ผ่าน), `npm run test:integration` (125 ผ่าน), `flutter test` (104 ผ่าน),
> **`flutter test integration_test/task_flow_test.dart` และ `notification_flow_test.dart` ผ่านทั้งคู่
> บน Android Emulator (AVD `Pixel_10a`) ต่อ backend จริงผ่าน `10.0.2.2:3001`** (ไม่ใช่ API ตรงแบบ curl
> เหมือนรอบก่อนอีกต่อไป) — Windows Developer Mode ยังเปิดไม่สำเร็จ (ผู้ใช้แจ้งว่าอาจถูก Group Policy
> บล็อก แต่ตรวจสอบเองด้วย `gpresult /r` และ registry policy key แล้วไม่พบ GPO ที่บล็อกชัดเจน — เครื่องนี้
> ไม่ได้ join domain เลย จึงยังสรุปสาเหตุไม่ได้ 100%) จึง**เปลี่ยนไปใช้ Android Emulator แทน Windows
> desktop target** ซึ่งให้ผลดีกว่าด้วย (ทดสอบ UI จริงได้ครบ ไม่ใช่แค่ API) ระหว่างทดสอบผ่าน UI จริงพบ
> **บั๊ก 2 จุดในแอป mobile** (ไม่ได้แก้เอง แค่รายงาน — ดูหัวข้อ 4.4) ที่ควรแจ้งทีม B ก่อน sign-off

---

## 1. โครงสร้างที่เกี่ยวข้อง

```
gps-config-firmware-center/
├── backend/     NestJS — ต้องรันก่อน Mobile เสมอ (Mobile ต่อ API ผ่านตัวนี้)
├── mobile/      Flutter
├── docker-compose.yml   PostgreSQL, Redis, MinIO
└── .env.example
```

Mobile ไม่คุยกับฐานข้อมูลตรง — ต้องผ่าน Backend API เสมอ (กฎของโปรเจกต์) ดังนั้นก่อนรัน Mobile ต้องมี Backend รันอยู่ก่อน (ยกเว้นทดสอบด้วย mock mode — ดูหัวข้อ 5)

> **แก้ไข:** โครงสร้างเดิมเขียนว่า docker-compose มี TimescaleDB และ Mosquitto (MQTT) ด้วย — เช็คแล้ว
> `docker-compose.yml` ปัจจุบันมีแค่ 3 service คือ **postgres, redis, minio** เท่านั้น ไม่มี
> TimescaleDB/Mosquitto ในไฟล์นี้ (อาจเป็นแผนใน design doc ที่ยังไม่ได้ implement จริง หรือถูกตัดออกไปแล้ว
> — ถ้าต้องการยืนยันให้เช็คกับทีม A/Infra)

---

## 2. Setup ครั้งแรก (ทำครั้งเดียว)

### 2.1 Infrastructure services (Docker)

```bash
cp .env.example .env
# แก้ค่าใน .env ตามเครื่อง (โดยเฉพาะรหัสผ่าน DB ถ้าไม่ใช้ default)

docker compose up -d
docker compose ps   # ต้องเห็น postgres, redis, minio ทั้งหมด "healthy"
```

| Service | Container name | Host port | ใช้ตรวจสอบ |
|---|---|---|---|
| PostgreSQL | `gps-postgres` | 5433 (map เข้า container port 5432 — ตั้งผ่าน `POSTGRES_PORT` ใน `.env.example` เพราะ 5432 มักชนกับ Postgres ตัวอื่นในเครื่อง) | `psql postgresql://gps_user:gps_password@localhost:5433/gps_config_firmware` |
| Redis | `gps-redis` | 6379 | `redis-cli ping` → ควรได้ `PONG` |
| MinIO (Object Storage — เก็บไฟล์ firmware) | `gps-minio` | 9000 (API) / 9001 (console) | เปิด `http://localhost:9001` login ด้วย `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` จาก `.env` |

> **แก้ไข:** ตารางเดิมมี TimescaleDB (5433) และ Mosquitto (1883/9001) — ไม่มีจริงใน
> `docker-compose.yml` ปัจจุบัน (ดูหมายเหตุหัวข้อ 1) พอร์ต 5433 จริง ๆ คือ Postgres ตัวเดียว
> ที่ map พอร์ตย้ายมาเลี่ยงชนกับ Postgres local อื่น ไม่ใช่ service แยก และ MinIO ที่มีจริงไม่เคยอยู่ใน
> ตารางเดิมเลย เพิ่มเข้ามาใหม่

> **ยืนยันแล้วรันจริง (7 กันยายน 2569):** `docker compose up -d` แล้ว `docker compose ps` เห็นครบ
> ทั้ง 3 container คือ `gps-postgres`, `gps-redis`, `gps-minio` ขึ้นสถานะ `Up ... (healthy)` ทั้งหมด

### 2.2 Backend (NestJS)

```bash
cd backend
npm install

# Prisma — ใช้ deploy ไม่ใช่ dev เพื่อเลี่ยงปัญหา migration checksum drift
# (เคยเจอเคสนี้มาแล้วรอบ migration ก่อนหน้า — ดู PR #87 หมายเหตุเรื่อง checksum drift,
# migration ที่เจอปัญหาคือ 20260831023429_add_device_auditlog_models)
npx prisma migrate deploy
npx prisma generate

npm run start:dev
```

> **ยืนยันแล้วรันจริง (7 กันยายน 2569):** `npx prisma migrate deploy` → "No pending migrations to
> apply" (10 migrations, ครบแล้วไม่มีอะไรต้อง apply เพิ่ม), `npx prisma generate` สำเร็จ, `npm run
> start:dev` บูต Nest application สำเร็จไม่มี error — โหลดครบทุก module (`PrismaModule`,
> `AuthModule`, `TaskModule`, `NotificationModule`, `DeviceModule`, `ConfigModule`,
> `ConfigDefinitionModule` ฯลฯ) และ map route ครบตาม `openapi.yaml`

**ตรวจว่า Backend พร้อมใช้:**
- ยังไม่มี dedicated health-check endpoint (เช็คจาก `backend/src/app.controller.ts` แล้ว — มีแค่
  `GET /` ตัวเดียว คืน `"Hello World!"`) เนื่องจาก `main.ts` ตั้ง `app.setGlobalPrefix('api/v1')`
  path จริงตอนรันคือ **`GET http://localhost:3001/api/v1/`**: `curl http://localhost:3001/api/v1/`
  (ควรได้ `Hello World!`) — ถ้าต้องการ health endpoint จริงจัง ยังไม่มีใน backend นี้ ต้องคุยกับทีม A
  ว่าจะเพิ่มหรือไม่
- **ไม่มี Swagger/API docs UI ติดตั้งอยู่** (เช็คใน `main.ts` แล้ว ไม่มีการเรียก `SwaggerModule` เลย
  และไม่มี `@nestjs/swagger` ใน `package.json`) เอกสาร API ที่มีจริงคือไฟล์ static
  `docs/api/openapi.yaml` เท่านั้น — ดู endpoint list ที่นั่น หรือรัน
  `npx @redocly/cli lint docs/api/openapi.yaml` เพื่อ validate (ตาม convention ใน `CLAUDE.md`)
  ยังไม่มี `http://localhost:3001/api/docs` หรือ URL ไหนที่ serve Swagger UI จริง

> **แก้ไข:** เดิมอ้าง `http://localhost:4000/api/v1` และ `http://localhost:4000/api/docs` —
> พอร์ตจริงคือ **3001** ไม่ใช่ 4000 (ยืนยันจาก `main.ts` บรรทัด `await app.listen(process.env.PORT ?? 3001)`,
> `mobile/lib/core/config/app_config.dart` ที่ตั้ง default `apiBaseUrl` เป็น
> `http://localhost:3001/api/v1`, และ `docs/api/openapi.yaml` → `servers[0].url` ก็เป็นค่าเดียวกัน)
> และไม่มี Swagger UI จริงตามที่กล่าวไว้ข้างบน — ลบตัวอย่าง URL `/api/docs` ออก แทนที่ด้วยการอ้างไฟล์
> openapi.yaml โดยตรง

### 2.3 Mobile (Flutter)

```bash
cd mobile
flutter pub get
```

ไม่มี `melos.yaml` หรือ `Makefile` ในโปรเจกต์ mobile (เช็คแล้ว — ไม่เจอไฟล์ทั้งสองแบบ) เป็น Flutter
project ธรรมดา ใช้คำสั่ง `flutter` ตรง ๆ ได้เลย ไม่ต้องผ่าน tool อื่น

ตั้งค่าให้ Mobile ชี้ไปที่ Backend ที่รันอยู่ผ่าน `--dart-define` (ยืนยันจาก
`mobile/lib/core/config/app_config.dart` — key จริงคือ `API_BASE_URL` และ `API_MOCK_MODE` ตรงตามที่ใช้ด้านล่าง
ค่า default ในโค้ดถ้าไม่ใส่ `--dart-define` เลยคือ `apiBaseUrl = http://localhost:3001/api/v1` และ
`apiMockMode = false`):

```bash
flutter run --dart-define=API_BASE_URL=http://localhost:3001/api/v1 --dart-define=API_MOCK_MODE=false
```

- ถ้ารันบน Android emulator แล้วต่อ backend ที่รันบนเครื่อง host ให้ใช้ `http://10.0.2.2:3001/api/v1` แทน `localhost` (ข้อจำกัดของ Android emulator)
- ถ้ารันบน physical device ต้องอยู่ network เดียวกันและใช้ IP เครื่อง host แทน `localhost`

> **แก้ไข:** เดิมอ้างอิงว่า pattern ตั้งค่าอาจเป็นไฟล์ `.env` ของ mobile เอง — เช็ค
> `app_config.dart` แล้วยืนยันว่าใช้ `--dart-define` (compile-time constant) เท่านั้น ไม่มี
> `.env`/`flutter_dotenv` ในโปรเจกต์ mobile และแก้พอร์ตจาก 4000 เป็น 3001 ให้ตรงกับ default จริงในโค้ด

---

## 3. รันแอปทุกวัน (หลัง setup ครั้งแรกแล้ว)

```bash
# terminal 1 — infra (ถ้ายังไม่ได้รันค้างไว้)
docker compose up -d

# terminal 2 — backend
cd backend && npm run start:dev

# terminal 3 — mobile
cd mobile && flutter run --dart-define=API_BASE_URL=http://localhost:3001/api/v1
```

---

## 4. รัน Test

### 4.1 Backend

ยืนยันจาก `backend/package.json` แล้ว (เปิดดูตรง ๆ อีกรอบ 7 กันยายน 2569) มี script ที่ขึ้นต้นด้วย
`test` ทั้งหมด **6 ตัว** ไม่ใช่ 5 หรือ 3 ตามที่เดิมเขียนไว้ต่างวาระกัน:

```bash
cd backend

npm run test              # unit test (service/controller *.spec.ts) — ไม่ต้องมี DB, รันผ่านแล้ว: 161 ผ่าน
npm run test:watch        # unit test เหมือน `test` แต่รันแบบ watch mode (jest --watch) — ใช้ตอน dev เขียนเทสไปด้วย
npm run test:cov          # unit test พร้อม coverage report
npm run test:debug        # unit test แบบแนบ Node inspector (--inspect-brk, --runInBand) — ใช้ตอนอยาก
                           # ตั้ง breakpoint ดีบั๊ก test ทีละ step ผ่าน Chrome DevTools/VS Code debugger
npm run test:e2e          # จริง ๆ คือ "smoke test" เดียว (test/app.e2e-spec.ts): GET / -> "Hello World!"
                           # ผ่าน AppModule เต็ม → ต้องมี DATABASE_URL ที่ต่อได้จริง (PrismaService
                           # ต่อ DB ตอน onModuleInit) แต่ไม่ได้ผ่าน guard DATABASE_URL_TEST เหมือน
                           # test:integration — เผลอชี้ DATABASE_URL ไป dev DB ก็รันผ่านได้ (ไม่ได้ลบข้อมูล
                           # อะไรเพราะเป็นแค่ GET) แต่ก็ไม่ได้ "แยก DB" ให้อัตโนมัติเหมือนที่เข้าใจกันเดิม
npm run test:integration  # integration test จริง (jest --config ./test/jest-integration.json
                           # --runInBand) — ไฟล์ *.integration-spec.ts ใน backend/test/integration/
                           # ต่อ Postgres จริง ต้องตั้ง DATABASE_URL_TEST ก่อนรัน (ดู 4.1.1)
```

- **แก้ไข:** เดิมมีแค่ `test` / `test:cov` / `test:e2e` และเข้าใจว่า `test:e2e` คือ integration
  test ที่ต้องมี test database แยก — ที่จริงมี **6 script** (เพิ่ม `test:watch` กับ `test:debug` ที่
  เอกสารรุ่นก่อนหน้ายังไม่ได้ระบุชื่อ/หน้าที่ไว้) และ integration test ตัวจริงที่ต่อ Postgres แล้วตรวจ
  IDOR/RBAC (auth, task, notification, device, config, permission-guard ฯลฯ) คือ
  **`npm run test:integration`** คนละตัวกับ `test:e2e` (ซึ่งมีแค่ smoke test ไฟล์เดียว)

#### 4.1.1 ตั้งค่าก่อนรัน `test:integration`

เช็ค `backend/test/integration/setup.ts` แล้ว: อ่านค่าจาก `DATABASE_URL_TEST` ก่อน (fallback ไป
`DATABASE_URL` ถ้าไม่ตั้ง) แล้ว **บังคับว่าชื่อ database ต้อง ลงท้ายด้วย `_test`** — ถ้าไม่ใช่จะ throw
error ทันทีตั้งแต่ setup (กันพลาดรัน `deleteMany()` ใส่ dev database จริง เพราะ integration test ล้าง
ตารางทั้งหมดก่อนแต่ละรอบ) `.env.example` มีคำสั่งตั้งต้นเตรียมไว้ให้แล้ว:

```bash
# สร้าง database แยกสำหรับเทสครั้งแรก (ครั้งเดียว)
docker exec gps-postgres createdb -U gps_user gps_config_firmware_test

# apply migration ให้ test database
DATABASE_URL=postgresql://gps_user:gps_password@localhost:5433/gps_config_firmware_test npx prisma migrate deploy

# ตั้งใน .env (หรือ export ก่อนรัน) แล้วรันเทส
# DATABASE_URL_TEST=postgresql://gps_user:gps_password@localhost:5433/gps_config_firmware_test
npm run test:integration
```

> **ยืนยันแล้วรันจริง (7 กันยายน 2569):** database `gps_config_firmware_test` มีอยู่แล้วในเครื่องนี้
> (สร้างไว้ก่อนหน้า), apply migration ซ้ำแล้วได้ "No pending migrations to apply" เช่นกัน — ตั้ง
> `DATABASE_URL_TEST` แล้วรัน `npm run test:integration` ได้ผล **11 test suites ผ่านหมด, 125 tests
> ผ่านหมด** (auth, task, notification, device, config-firmware-campaign-incident,
> permission-guard-http, config-http, config-definition-http, device-http, task-http,
> notification-http) ไม่มี fail

- ถ้า integration test ค้างหรือ fail แปลกๆ ให้เช็คว่า container postgres ยัง healthy อยู่ก่อน (`docker compose ps`)

### 4.2 Mobile

```bash
cd mobile

flutter test                       # unit test + widget test ทั้งหมด — รันผ่านแล้ว: 104 ผ่าน
flutter test --coverage            # พร้อม coverage (ได้ไฟล์ coverage/lcov.info)
```

**โครงสร้างจริงของ `mobile/test/` เป็นแบบ flat ไม่มี subfolder ต่อ feature** (เช็คแล้ว — ไม่มี
`test/features/task/` หรือ subfolder อื่นใด) ไฟล์ที่มีจริงตอนนี้ (13 ไฟล์):
`mock_mode_test.dart`, `widget_test.dart`, `device_connection_test_page_test.dart`,
`login_form_test.dart`, `task_detail_page_test.dart`, `task_repository_test.dart`,
`simulator_page_test.dart`, `simulator_repository_test.dart`, `api_client_test.dart`,
`home_page_test.dart`, `notification_list_page_test.dart`, `notification_repository_test.dart`,
`models_test.dart`

รันเฉพาะไฟล์เดียวได้ตรง ๆ เช่น:

```bash
flutter test test/task_repository_test.dart   # รันเฉพาะไฟล์ใดไฟล์หนึ่ง
```

> **แก้ไข:** เดิมตัวอย่างใช้ `flutter test test/features/task/` (path แบบแยก feature folder) —
> ไม่มีจริง โครงสร้างปัจจุบันแบนราบอยู่ใต้ `mobile/test/` ตรง ๆ ปรับตัวอย่างเป็นชี้ไฟล์ตรง ๆ แทน

**ดู coverage แบบอ่านง่าย (ถ้ามี lcov ติดตั้ง):**

```bash
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html   # macOS — เครื่องอื่นเปิดไฟล์ตรงๆ ในเบราว์เซอร์
```

### 4.3 Integration test แบบเต็ม (`integration_test/`)

มีไฟล์จริง 2 ไฟล์ใน `mobile/integration_test/`: `task_flow_test.dart`, `notification_flow_test.dart`
ยังไม่ได้ผูกเข้า CI อัตโนมัติตามที่เดิมระบุไว้ — **ยืนยันแล้วผ่าน `gh issue view 75` (7 กันยายน 2569):
issue #75 "mobile: ผูก integration_test (E2E) เข้า CI pipeline" ยังเปิดอยู่ (`OPEN`) ตรงกับที่เอกสารอ้างไว้
ทุกประการ** (`https://github.com/dtc-gps-team/gps-config-firmware-center/issues/75`) รันมือได้ผ่าน:

```bash
flutter test integration_test/ -d <device_id>
# ดู device_id ที่ต่อได้ด้วย: flutter devices
```

> **ยืนยันแล้วรันผ่านจริงบน UI จริง (7 กันยายน 2569 รอบ 3):** ลองบน `-d chrome` ก่อน → error
> `Web devices are not supported for integration tests yet.` (ข้อจำกัดของ Flutter เอง) ลองบน
> `-d windows` → error `Building with plugins requires symlink support. Please enable Developer Mode`
> (Developer Mode เปิดไม่สำเร็จในเครื่องนี้ — ดูหมายเหตุด้านบนสุดของไฟล์) จึง **เปลี่ยนไปใช้ Android
> Emulator แทน**: เครื่องนี้มี Android SDK + emulator ติดตั้งพร้อมอยู่แล้ว (`flutter doctor` ผ่านหมด
> ยกเว้น Visual Studio C++ workload ที่ไม่จำเป็นสำหรับ Android) และมี AVD ชื่อ `Pixel_10a` อยู่แล้ว
> (`emulator -list-avds`) บูตด้วย `emulator -avd Pixel_10a` แล้วรัน:
> ```bash
> flutter test integration_test/task_flow_test.dart -d emulator-5554 \
>   --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1 --dart-define=API_MOCK_MODE=false
> flutter test integration_test/notification_flow_test.dart -d emulator-5554 \
>   --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1 --dart-define=API_MOCK_MODE=false
> ```
> **ผลจริง: ทั้งสองไฟล์ผ่านหมด** (`task_flow_test.dart`: "All tests passed!" ใน ~36s,
> `notification_flow_test.dart`: "All tests passed!" ใน ~24s) ต่อ backend จริงผ่าน `10.0.2.2:3001`
> — นี่คือการยืนยันชั้น UI/widget ของ Flutter จริง ๆ (render, routing, provider wiring) ไม่ใช่แค่ยิง
> API ตรงเหมือนรอบก่อน
>
> **หมายเหตุสำคัญ — `flutter test integration_test/` ถอนแอปออกหลังรันเสร็จทุกครั้ง** (ไม่เหมือน
> `flutter run` ที่ค้างแอปไว้) ถ้าจะทดสอบ manual ต่อหลังรัน integration test แล้ว ต้องรัน
> `flutter run -d <device_id> --dart-define=...` แยกอีกรอบเพื่อเปิด session ค้างไว้ให้ทดสอบด้วยมือได้

#### 4.3.1 ยืนยัน flow แทนด้วยการยิง API ตรง (ใช้ตอนไม่มีทางขับ UI ได้เลย — เก็บไว้เป็นทางเลือกสำรอง)

ใช้ user ที่ seed ไว้แล้วในโปรเจกต์ (`st.test` / `password123`, role `ST`, มี 3 tasks + 4
notifications ผูกอยู่จริงใน dev DB) จำลอง flow เดียวกับที่ `task_flow_test.dart` +
`notification_flow_test.dart` ทดสอบ:

```bash
# 1) login
curl -sS -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"st.test","password":"password123"}'
# -> 200 { "accessToken": "...", "role": "ST" }

# 2) task list (ใส่ accessToken จากข้อ 1 แทน $TOKEN)
curl -sS http://localhost:3001/api/v1/tasks -H "Authorization: Bearer $TOKEN"
# -> 200, 3 tasks ของ st.test

# 3) task detail
curl -sS http://localhost:3001/api/v1/tasks/<task_id> -H "Authorization: Bearer $TOKEN"
# -> 200

# 4) notification list
curl -sS http://localhost:3001/api/v1/notifications -H "Authorization: Bearer $TOKEN"
# -> 200, 4 notifications (2 unread ตอนเช็ค)

# 5) mark read
curl -sS -X PATCH http://localhost:3001/api/v1/notifications/<notification_id>/read \
  -H "Authorization: Bearer $TOKEN"
# -> 200, read เปลี่ยนเป็น true, unread count ลดลง 1
```

**ผลจริงที่รันได้ (7 กันยายน 2569):** ทุกขั้นตอนได้ HTTP 200 ตามที่คาดตามลำดับ — login คืน role `ST`
ถูกต้อง, task list คืน 3 รายการตรงกับที่ seed ไว้จริง, task detail คืน 200, notification list คืน 4
รายการ (2 unread), หลัง PATCH mark read แล้ว GET ซ้ำเห็น `read: true` และ unread count ลดลงจาก 2
เหลือ 1 ตรงตาม flow ที่ `notification_flow_test.dart` คาดหวัง (เช็ค `unread_dot` ลดลงหลัง tap)

### 4.4 Task Management Checklist — ผลทดสอบผ่าน UI จริงบน Android Emulator (7 กันยายน 2569)

ทดสอบด้วยมือผ่าน `adb input` + screenshot (`adb exec-out screencap`) บน AVD `Pixel_10a` ต่อ backend
จริง (`10.0.2.2:3001`, `API_MOCK_MODE=false`) — ไม่ใช่ mock ทั้งหมด 6 ข้อ **ผ่าน 4 ข้อ, พบบั๊กจริง 2 จุด**
(รายละเอียดด้านล่าง) สกรีนช็อตทุกขั้นตอนส่งให้ผู้ใช้แล้วผ่าน SendUserFile ระหว่างทดสอบ

| # | ขั้นตอน | ผล | รายละเอียด |
|---|---|---|---|
| 1 | Login → Home | ✅ ผ่าน | เข้าสู่ระบบด้วย `st.test`/`password123` แล้วเข้าหน้า Home ปกติ เห็น "สวัสดี, st.test", role badge `ST • ช่างภาคสนาม` |
| 2 | Task list scoped ต่อ user | ✅ ผ่าน | `st.test` เห็น 3 งานของตัวเอง (ตรงกับ DB) — `ot.test` (คนละ user, role เดียวกัน) เห็น 0 งาน ไม่เห็นงานของ `st.test` เลย ยืนยัน scoping ถูกต้อง |
| 3 | เปิดดูรายละเอียดงาน | ✅ ผ่าน | หน้า "รายละเอียดงาน" render ครบ: ชื่องาน, สถานะ, อุปกรณ์, กำหนดส่ง, สร้างเมื่อ, แก้ไขล่าสุด, รายละเอียด, ตัวเลือกเปลี่ยนสถานะ (จำกัดแค่ กำลังทำ/เสร็จแล้ว ตาม role ST ตรงกับที่ `task_flow_test.dart` ยืนยันไว้) |
| 4 | เปลี่ยนสถานะงาน | ✅ ผ่าน | กด "เสร็จแล้ว" → "บันทึกสถานะ" → toast "อัปเดตสถานะงานแล้ว" ขึ้น, badge เปลี่ยนเป็น "เสร็จแล้ว" ทันที, กลับไปหน้า list เห็นสถานะใหม่ตรงกัน (persist จริงผ่าน backend) |
| 5 | Backend/network ล่ม → error ที่อ่านได้ | ✅ ผ่าน (แก้แล้ว 8 กันยายน 2569) | เดิมไม่ผ่าน (ดูหัวข้อ "บั๊กที่พบ #2" ด้านล่าง) — แก้แล้วที่ `ApiClient._toApiException` (`mobile/lib/core/api/api_client.dart`) ยืนยันซ้ำบน emulator จริง: ข้อความเปลี่ยนเป็น "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง" ไม่มี raw exception หลุดออกมาอีก ปุ่ม retry ยังทำงานถูกต้อง |
| 6 | Empty state (user ไม่มีงานเลย) | ✅ ผ่าน | ใช้ `ot.test` (มีอยู่แล้วในกลุ่ม seed users, 0 tasks ในสกีมา ไม่ต้องสร้างใหม่) → เห็น empty state สื่อความหมาย "ยังไม่มีงานที่ได้รับมอบหมาย" พร้อมไอคอน inbox ไม่ใช่หน้าเปล่า |

**สรุป (อัปเดต 8 กันยายน 2569): ผ่านครบ 6/6 ข้อ** — ข้อ 5 แก้แล้วและยืนยันซ้ำผ่านทั้ง unit/widget test และบน Android emulator จริง (เดิมผ่าน 4/6 ตอนทดสอบรอบแรก 7 กันยายน 2569) ไม่มีข้อไหน crash หรือค้าง

#### บั๊กที่พบ #1 — Session restore ไม่ดึงชื่อ/role กลับมา (ไม่เกี่ยวกับ backend ล่มเลย)

ระหว่างพยายามทดสอบข้อ 5 (จำลอง backend ล่ม) เจอโดยบังเอิญว่า **ทุกครั้งที่แอป cold start ด้วย token ที่
persist ไว้แล้ว** (เช่นโดน Android kill แอปพื้นหลังแล้วเปิดใหม่ หรือ reboot เครื่อง) — ไม่ว่า backend จะ
รันอยู่หรือไม่ก็ตาม — หน้า Home จะขึ้น **"สวัสดี, ผู้ใช้งาน"** (placeholder ทั่วไป แทนชื่อ user จริง),
section "งานวันนี้" หายไปทั้ง section (ไม่ใช่ empty state ที่ตั้งใจ — หายเลย), และ shortcut
"ทดสอบสัญญาณ" หายไปด้วย (แสดงว่า role ก็ไม่ถูกต้องด้วย) **ทดสอบยืนยันซ้ำ 2 ครั้ง** — ครั้งแรกตอน backend
ล่ม, ครั้งที่สองตอน backend รันปกติสมบูรณ์ — **ได้ผลเหมือนกันทุกอย่าง** พิสูจน์ว่าไม่เกี่ยวกับ network เลย

**ต้นตอที่เจอ (อ่านโค้ดอย่างเดียว ไม่ได้แก้):** `mobile/lib/core/auth/auth_controller.dart:75-83`
เมธอด `_restore()` ที่ทำงานตอน cold start อ่านแค่ token จาก `TokenStore` แล้วตั้ง
`state = state.copyWith(status: AuthStatus.authenticated)` ทันที **ไม่มีการเรียก API ไหนเพื่อดึง
username/role กลับมาเลย** — ค่า `username`/role ใน `AuthState` เลยยังเป็นค่า default (ว่าง/null) จนกว่า
ผู้ใช้จะ logout แล้ว login ใหม่ด้วยมือ (ซึ่งตอนนั้น `login()` ที่ auth_controller.dart:85 เป็นคนละ method
ที่ set ค่าครบถูกต้อง)

**ผลกระทบที่คาดว่าจะเกิดจริงกับช่างหน้างาน:** ทุกครั้งที่ Android ฆ่าแอปพื้นหลัง (เรื่องปกติมากบนมือถือ
เวลาเปิดแอปอื่นแช่ RAM ไว้) แล้วช่างสลับกลับมาที่แอปนี้ — จะเห็นหน้า Home ที่ดูเหมือนไม่มีงานมอบหมายเลย
ทั้ง ๆ ที่จริง ๆ มีงานอยู่ อาจทำให้เข้าใจผิดว่างานหาย หรือคิดว่าแอปพัง ต้อง force-quit + เปิดใหม่ (ซึ่งจะ
เจอปัญหาเดิมซ้ำ เพราะ token ยัง persist อยู่) วิธีเลี่ยงตอนนี้คือต้องกด logout แล้ว login ใหม่ทุกครั้ง

**สถานะ: แก้แล้ว ยืนยันด้วย test (8 กันยายน 2569)** — branch `fix/session-restore-and-raw-error-message`
commit `91abfad` (local, ยังไม่ push/merge — รอผู้ใช้ตัดสินใจเปิด PR เอง)

**วิธีแก้ที่ใช้จริง (ต่างจากที่ขอไว้ตอนแรกเล็กน้อย เพราะเช็คแล้วไม่มี endpoint ให้เรียก):** ขอเดิมให้
`_restore()` "ดึง user profile กลับมาจาก backend" — แต่ไล่โค้ด `RealAuthRepository`/`auth.controller.ts`
แล้วพบว่า **backend มีแค่ `POST /auth/login` ตัวเดียว ไม่มี `/auth/me` หรือ endpoint ดึงโปรไฟล์คืนเลย**
(ตรงกับ comment เดิมใน `AuthState.username` ที่อธิบายไว้แล้วก่อนแก้) จึงเปลี่ยนวิธีเป็น **persist
username + role ไว้ในเครื่องเอง** (เก็บคู่กับ token) แทนการเรียก backend — เพิ่มคลาสใหม่
`SessionProfileStore` ใน `mobile/lib/core/auth/token_store.dart` (`SecureSessionProfileStore` /
`InMemorySessionProfileStore` — pattern เดียวกับ `TokenStore` เดิมทุกประการ ไม่ได้คิดอะไรใหม่ แค่ copy
pattern ไปเก็บอีก 2 ฟิลด์) แล้ว wire เข้า `AuthController.login()` (save), `_restore()` (read),
`logout()` (clear) ใน `auth_controller.dart` — **ไม่ได้แตะ `TokenStore` เดิมเลยสักบรรทัด** ตามที่สั่งไว้

**Test ที่เพิ่ม:** `mobile/test/auth_controller_test.dart` (ไฟล์ใหม่ 5 test) cover: ไม่มี token ค้าง
(unauthenticated), มี token แต่ไม่มี profile cache (เคส upgrade จากเวอร์ชันเก่า — username/role ยัง
null ตามเดิม ไม่ crash), มี token + profile cache (username/role กลับมาครบ — regression test ของบั๊กนี้
โดยตรง), login แล้ว persist ถูก restore ข้าม container ใหม่ได้จริง, logout ล้าง cache หมด — และแก้ test
เดิม 5 ไฟล์ที่ override `tokenStoreProvider` ให้เพิ่ม override `sessionProfileStoreProvider` ด้วย (ไม่งั้น
`login()`/`logout()` ใหม่จะไปชนปลั๊กอิน secure storage จริงตอนรัน test แล้ว timeout)

**ยืนยันบน Android Emulator จริง (8 กันยายน 2569):** login → กด Home (background) → `adb shell am
force-stop` (จำลอง Android ฆ่าแอป) → เปิดแอปใหม่ → Home ขึ้น "สวัสดี, st.test" + role badge + 3 งานครบ
ถูกต้อง ไม่ใช่ "สวัสดี, ผู้ใช้งาน" อีกต่อไป (screenshot ส่งให้ผู้ใช้แล้ว)

#### บั๊กที่พบ #2 — Error message ตอน backend ล่มเป็น raw exception ไม่ใช่ข้อความที่อ่านเข้าใจได้

แยกทดสอบใหม่ให้สะอาด (login ปกติก่อน ยืนยันเห็นชื่อ/งานครบถูกต้อง แล้วค่อยปิด backend ระหว่าง session
เดิมที่ล็อกอินค้างอยู่ ไม่ cold start ซ้ำ กัน conflate กับบั๊ก #1) แล้วกดเปิดดูรายละเอียดงาน 1 รายการ:

- ไม่ crash, มีปุ่ม "ลองอีกครั้ง" (retry) จริง และกดแล้ว **recover ได้ถูกต้อง** เมื่อ backend กลับมา
- แต่ข้อความที่แสดงคือ: *"The connection errored: Connection refused This indicates an error which
  most likely cannot be solved by the library."* — เป็นข้อความ exception ดิบจาก Dio (HTTP client
  library) ภาษาอังกฤษล้วน ไม่ได้แปล ไม่ได้ปรับให้เข้าใจง่าย และมีปัญหาการเว้นวรรค/จบประโยค (ไม่มี
  full stop คั่นระหว่าง "refused" กับ "This") — ไม่ตรงกับที่ checklist ต้องการ ("error message ที่อ่าน
  เข้าใจได้ ไม่ขึ้น error ดิบจาก exception")

**ต้นตอที่เจอตอนแรก (ก่อนไล่ลึก):** `mobile/lib/features/home/home_page.dart` มีการดักจับ error ไว้
(widget `_TasksError` บรรทัด ~314, ดึงข้อความจาก `error is ApiException ? error.message : 'โหลดงานไม่สำเร็จ'`)
ดูเหมือนมี fallback ภาษาไทยพร้อมอยู่แล้ว เลยตั้งสมมติฐานว่าหน้า task detail "ไม่ได้ใช้ pattern เดียวกับ
Home" — **แต่ไล่โค้ดจริงจังแล้วสมมติฐานนี้ผิด**

**ต้นตอที่แท้จริง (แก้แล้ว):** `error is ApiException` เป็น `true` เสมอ เพราะทุก endpoint ใน `ApiClient`
โยน `ApiException` เท่านั้น (ไม่เคยโยนอย่างอื่น) — แปลว่า fallback ภาษาไทย `'โหลดงานไม่สำเร็จ'` ใน Home
**เป็น dead code ที่ไม่เคยทำงานจริงเลย** Home จะโชว์ raw exception เหมือนกันทุกประการถ้าเจอ backend
ล่ม (แค่ไม่เคยเจอในการทดสอบรอบก่อนเพราะบั๊ก #1 ซ่อน section งานทั้งหมดไปก่อน) และหน้า task detail เอง
(`task_detail_page.dart:75-87`) ก็มี switch ข้อความไทยตาม statusCode (404/403) อยู่แล้วจริง ๆ — ไม่ได้
ขาด pattern เลย มันแค่ไม่มี case สำหรับตอน "ไม่มี response เลย" (connection refused/timeout) เหมือนกัน
ทุกหน้า เพราะรากที่แท้จริงอยู่ที่ **`ApiClient._toApiException` ใน `mobile/lib/core/api/api_client.dart`
จุดเดียว** ที่ทุกหน้าใช้ร่วมกัน — ตอน `e.response` เป็น null (ไม่มี HTTP response กลับมาเลย) โค้ดเดิม fallback
ไปที่ `e.message` ตรง ๆ ซึ่งเป็นข้อความ diagnostic ดิบของ Dio เอง ไม่ใช่ข้อความสำหรับ end user

**วิธีแก้ที่ใช้จริง:** แก้ที่จุดเดียว (`_toApiException`) แทนที่จะไปแก้ทีละหน้า — เพิ่มเมธอด
`_transportErrorMessage(DioExceptionType)` แปลง `connectionTimeout`/`sendTimeout`/`receiveTimeout`/
`transformTimeout`/`connectionError` ให้เป็นข้อความไทยเดียวกัน ("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณา
ตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง") และ fallback สุดท้ายเปลี่ยนจาก `'Network error'`
(อังกฤษ) เป็น `'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง'` — แก้จุดเดียวนี้ทำให้ **ทุกหน้าที่ใช้
`ApiClient` ถูกแก้ไปพร้อมกันหมด** (task detail, task list บน Home, notifications, ฯลฯ) โดยไม่ต้องแตะ
โค้ด UI ของแต่ละหน้าเลยสักไฟล์ — ไม่ได้สร้าง error handling แบบใหม่แยกต่างหากตามที่สั่งไว้ (ใช้จุดรวม
ที่มีอยู่แล้วจุดเดียว)

**Test ที่แก้/เพิ่ม:** `mobile/test/api_client_test.dart` — แก้ test เดิมที่ชื่อ (แปลตรงตัว) "ไม่มี
response เลย (connection error) -> ใช้ e.message เหมือนเดิม" ซึ่ง**เคย assert พฤติกรรมบั๊กเป็นของถูกต้อง
มาก่อน** ให้ assert ข้อความไทยใหม่แทน (พร้อม `isNot(contains(...))` กันข้อความดิบหลุดกลับมาอีก) และเพิ่ม
2 test ใหม่ (`connectionTimeout`, `unknown` type) — และ `mobile/test/task_detail_page_test.dart` เพิ่ม 1
widget test เฉพาะเคส "backend เข้าไม่ถึง" ยืนยันว่าเห็นข้อความไทย ไม่เห็นคำว่า "cannot be solved by the
library" และปุ่ม retry ยังอยู่

**สถานะ: แก้แล้ว ยืนยันด้วย test (8 กันยายน 2569)** — branch/commit เดียวกับบั๊ก #1
(`fix/session-restore-and-raw-error-message`, commit `91abfad`, local, ยังไม่ push/merge)

**ยืนยันบน Android Emulator จริง (8 กันยายน 2569):** login ปกติ → ปิด backend → กดเข้าดูรายละเอียดงาน
เดิมที่เคยโหลดสำเร็จมาก่อน (ไม่ cold start ใหม่ กัน conflate กับบั๊ก #1) → ขึ้นข้อความ "เชื่อมต่อเซิร์ฟเวอร์
ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง" พร้อมปุ่ม "ลองอีกครั้ง" — เปิด
backend กลับมาแล้วกด retry → โหลดข้อมูลงานสำเร็จ (screenshot ส่งให้ผู้ใช้แล้ว)

---

## 5. Mock Mode (รัน Mobile โดยไม่ต้องมี Backend จริง)

โปรเจกต์มี pattern ให้ repository แต่ละตัวสลับระหว่างของจริง (`ApiXxxRepository`) กับของ mock (`MockXxxRepository`) ผ่านค่า config ตัวเดียว (`API_MOCK_MODE` / `AppConfig.apiMockMode`) ใช้ตอนอยากทดสอบ UI เร็วๆ โดยไม่ต้องเปิด Docker/Backend:

```bash
flutter run --dart-define=API_MOCK_MODE=true
```

ข้อควรระวัง: ฟีเจอร์ที่ยังไม่มี mock รองรับ (เช่นส่วนที่เพิ่งต่อ backend จริงใหม่ๆ) อาจ error หรือใช้ mock data เก่าที่ไม่ตรงกับ endpoint ปัจจุบัน — ถ้าจะ demo ให้พี่เลี้ยงดู แนะนำใช้ mode จริง (`API_MOCK_MODE=false`) ต่อ backend ที่รันจริงตามข้อ 3 จะตรงกับของจริงมากกว่า

---

## 6. Troubleshooting ที่เจอมาแล้ว

| อาการ | สาเหตุที่เจอ | วิธีแก้ |
|---|---|---|
| `prisma migrate dev` สั่ง reset ฐานข้อมูลทั้งหมด | migration checksum drift จาก migration ก่อนหน้า (เคยเกิดกับ migration `20260831023429`) | ใช้ `npx prisma migrate deploy` แทน `migrate dev` เมื่อ pull โค้ดที่มี migration ใหม่มาแล้ว |
| Mobile ต่อ backend ไม่ติดตอนรันบน emulator | ใช้ `localhost` ซึ่งบน Android emulator หมายถึงตัว emulator เอง ไม่ใช่เครื่อง host | เปลี่ยนเป็น `10.0.2.2` แทน `localhost` |
| Integration test (backend) ค้างหรือ error connection refused | ลืมเปิด docker compose หรือ container postgres ไม่ healthy | `docker compose ps` เช็คสถานะ, `docker compose logs postgres` ดู error |
| Widget test แจ้ง error หา provider ไม่เจอ | ลืม wrap widget ด้วย `ProviderScope`/mock provider override ตาม pattern เดิมของโปรเจกต์ | เช็คไฟล์ test ของ feature ที่ทำผ่านแล้ว (เช่น task, notification) เป็นตัวอย่างโครง test |
| `npm run test:integration` throw ตั้งแต่ setup ทันที: `Integration tests need DATABASE_URL_TEST ...` | ยังไม่ได้ตั้ง `DATABASE_URL_TEST` หรือชื่อ database ไม่ลงท้ายด้วย `_test` — `setup.ts` เช็คบังคับก่อนรันเทสทุกครั้งกันเผลอลบข้อมูล dev DB | ตั้ง `DATABASE_URL_TEST` ให้ชี้ไป database ที่ชื่อลงท้าย `_test` ตามตัวอย่างในหัวข้อ 4.1.1 |
| สับสนระหว่าง `test:e2e` กับ `test:integration` | ชื่อคล้ายกันแต่คนละตัว: `test:e2e` มีแค่ smoke test เดียว (`GET /`), `test:integration` คือชุดที่ต่อ Postgres จริงและครอบคลุม RBAC/IDOR | ใช้ `test:integration` เวลาต้องการเทสที่ต่อ DB จริง อย่าพึ่ง `test:e2e` แทน |
| `docker ps` / `docker compose up -d` ขึ้น `failed to connect to the docker API ... dockerDesktopLinuxEngine` (Windows) | Docker Desktop ปิดอยู่ หรือยังไม่ได้เปิดครั้งแรกหลัง reboot | เปิดแอป Docker Desktop รอจน tray icon ขึ้นสถานะ running แล้วค่อยรัน `docker compose up -d` ใหม่ |
| เปิด `http://localhost:3001/api/docs` แล้วเจอ 404 | โปรเจกต์นี้ยังไม่ได้ติดตั้ง Swagger UI (`main.ts` ไม่มี `SwaggerModule.setup`) | ดู endpoint list จาก `docs/api/openapi.yaml` โดยตรงแทน (หรือรัน `npx @redocly/cli lint docs/api/openapi.yaml` เพื่อดู error/warning) |
| `flutter test integration_test/*.dart -d chrome` ขึ้น `Web devices are not supported for integration tests yet.` | ข้อจำกัดของ Flutter tooling เอง (ไม่ใช่บั๊กโปรเจกต์) — `flutter test integration_test/` ยังไม่รองรับ web device | ใช้ device อื่น (Android emulator หรือ desktop ที่เปิด Developer Mode แล้ว) แทน หรือใช้ `flutter drive` คู่กับ `test_driver/integration_test.dart` ตาม comment ในไฟล์ test แทน |
| `flutter test integration_test/*.dart -d windows` ขึ้น `Building with plugins requires symlink support. Please enable Developer Mode` | เครื่อง Windows ยังไม่ได้เปิด Developer Mode — Flutter ต้องใช้ symlink ตอน build plugin สำหรับ desktop target | รัน `start ms-settings:developers` แล้วเปิด Developer Mode ก่อน ค่อยรันคำสั่งเดิมใหม่ — **ถ้าเปิดแล้วยังไม่ผ่าน** ให้เปลี่ยนไปใช้ Android Emulator แทน (ดูหัวข้อ 4.3) ซึ่งใช้ได้จริงในเครื่องที่ Developer Mode มีปัญหา และครอบคลุมกว่าด้วย |
| เปิด Developer Mode ผ่าน Settings แล้ว toggle ขึ้นเป็น "on" แต่ registry (`HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock`) ยังไม่มีค่า `AllowDevelopmentWithoutDevLicense` | ไม่ทราบสาเหตุแน่ชัด — เช็ค `gpresult /r` แล้วเครื่องไม่ได้ join domain, ไม่มี GPO ใด ๆ ถูก apply, และ `HKLM\SOFTWARE\Policies\Microsoft\Windows\Appx` ไม่มี policy ที่เกี่ยวกับ Developer Mode เลย จึงไม่ใช่ IT/GPO บล็อกที่ยืนยันได้จากเครื่องมือมาตรฐาน — อาจเป็นแค่ toggle ยังติดตั้ง component ไม่เสร็จ หรือมีข้อจำกัดอื่นที่ยังไม่ทราบ | ยังไม่มีวิธีแก้ที่ยืนยันได้ในรอบนี้ — ใช้ Android Emulator แทนได้ผลดีกว่าและไม่ติดปัญหานี้เลย |
| `flutter test integration_test/` ถอนแอปออกจากเครื่อง/emulator ทันทีหลังรันเสร็จ | เป็นพฤติกรรมปกติของ `flutter test integration_test/` (ต่างจาก `flutter run`) — ไม่ทิ้งแอปค้างไว้ให้ทดสอบต่อด้วยมือ | ถ้าต้องการ session ค้างไว้ทดสอบต่อด้วยมือ (เช่นไล่ checklist ที่ integration test ไม่ครอบคลุม) ให้รัน `flutter run -d <device_id> --dart-define=...` แยกอีกรอบแทน |
| ตอนขับ UI ด้วย `adb shell input tap`/`input text` แล้ว tap พลาดเป้า (เช่นไปโดนปุ่ม logout แทนกระดิ่งแจ้งเตือน) | พิกัดที่เห็นจาก `adb exec-out screencap` เป็น **native resolution จริงของอุปกรณ์** (เช่น 1080×2424) แต่ถ้าดูภาพผ่านตัวย่อ/preview ที่แสดงเป็นขนาดอื่น (เช่น 891×2000) ต้องคูณ scale factor กลับก่อนส่งพิกัดให้ `adb input tap` มิฉะนั้นจะ tap ผิดตำแหน่ง | คำนวณ `original = displayed * (native_width / displayed_width)` ก่อนทุกครั้ง หรือ crop/ดู log ขนาดภาพจริงจาก `screencap` ให้แน่ใจว่าใช้พิกัด native ไม่ใช่พิกัดที่เห็นในตัวย่อ |
| `flutter test integration_test/notification_flow_test.dart` fail ที่ `expect(unread_dot count, lessThan(dotsBefore))` | ข้อมูล notification ใน dev DB ถูกแก้ผ่าน `curl PATCH .../read` ด้วยมือไปก่อนหน้า (ทดสอบ API ตรงในรอบก่อน) ทำให้ notification ตัวที่ index 0 ในลิสต์ (ที่ test คาดว่าจะ unread) กลายเป็น read ไปแล้วจริง — ไม่ใช่บั๊กของแอป เป็นแค่ test fixture data เพี้ยนจากการทดสอบ API ตรงก่อนหน้า | เช็ค read state จริงผ่าน `GET /notifications` ก่อน ถ้าเพี้ยนให้ `UPDATE "Notification" SET read=false WHERE id=...` คืนสภาพเดิมตรง ๆ ผ่าน `docker exec gps-postgres psql ...` (ระวัง: `seed.ts` ไม่ได้ seed ตาราง Task/Notification เลย รันซ้ำไม่ช่วยคืนข้อมูลส่วนนี้) |

---

## 7. เช็คลิสต์ก่อนรีวิว/เดโม

- [x] `docker compose ps` — ทุก service (postgres, redis, minio) healthy — ยืนยันแล้ว 7 กันยายน 2569
- [x] Backend รันอยู่ ไม่มี error ใน log ตอน start (`npm run start:dev`, ทดสอบด้วย `curl http://localhost:3001/api/v1/`) — ยืนยันแล้ว 7 กันยายน 2569
- [x] `npm run test` (backend unit) ผ่านทั้งหมด — 161 ผ่าน (7 กันยายน 2569)
- [x] `npm run test:integration` (backend, ตั้ง `DATABASE_URL_TEST` แล้ว) ผ่านทั้งหมด — 125 ผ่าน (7 กันยายน 2569)
- [x] `flutter test` (mobile) ผ่านทั้งหมด — 104 ผ่าน (7 กันยายน 2569)
- [x] เปิดแอปด้วย `API_MOCK_MODE=false` ต่อ backend จริง ไล่ feature ตามคู่มือทดสอบ — **ยืนยันผ่าน UI
      จริงแล้ว** บน Android Emulator: `task_flow_test.dart` + `notification_flow_test.dart` ผ่านทั้งคู่
      ผ่าน `flutter test integration_test/` (7 กันยายน 2569), และไล่ Task Management checklist ด้วยมือ
      ผ่าน `adb input` ครบ 6 ข้อ — **อัปเดต 8 กันยายน 2569: แก้บั๊กทั้ง 2 จุดที่พบแล้ว (ดูหัวข้อ 4.4) ผ่าน
      ครบ 6/6 ข้อ ยืนยันด้วย unit/widget test (112 ผ่าน) และซ้ำบน emulator จริงอีกครั้ง**

> **แก้ไข:** เดิมข้อสุดท้ายอ้างถึงไฟล์ `Sprint_Review_Mobile_TestGuide.md` — ค้นในโปรเจกต์แล้ว
> **ไม่มีไฟล์นี้อยู่จริง** (ไม่พบทั้ง root และทุกโฟลเดอร์) ตัดการอ้างอิงออก ถ้ามีคู่มือทดสอบแยกต่างหากจริง
> ให้ทีมช่วยยืนยันชื่อ/ที่อยู่ไฟล์แล้วใส่กลับเข้ามา

---

## สรุปการแก้ไขในรอบนี้

### รอบที่ 1 (7 กันยายน 2569 — เทียบโค้ด/config, Docker ปิดอยู่)

**แก้แล้ว (ยืนยันกับโค้ดจริง):**
1. Backend scripts: มี 6 ตัว (`test`, `test:watch`, `test:cov`, `test:debug`, `test:e2e`, `test:integration`) ไม่ใช่ 3 ตัว — และ `test:e2e` ≠ integration test ที่ต่อ DB แยก อย่างที่เข้าใจเดิม ตัวที่ต่อ DB แยกจริงคือ `test:integration`
2. Backend port: **3001** ไม่ใช่ 4000 (ยืนยันจาก `main.ts`, `app_config.dart`, `openapi.yaml`)
3. ไม่มี health-check endpoint เฉพาะ — มีแค่ `GET /` (จริง ๆ คือ `GET /api/v1/` เพราะมี global prefix)
4. ไม่มี Swagger/API docs UI ติดตั้งเลย — ลบ URL `/api/docs` ที่ไม่มีจริงออก ชี้ไปที่ `docs/api/openapi.yaml` แทน
5. `DATABASE_URL_TEST` คือ env var ที่ถูกต้องสำหรับ integration test (ไม่ใช่แค่ "DATABASE_URL แยก DB" อย่างคลุมเครือ) พร้อม guard บังคับชื่อ DB ลงท้าย `_test`
6. Docker services จริงมีแค่ **postgres, redis, minio** — ไม่มี TimescaleDB/Mosquitto ตามที่เขียนไว้เดิม
7. mobile: ไม่มี melos/Makefile, ยืนยัน `API_BASE_URL`/`API_MOCK_MODE` เป็น key จริงใน `app_config.dart` ผ่าน `--dart-define` (ไม่ใช่ .env ของ mobile)
8. mobile test folder เป็น flat ไม่มี `test/features/task/` — แก้ตัวอย่างคำสั่งให้ตรง
9. ลบการอ้างอิงไฟล์ `Sprint_Review_Mobile_TestGuide.md` ที่ไม่มีอยู่จริงในโปรเจกต์

**รันจริงแล้วผ่าน:** `npm run test` (backend, 161 tests), `flutter pub get` + `flutter test` (mobile, 104 tests)

### รอบที่ 2 (7 กันยายน 2569 — Docker เปิดแล้ว รันครบทุกขั้นตอนที่ค้างไว้)

**รันจริงแล้วผ่านเพิ่มเติม:**
1. `docker compose up -d` → `gps-postgres`, `gps-redis`, `gps-minio` ขึ้น healthy ครบ 3 ตัว
2. `npx prisma migrate deploy` (dev DB) → No pending migrations, `npx prisma generate` สำเร็จ, `npm run start:dev` บูตสำเร็จไม่มี error ทุก module/route map ครบ
3. ตั้ง `DATABASE_URL_TEST` ชี้ database `gps_config_firmware_test` (มีอยู่แล้ว) → `npm run test:integration` **ผ่านทั้งหมด 125 tests / 11 suites**
4. ยืนยัน backend มี test script **6 ตัว** ไม่ใช่ 5 — เพิ่ม `test:watch` และ `test:debug` เข้าไปในเอกสารพร้อมอธิบายหน้าที่ (watch mode / Node inspector debug)
5. ยืนยัน issue #75 จริงผ่าน `gh issue view 75` — ยัง `OPEN`, ชื่อเรื่องตรงกับที่เอกสารอ้างไว้ทุกประการ
6. พยายามรัน `flutter run`/`flutter test integration_test/` แบบ UI E2E จริง — **ติดข้อจำกัดของเครื่องทดสอบ** (ไม่มี Android emulator, ผู้ใช้เลือกไม่ติดตั้ง Claude in Chrome extension, `integration_test` ไม่รองรับ web device, Windows desktop ต้องเปิด Developer Mode ก่อนซึ่งยังไม่ได้เปิด) จึง **ยืนยัน flow login → task list → task detail → notification list → mark read แทนด้วยการยิง API ตรง** (curl) กับ backend จริงและ user ที่ seed ไว้แล้ว (`st.test`/`password123`) — ผ่านทุกขั้นตอน (ดูหัวข้อ 4.3.1) แต่ **ยังไม่ได้ยืนยันชั้น UI/Flutter widget ของแอปจริง**

**เช็คลิสต์หัวข้อ 7:** ติ๊กผ่านแล้ว 5 จาก 6 ข้อ เหลือข้อเดียวที่ยังไม่ผ่าน — "ไล่ feature ผ่าน UI จริงด้วย `API_MOCK_MODE=false`" (ติดข้อจำกัดเครื่องมือข้างต้น)

### รอบที่ 3 (7 กันยายน 2569 — เปิด Developer Mode ไม่สำเร็จ → เปลี่ยนไปใช้ Android Emulator แทน)

**สิ่งที่ทำ:**
1. พยายามเปิด Windows Developer Mode ตามที่ผู้ใช้ขอ — ตรวจสอบด้วยตัวเอง (`gpresult /r`, registry
   policy key) **ไม่พบหลักฐานว่าเป็น GPO/IT policy บล็อก** (เครื่องนี้ไม่ได้ join domain, ไม่มี GPO ถูก
   apply เลย) แต่ registry value `AllowDevelopmentWithoutDevLicense` ก็ยังไม่ถูกตั้งค่าอยู่ดีแม้ผู้ใช้
   ยืนยันว่าเปิด toggle ผ่าน Settings แล้ว — **สาเหตุที่แท้จริงยังไม่ยืนยันได้ 100%** (ผู้ใช้ระบุว่าอาจถูก
   Group Policy บล็อก แต่การตรวจสอบของเราเองไม่สนับสนุนข้อสรุปนั้นโดยตรง)
2. เปลี่ยนไปใช้ **Android Emulator** แทน (มี Android SDK + AVD `Pixel_10a` พร้อมอยู่แล้วในเครื่อง) —
   ได้ผลลัพธ์ที่ดีกว่าด้วย เพราะทดสอบ UI จริงได้ครบ ไม่ต้องพึ่ง API-only workaround อีกต่อไป
3. รัน `flutter test integration_test/task_flow_test.dart` และ `notification_flow_test.dart` บน
   emulator ต่อ backend จริง (`10.0.2.2:3001`) — **ผ่านทั้งคู่**
4. ไล่ Task Management checklist 6 ข้อด้วยมือผ่าน `adb input` + screenshot บน emulator เดียวกัน —
   **ผ่าน 4/6** (ข้อ 5 "network ล่ม → error อ่านได้" ไม่ผ่าน)
5. ระหว่างทดสอบพบ **บั๊กจริง 2 จุด** ในแอป mobile (รายงานเท่านั้น ไม่ได้แก้โค้ดเอง ตามที่ผู้ใช้สั่งไว้):
   - **บั๊ก #1:** cold start ด้วย persisted token ไม่ดึง username/role กลับมาเลย (`auth_controller.dart:75-83`) — ทำให้ Home แสดง "สวัสดี, ผู้ใช้งาน" + งานหายทั้ง section ไม่ว่า backend จะรันอยู่หรือไม่ (ยืนยันซ้ำ 2 ครั้ง)
   - **บั๊ก #2:** หน้า task detail แสดง raw Dio exception message ภาษาอังกฤษดิบตอน backend ล่ม แทนข้อความไทยที่อ่านง่ายแบบที่หน้า Home มี fallback ไว้แล้ว (`_TasksError` ใน `home_page.dart:314`)
6. ส่ง screenshot ทุกขั้นตอน (10 ไฟล์) ให้ผู้ใช้ผ่าน SendUserFile ระหว่างทดสอบแล้ว
7. Sprint_Review_Mobile_TestGuide.md — ผู้ใช้ยืนยันว่ายังไม่มีไฟล์นี้จริง ให้ข้ามไป อัปเดตแค่ไฟล์นี้

**เช็คลิสต์หัวข้อ 7:** ติ๊กผ่านครบ 6/6 ข้อแล้ว — แต่ข้อสุดท้าย (UI E2E) ติ๊กผ่านเพราะ *กระบวนการทดสอบ*
สำเร็จและครอบคลุมครบ ไม่ได้แปลว่าแอปไม่มีบั๊ก ยังมี 2 บั๊กค้างอยู่ที่ต้องแจ้งทีม B ก่อน sign-off จริงจัง

**ยังไม่มั่นใจ 100%:**
- TimescaleDB/Mosquitto อาจเป็นแผนใน design doc ที่ยังไม่ implement จริง หรือถูกตัดออกจาก scope ไปแล้ว — ไม่ได้ไล่เอกสาร architecture เทียบเพื่อยืนยันสาเหตุ
- ยังไม่ได้ยืนยันว่าทีมตั้งใจไม่มี health-check endpoint จริง ๆ หรือแค่ยังไม่ได้ทำ (ควรถามทีม A ก่อนถ้าจะใช้ path นี้ทำ readiness probe จริงจัง)
- **สาเหตุที่แท้จริงที่ Windows Developer Mode เปิดไม่ติดบนเครื่องนี้** — ผู้ใช้ระบุว่าอาจเป็น Group
  Policy แต่ `gpresult`/registry policy key ที่เราตรวจเองไม่สนับสนุนข้อสรุปนั้น เครื่องไม่ได้ join
  domain เลย ยังไม่ได้ข้อสรุปที่ยืนยันได้ 100% (ไม่กระทบงานต่อเพราะใช้ Android Emulator แทนได้แล้ว)
- **บั๊ก #1 และ #2** — แก้และยืนยันแล้ว 8 กันยายน 2569 (ดูรอบที่ 4 ด้านล่าง) ไม่ใช่ประเด็นค้างอีกต่อไป

### รอบที่ 4 (8 กันยายน 2569 — แก้บั๊กทั้ง 2 จุดที่พบในรอบที่ 3)

**สิ่งที่ทำ:**
1. **บั๊ก #1 (session restore):** ไล่โค้ด `RealAuthRepository`/`auth.controller.ts` ก่อนแก้ — พบว่า
   backend มีแค่ `POST /auth/login` ไม่มี `/auth/me` ให้เรียกจริง (ตรงกับที่ comment เดิมในโค้ดบอกไว้)
   จึงเปลี่ยนวิธีจาก "เรียก backend ดึงโปรไฟล์" เป็น **persist username+role ไว้ในเครื่องเอง** ผ่านคลาส
   ใหม่ `SessionProfileStore` (pattern เดียวกับ `TokenStore` เดิมทุกประการ, ไม่แตะ `TokenStore` เลย) —
   ไฟล์ที่แก้: `mobile/lib/core/auth/token_store.dart` (+70 บรรทัด, เพิ่มคลาสใหม่),
   `mobile/lib/core/auth/auth_controller.dart` (~15 บรรทัด wiring เข้า login/_restore/logout)
2. **บั๊ก #2 (raw error message):** ไล่โค้ด Home/task detail ก่อนแก้ พบว่าสมมติฐานเดิม (รอบที่ 3) ที่ว่า
   "Home มี pattern ถูกต้องอยู่แล้ว" **ผิด** — Home's fallback ภาษาไทยเป็น dead code เพราะ
   `error is ApiException` เป็นจริงเสมอ ต้นตอจริงอยู่ที่จุดร่วมเดียว `ApiClient._toApiException` ใน
   `mobile/lib/core/api/api_client.dart` แก้ที่จุดเดียวนั้น (+20 บรรทัด, เพิ่มเมธอด
   `_transportErrorMessage`) แก้ได้ทุกหน้าพร้อมกันโดยไม่ต้องแตะ UI code เลย
3. เขียน/แก้ test: ไฟล์ใหม่ `mobile/test/auth_controller_test.dart` (5 test), แก้
   `mobile/test/api_client_test.dart` (แก้ 1 test เดิมที่เคย assert บั๊กเป็นพฤติกรรมถูกต้อง + เพิ่ม 2
   test ใหม่), แก้ `mobile/test/task_detail_page_test.dart` (+1 test), และเพิ่ม
   `sessionProfileStoreProvider` override ใน test เดิม 5 ไฟล์ที่ override `tokenStoreProvider` อยู่แล้ว
   (`login_form_test.dart`, `widget_test.dart`, `task_detail_page_test.dart`, `home_page_test.dart`
   ×2 จุด, `notification_list_page_test.dart`) — ไม่งั้น `login()`/`logout()` ใหม่ไปชน platform channel
   จริงตอนรัน test แล้ว timeout/fail
4. `flutter test` **ทั้งชุดผ่านหมด 112 tests** (จาก 104 เดิม — เพิ่มสุทธิ 8 test: 5 จาก
   `auth_controller_test.dart` ใหม่ + 3 จาก `api_client_test.dart`/`task_detail_page_test.dart`)
5. ยืนยันซ้ำบน Android Emulator จริงทั้ง 2 บั๊ก (login → background → force-stop → เปิดใหม่ สำหรับบั๊ก
   #1; login → ปิด backend → เปิด task detail สำหรับบั๊ก #2) — screenshot ส่งให้ผู้ใช้แล้วทั้งคู่
6. สร้าง branch ใหม่ `fix/session-restore-and-raw-error-message` จาก `origin/main` (ไม่ใช่ต่อจาก
   `feat/notification-device-tokens` ที่ทำงานอยู่ตอนแรก เพราะเป็นคนละเรื่องกัน ไม่อยากพ่วง commit ของ
   feature อื่นที่ยังไม่ merge เข้ามาใน PR ของบั๊กนี้) — commit `91abfad` ไว้ใน local เท่านั้น
   **ไม่ได้ push/merge** ตามที่สั่งไว้ ให้ผู้ใช้ตัดสินใจเปิด PR เอง (`git push -u origin
   fix/session-restore-and-raw-error-message` แล้วเปิด PR ได้เลยถ้าตกลงใจ)

**เช็คลิสต์หัวข้อ 7:** ผ่านครบ 6/6 ข้อจริง ไม่มีบั๊กค้างที่รู้แล้วเหลืออยู่
