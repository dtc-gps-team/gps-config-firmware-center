# ws-gateway — WebSocket Gateway (WSS)

ส่วนนี้คือ **WebSocket Gateway** ตามข้อ 2 และข้อ 7 ของ `ESP32_Central_Device_Management_Spec.md`

- กล่องเปิด WebSocket ออกมาที่ `/ws/device` แล้วยืนยันตัวตนด้วย `Authorization: Bearer <device token>`
- รับ `HELLO` / `HEARTBEAT` / `COMMAND_STATUS` จากกล่อง
- บันทึกคำสั่งลงไฟล์ก่อน แล้วค่อยส่ง `COMMAND` (คำสั่งค้างจะถูกส่งเมื่อกล่อง reconnect)
- Admin API สำหรับลงทะเบียนกล่องและสั่ง `UPDATE_CONFIG` / `UPDATE_FIRMWARE` (ยิงจาก Postman)

ข้อมูลเก็บใน `data/db.json` (ใช้แทน Database) และ `data/audit.log`

## ติดตั้ง / รัน

```bash
cd ws-gateway
npm install
cp .env.example .env      # แล้วแก้ ADMIN_TOKEN
npm start
```

ต้องใช้ Node.js 20.12 ขึ้นไป

## Endpoints

### WebSocket
| | |
|---|---|
| `WS /ws/device` | Header `Authorization: Bearer <device token>` + `X-Device-Id: <device_id>` |

### Admin (`Authorization: Bearer <ADMIN_TOKEN>`)
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/admin/devices` | รายการกล่อง + online/offline + เวอร์ชันจาก HELLO |
| POST | `/api/admin/devices` | `{device_id, token?}` ลงทะเบียน token (ใช้ token เดียวกับ delivery-server) |
| GET | `/api/admin/devices/:id` | รายละเอียดกล่อง |
| PUT | `/api/admin/devices/:id/token` | `{token}` เปลี่ยน token (ตัด connection เดิม) |
| POST | `/api/admin/devices/:id/revoke` | ระงับกล่อง |
| GET | `/api/admin/devices/:id/commands` | ประวัติคำสั่ง |
| POST | `/api/admin/devices/:id/commands/config-update` | `{target_config_version, ttl_sec?}` |
| POST | `/api/admin/devices/:id/commands/firmware-update` | `{target_firmware_version, ttl_sec?}` |
| GET | `/api/admin/jobs/:jobId` | สถานะ + events |
| POST | `/api/admin/jobs/:jobId/cancel` | ยกเลิก (เฉพาะ PENDING / DELIVERED / ACKNOWLEDGED) |

### Device (`Authorization: Bearer <device token>` + `X-Device-Id: <device_id>`)
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/device/me/pending-commands` | ดึงคำสั่งค้างผ่าน REST (ใช้แทน WS ได้) |

`GET /health` ไม่ต้องใช้ token

## กติกาคำสั่ง

- สถานะ: `PENDING → DELIVERED → ACKNOWLEDGED → DOWNLOADING → VALIDATING → INSTALLING → REBOOTING → SUCCESS | FAILED | ROLLED_BACK`, `EXPIRED`
- `SUCCESS` ของ firmware ต้องมี `reported_firmware_version` และ `firmware_version` ใน HELLO หลังรีบูต ตรงกับ target
- `SUCCESS` ของ config ต้องมี `reported_config_version` ตรงกับ target
- คำสั่งที่จบแล้ว ถ้าได้รับสถานะซ้ำจะตอบสถานะเดิม (idempotent)
- ห้ามมี OTA สองงานพร้อมกัน; config ใหม่จะทำให้ config เก่าที่ยังไม่เริ่ม `EXPIRED (SUPERSEDED)`
- คำสั่งที่ยังไม่เริ่มทำจนเลย `expires_at` จะกลายเป็น `EXPIRED (TTL_EXPIRED)`
- **กล่องหลุดระหว่างทำคำสั่ง:** ถ้าคำสั่งอยู่ที่ `DELIVERED` / `ACKNOWLEDGED` / `DOWNLOADING` / `VALIDATING` แล้วกล่องหลุด และไม่กลับมาส่ง `HELLO` ภายใน `COMMAND_DISCONNECT_GRACE_SEC` (ค่าเริ่มต้น 60 วินาที, 0 = ปิด) จะเป็น `FAILED (DEVICE_DISCONNECTED)` — `INSTALLING` และ `REBOOTING` ใช้ `COMMAND_REBOOT_TIMEOUT_SEC` (ค่าเริ่มต้น 300 วินาที) แทน เพราะกล่องเขียน flash แล้วรีบูตเองได้โดยไม่ต้องใช้เน็ต ส่วน `PENDING` ใช้ `COMMAND_DELIVERY_TIMEOUT_SEC` ตามเดิม (เวลาที่หลุดดูได้จาก `disconnected_at` ของกล่อง)
- ถ้ากล่องส่ง `COMMAND_STATUS` มาหลังคำสั่งจบแล้ว สถานะจะไม่เปลี่ยน แต่จะเก็บ event `LATE_REPORT` (สถานะ/เวอร์ชันที่กล่องรายงาน) ไว้ใน `events`
- ping/heartbeat ทุก `HEARTBEAT_INTERVAL_SEC` (ค่าเริ่มต้น 10 วินาที) — connection ที่ไม่ตอบ ping จะถูกตัดภายในประมาณ 2 รอบ

## รันบน server จริง

- **TLS (WSS):** แนะนำให้ใช้ nginx / Caddy ทำ TLS อยู่ข้างหน้า แล้ว proxy เข้า `http://127.0.0.1:3018` หรือจะใส่ `TLS_CERT_FILE` / `TLS_KEY_FILE` ให้ Node เปิด WSS เองก็ได้
  ```nginx
  location /ws/device {
      proxy_pass http://127.0.0.1:3018;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 120s;
  }
  location / { proxy_pass http://127.0.0.1:3018; }
  ```
- ให้รันค้างไว้ด้วย pm2 หรือ systemd เช่น `pm2 start src/server.js --name ws-gateway`
- ใช้ได้กับ **instance เดียว** เท่านั้น เพราะ connection และ store อยู่ใน process เดียว ถ้าจะรันหลาย instance ต้องเปลี่ยนไปใช้ PostgreSQL + Redis ตามสเปกข้อ 12
- ปิดพอร์ต admin จากภายนอก หรือจำกัด IP ที่เรียก `/api/admin/*` ได้
