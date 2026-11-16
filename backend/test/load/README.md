# ทดสอบโหลดด้วย k6

สคริปต์ทดสอบโหลดตาม [docs/32](../../../docs/32_Load_Testing_Plan.md) · ผลรอบแรก (13 พ.ย. 2569) อยู่ใน docs/32 §8
และไฟล์ดิบใน `results/` · **ไม่อยู่ใน CI** รันด้วยมือเท่านั้น

> รันกับ **ฐานแยก `gps_config_firmware_loadtest`** และ backend ตัวที่สองที่ **พอร์ต 3002** เท่านั้น
> ห้ามชี้ฐานหรือ backend ที่ใช้งานจริง — สคริปต์สร้างกล่องจำลอง 6,000 ตัวและ telemetry หลายแสนแถว

## ไฟล์

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `lib.js` | ตัวช่วยร่วม: ส่ง telemetry แบบกล่องจริง, login, รายชื่อผู้ใช้ทดสอบ |
| `telemetry.js` | S1 Load / S3 Stress — กล่องส่ง telemetry ทุก 10 วิ ไล่ขั้นจำนวนกล่อง |
| `mixed.js` | S2 ใช้งานปนกัน / S5 Soak — telemetry + เจ้าหน้าที่เปิดหน้าต่างๆ |
| `spike.js` | S4 Spike — กล่องกลับมาส่งพร้อมกัน |
| `login.js` | S6 Login — 50 คน login ภายใน 1 นาที |
| `ratelimit.js` | S7 — กล่องหลายตัวออก IP เดียว ด้วยเพดานจริง |
| `seed-load-devices.sql` | สร้างกล่องจำลอง `LT-00001`..`LT-06000` (telemetry key = `k6key-<เลข>`) |
| `seed-old-telemetry.sql` | S5: เติม telemetry อายุ 8 วัน 216,000 แถว ให้ job ลบข้อมูลเก่ามีงานทำ |
| `env.sh` | ตั้ง env ของ backend ทดสอบ (พอร์ต 3002, ฐาน loadtest, ทุกโหมดเป็น mock) |
| `run.sh` | รัน k6 หนึ่งชุด + เก็บ summary JSON และ CPU/RAM ของ postgres/backend ทุก 5 วิ |

## เตรียมครั้งแรก

ต้องมี: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), Docker (container `gps-postgres`
ของ `docker-compose.yml`), `.env` ที่ root ของ repo (มี `DATABASE_URL` และ `TEST_USERS_PASSWORD`)
· `run.sh` เขียนสำหรับ **Git Bash บน Windows** (ใช้ `netstat -ano` + `powershell.exe` วัด CPU/RAM ของ
backend) — บน Linux/macOS ให้แก้ส่วน sampler หรือรัน `k6 run` ตรงๆ

```bash
# 1. สร้างฐานแยก
docker exec gps-postgres psql -U gps_user -d postgres -c "CREATE DATABASE gps_config_firmware_loadtest"

# 2. migrate + seed ผู้ใช้ทดสอบลงฐานแยก (env.sh เปลี่ยนแค่ชื่อฐาน ไม่พิมพ์ค่าลับ)
cd backend
source test/load/env.sh ../.env
npx prisma migrate deploy
npx prisma db seed

# 3. กล่องจำลอง 6,000 ตัว
docker exec -i gps-postgres psql -U gps_user -d gps_config_firmware_loadtest < test/load/seed-load-devices.sql

# 4. เปิด backend ทดสอบที่พอร์ต 3002 (เทอร์มินัลแยก, env เดียวกับข้อ 2)
npm run build && node dist/src/main.js > test/load/backend-3002.log 2>&1
```

`env.sh` ตั้ง `TELEMETRY_RATE_LIMIT_PER_IP` สูงมากไว้ เพราะ k6 ยิงจาก IP เดียว — **ยกเว้น S7** ที่ต้องใช้ค่าจริง

## รันแต่ละชุด

รันจาก `backend/test/load/` · ผลไปที่ `results/<ชื่อผล>-summary.json` และ `-stats.csv`

| ชุด | คำสั่ง | หมายเหตุ |
|---|---|---|
| S0 Smoke | `bash run.sh s0-telemetry telemetry.js -e STEPS=10 -e STEP_SEC=10` | เช็คว่าสคริปต์ทำงาน |
| S1 Load | `bash run.sh s1-load telemetry.js -e STEPS=300,1000,3000 -e STEP_SEC=300` | ขั้นละ 5 นาที |
| S2 ใช้งานปนกัน | `bash run.sh s2-300 mixed.js -e BOXES=300 -e DURATION=5m`<br>`bash run.sh s2-3000 mixed.js -e BOXES=3000 -e DURATION=5m` | เจ้าหน้าที่ 30 คน (`STAFF`) |
| S3 Stress | `bash run.sh s3-stress telemetry.js -e STEPS=5000,8000,12000,16000,20000 -e STEP_SEC=60` | หาจุดพัง |
| S4 Spike | `bash run.sh s4-spike spike.js -e BOXES=3000` | 0 → 300 คำขอ/วิ ใน 10 วิ |
| S5 Soak + retention | รัน `seed-old-telemetry.sql` ก่อน แล้ว<br>`bash run.sh s5-soak mixed.js -e BOXES=300 -e DURATION=70m` | ให้คร่อมรอบ job ลบข้อมูลเก่า (ชั่วโมงละครั้ง) และนับแถวเก่าระหว่างรัน |
| S6 Login | `bash run.sh s6-login login.js` | 50 คน (`USERS`) |
| S7 Rate limit | เปิด backend ใหม่ด้วย `TELEMETRY_RATE_LIMIT_PER_IP=300` แล้ว<br>`bash run.sh s7-40boxes ratelimit.js -e BOXES=40`<br>`bash run.sh s7-100boxes ratelimit.js -e BOXES=100` | นับ 429 ใน `telemetry_429` |

เปลี่ยนปลายทางได้ด้วย `-e BASE_URL=http://<host>:<port>/api/v1` (เช่นตอนรันซ้ำบน server จริง —
ควรรัน k6 จากอีกเครื่อง ไม่ใช่เครื่องเดียวกับ backend ดู docs/32 §8.2)

## ลบทิ้งหลังทดสอบ

```bash
docker exec gps-postgres psql -U gps_user -d postgres -c "DROP DATABASE gps_config_firmware_loadtest WITH (FORCE)"
```

`*.log` และ `results/*-k6.txt` (ข้อความดิบของ k6) ถูก `.gitignore` ไว้ — เก็บเข้า repo เฉพาะ summary JSON และสถิติ CSV
