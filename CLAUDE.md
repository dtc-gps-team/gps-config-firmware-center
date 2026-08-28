# CLAUDE.md — GPS Config & Firmware Center

กฎและบริบทของโปรเจกต์สำหรับ Claude Code (ทั้งของ A และ B) — อ่านก่อนเริ่มงานทุกครั้ง
เนื้อหาในไฟล์นี้ **override** พฤติกรรม default ของ Claude Code

## Repo Overview

Monorepo 3 โปรเจกต์อิสระ สื่อสารกันผ่าน Backend REST API เท่านั้น (`/api/v1/...`) —
ห้าม import โค้ดข้ามโปรเจกต์:

| โฟลเดอร์ | stack |
|---|---|
| `web/` | Next.js + shadcn/ui |
| `backend/` | NestJS + Prisma + PostgreSQL |
| `mobile/` | Flutter |

เอกสารหลัก: `01_GPS_Build_Reference.md`, `02_GPS_Development_Plan.md`,
`03_GPS_Detailed_Build_Steps.md`, `00_Sprint0_Setup_Guide.md` (ที่ root),
`docs/api/openapi.yaml`, `docs/architecture/RBAC_Matrix.md`

## Git / Commit Convention

- **ห้ามเติม `🤖 Generated with Claude Code` หรือ `Co-Authored-By: Claude`** ต่อท้าย
  commit message หรือ PR description
- **ห้าม push ตรงเข้า `main` เด็ดขาด** — ทุกการเปลี่ยนแปลงต้องผ่าน branch + PR
  (branch protection บล็อกอยู่แล้ว)
- ทุก PR ต้องมี **approving review จากคนอื่น** (ไม่ใช่ author เอง) ก่อน merge เสมอ
- รอ **CI เขียวครบทุก check** (Backend / Web / Mobile lint-and-test) ก่อน merge เสมอ
- ใช้ **squash merge** เป็นค่าเริ่มต้น + ลบ branch หลัง merge (`--squash --delete-branch`)
- ก่อนเปิด PR ให้ `git pull` main ล่าสุดมาก่อนเสมอ (branch protection ตั้ง strict —
  ต้อง up-to-date กับ main ถึงจะ merge ได้)

## Role Enum (ห้ามผิดพลาดซ้ำ)

- Role มีแค่ **6 ค่าเท่านั้น**: `SW`, `Operation`, `ST`, `OT`, `Auditor`, `Admin`
- **ห้ามมี `FieldTechnician` เด็ดขาด** — role นี้ไม่เคยมีอยู่จริง เคยถูกใส่ผิดพลาดใน
  ดราฟต์ก่อนหน้าแล้วถูกแก้ออกทั้งหมด (อ้างอิง PR #11, #13, #15) ช่างหน้างานที่ใช้
  Mobile คือ `ST` / `OT` ที่ login เข้าแอป ไม่ใช่ role แยก
- Source of truth: `GPS_Data_Dictionary.xlsx` (ROLE table) และ `docs/api/openapi.yaml`
  (`LoginResponse.role`) — Prisma: `enum Role` ใน `backend/prisma/schema.prisma`

## Config Status Enum

- เป็น **single-stage เท่านั้น**: `draft`, `testing`, `approved`, `rejected`, `synced`
- **ไม่ใช่ 2-stage** — ไม่มี `sw_approved` / `operation_approved`
- มีเฉพาะ **Operation** เท่านั้นที่อนุมัติ Config / Firmware / Campaign ได้
  SW สร้าง/แก้ไข/รัน simulation ได้ แต่อนุมัติงานตัวเองไม่ได้ (Separation of Duty)

## Team Ownership

- **A (`paveekornkwork-dev`)** — Web (Next.js) + backend module: `auth`, `config`,
  `firmware`, `campaign`, `incident`, `audit`, `device-status`
- **B (`kittiphongkubkub`)** — Mobile (Flutter) + backend module: `task`, `notification`
- **ร่วมกัน** — `config-sync-writer`, Infra / CI-CD, cross-cutting features

## Shared Prisma Schema

- `backend/prisma/schema.prisma` เป็นไฟล์ร่วมของทั้งทีม
- **ก่อนแก้ไฟล์นี้ต้อง `git pull origin main` ก่อนเสมอ** กันชนกับ model ที่อีกฝ่ายเพิ่งเพิ่ม
- ถ้า merge ทีหลังแล้วเจอ conflict ในไฟล์นี้ → **เป็นคน resolve เอง** ไม่ปล่อยให้อีกฝ่าย
- migration ใหม่ต้องเป็น additive และไม่แก้/ลบ migration เดิมของคนอื่นใน
  `backend/prisma/migrations/`

## Auth Pattern

- ใช้ `JwtAuthGuard` ที่ `backend/src/common/guards/jwt-auth.guard.ts` สำหรับทุก
  endpoint ที่ต้อง authenticate (`@nestjs/jwt` + `JWT_SECRET` env var, `@UseGuards(JwtAuthGuard)`)
- ดึง user id จาก JWT payload (`req.user.sub`) เท่านั้น
- **ห้ามคิด pattern auth ใหม่เอง** เช่น `@Headers('x-user-id')` หรือรับ userId จาก
  client โดยตรง — ไม่ปลอดภัย
- Guard นี้จะถูกย้ายเข้า auth module ของ A ในอนาคต แต่ตอนนี้ใช้ที่ `common/guards/` ไปก่อน

## IDOR Prevention Pattern

- Resource ที่ผูกกับ user (notification, task, ฯลฯ) ต้อง filter ด้วย `userId` ทุกครั้ง
  ตอน update / delete
- ใช้ `prisma.model.updateMany({ where: { id, userId } })` แล้วเช็ค `result.count === 0`
  → ถ้าเป็น 0 ให้ `throw new NotFoundException()` (404)
- **ห้ามใช้ `update()` เปล่าๆ ที่ filter แค่ `id`** — user คนอื่นแก้ข้อมูลคนอื่นได้ (IDOR)
  และถ้า record ไม่เจอจะ throw Prisma `P2025` กลายเป็น 500 แทนที่จะเป็น 404
- GET รายการก็ต้อง scope ด้วย userId เช่นกัน (เช่น `findMany({ where: { userId } })`)

## API Contract

- `docs/api/openapi.yaml` คือ **single source of truth** ของ API ทั้ง Web และ Mobile
- Endpoint ใหม่ทุกตัวต้องอัปเดต `openapi.yaml` คู่กันเสมอ: `operationId`, `tag`,
  `security` (`bearerAuth` inherit global; `security: []` เฉพาะ public เช่น `/auth/login`),
  response `4xx` ให้ครบ (400 validation, 401, 404 ตามที่มี)
- รัน `npx @redocly/cli lint docs/api/openapi.yaml` ก่อน commit ทุกครั้งที่แก้ไฟล์นี้
  (ต้องไม่มี error ใหม่ — warning ของเดิมยอมได้)
- โค้ด client (Mobile models, Web types) ต้อง type ตรงกับ schema ใน spec เป๊ะ

## Mock Mode Pattern

ฟีเจอร์ที่ยังไม่พร้อมต่อระบบจริง ให้ทำ mock mode ผ่าน env var ตาม **convention เดิม
ที่มีอยู่แล้ว — ห้ามคิด pattern ใหม่**:

| Env var | ค่า | ใช้กับ |
|---|---|---|
| `LEGACY_SYNC_MODE` | `mock` \| `docker` \| `production` | `config-sync-writer` (ดู Build Reference §4.1) |
| `NOTIFICATION_MODE` | `mock` (default) \| `fcm` | `notification` module |
| `DEVICE_SIMULATOR_MODE` | `mock` \| `real` | config/firmware simulation |
| `API_MOCK_MODE` | `true` \| `false` | Mobile (ผ่าน `--dart-define=API_MOCK_MODE=true`) |

default ต้องเป็น mock เสมอ — โหมดที่ยิงระบบจริงต้องตั้ง env var ชัดเจนถึงจะทำงาน
