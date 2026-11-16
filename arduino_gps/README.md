# arduino_gps — Server กลาง + firmware กล่อง GPS (ESP32)

ระบบต้นแบบที่ GPS Config & Firmware Center ใช้ส่ง Config / Firmware เข้ากล่องจริง (โหมด `central`)
แยกเป็นโปรเจกต์ Node.js + Arduino ของตัวเอง **ไม่ได้ import โค้ดข้ามกับ `backend/` `web/` `mobile/`** —
คุยกันผ่าน HTTP เท่านั้น

```
Web / Mobile ──► backend (NestJS :3001) ──► delivery-server (:3019) ──► ws-gateway (:3018) ──WebSocket──► กล่อง ESP32
                       ▲                                                                            │
                       └──────────── telemetry: POST /api/v1/device-sync/{id}/telemetry/{key} ◄──────┘
```

| โฟลเดอร์ | คืออะไร | พอร์ต |
|---|---|---|
| [`delivery-server/`](delivery-server/README.md) | เก็บ Config / Firmware / Schema ของกล่อง, หน้าจัดการ `/admin`, API ที่ backend เรียก | 3019 |
| [`ws-gateway/`](ws-gateway/README.md) | ช่องทาง WebSocket ส่งคำสั่งถึงกล่อง real-time และรับสถานะกลับ | 3018 |
| [`firmware/`](firmware/README.md) | firmware ESP32 (`esp32_gps_box/`) + `build.js` build ทุกเวอร์ชันพร้อมเซ็นลายเซ็น | — |
| [`data-monitor/`](data-monitor/README.md) | Data Server จำลอง + หน้าเว็บดูข้อมูลที่กล่องส่งออก (ใช้ตอนทดสอบ) | 320 |
| [`postman/`](postman/README.md) | Postman collection เรียก API ของ delivery-server + สคริปต์สาธิต | — |
| `sketch_oct17a/` | sketch ทดลองรุ่นแรก (เก็บไว้อ้างอิง ไม่ได้ใช้แล้ว) | — |

เอกสารเต็ม: [คู่มือการใช้งาน.md](คู่มือการใช้งาน.md) (ใช้งาน/แฟลช/แก้ปัญหา) ·
[ESP32_Central_Device_Management_Spec.md](ESP32_Central_Device_Management_Spec.md) (สเปกระบบ, WebSocket protocol, ลำดับอัปเดต)

## รันแบบเร็ว (เครื่อง dev)

ต้องมี Node.js 20.12+ · ทั้งสอง server เก็บข้อมูลเป็นไฟล์ใน `data/` ของตัวเอง (ไม่ใช้ PostgreSQL)

```bash
cd arduino_gps/delivery-server && cp .env.example .env && npm ci && npm run keygen && npm start
cd arduino_gps/ws-gateway      && cp .env.example .env && npm ci && npm start
```

- `ADMIN_TOKEN` ของทั้งสองต้องตรงกับที่อีกฝั่งอ้าง (`GATEWAY_ADMIN_TOKEN` ใน delivery-server) — ดูคอมเมนต์ใน `.env.example`
- Windows: `start-servers.bat` เปิดทั้งสองตัวในหน้าต่างแยก · `start-data-monitor.bat` เปิด data-monitor
- เช็ค: `http://localhost:3019/health`, `http://localhost:3018/health` · หน้าจัดการ `http://localhost:3019/admin`

ต่อ backend เข้ากับ Server กลาง: ตั้งใน `.env` ที่ root ของ repo

```
CENTRAL_MODE=real
CENTRAL_BASE_URL=http://<host>:3019
CENTRAL_ADMIN_USERNAME=...   # = ADMIN_USERNAME ของ delivery-server
CENTRAL_ADMIN_PASSWORD=...   # = ADMIN_PASSWORD ของ delivery-server
DEVICE_CONFIG_APPLY_MODE=central
```

## เทส

```bash
cd arduino_gps/delivery-server && npm test   # node --test
cd arduino_gps/ws-gateway      && npm test   # unit + จำลองกล่องหลุดระหว่างคำสั่ง
```

ยังไม่อยู่ใน CI ของ repo (workflow ปัจจุบันครอบแค่ backend / web / mobile)

## ต้องเปลี่ยนก่อนใช้จริง

ค่าทั้งหมดด้านล่างเป็นค่าตัวอย่าง/ค่าทดสอบ **ห้ามใช้บน server จริง**

| จุด | ค่าตัวอย่างใน repo | ทำอะไร |
|---|---|---|
| `delivery-server/.env` | `ADMIN_TOKEN`, `ADMIN_USERNAME` / `ADMIN_PASSWORD` (`admin` / `admin123`) | สุ่มค่ายาวๆ ใหม่ · บัญชีนี้มีสิทธิ์เต็ม (ลงทะเบียนกล่อง, อัปโหลด firmware, ส่ง config) |
| `ws-gateway/.env` | `ADMIN_TOKEN` | สุ่มใหม่ ให้ตรงกับ `GATEWAY_ADMIN_TOKEN` ของ delivery-server |
| `delivery-server/keys/` | สร้างด้วย `npm run keygen` (ไม่อยู่ใน repo) | private key เซ็น firmware — **ห้ามหลุด** ใครมีก็ทำ firmware ที่กล่องยอมรับได้ · public key คู่กันอยู่ใน `firmware/esp32_gps_box/signing_key.h` (สร้างกุญแจใหม่ = แก้ไฟล์นี้แล้วแฟลชผ่าน USB ใหม่ทุกกล่อง) |
| `delivery-server/.env` + `ws-gateway/.env` `AUTO_REGISTER_TOKEN` | `1234` | กล่องที่ยังไม่มีในระบบแต่ใช้ token นี้จะถูกเพิ่มให้เอง — ใครรู้ค่านี้ลงทะเบียนกล่องปลอมได้ · ปล่อยว่าง = ปิดการลงทะเบียนอัตโนมัติ (ลงทะเบียนทีละกล่องในหน้า `/admin`) · ต้องเปลี่ยนคู่กับข้อถัดไปและ build firmware ใหม่ (เปลี่ยนแค่ฝั่ง server กล่องที่แฟลชค่าเดิมจะลงทะเบียนไม่ได้) · ตั้ง `MIN_DEVICE_TOKEN_LENGTH` ให้ยาวขึ้นด้วย (ตัวอย่าง = 4) |
| `firmware/esp32_gps_box/bootstrap_defaults.h` `DEFAULT_DEVICE_TOKEN` | `"1234"` | token ตั้งต้นที่แฟลชลงกล่อง — ต้องตรงกับ `AUTO_REGISTER_TOKEN` |
| `firmware/esp32_gps_box/globals.h` | `AP_PASS = "12345678"` | รหัส WiFi ของกล่องตอนเข้าโหมดตั้งค่า — เปลี่ยนก่อน build firmware สำหรับกล่องจริง |
| `firmware/esp32_gps_box/bootstrap_defaults.h` | `192.168.1.100` | ค่าเริ่มต้นของ Gateway / Delivery URL ตอนแฟลชครั้งแรก แก้ทีหลังได้ในหน้าเว็บของกล่อง |
| `delivery-server/.env` `DATA_SERVER_HOST_ALLOWLIST` | `data.example.com,192.168.1.100` | ปลายทางที่กล่องส่ง telemetry ได้ — ใส่ host ของ backend จริง |

IP `192.168.1.100` และโดเมน `data.example.com` ในเอกสารทั้งโฟลเดอร์เป็นค่าตัวอย่าง แทนที่ด้วยค่าจริงของ server ที่ใช้

## Firmware

- เวอร์ชันที่ build ได้ดูที่ `VERSIONS` ใน `firmware/build.js` (1.0.0 – 1.2.1 · ฟีเจอร์ต่อเวอร์ชันดู `version.h`)
- build: `node firmware/build.js [เวอร์ชัน]` — ต้องมี `arduino-cli` และ private key จาก `npm run keygen` → ได้ไฟล์ที่ `firmware/dist/`
- OTA มีระบบทดลองบูตแล้วย้อนกลับเองถ้าเวอร์ชันใหม่ต่อ WiFi/Server ไม่ได้ (`ota_trial_policy.h`)
- **ปัญหาที่ยังเปิดอยู่:** เคยพบกล่อง crash (`pbuf_free`) ระหว่างทดลองบูตแล้วย้อนเวอร์ชันเอง สาเหตุยังไม่ทราบแน่ชัด — ดู `docs/KNOWN_ISSUES.md`

## ที่มา

ย้ายเข้า repo นี้ 16 พ.ย. 2569 (ก่อนหน้าอยู่ใน git แยกบนเครื่องผู้พัฒนา) · ประวัติ commit เดิม (squash ตอนรวม):

| commit | วันที่ | เรื่อง |
|---|---|---|
| `b3b8c86` | 2026-10-26 | baseline (รวม ws-gateway disconnect grace) |
| `dc94c93` | 2026-10-31 | ws-gateway: รอกล่องพร้อมก่อนส่ง firmware, ลบประวัติคำสั่งได้ |
| `0f5ccc5` | 2026-10-31 | delivery-server: Config หลังย้อน firmware และรีเซ็ต `config_version` |
| `9e569d5` | 2026-10-31 | postman: ตัวอย่าง Config หลังย้อน firmware |
| `ca07124` – `9d958a3` | 2026-11-02 | firmware: OTA ทดลองบูต + ย้อนเวอร์ชันอัตโนมัติ (5 commit) |
| `28ee9ff` | 2026-11-04 | firmware: แก้อายุของ HTTP transport (เกี่ยวกับ crash `pbuf_free`) |
| `81cb6dd` | 2026-11-04 | firmware: เพิ่ม build target 1.1.1 |
| (ค่า) | 2026-11-10 | ws-gateway: `FIRMWARE_SETTLE_SEC` ค่าเริ่มต้น 60 → 30 วินาที |

ไม่ได้รวม: build ทดสอบ 1.2.9 ที่ตั้งใจให้ติดตั้งล้มสองครั้งแรก (ใช้สาธิตการลองส่งใหม่อัตโนมัติ docs/31 เท่านั้น)
