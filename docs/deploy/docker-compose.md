# คู่มือรันระบบเต็มชุดด้วย docker compose

รันทั้งระบบ (ฐานข้อมูล, MinIO, backend, เว็บ, reverse proxy) ด้วยคำสั่งเดียวบนเครื่องที่มี Docker
ใช้สำหรับเดโม เครื่องทดสอบ และวันทดสอบด้วยมือถือ (`docs/19` หัวข้อ 11) ตรงกับ Sprint 4 แถวที่ 30

ตอนพัฒนาตามปกติยังใช้แบบเดิม (`docker compose up -d` ได้แค่ postgres / redis / minio แล้วรัน backend
และเว็บด้วย `npm run start:dev` / `npm run dev`) คู่มือนี้ไม่เปลี่ยนวิธีนั้น

---

## 1. ภาพรวม

```
เบราว์เซอร์ / แอปมือถือ / กล่อง GPS / tunnel
                  │  http://<เครื่อง>:8080
                  ▼
        proxy (Caddy) พอร์ตเดียว
          ├── /api/*     → backend (NestJS)
          ├── /socket/*  → backend (เตรียมไว้ให้ WebSocket ในอนาคต)
          └── อื่นๆ       → web (Next.js)

migrate   รัน prisma migrate deploy + seed แล้วจบ ก่อน backend เริ่มทุกครั้ง
postgres / minio / redis  ตัวเดียวกับที่ใช้ตอนพัฒนา
```

| service | image | หมายเหตุ |
|---|---|---|
| `migrate` | `backend/Dockerfile` target `migrator` | รันแล้วจบ รันซ้ำทุกครั้งที่ `up` ได้ปลอดภัย (seed ใช้ upsert) |
| `backend` | `backend/Dockerfile` target `runtime` | รันเป็น user `node` มี healthcheck ที่ `/api/v1/health` |
| `web` | `web/Dockerfile` | Next.js แบบ standalone เรียก API ผ่าน `/api/v1` ของ origin เดียวกัน |
| `proxy` | `caddy:2.8.4-alpine` | ตั้งค่าที่ `infra/caddy/Caddyfile` |

---

## 2. ตั้งค่าก่อนรันครั้งแรก

คัดลอก `.env.example` เป็น `.env` ที่ root (ถ้ายังไม่มี) แล้วตั้งค่าเหล่านี้ ห้าม commit `.env`

| ค่า | จำเป็น | ทำไม |
|---|---|---|
| `JWT_SECRET` | ใช่ | backend ใน container เป็น `NODE_ENV=production` ถ้ายังเป็นค่าตัวอย่างหรือสั้นกว่า 32 ตัวอักษรจะไม่ยอมเริ่ม สร้างด้วย `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD` | เครื่องใหม่ | seed สร้าง SuperAdmin คนแรกให้ (เฉพาะเมื่อยังไม่มี SuperAdmin) รหัสยาวอย่างน้อย 12 ตัวอักษร |
| `SEED_TEST_USERS=true`, `TEST_USERS_PASSWORD` | ถ้าต้องการเครื่องเดโม | สร้างบัญชีทดสอบทุกบทบาท (`config.test`, `operation.test` ฯลฯ) และข้อมูลตัวอย่าง ด้วยรหัสที่ตั้งเอง ไม่ใช่ `password123` |
| `APP_PORT` | ไม่ | พอร์ตหน้าระบบ ค่าเริ่มต้น 8080 |

---

## 3. คำสั่งที่ใช้บ่อย

```bash
# เปิดทั้งระบบ (build image ครั้งแรกใช้เวลาหลายนาที)
docker compose --profile app up -d --build

# ดูสถานะ / log
docker compose --profile app ps
docker compose --profile app logs -f backend
docker compose --profile app logs migrate

# ปิด (ข้อมูลยังอยู่)
docker compose --profile app down
```

เปิดเว็บที่ `http://localhost:8080` (หรือพอร์ตที่ตั้งใน `APP_PORT`)

**บนเครื่องที่ใช้พัฒนาด้วย:** profile `app` ใช้ postgres / minio ตัวเดียวกับตอนพัฒนา (container `gps-postgres`,
`gps-minio`) `migrate` จึงรัน migration และ seed บนฐานข้อมูล dev นั้น ถ้าฐานข้อมูลเคยรัน migration จาก branch ที่ยังไม่
merge อาจขัดกัน (ดูหัวข้อ Migration Safety ใน CLAUDE.md) และ backend ใน container ชนพอร์ตกับ dev server ไม่ได้
เพราะเปิดแค่พอร์ตของ Caddy

**ล้างข้อมูลทั้งหมดแล้วเริ่มใหม่:** `docker compose --profile app down -v` ระวัง: ลบ volume ของ postgres / minio
ซึ่งเป็น volume เดียวกับที่ใช้ตอนพัฒนาในเครื่องเดียวกัน ข้อมูล dev จะหายด้วย

**อัปเดตโค้ด:** `git pull` แล้ว `docker compose --profile app up -d --build` migrate จะรัน migration ใหม่ให้เอง

---

## 4. IP ใน Audit Log (`TRUST_PROXY`)

backend ต้องรู้ว่ามี proxy อยู่หน้ากี่ชั้น ไม่งั้น IP ใน Audit Log ผิดทุกแถว (กติกาใน CLAUDE.md)

| วิธีเข้าระบบ | `APP_TRUST_PROXY` | `CADDY_TRUSTED_PROXIES` |
|---|---|---|
| เข้าตรงที่พอร์ตของ Caddy (ค่าเริ่มต้น) | `1` (ค่าเริ่มต้น) | ไม่ตั้ง |
| ผ่าน tunnel หรือ proxy อีกชั้นที่อยู่หน้า Caddy | `2` | `private_ranges` |

ห้ามเพิ่มค่าถ้าไม่มี proxy จริง ผู้ใช้จะปลอม IP ผ่าน header `X-Forwarded-For` ได้

**ข้อจำกัดของ Docker Desktop บน Windows / macOS:** container มักเห็น IP ของ gateway ของ Docker แทน IP จริงของผู้ใช้
Audit Log บนเครื่องเหล่านี้จึงอาจได้ IP เดียวกันทุกแถว บน Linux ไม่มีปัญหานี้

---

## 5. วันทดสอบด้วยมือถือ (`docs/19`)

ทำตาม `docs/19` หัวข้อ 11 โดยใช้ระบบนี้แทน dev server ได้ ต่างกันแค่ค่าที่ตั้ง:

1. ตั้งใน `.env`: `DEVICE_CONFIG_APPLY_MODE=real`, `APP_TRUST_PROXY=2`, `CADDY_TRUSTED_PROXIES=private_ranges`
   และบัญชีที่ใช้ login (`INITIAL_ADMIN_*` หรือ `SEED_TEST_USERS=true` + `TEST_USERS_PASSWORD`)
2. `docker compose --profile app up -d --build`
3. เปิด tunnel ชี้ไปที่พอร์ตของ Caddy: `cloudflared tunnel --url http://localhost:8080`
4. ใช้ URL ที่ได้ในแอปมือถือทุกเครื่อง (หน้าเว็บ API และ endpoint ของกล่องอยู่ใต้ URL เดียวกัน)

**การ build แอปมือถือสำหรับวันทดสอบ**

ค่า URL และโหมดของแอปฝังตอน build (`--dart-define`) ไม่ใช่ค่าที่แก้ในแอปภายหลังได้ (ยกเว้นโหมดจำลองกล่องที่ B
จะทำให้กรอก URL ได้ตาม `docs/19` หัวข้อ 8)

```bash
cd mobile
flutter run   --dart-define=API_BASE_URL=https://xxxx.trycloudflare.com/api/v1   --dart-define=API_MOCK_MODE=false
```

- **ใส่ `API_MOCK_MODE=false` ทุกครั้ง** แอปที่ build โดยไม่ใส่จะเป็นโหมด mock (กฎ Mock Mode ใน CLAUDE.md คือ
  ค่าเริ่มต้นเป็น mock) ซึ่งจะไม่เรียก backend เลย ทำให้ดูเหมือนระบบไม่ทำงาน
- **`API_BASE_URL` ต้องลงท้าย `/api/v1`** และเป็น URL ของ tunnel (หรือของเครื่องที่รัน compose) ไม่ใช่ `localhost`
  เพราะมือถือเรียก `localhost` ของตัวเองไม่ได้ ถ้า tunnel เปิดใหม่ URL เปลี่ยน ต้อง build แอปใหม่
- **ทดสอบแจ้งเตือน push (ไม่บังคับ):** ค่าเริ่มต้นของ compose คือ `mock` (บันทึกแจ้งเตือนลงฐานข้อมูลและแสดงในแอป
  ได้ แต่ไม่ยิงเข้า Firebase) ถ้าจะให้ push เด้งบนเครื่องจริง
  1. วางไฟล์ service account ของ Firebase project **dev** ไว้ที่ `secrets/` ในโฟลเดอร์ root (โฟลเดอร์นี้ถูก
     gitignore อยู่แล้ว ห้ามเอาไฟล์นี้ขึ้น GitHub) เช่น `secrets/fcm-service-account.dev.json`
  2. ตั้ง `APP_NOTIFICATION_MODE=fcm` ใน `.env` (ถ้าชื่อไฟล์ต่างจากข้างบนให้ตั้ง `APP_FCM_SERVICE_ACCOUNT_FILE`
     เป็น**ชื่อไฟล์**) แล้ว `docker compose --profile app up -d --build`
  3. ติดตั้งแอป Android flavor `dev` (`--flavor dev` ใช้ `google-services.json` ของ project dev) ถ้าติดตั้ง flavor
     `prod` จะได้ token ของคนละ project push ไม่ถึงเครื่อง
  - ถ้าไฟล์ไม่มี อ่านไม่ได้ หรือ `project_id` ไม่ลงท้าย `-dev` backend จะไม่ยอมเริ่ม (ตั้งใจให้ล้มตั้งแต่เริ่มดีกว่า
    ยิง push เข้า production โดยไม่รู้ตัว) ดูข้อความใน `docker compose logs backend`
  - ถ้า backend อยู่ใน container แล้วอ่านไฟล์ไม่ได้บน Linux ให้ตรวจสิทธิ์ไฟล์ (container รันเป็นผู้ใช้ `node`)
  - flavor ยังไม่มีใน `main` หรือไม่ได้ทดสอบ push ข้ามข้อนี้ได้ (ไม่ใช่ส่วนจำเป็นของวันทดสอบ docs/19)

**หลังทดสอบ:** ปิด tunnel, เอา `APP_TRUST_PROXY` / `CADDY_TRUSTED_PROXIES` ออก, ตั้ง `DEVICE_CONFIG_APPLY_MODE=mock`
แล้ว `up -d` อีกครั้ง

ถ้าทดสอบด้วยฐานข้อมูล dev ที่มีบัญชีทดสอบรหัส `password123` อยู่แล้ว backend จะไม่ยอมเริ่ม ให้ตั้ง
`TEST_USERS_PASSWORD` แล้วรัน `npm run test-users:set-password` ในโฟลเดอร์ backend ก่อน (ใช้ `.env` เดียวกัน)

---

## 6. แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| `migrate` ล้ม | ดู `docker compose --profile app logs migrate` ส่วนใหญ่คือตั้ง `SEED_TEST_USERS=true` แต่ไม่ได้ตั้ง `TEST_USERS_PASSWORD` หรือ `INITIAL_ADMIN_*` ตั้งไม่ครบ |
| `backend` ไม่ healthy | ดู log ของ backend ถ้าขึ้นเรื่อง `JWT_SECRET` หรือบัญชีทดสอบรหัส `password123` ให้แก้ตามข้อความ |
| login ไม่ได้ เครื่องใหม่ | ยังไม่ได้ตั้ง `INITIAL_ADMIN_*` หรือ `SEED_TEST_USERS` ตั้งแล้ว `up -d` อีกครั้ง |
| พอร์ต 8080 ถูกใช้แล้ว | ตั้ง `APP_PORT` เป็นพอร์ตอื่น |
| build ช้าครั้งแรก | ปกติ ครั้งต่อไปใช้ cache |

---

## 7. ข้อจำกัดที่ทราบ

- **backend รันได้ 1 ตัว** มีงานตามเวลาอยู่ในตัว (ลบ Config อัตโนมัติ, เวลารอของ `docs/19`) ถ้ารันหลายตัวงานจะรันซ้ำ
- **ไม่มีระบบ backup** ข้อมูลอยู่ใน volume ของ Docker บนเครื่องนั้นเท่านั้น
- **MinIO ไม่เปิดสู่ภายนอก** อัปโหลด Firmware ผ่าน backend ได้ตามปกติ แต่ลิงก์ดาวน์โหลดตรงให้กล่อง (`docs/19` ขั้นที่ 2)
  ต้องเพิ่มเส้นทางใน Caddy ภายหลัง
- **HTTPS:** Caddy ทำให้อัตโนมัติเมื่อมีโดเมนจริง ตอนนี้ตั้งเป็น `:80` สำหรับเครื่องในวงและ tunnel (tunnel เป็น HTTPS อยู่แล้ว)
- image ของ postgres / minio / redis ยังใช้ tag เดิมที่ใช้ตอนพัฒนา (`minio/minio:latest`) ไม่ได้เปลี่ยนในรอบนี้
  เพื่อไม่กระทบ container ที่ทุกคนใช้อยู่
