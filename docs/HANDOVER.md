# เอกสารส่งมอบ — GPS Config & Firmware Center

ส่งมอบให้ทีมพัฒนาที่รับช่วงต่อ · สถานะ ณ **18 พฤศจิกายน 2569** · ทีมเดิม 2 คน (A, B) ช่วงสหกิจศึกษา

อ่านเอกสารนี้ก่อน แล้วตามลำดับใน [ลำดับการอ่าน](#9-ลำดับการอ่าน)

---

## 1. ระบบนี้คืออะไร

ระบบกลางสำหรับจัดการ **Config** (ค่าตั้งของกล่อง) และ **Firmware** ของกล่อง GPS ตั้งแต่สร้าง → อนุมัติ → ส่งเข้ากล่อง
จริง → ติดตามผล โดยมีแอปมือถือให้ช่างหน้างาน (ST / OT) ทำงานกับกล่องที่ติดตั้งในรถ

| ส่วน | โฟลเดอร์ | เทคโนโลยี | ผู้ใช้ |
|---|---|---|---|
| Backend (REST API `/api/v1`) | [`backend/`](../backend/README.md) | NestJS 11 + Prisma 6 + PostgreSQL 16 + MinIO | ทุกส่วน |
| เว็บ | [`web/`](../web/README.md) | Next.js 16 + React 19 + shadcn/ui | เจ้าหน้าที่ทุกบทบาท |
| แอปมือถือ | [`mobile/`](../mobile/README.md) | Flutter 3.47 (Android) | ช่างหน้างาน ST / OT (Operation ดูได้) |
| Server กลาง + firmware | [`arduino_gps/`](../arduino_gps/README.md) | Node.js + ESP32 (Arduino) | backend เรียกผ่าน HTTP |

ภาพรวมการเชื่อมต่อและวิธีรันอยู่ใน [README หลัก](../README.md)

## 2. สิ่งที่ทำเสร็จแล้ว

| หมวด | ทำได้แล้ว | เอกสาร |
|---|---|---|
| ผู้ใช้และสิทธิ์ | login (JWT), 9 บทบาท, ตาราง RBAC ในฐานข้อมูล, SuperAdmin ข้าม Separation of Duty ได้, จัดการผู้ใช้ | `docs/architecture/RBAC_Matrix.md`, docs/11, docs/13 |
| Parameter / Config | คลัง Parameter, สร้าง/แก้/โคลน/นำเข้า-ส่งออก JSON, ผูกรุ่นอุปกรณ์ (`modelId`), จำลองก่อนอนุมัติ, อนุมัติขั้นเดียว, ขอลบ (SuperAdmin อนุมัติ) | docs/04, docs/11, docs/15, [Config_Flow_Summary](Config_Flow_Summary.md) |
| Firmware | อัปโหลดเข้า MinIO, รุ่นที่รองรับ, QA อนุมัติ/ปฏิเสธคุณภาพ, จำลอง | docs/13 |
| อุปกรณ์ | ทะเบียนกล่อง/รุ่น/ลูกค้า, ค้นหา, ปลดระวาง, รับ telemetry GPS จากกล่อง, อ่านสถานะจาก Server กลาง | docs/14, docs/15, docs/23 |
| Campaign / Rollout | กลุ่มอุปกรณ์ (ผูกรุ่นเดียว), ปล่อย Config/Firmware ทีละกลุ่ม, อนุมัติ → ปล่อย, ค่าเฉพาะเครื่อง, timeout, ลองส่งใหม่อัตโนมัติ, สร้าง Incident อัตโนมัติเมื่อล้ม | docs/12, docs/17, docs/19, docs/31 |
| งานหน้างาน | มอบหมายงาน, ช่างเริ่มงานเองจากหน้ากล่อง, ประวัติงานแบบ timeline, ขอส่ง Config/Firmware เข้ากล่องจากมือถือ → Operation อนุมัติ → ช่างกดส่ง, ขอแก้ค่าเฉพาะเครื่อง (ใช้ครั้งเดียว) | docs/16, docs/25, docs/27, docs/28, docs/30 |
| Incident | ช่างรายงานปัญหา, Operation ตัดสิน/ส่งต่อเป็น Campaign | issue #236 |
| แจ้งเตือน | ในแอป/เว็บ + push จริงผ่าน FCM (Android) | docs/05 |
| Audit | บันทึกทุกการเปลี่ยนข้อมูล (ไม่บันทึกการดูอย่างเดียว), หน้า Audit Log | CLAUDE.md §Audit Pattern |
| เว็บ | Dashboard, Approval Center, หน้าจัดการทุกหมวดข้างบน | — |
| มือถือ | ดีไซน์ r4 (แท็บตามบทบาท), ทำงานออฟไลน์แล้วซิงค์ทีหลัง, push + deep link | docs/22, docs/29 |
| ทดสอบ | unit + integration (backend), vitest (เว็บ), widget/flow test (มือถือ), E2E มือถือบน emulator ทุกคืน, ทดสอบโหลด k6 | docs/32, `docs/testing/` |

**ทดสอบกับกล่องจริงแล้ว** (ESP32 1 กล่อง `BOX-0001` ผ่าน Server กลางในวง LAN): ส่ง telemetry เข้า backend ต่อเนื่อง,
ส่ง Config และอัปเดต Firmware ผ่าน OTA จากแอปมือถือ → อนุมัติ → ส่งสำเร็จ, ลองส่งใหม่อัตโนมัติเมื่อล้ม
**ยังไม่เคยขึ้น server จริง** และยังไม่เคยใช้กับกล่องหลายตัวพร้อมกัน

## 3. ส่วนที่ต่อของจริง / ยังเป็น mock

ทุกโหมดเริ่มต้นเป็น mock เสมอ (รันได้โดยไม่ต้องต่ออะไร) — ต้องตั้ง env ชัดเจนถึงจะยิงของจริง

| env | ค่าเริ่มต้น | ของจริงที่ใช้ได้แล้ว | หมายเหตุ |
|---|---|---|---|
| `CENTRAL_MODE` | `mock` | `real` — อ่านสถานะกล่องจาก Server กลาง | ต้องตั้ง `CENTRAL_BASE_URL` + บัญชี admin ของ delivery-server |
| `DEVICE_CONFIG_APPLY_MODE` | `mock` | `central` — ส่ง Config/Firmware เข้ากล่องผ่าน Server กลาง | ใช้คู่กับ `CENTRAL_MODE=real` |
| `NOTIFICATION_MODE` | `mock` | `fcm` — ทดสอบกับ Firebase project dev แล้ว | production ต้องตั้ง `FCM_ALLOW_NON_DEV_PROJECT=true` |
| `LEGACY_SYNC_MODE` | `mock` | — | **ห้ามตั้ง `production`** จนกว่าจะตกลงกับเจ้าของระบบเดิม (docs/07) |
| `DEVICE_SIMULATOR_MODE`, `FIRMWARE_SIMULATOR_MODE`, `DEVICE_CONNECTION_TEST_MODE` | `mock` | — | โหมด `real` ยังไม่มี (throw ตอน startup) |
| แอปมือถือ `API_MOCK_MODE` | `true` | `false` + `API_BASE_URL` | ดู `mobile/README.md` |

ค่า env ทั้งหมดและที่ต้องตั้งบน production: [deploy/OPERATIONS.md](deploy/OPERATIONS.md)

## 4. บัญชีทดสอบ

seed สร้างบัญชีทดสอบครบทุกบทบาท (11 บัญชี ลงท้าย `.test`) — **ไม่มีรหัสในเอกสารนี้** ตอนพัฒนาในเครื่องใช้รหัสตั้งต้นใน
`backend/src/common/test-users.ts` ถ้าเปิดสู่ภายนอกต้องเปลี่ยนด้วย `npm run test-users:set-password` (backend ไม่ยอมเริ่มถ้ายังใช้รหัสตั้งต้น)

| บทบาท | บัญชี | ใช้ที่ |
|---|---|---|
| SuperAdmin | `superadmin.test` | เว็บ |
| Admin | `admin.test` | เว็บ |
| ConfigEngineer | `config.test` | เว็บ |
| FirmwareEngineer | `firmware.test` | เว็บ |
| QAEngineer | `qa.test` | เว็บ |
| Operation | `operation.test`, `operation2.test`, `operation3.test` | เว็บ + มือถือ (ดู) |
| ST / OT (ช่าง) | `st.test`, `ot.test` | มือถือ |
| Auditor | `auditor.test` | เว็บ (ดูอย่างเดียว) |

## 5. สิ่งที่ส่งมอบนอก repo

repo นี้เป็น **public** — ค่าลับทั้งหมดอยู่นอก repo และส่งให้ผู้รับผิดชอบโดยตรงทางช่องทางที่ปลอดภัย
(**ไม่ส่งผ่าน repo, issue, PR หรือแชทกลุ่ม**) แล้ว **เปลี่ยนค่าใหม่หลังรับมอบ**

| รายการ | อยู่ที่ (เครื่องทีมเดิม) | ใช้ทำอะไร | ถ้าไม่ได้รับ |
|---|---|---|---|
| private key เซ็น firmware | `arduino_gps/delivery-server/keys/` | เซ็น firmware ให้กล่องยอมรับ | build firmware ให้กล่องที่ติดตั้งแล้วไม่ได้ — สร้างกุญแจใหม่ต้องแฟลช USB ใหม่ทุกกล่อง |
| Firebase service account (dev) + `google-services.json` (dev/prod) | `secrets/`, `mobile/android/app/` | push / build แอป | สร้างใหม่จาก Firebase Console ได้ ถ้าได้สิทธิ์ project |
| สิทธิ์ Firebase project (`gps-config-firmware-center-dev`, `gps-config-firmware-center`) | Firebase Console | — | ขอโอนสิทธิ์ Owner |
| `.env` ของ backend และ Server กลาง | root, `arduino_gps/*/` | — | สร้างจาก `.env.example` ได้ (ค่าลับต้องสุ่มใหม่อยู่แล้ว) |
| dump ฐานข้อมูลทดสอบ | — | ข้อมูลตัวอย่างที่ใช้เดโม | ใช้ `npm run seed:demo` แทนได้ |

ค่าที่ทีมเดิมใช้ตอนพัฒนา/เดโมถือว่ารั่วแล้วทั้งหมด (บางค่าอยู่ใน repo public เป็นค่าตัวอย่าง) ต้องเปลี่ยนก่อนใช้จริง:
`JWT_SECRET`, รหัสบัญชี `*.test`, `ADMIN_TOKEN` / `ADMIN_PASSWORD` / `AUTO_REGISTER_TOKEN` ของ Server กลาง,
key ส่ง telemetry ของกล่อง (`TELEMETRY_INGEST_KEY_SHA256` และ key ต่อเครื่อง), รหัส WiFi โหมดตั้งค่าของกล่อง

## 6. เรื่องที่รอตัดสินใจ

| เรื่อง | ทำไมสำคัญ | ผู้ตัดสิน |
|---|---|---|
| repo ย้ายไป GitHub ของบริษัท หรือเชิญทีมเข้า org `dtc-gps-team` | สิทธิ์ admin, branch protection, secrets ของ CI | พี่เลี้ยง |
| ซิมของกล่องจริงออก IP ร่วมกันหรือไม่ (CGNAT) | เพดาน 300 คำขอ/นาที/IP ตัดข้อมูลทิ้งเมื่อเกิน 50 กล่องต่อ IP (docs/32 §3.2) | พี่เลี้ยง + ผู้ให้บริการซิม |
| ใช้ Server กลาง (`arduino_gps`) บน production หรือเชื่อมระบบเดิมของบริษัท (`LEGACY_SYNC_MODE`) | กำหนดว่าจะพัฒนาเส้นทางส่งเข้ากล่องทางไหนต่อ | ทีมใหม่ + พี่เลี้ยง |
| รองรับ iOS | push และ build iOS ยังไม่ได้ทำ (docs/05) | ทีมใหม่ |
| spec server จริง | ผลทดสอบโหลดรอบแรกเป็นค่าต่ำสุดจากโน้ตบุ๊ก (docs/32 §8.2) | ทีมใหม่ |

## 7. งานที่ควรทำต่อ (เรียงตามความสำคัญ)

1. **แก้ job ลบ telemetry เก่า** — ลบได้ 50,000 แถว/ชม. แต่ข้อมูลเข้า ~108,000 แถว/ชม. ที่ 300 กล่อง ฐานจะโตไม่หยุด (docs/32 §8.1)
2. **ตัดสินเรื่องเพดานต่อ IP** ตามผลข้อ 6
3. **แบ่งหน้า `GET /devices`** (backend + เว็บ + มือถือ) — ช้ากว่าหน้าอื่น ~10 เท่าเมื่อมีหลายพันเครื่อง
4. **รัน backend หลาย instance** หรือแยกตัวรับ telemetry — process เดียวรับไม่ทันที่ ~800 คำขอ/วิ
5. **เปลี่ยนค่าลับทั้งหมดในข้อ 5** และตั้งค่า production ตาม [OPERATIONS.md](deploy/OPERATIONS.md)
6. รันทดสอบโหลดซ้ำบน server จริง (`backend/test/load/README.md`)

รายการปัญหาที่รู้แล้วทั้งหมดและ issue ที่ยังเปิด: [KNOWN_ISSUES.md](KNOWN_ISSUES.md)

## 8. ทีมเดิมดูแลส่วนไหน

ใช้ดูว่าควรถามใครหรือดูประวัติ PR ของใคร (รายละเอียดใน `CLAUDE.md` §Team Ownership)

| คน | GitHub | ส่วนที่ดูแล |
|---|---|---|
| A | `paveekornkwork-dev` | เว็บทั้งหมด + backend: `auth`, `user`, `config`, `config-definition`, `config-deletion`, `firmware`, `campaign`, `incident`, `audit`, `device`, `device-model`, `customer` |
| B | `kittiphongkubkub` | มือถือทั้งหมด + backend: `task`, `notification`, `config-apply-request`, `device-sync` (telemetry), `central-device` · Server กลาง / firmware (`arduino_gps`) · ทดสอบโหลด |
| ร่วมกัน | — | `config-sync-writer`, CI/CD, docker compose, schema ฐานข้อมูล (`schema.prisma`) |

แบ่งตามจำนวน commit จริงในแต่ละโมดูล — หลายโมดูลมีทั้งสองคนแก้

## 9. ลำดับการอ่าน

1. [README หลัก](../README.md) — ติดตั้งและรันให้ได้ก่อน
2. เอกสารนี้
3. [CONTRIBUTING.md](../CONTRIBUTING.md) — กฎของ repo (branch / PR / migration / RBAC / API contract)
4. [Config_Flow_Summary.md](Config_Flow_Summary.md) — flow หลัก Parameter → Config → ส่งเข้ากล่อง
5. [docs/README.md](README.md) — สารบัญเอกสาร พร้อมสถานะว่าฉบับไหนยังใช้อ้างอิงได้
6. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) และ [deploy/OPERATIONS.md](deploy/OPERATIONS.md)
7. `docs/api/openapi.yaml` (ข้อกำหนด API) และ `backend/prisma/schema.prisma` (โครงสร้างข้อมูล)
