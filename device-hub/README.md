# device-hub

ตัวกลางระหว่างกล่อง GPS ที่ไม่ใช่ ESP32 (เริ่มที่ Meitrack TA255) กับ backend — ดูการออกแบบใน [`docs/33_Multi_Device_Plan.md`](../docs/33_Multi_Device_Plan.md)

- รับการเชื่อมต่อ TCP จากกล่อง แปลงพิกัดแล้วส่งเข้า backend (`POST /api/v1/device-sync/{imei}/telemetry/{key}` — endpoint เดียวกับกล่อง ESP32)
- ไม่มี dependency — ใช้ Node.js ≥ 20.12 เท่านั้น

## รัน test

```bash
cd device-hub
npm test
```

## รันจริง

1. ลงทะเบียนเครื่องใน backend ก่อน: รุ่น `TA255L` + Device ที่ `deviceId` = IMEI ของกล่อง + ออก telemetry key ให้เครื่อง
2. คัดลอก `devices.example.json` เป็น `devices.json` แล้วใส่ IMEI จริงและ telemetry key (`devices.json` ไม่เข้า git)
3. รัน

```bash
cd device-hub
DEVICE_HUB_BACKEND_URL=http://localhost:3001/api/v1 npm start
```

4. เปิดทางให้กล่องเข้าจากอินเทอร์เน็ต — ช่วงทดสอบใช้ pinggy (หมดอายุทุก 60 นาที ได้ที่อยู่ใหม่ทุกครั้ง):

```bash
ssh -p 443 -R0:localhost:5000 tcp@a.pinggy.io
```

5. ช่อง IP/Domain ของกล่องรับได้ไม่เกิน 32 ตัว ชื่อของ pinggy ยาวกว่านั้น ต้องแปลงเป็น IP ก่อน (PowerShell):

```powershell
(Resolve-DnsName <ชื่อ pinggy> -Type A | ? Type -eq 'A').IPAddress
```

แล้วใส่ IP + Port ใน Meitrack Manager → Tracking → Set

## ความปลอดภัยตอนใช้งานจริง

โปรโตคอล Meitrack **ไม่มีการยืนยันตัวตน** กล่องบอกแค่ IMEI ในทุก frame ใครรู้ IMEI ที่อยู่ใน `devices.json` ก็ต่อพอร์ต TCP เข้ามาส่งพิกัดแทนกล่องได้ (เป็นข้อจำกัดของตัวกล่อง แก้ฝั่ง device-hub ไม่ได้)

ตอนใช้งานจริงจึงต้องให้ firewall ของ server **รับพอร์ต TCP (`DEVICE_HUB_TCP_PORT`, ค่าเริ่มต้น `5000`) เฉพาะช่วง IP ที่เครือข่ายซิมของกล่องใช้ออกอินเทอร์เน็ต** ขอช่วง IP นี้จากผู้ให้บริการซิม (ถ้าซิมใช้ APN ส่วนตัว / private network ได้จะปลอดภัยกว่า)

ตัวอย่าง (`203.0.113.0/24` เป็น IP ตัวอย่าง ให้แทนด้วยช่วงจริงของซิม):

```powershell
# Windows Server
New-NetFirewallRule -DisplayName "device-hub TCP จากซิม" -Direction Inbound -Protocol TCP -LocalPort 5000 -RemoteAddress 203.0.113.0/24 -Action Allow
```

```bash
# Linux (ufw)
sudo ufw allow from 203.0.113.0/24 to any port 5000 proto tcp
```

- อย่าเปิดพอร์ตนี้ให้ทุก IP (`0.0.0.0/0`) · pinggy ที่ใช้ในหัวข้อ "รันจริง" เปิดรับทุก IP ใช้ได้เฉพาะช่วงทดสอบ
- HTTP API (`DEVICE_HUB_HTTP_HOST`) ฟัง `127.0.0.1` เป็นค่าเริ่มต้น ให้ backend เรียกจากเครื่องเดียวกันหรือวงภายในเท่านั้น ไม่ต้องเปิดออกอินเทอร์เน็ต
- ซิมหลายเครื่องอาจออก IP เดียวกัน (CGNAT) ยังรอพี่เลี้ยงยืนยันว่าซิมที่ใช้จริงเป็นแบบไหน (`docs/HANDOVER.md` §6)

## ค่าตั้ง (env)

| env | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `DEVICE_HUB_TCP_PORT` | `5000` | port ที่กล่องต่อเข้ามา |
| `DEVICE_HUB_BACKEND_URL` | (ไม่ตั้ง = ไม่ส่งพิกัด) | เช่น `http://localhost:3001/api/v1` |
| `DEVICE_HUB_DEVICES_FILE` | `devices.json` | ทะเบียนเครื่องที่อนุญาต |
| `DEVICE_HUB_LOG_DIR` | `logs` | log อ่านง่าย (`<วันที่>.log`) + hex (`<วันที่>.raw.log`) เวลาเป็น UTC |

กล่องที่ IMEI ไม่อยู่ใน `devices.json` จะถูกตัดสายทันที · สายที่ยังไม่ระบุตัวจาก IP เดียวกันค้างได้ไม่เกิน 5 สาย (กล่องที่ระบุตัวแล้วไม่จำกัด — ซิมหลายเครื่องอาจออก IP เดียวกัน)

## ส่งพิกัดเข้า backend

- แปลงเป็นรูปเดียวกับกล่อง ESP32 · event 19 → `OVERSPEED`, 20 → `GEOFENCE_ENTER`, 21 → `GEOFENCE_EXIT` · event อื่นส่งเป็นพิกัดธรรมดา
- ตำแหน่งที่ไม่ได้มาจาก GPS (เสา/Wi-Fi) ส่งเป็น `fix: false` — หน้าเว็บ/แอปกรองออกเหมือนกล่อง ESP32
- ชะลอเองไม่เกิน 60 ครั้ง/นาที/เครื่อง และ 240 ครั้ง/นาทีรวม (backend จำกัด 60/เครื่อง และ 300/IP)
- backend ล่ม → เก็บรอส่งใหม่ (สูงสุด 5000 จุดต่อเครื่อง) · backend ปฏิเสธ (4xx) → ทิ้งจุดนั้นพร้อม log

## รับ Config จาก backend

เปิดเมื่อตั้ง `DEVICE_HUB_ADMIN_USERNAME` และ `DEVICE_HUB_ADMIN_PASSWORD` — HTTP API ใช้ path และรูป JSON เดียวกับ Server กลาง ESP32 backend จึงใช้ client ตัวเดิมได้ (ตั้ง `DEVICE_HUB_MODE=real`, `DEVICE_HUB_BASE_URL`, user/pass เดียวกันฝั่ง backend)

| env | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `DEVICE_HUB_HTTP_HOST` | `127.0.0.1` | ฟังเฉพาะในเครื่อง — เปิดออกเครือข่ายเมื่อ backend อยู่คนละเครื่องเท่านั้น |
| `DEVICE_HUB_HTTP_PORT` | `8090` | |
| `DEVICE_HUB_ADMIN_USERNAME` / `DEVICE_HUB_ADMIN_PASSWORD` | (ไม่ตั้ง = ปิดส่วนนี้) | backend ใช้ login |
| `DEVICE_HUB_DATA_DIR` | `data` | เก็บคิวคำสั่ง (`queue.json`) |
| `DEVICE_HUB_QUEUE_TTL_HOURS` | `24` | คำสั่งที่รอกล่องเกินนี้ถือว่าข้าม (กล่องออฟไลน์) |

ต้องใส่ `--protocol TCP` ให้ตรงกับรุ่น (ค่าเริ่มต้นของสคริปต์คือ HTTP ของ ESP32 — ใส่ผิด field จะไม่ขึ้นในหน้าสร้าง Config) · ค่าที่ตั้งได้ของแต่ละรุ่นอยู่ใน `src/protocols/<โปรโตคอล>/fields.js` ที่เดียว · หลังแก้ตารางให้รัน `npm run schema` แล้วนำเข้า backend:

```bash
cd backend
npm run import:central-schema -- --file ../device-hub/schemas/TA255L-1.json --as TA255L --protocol TCP --dry-run
```

### สถานะคำสั่ง

| สถานะ | ความหมาย | backend เห็นเป็น |
|---|---|---|
| `QUEUED` | รอกล่องเชื่อมต่อ / รอส่งใหม่ | กำลังส่ง |
| `SENT` | ส่งแล้ว รอกล่องตอบ | กำลังส่ง |
| `ACKED` | กล่องตอบรับ กำลังยืนยันผล | กำลังส่ง |
| `SUCCESS` | ยืนยันแล้ว (ตอบรับ / อ่านค่ากลับตรง / รอบส่งจริงตรง) | สำเร็จ |
| `FAILED` + `DEVICE_REJECTED` | กล่องตอบ Error | ล้มเหลว (ไม่ลองซ้ำ) |
| `FAILED` + `NOT_VERIFIED` | กล่องตอบรับแต่ค่าไม่ถูกใช้ (เช่น อยู่นอก geofence) | ล้มเหลว |
| `FAILED` + `DEVICE_NO_REPLY` | ส่งไม่ถึงกล่อง 3 ครั้ง | ล้มเหลว |
| `FAILED` + `SUPERSEDED` | มีคำสั่งใหม่ของกล่องเดียวกันมาแทนก่อนส่ง | ข้าม |
| `EXPIRED` + `TTL_EXPIRED` | กล่องไม่ต่อเข้ามาภายในเวลา | ข้าม (กล่องออฟไลน์) |

## เพิ่มกล่องรุ่นหรือโปรโตคอลใหม่

- **รุ่นใหม่ โปรโตคอลเดิม:** เพิ่มเครื่องใน `devices.json` (ใส่ `model`) และเพิ่มตารางค่าของรุ่นนั้น
- **โปรโตคอลใหม่:** สร้าง `src/protocols/<ชื่อ>/` ที่มี 3 ส่วนแบบเดียวกับ `meitrack/`
  - `frame.js` — แยก frame จาก TCP, สร้างคำสั่ง, แปลงข้อมูลพิกัด
  - `telemetry.js` — `toTelemetryReport(packet, ctx)` แปลงเป็นรูปที่ backend รับ
  - `fields.js` — `MODEL`, `SCHEMA_VERSION`, `schema()`, `planCommands(settings)`, `parseReadback(group, body)`
  - test ด้วยข้อมูลตัวอย่างจากเอกสารผู้ผลิตเท่านั้น (ห้ามใช้ IMEI / พิกัด / log จากกล่องจริง — repo เป็น public)
- ไม่มีช่องส่งคำสั่งดิบ: ค่าที่ไม่อยู่ใน `fields.js` ส่งเข้ากล่องไม่ได้ · ห้ามใส่คำสั่งเปลี่ยนเซิร์ฟเวอร์ / ตัดน้ำมัน / คืนค่าโรงงาน

## เอกสารโปรโตคอล

อ้างอิง "TA255 GPRS Protocol V1.0 (2022-09-21)" ของ Meitrack — เอกสาร Confidential **ห้ามใส่ใน repo** ขอจากพี่เลี้ยง
