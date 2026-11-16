# delivery-server — HTTPS Firmware / Config Delivery

ส่วนนี้คือ **HTTPS Firmware / Config Delivery** ตามข้อ 2, 5, 6, 8 และ 11 ของ `ESP32_Central_Device_Management_Spec.md`

- เก็บ **Parameter Schema** แยกตาม firmware (`schemas/<hardware_model>/<schema_version>.json`) รองรับ `inherits`
- เก็บ **desired config** รายกล่อง และตรวจตาม schema ที่กล่องรันจริง (ปฏิเสธ key ที่ firmware ไม่รองรับ, ตรวจ type/range, ตรวจรูปแบบ IPv4 / allowlist ของชื่อโดเมน)
- เก็บ **firmware release** (.bin + sha256 + ลายเซ็น ECDSA P-256) และออก**ลิงก์ดาวน์โหลดอายุสั้น**ที่ผูกกับตัวกล่อง
- รับ **report** จากกล่อง (เวอร์ชันที่รันจริง, config ที่ apply แล้ว, health)

ข้อมูลเก็บใน `data/db.json`, `data/firmware/` และ `data/audit.log`

## ติดตั้ง / รัน

```bash
cd delivery-server
npm install
cp .env.example .env      # แล้วแก้ ADMIN_TOKEN, PUBLIC_BASE_URL, DATA_SERVER_HOST_ALLOWLIST
npm run keygen            # สร้างกุญแจเซ็น firmware (ทำครั้งเดียว)
npm start
```

ต้องใช้ Node.js 20.12 ขึ้นไป

### กุญแจเซ็น firmware

- `npm run keygen` จะสร้าง `keys/firmware-signing-private.pem` และ `keys/firmware-signing-public.pem`
- **private key** ใช้เซ็นเท่านั้น ควรเก็บไว้ที่เครื่องที่ build firmware **ไม่ต้องอัปโหลดขึ้น server จริง**
- **public key** ต้องอยู่บน server (`FIRMWARE_PUBLIC_KEY_FILE`) และต้องฝังไว้ใน firmware ESP32 ด้วย เพื่อให้กล่องตรวจลายเซ็นได้เอง
- เซ็นไฟล์ด้วย `npm run sign -- path/to/firmware.bin` แล้วนำ base64 ที่ได้ไปใส่ header `X-Firmware-Signature`

## Endpoints

### Admin (`Authorization: Bearer <ADMIN_TOKEN>`)
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/admin/devices` | รายการกล่อง + เวอร์ชันที่รายงาน |
| POST | `/api/admin/devices` | `{device_id, hardware_model, schema_version, token?}` → คืน token ครั้งเดียว |
| GET | `/api/admin/devices/:id` | รายละเอียดกล่อง |
| POST | `/api/admin/devices/:id/rotate-token` | ออก token ใหม่ |
| POST | `/api/admin/devices/:id/revoke` | ระงับกล่อง |
| GET | `/api/admin/schemas` | รายการ schema |
| GET | `/api/admin/schemas/:model/:version` | schema แบบ resolve แล้ว |
| POST | `/api/admin/schemas` | เพิ่ม schema ใหม่ (แก้ของเดิมไม่ได้) |
| GET | `/api/admin/devices/:id/config` | desired vs reported + `in_sync` |
| PUT | `/api/admin/devices/:id/config` | `{settings}` ตรวจตาม schema แล้ว `config_version + 1` |
| GET | `/api/admin/devices/:id/config/history` | ประวัติ config |
| GET | `/api/admin/firmware` | รายการ release |
| POST | `/api/admin/firmware` | body = ไฟล์ .bin, header `X-Hardware-Model`, `X-Firmware-Version`, `X-Schema-Version`, `X-Firmware-Signature` |
| PATCH | `/api/admin/firmware/:model/:version` | `{rollout_status: active \| paused \| revoked}` |

### Device (`Authorization: Bearer <device token>` + `X-Device-Id: <device_id>`)
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/device/me/config` | ดาวน์โหลด desired config |
| GET | `/api/device/me/firmware-manifest?target=1.1.0&current=1.0.0` | manifest + ลิงก์ดาวน์โหลด (กัน downgrade / ติดตั้งซ้ำ) |
| POST | `/api/device/me/report` | `{firmware_version, schema_version, config_version, reported_config, health}` |
| GET | `/firmware/download/:model/:version?device&exp&sig` | ลิงก์ที่ได้จาก manifest (ไม่ต้องใช้ token) |

`GET /health` ไม่ต้องใช้ token

## Config หลังย้อน firmware

เมื่อย้อน firmware เช่น 1.2.0 → 1.0.0 การบันทึก Config ครั้งถัดไปจะเก็บต่อเฉพาะค่าเดิมที่ schema ปัจจุบันรองรับ และเก็บ Config ก่อนแก้ไว้ใน history ส่วน parameter ที่ส่งเข้ามาใหม่ยังตรวจตาม firmware ที่กล่องรายงานจริงเสมอ

ตัวอย่างเปลี่ยนรอบส่ง GPS บน firmware 1.0.0 ด้วย `PUT /api/admin/devices/BOX-0001/config`:

```json
{ "settings": { "gps": { "send_interval_sec": 20 } } }
```

ต้องวาง `send_interval_sec` ใต้ `gps` หากต้องการใช้ `speed_limit` ให้อัปเดต firmware เป็น 1.1.0 ขึ้นไป และ `geofence` ต้องเป็น 1.2.0 ขึ้นไป รอให้กล่องรายงานเวอร์ชันใหม่ก่อนบันทึกค่าเหล่านี้

รันทดสอบด้วย `npm test`

## รันบน server จริง

- ตั้ง `PUBLIC_BASE_URL` เป็น URL https จริง (ใช้สร้างลิงก์ดาวน์โหลด)
- ตั้ง `DOWNLOAD_URL_SECRET` เป็นค่าคงที่ ไม่อย่างนั้นลิงก์ที่ออกไปแล้วจะใช้ไม่ได้หลังรีสตาร์ท
- TLS: ใช้ nginx / Caddy อยู่ข้างหน้า แล้ว proxy เข้า `http://127.0.0.1:3019` (ตั้ง `client_max_body_size 8m;` สำหรับอัปโหลด firmware) หรือใส่ `TLS_CERT_FILE` / `TLS_KEY_FILE`
- ใช้ได้กับ instance เดียว ถ้าจะ scale ต้องเปลี่ยนไปใช้ PostgreSQL + object storage ตามสเปก
- **token ของกล่อง** ต้องลงทะเบียนให้ตรงกันทั้งที่นี่และที่ ws-gateway (Postman ทำให้อัตโนมัติ)
