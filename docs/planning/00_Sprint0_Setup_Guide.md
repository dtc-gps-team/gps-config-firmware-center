# Sprint 0 — คู่มือ Setup แบบละเอียด (Branch Protection + API Spec) test

**อ้างอิงจาก:** GPS_Project_Structure_Formal.md v3.7, 01_GPS_Build_Reference.md, 03_GPS_Detailed_Build_Steps.md (Phase 0)
**Checkpoint:** 30/08/2026 — เอกสารนี้ลงรายละเอียดทีละขั้นตอนสำหรับ 5 งานของ Sprint 0

**ไฟล์ที่แนบมาพร้อมคู่มือนี้ (ใช้ก๊อปวางได้ทันที):**

- `docker-compose.yml` — PostgreSQL, Redis, MinIO
- `.env.example` — ตัวแปรที่ต้องมีครบตาม Build Reference Section 7
- `.github/workflows/web-ci.yml`, `backend-ci.yml`, `mobile-ci.yml` — GitHub Actions เบื้องต้น
- `openapi/openapi.yaml` — โครง API Spec เริ่มต้น

---

## 1. ตั้งค่า Branch Protection บน `main`

**ทำที่ไหน:** GitHub → เข้า repo ที่สร้างไว้ → แท็บ **Settings** → เมนูซ้าย **Branches**

### ขั้นตอน

1. ที่หัวข้อ "Branch protection rules" กด **Add branch protection rule** (หรือ "Add rule" ถ้าเป็น UI เก่า)
2. ช่อง **Branch name pattern** พิมพ์ `main`
3. ติ๊กเลือกตัวเลือกต่อไปนี้ (สำคัญสำหรับทีม 2 คน):
   - ✅ **Require a pull request before merging** — ห้าม push ตรงเข้า `main` ต้องผ่าน PR เท่านั้น
     - ✅ **Require approvals** — ตั้งเป็น **1** (เพราะมีแค่ 2 คน ให้อีกฝ่ายรีวิวก่อน merge เสมอ — ห้ามตั้งเป็น 2 เพราะจะไม่มีใคร approve ได้ครบ)
     - ✅ **Dismiss stale pull request approvals when new commits are pushed** — ถ้ามีคน push เพิ่มหลัง approve แล้ว ต้องให้ approve ใหม่
   - ✅ **Require status checks to pass before merging** — (ติ๊กได้หลังมี GitHub Actions รันผ่านอย่างน้อย 1 ครั้งแล้ว ถ้ายังไม่มี workflow รันเลยจะยังไม่เห็นตัวเลือกให้ค้นหา CI job — ให้ตั้งค่า GitHub Actions ในข้อ 4 ก่อนแล้วค่อยกลับมาติ๊กข้อนี้)
     - ✅ **Require branches to be up to date before merging**
     - ค้นหาแล้วเลือก job ที่ตั้งชื่อไว้ใน workflow (เช่น `lint-and-test`)
   - ✅ **Require conversation resolution before merging** — บังคับให้ resolve comment ในหน้า PR ก่อน merge (กัน SW/Operation ลืมแก้ตาม comment)
   - ⬜ **Require signed commits** — ไม่จำเป็นสำหรับทีมเล็ก ข้ามได้
   - ✅ **Do not allow bypassing the above settings** — กันไม่ให้ Admin (ตัวเอง) กด merge ข้ามกฎโดยไม่ตั้งใจ
4. กด **Create** (หรือ **Save changes**)

### ทดสอบว่าใช้งานได้จริง

- ลอง `git push origin main` ตรงๆ จากเครื่อง (ไม่ผ่าน PR) → ต้องถูก GitHub ปฏิเสธ พร้อมข้อความ "protected branch"
- สร้าง PR ทดสอบ 1 อัน กด Merge ทันทีโดยยังไม่มีใคร approve → ปุ่ม Merge ต้องเป็นสีเทากดไม่ได้ จนกว่าจะมีคน approve ครบ

---

## 2. สร้างโครงสร้างโฟลเดอร์ (Monorepo)

**อ้างอิงโครงสร้างเต็มจาก:** `01_GPS_Build_Reference.md` Section 2

### ขั้นตอน (รันจาก root ของ repo)

```bash
# 2.1 สร้างโฟลเดอร์หลัก
mkdir -p docs/architecture docs/planning docs/api docs/design docs/sitemap docs/screen-map

# 2.2 สร้างโปรเจกต์ Web (Next.js + TypeScript + Tailwind)
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"

# 2.3 สร้างโปรเจกต์ Backend (NestJS)
npx @nestjs/cli new backend --package-manager npm

# 2.4 สร้างโปรเจกต์ Mobile (Flutter) — ต้องติดตั้ง Flutter SDK ก่อน
flutter create mobile

# 2.5 โฟลเดอร์ log/script เสริม (ตาม Build Reference)
mkdir -p scripts tests infra/mosquitto logs
```

### ผลลัพธ์ที่ควรได้

```
gps-config-firmware-center/
├── web/                    ← package.json ของตัวเอง (Next.js)
├── backend/                ← package.json ของตัวเอง (NestJS)
├── mobile/                 ← pubspec.yaml ของตัวเอง (Flutter)
├── docs/
│   ├── architecture/       ← ย้าย GPS_Project_Structure_Formal.md มาไว้ที่นี่
│   ├── planning/           ← ย้าย 02_GPS_Development_Plan.md, 03_GPS_Detailed_Build_Steps.md มาไว้ที่นี่
│   └── api/                ← เก็บ openapi.yaml
├── docker-compose.yml
├── .env.example
└── .github/workflows/
```

### สิ่งที่ต้องเช็คหลังสร้างเสร็จ

- [ ] `cd web && npm run dev` รันขึ้นที่ `localhost:3000` ได้
- [ ] `cd backend && npm run start:dev` รันขึ้นที่ `localhost:3001` (หรือ port ที่ตั้ง) ได้
- [ ] `cd mobile && flutter run` เปิดแอปบน Emulator ได้
- [ ] แต่ละโฟลเดอร์มี `.gitignore` ของตัวเอง (สร้างมาให้อัตโนมัติจากคำสั่งข้างบนอยู่แล้ว) — เช็คว่า `node_modules/`, `.next/`, `build/` ไม่ถูก commit เข้า git

**⚠️ อย่าลืม:** ถ้าเจอโฟลเดอร์ `device-gateway/` หรือไฟล์ `.github/workflows/device-gateway-ci.yml` ค้างอยู่จาก repo เดิม ให้ลบทิ้งทั้งคู่ — ไม่มี Device Gateway ในสถาปัตยกรรมปัจจุบันแล้ว (ตัดออกตั้งแต่ v1.4)

---

## 3. ตั้ง `docker-compose.yml` (PostgreSQL, Redis, MinIO)

**ไฟล์พร้อมใช้:** ก๊อปไฟล์ `docker-compose.yml` ที่แนบมาไปวางไว้ที่ root ของ repo แล้วก๊อป `.env.example` ไปด้วย

### ขั้นตอน

1. วางไฟล์ `docker-compose.yml` และ `.env.example` ไว้ที่ root ของ repo
2. คัดลอก `.env.example` เป็น `.env` แล้วปรับรหัสผ่านตามต้องการ (ห้าม commit ไฟล์ `.env` จริงเข้า git — เช็คว่ามีบรรทัด `.env` ใน `.gitignore` แล้ว)
3. รันทดสอบ:

```bash
docker-compose up -d
docker-compose ps   # ต้องเห็นทั้ง 3 service เป็น "Up"
```

4. ทดสอบเชื่อมต่อแต่ละตัว:

```bash
# PostgreSQL
docker exec -it gps-postgres psql -U gps_user -d gps_config_firmware -c "\dt"

# Redis
docker exec -it gps-redis redis-cli ping   # ต้องตอบ PONG

# MinIO Console — เปิดเบราว์เซอร์ที่ http://localhost:9001
# Login ด้วย MINIO_ROOT_USER / MINIO_ROOT_PASSWORD จากไฟล์ .env
```

### Checklist

- [ ] `docker-compose up -d` รันขึ้นทั้ง 3 service โดยไม่ error
- [ ] เชื่อม PostgreSQL ผ่าน Prisma ได้ (ทดสอบตอนทำ Prisma schema ใน Phase 0 ข้อถัดไป)
- [ ] เปิด MinIO Console ผ่านเบราว์เซอร์ได้จริง

---

## 4. ตั้ง GitHub Actions เบื้องต้น (lint + test ทุก PR)

**ไฟล์พร้อมใช้:** ก๊อปโฟลเดอร์ `.github/workflows/` ทั้งโฟลเดอร์ (มี 3 ไฟล์: `web-ci.yml`, `backend-ci.yml`, `mobile-ci.yml`) ไปวางไว้ที่ root ของ repo

### ขั้นตอน

1. วางไฟล์ทั้ง 3 ไว้ที่ `.github/workflows/`
2. Commit + Push ขึ้น branch ใดก็ได้ที่ไม่ใช่ `main` แล้วเปิด PR เข้า `main` — GitHub Actions จะรันอัตโนมัติ
3. เข้าไปดูผลที่แท็บ **Actions** ของ repo ว่าวิ่งผ่านหรือไม่ (รอบแรกอาจ fail เพราะยังไม่มี test จริง — ปรับ script ใน `package.json`/`pubspec.yaml` ตามความเหมาะสม)
4. กลับไปทำข้อ 1 (Branch Protection) ต่อ — ตอนนี้จะเห็น job name (เช่น `lint-and-test`) ให้เลือกเป็น Required status check ได้แล้ว

### Checklist

- [ ] เปิด PR ทดสอบ 1 อัน แล้วเห็น CI รันอัตโนมัติที่แท็บ Actions
- [ ] CI เขียว (ผ่าน) อย่างน้อย 1 ครั้ง ก่อนตั้งเป็น Required status check ใน Branch Protection
- [ ] ตั้งกลับไปที่ Branch Protection Rule ให้ Required status check ชี้ไปที่ job นี้แล้ว

---

## 5. เขียน API Spec เริ่มต้นแบบ OpenAPI

**ไฟล์พร้อมใช้:** ก๊อปไฟล์ `openapi/openapi.yaml` ที่แนบมาไปไว้ที่ `docs/api/openapi.yaml`

### แนวทาง (ยังไม่ต้องครบทุก Endpoint)

ไฟล์ที่แนบมาเป็น**โครงหลัก** ครอบคลุมกลุ่ม Endpoint ตามโมดูลใน Build Reference Section 3 (auth, config, firmware, device-status) พร้อม schema เบื้องต้น (`DeviceConfigDraft`, `LoginRequest` ฯลฯ) — เป้าหมาย Sprint 0 คือมี "โครง" ให้ทั้ง Web และ Mobile เห็นภาพ Contract ตรงกันก่อนเขียนโค้ดจริง ไม่ต้องสมบูรณ์ 100% ในรอบนี้ (ค่อยเพิ่ม Endpoint ทีละ Phase ตามที่ Build ไปจริง)

### วิธีดูไฟล์แบบมี UI (แนะนำ)

```bash
npx @redocly/cli preview-docs docs/api/openapi.yaml
# หรือใช้ Swagger Editor ออนไลน์ที่ https://editor.swagger.io แล้ววาง content เข้าไป
```

### Checklist

- [ ] ไฟล์ `openapi.yaml` วางอยู่ที่ `docs/api/openapi.yaml`
- [ ] เปิดดูผ่าน Redocly/Swagger Editor แล้ว render ได้โดยไม่ error (Syntax ถูกต้อง)
- [ ] A และ B อ่านแล้วเห็นพ้องกันว่า Endpoint หลักที่มีอยู่ตอนนี้เพียงพอสำหรับเริ่ม Phase 0-1
- [ ] ทุกครั้งที่เพิ่ม Endpoint ใหม่ในแต่ละ Phase ถัดไป ให้กลับมาอัปเดตไฟล์นี้ด้วย (Contract ต้องตรงกับของจริงเสมอ ไม่ใช่ทำครั้งเดียวแล้วทิ้ง)

---

## สรุป Checkpoint Sprint 0 ทั้งหมด (จาก 03_GPS_Detailed_Build_Steps.md)

- [ ] รัน `web/`, `backend/`, `mobile/` แยกกันได้จริงบนเครื่อง dev
- [ ] Branch Protection บน `main` ทำงานจริง (push ตรงไม่ได้ ต้องผ่าน PR + approve)
- [ ] CI (lint + test) เขียวบน PR แรก และถูกตั้งเป็น Required status check แล้ว
- [ ] `docker-compose up` รันขึ้นทั้ง PostgreSQL, Redis, MinIO โดยไม่ error
- [ ] `.env.example` ครบทุกตัวแปรที่ระบบทั้งหมดจะใช้ (แม้ยังไม่ implement จริงทุกตัว)
- [ ] `docs/api/openapi.yaml` มีโครงหลักและเปิดดูผ่าน Swagger/Redocly ได้

ทำครบตามนี้แล้ว Sprint 0 ถือว่าเสร็จ พร้อมเข้า Phase 0 ข้อถัดไปคือ RBAC Matrix (A เป็นคนทำ) ต่อได้เลยครับ
