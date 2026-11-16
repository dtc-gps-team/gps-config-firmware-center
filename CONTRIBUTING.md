# กฎการพัฒนา

กฎที่ทีมเดิมใช้และ CI / branch protection บังคับอยู่ — ที่มาของแต่ละข้อมีใน `CLAUDE.md` และเอกสารที่อ้างถึง
(`CLAUDE.md` คือฉบับเต็มสำหรับคนที่ใช้ Claude Code)

## 1. Git / Pull Request

- **ห้าม push เข้า `main` ตรง** — ทุกการเปลี่ยนแปลงผ่าน branch + PR (branch protection บล็อกอยู่)
- PR ต้องมี **approve จากคนอื่น** (ไม่ใช่ผู้เปิด PR) และ **CI เขียวครบ** (Backend / Web / Mobile `lint-and-test`) ก่อน merge
- merge แบบ **squash** แล้วลบ branch (`gh pr merge <n> --squash --delete-branch`)
- branch ต้องตามทัน `main` (protection แบบ strict) — sync ผ่าน CLI เท่านั้น:
  `git fetch origin && git merge origin/main` รันเทสซ้ำ แล้ว push · **ไม่กดปุ่ม "Update branch" บน GitHub**
- ต้อง resolve ทุก conversation ใน PR ก่อน merge
- ข้อความภาษาไทยใน commit / PR: ส่งผ่านไฟล์ (`-F` / `--body-file`) — Git Bash บน Windows แปลงไทยในอาร์กิวเมนต์เป็น `?`

## 2. โครงสร้าง repo

| โฟลเดอร์ | stack | หมายเหตุ |
|---|---|---|
| `backend/` | NestJS + Prisma + PostgreSQL | |
| `web/` | Next.js + shadcn/ui | |
| `mobile/` | Flutter | |
| `arduino_gps/` | Node.js + ESP32 | Server กลาง + firmware — ไม่ใช้ DB ร่วม |

**ห้าม import โค้ดข้ามโปรเจกต์** — web / mobile คุยกับ backend ผ่าน REST `/api/v1/...` เท่านั้น backend คุยกับ Server กลางผ่าน HTTP

## 3. ข้อกำหนด API (`docs/api/openapi.yaml`)

- `openapi.yaml` คือ **ข้อกำหนดหลัก (single source of truth)** ของ API ทั้งเว็บและมือถือ
- endpoint ใหม่ทุกตัวอัปเดต spec คู่กันเสมอ: `operationId`, `tags`, `security` (`bearerAuth` เป็นค่าเริ่มต้น · `security: []` เฉพาะ public เช่น `/auth/login`), response 4xx ครบ (400 / 401 / 403 / 404 ตามที่มี)
- ก่อน commit: `npx @redocly/cli lint docs/api/openapi.yaml` ต้องไม่มี error ใหม่
- type ฝั่ง client (model ของมือถือ, type ของเว็บ) ต้องตรงกับ schema ใน spec

## 4. Auth / สิทธิ์

- endpoint ที่ต้อง login ใช้ `JwtAuthGuard` (`backend/src/common/guards/jwt-auth.guard.ts`) และ `PermissionGuard` ตามตาราง RBAC
- user id มาจาก JWT (`req.user.sub`) **เท่านั้น** — ห้ามรับ userId จาก client (`@Headers('x-user-id')` ฯลฯ)
- **กัน IDOR:** resource ที่ผูกกับ user (notification, task ฯลฯ) filter ด้วย `userId` ทุกครั้ง — update/delete ใช้
  `updateMany({ where: { id, userId } })` แล้ว `count === 0` → `NotFoundException` (404) · ห้าม `update()` ที่ filter แค่ `id`
  (คนอื่นแก้ได้ และไม่เจอ record กลายเป็น 500 แทน 404) · GET รายการก็ scope ด้วย userId
- สิทธิ์ของแต่ละบทบาท: `docs/architecture/RBAC_Matrix.md` · เพิ่มบทบาท/สิทธิ์ = แก้ `backend/prisma/seed.ts` (ไม่ต้อง migration)

### บทบาท (Role) — มี 9 ค่าเท่านั้น

`ConfigEngineer`, `FirmwareEngineer`, `QAEngineer`, `Operation`, `ST`, `OT`, `Auditor`, `Admin`, `SuperAdmin`

- ไม่มี `SW` แล้ว (แยกเป็น 3 บทบาทแรกตาม docs/13) · **ไม่มี `FieldTechnician`** — ช่างคือ `ST` / `OT`
- `SuperAdmin` ทำได้ทุกอย่างและ **ข้าม Separation of Duty ได้** (อนุมัติงานตัวเองได้) — bypass อยู่ที่จุดกลาง
  (`PermissionGuard`, `assertDecider()`, `assertDecidable()`) ของใหม่ได้อัตโนมัติ · ต้องมี SuperAdmin ที่ active อย่างน้อย 1 คนเสมอ
- Separation of Duty: คนสร้าง Config/Firmware/Campaign อนุมัติงานตัวเองไม่ได้ (ยกเว้น SuperAdmin)

### สถานะ Config — ขั้นเดียว

มี 5 ค่า: `draft`, `testing`, `approved`, `rejected`, `synced` · **ไม่มี** 2 ขั้น (`sw_approved` / `operation_approved`)
`Operation` (และ `SuperAdmin`) อนุมัติ Config / Firmware / Campaign

## 5. ฐานข้อมูล (`backend/prisma/schema.prisma`)

- ไฟล์ schema ใช้ร่วมกันทั้งทีม — **`git pull origin main` ก่อนแก้ทุกครั้ง** · merge แล้ว conflict ในไฟล์นี้ คนที่ merge ทีหลังเป็นคน resolve
- migration ใหม่ต้อง **เพิ่มอย่างเดียว (additive)** ห้ามแก้/ลบ migration เดิมใน `prisma/migrations/`
- migration ที่เพิ่ม FK บนตารางที่มีข้อมูล: เช็คข้อมูลกำพร้าก่อน · ถ้าจะ fail **หยุดและรายงาน ห้าม reset ฐาน**
- ห้ามรัน `npx prisma format`
- **`docs/database/GPS_Data_Dictionary.xlsx` คือต้นฉบับของ data model** — ถ้าตั้งใจให้ต่างจากนั้น ต้องมี comment อธิบายเหตุผล
  เหนือ model/field และบันทึกในเอกสารที่เกี่ยวข้อง ห้ามต่างแบบเงียบๆ

## 6. Audit Log

- `AuditLog` บันทึก **เฉพาะการเปลี่ยนข้อมูล** (สร้าง / แก้ / อนุมัติ / ปฏิเสธ / ส่ง Config / Override) และทุก action ของ `SuperAdmin`
- การดูอย่างเดียว (เปิดหน้า, ค้นหา) **ไม่บันทึก**
- ปัญหาที่รู้: หลายโมดูลยังเขียนนอกทรานแซกชัน — KNOWN_ISSUES §3.2

## 7. โหมด mock

ฟีเจอร์ที่ต่อระบบภายนอกต้องมีโหมด mock ผ่าน env var — **ค่าเริ่มต้นเป็น mock เสมอ** ใช้ convention เดิม ห้ามคิดแบบใหม่

| env | ค่า | ใช้กับ |
|---|---|---|
| `LEGACY_SYNC_MODE` | `mock` \| `docker` \| `production` | `config-sync-writer` |
| `NOTIFICATION_MODE` | `mock` \| `fcm` | `notification` |
| `DEVICE_SIMULATOR_MODE` / `FIRMWARE_SIMULATOR_MODE` / `DEVICE_CONNECTION_TEST_MODE` | `mock` \| `real` | จำลอง / ทดสอบสัญญาณ |
| `DEVICE_CONFIG_APPLY_MODE` | `mock` \| `real` \| `central` | ส่ง Config/Firmware เข้ากล่อง |
| `CENTRAL_MODE` | `mock` \| `real` | อ่านสถานะจาก Server กลาง |
| `API_MOCK_MODE` (มือถือ, `--dart-define`) | `true` \| `false` | ข้อมูลจำลองในแอป |

guard ที่ไม่ยอมให้ backend เริ่มเมื่อค่าเสี่ยง (`JWT_SECRET`, `FCM_ALLOW_NON_DEV_PROJECT`, `TRUST_PROXY`, บัญชีทดสอบ): [OPERATIONS.md §1](docs/deploy/OPERATIONS.md)

## 8. ก่อนเริ่มงานแต่ละวัน

```bash
docker compose ps            # postgres / redis / minio ต้องรันอยู่ (ไม่รัน: docker compose up -d)
git pull origin main
git status                   # ไม่มีงานค้างที่ลืม commit
```

เทสที่ CI รัน: ดูตาราง "เทส" ใน [README หลัก](README.md#เทส)
