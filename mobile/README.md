# mobile — แอปช่างหน้างาน (Flutter, Android)

แอปสำหรับช่าง ST / OT (Operation login ดูได้) · Flutter 3.47.x (CI ใช้ 3.47.9) · Riverpod + go_router + Drift (SQLite)
คุยกับ backend ผ่าน REST เท่านั้น — model ต้องตรงกับ [`docs/api/openapi.yaml`](../docs/api/openapi.yaml)

## รันครั้งแรก

```bash
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # สร้าง *.g.dart ของ Drift (ไม่ได้ commit)
```

**ต้องมี `google-services.json` ก่อน build Android** (ปลั๊กอิน Google Services บังคับ — ไฟล์จริงไม่อยู่ใน repo):

| flavor | ไฟล์ | Firebase project |
|---|---|---|
| `dev` (`com.example.mobile.dev`) | `android/app/src/dev/google-services.json` | `gps-config-firmware-center-dev` |
| `prod` (`com.example.mobile`, ค่าเริ่มต้นเมื่อไม่ใส่ `--flavor`) | `android/app/google-services.json` | `gps-config-firmware-center` |

**ไม่มีไฟล์จริง:** คัดลอก JSON ในขั้น "google-services.json placeholder" ของ `.github/workflows/mobile-integration-test.yml`
ไปไว้ที่ `android/app/google-services.json` แล้ว **build แบบไม่ใส่ `--flavor`** (ได้ `prod`) พร้อม
`--dart-define=PUSH_NOTIFICATIONS_ENABLED=false` — แอปใช้ได้ปกติแค่ไม่มี push · stub นี้มีแค่ package `com.example.mobile`
ใช้กับ `--flavor dev` ไม่ได้ (Gradle ฟ้อง `No matching client found for package name 'com.example.mobile.dev'`)

```bash
# ข้อมูลจำลองในแอป (ไม่ต้องมี backend)
flutter run --flavor dev

# ต่อ backend จริง — emulator บนเครื่องเดียวกันใช้ 10.0.2.2 · มือถือจริงใช้ IP ของเครื่อง backend (Wi-Fi เดียวกัน)
flutter run --flavor dev --dart-define=API_MOCK_MODE=false --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1

# ใช้ stub (ไม่มีไฟล์ Firebase จริง)
flutter run --dart-define=PUSH_NOTIFICATIONS_ENABLED=false --dart-define=API_MOCK_MODE=false --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
```

emulator บางเครื่องจอดำ/ค้าง: เพิ่ม `--no-enable-impeller` · ใช้มือถือในวง LAN: [OPERATIONS.md §4](../docs/deploy/OPERATIONS.md)

## `--dart-define`

| ค่า | ค่าเริ่มต้น | ทำอะไร |
|---|---|---|
| `API_MOCK_MODE` | `true` | `true` = ข้อมูลจำลองในหน่วยความจำ · `false` = เรียก backend จริง |
| `API_BASE_URL` | `http://localhost:3001/api/v1` | ที่อยู่ backend |
| `PUSH_NOTIFICATIONS_ENABLED` | `true` | ปิดเมื่อไม่มี Firebase จริง (CI, emulator ไม่มี Google Play) |
| `TASK_TIMELINE_ENABLED` | `false` | การ์ดประวัติงานใน Task Detail (backend พร้อมแล้ว ปิดไว้ในแอป) |

ทั้งหมดอยู่ใน `lib/core/config/app_config.dart`

## โครงสร้าง (`lib/`)

| ที่ | อะไร |
|---|---|
| `core/api/` | `ApiClient` (dio) + model ตาม openapi |
| `core/auth/` | login, เก็บ session, บทบาท |
| `core/db/`, `core/sync/` | Drift + คิวงานออฟไลน์ (ทำงานไม่มีเน็ตได้ ซิงค์ทีหลัง — badge "รอซิงค์") |
| `core/router/` | go_router + แท็บตามบทบาท |
| `core/theme/`, `core/ui/`, `core/widgets/` | design token ชุด r4 (docs/22, docs/29) + component ร่วม |
| `features/home`, `task` | หน้าแรก, งาน, ขอส่ง Config/Firmware เข้ากล่อง, ความคืบหน้าการส่ง |
| `features/device_search` | ค้นหา/รายละเอียดอุปกรณ์ |
| `features/config_override`, `firmware_override`, `firmware_install` | ขอแก้ค่าเฉพาะเครื่อง, ยืนยันติดตั้ง Firmware |
| `features/incident` | รายงาน/ดู Incident |
| `features/notification`, `push_notification` | รายการแจ้งเตือน + push FCM (docs/05) |

แต่ละ feature มี repository แบบ `Api...` (จริง) และ `Mock...` (สำหรับ `API_MOCK_MODE=true`)

## เทส

```bash
dart format --output=none --set-exit-if-changed .   # CI ตรวจ — ใช้ Flutter 3.47.x ให้ตรง CI ไม่งั้นผลต่างกัน
flutter analyze
flutter test
flutter test --dart-define=API_MOCK_MODE=false       # CI รันทั้งสองโหมด
```

E2E บน emulator (`integration_test/`): CI รันทุกคืน (`mobile-integration-test.yml`, ไม่ใช่ required check) ต่อ backend จริง
รันเองดู [docs/testing/Mobile_Setup_Run_Test_Guide.md](../docs/testing/Mobile_Setup_Run_Test_Guide.md)

## ข้อจำกัด

- Android เท่านั้น — ยังไม่มี iOS (KNOWN_ISSUES §4.1)
- `applicationId` ยังเป็น `com.example.mobile` — เปลี่ยนก่อนขึ้น Play Store (ต้องสร้างแอปใน Firebase ใหม่ให้ตรง)
- release build ยังใช้ debug signing (`TODO` ใน `android/app/build.gradle.kts`)
