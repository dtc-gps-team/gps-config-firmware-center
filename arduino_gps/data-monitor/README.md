# data-monitor — Data Server จำลอง + หน้าเว็บดูข้อมูลที่ไหลเข้ามา

รับข้อมูลที่กล่อง ESP32 ส่งมา (`POST /api/gps`) แล้วแสดงบนเว็บแบบ real-time ว่ามีค่าอะไรส่งมาบ้าง

## รัน
```bash
cd data-monitor
npm install
npm start          # หรือดับเบิลคลิก start-data-monitor.bat ที่โฟลเดอร์หลัก
```
เปิด **http://localhost:320**

ตั้งพอร์ตได้ที่ `.env` (`PORT=320`)

## ให้กล่องส่งข้อมูลมาที่นี่
ตั้ง Config ของกล่อง (หน้าจัดการ → แท็บ Config หรือ API) เป็น:
```json
{ "settings": { "data_server": { "protocol": "http", "host": "192.168.1.100", "port": 320, "path": "/api/gps" } } }
```
- `192.168.1.100` ต้องอยู่ใน `DATA_SERVER_HOST_ALLOWLIST` ของ `delivery-server/.env` (ใส่ไว้แล้ว)
- กล่องต้องรัน firmware ที่รองรับ `http` (build ตั้งแต่ 19 ต.ค. 2569 23:00 เป็นต้นไป)

## ข้อมูลที่กล่องส่งมา
ทุกรอบ `gps.send_interval_sec` (ค่าเริ่มต้น 10 วินาที):
```json
{ "device_id": "BOX-0001", "latitude": 13.680359, "longitude": 100.603004, "speed_kmh": 42.5,
  "location_source": "gps", "fix": true, "satellites": 7, "firmware_version": "1.1.0", "timestamp": "2026-10-19T16:30:00Z" }
```
- ยังไม่มีสัญญาณ GPS: ส่ง**พิกัดเริ่มต้น** (13.680359, 100.603004) + `"location_source": "default"`, `fix` = `false`, `speed_kmh` = `null`
- โหมดจำลองการขับ: มี `"simulated": true` (ใช้พิกัดเริ่มต้นถ้าไม่มีสัญญาณ)

แจ้งเตือน (firmware 1.1.0 ขึ้นไป):
```json
{ "device_id": "BOX-0001", "event_type": "OVERSPEED", "speed_kmh": 86.0, "speed_limit_kmh": 80.0,
  "latitude": 13.680359, "longitude": 100.603004, "timestamp": "" }
```
v1.2.0 มี `GEOFENCE_EXIT` / `GEOFENCE_ENTER` (มี `distance_m`, `radius_m`)

## หน้าเว็บ
- **มุมมอง Terminal** (ปุ่ม "มุมมอง: Terminal" หรือเปิด `http://localhost:320/?view=term`): ข้อมูลไหลเข้ามาเป็นบรรทัดแบบ console ใหม่สุดอยู่ล่าง แจ้งเตือนสีแดง / โหมดจำลองสีเหลือง
- หน้าต่างดำของ data-monitor ก็พิมพ์ทุกข้อมูลที่รับเข้ามาเต็ม ๆ แบบเดียวกัน
- ตารางข้อมูลที่ไหลเข้ามา (ใหม่สุดอยู่บน, แถวแจ้งเตือนเป็นสีแดง) — คลิกแถวเพื่อดูข้อมูลดิบ + Google Maps
- **ค่าที่ส่งมา**: ทุกฟิลด์ที่เคยเห็น พร้อมชนิดข้อมูล ค่าล่าสุด และจำนวนครั้ง
- สถิติ: รับทั้งหมด, จำนวนกล่อง, ใน 1 นาทีล่าสุด, จำนวนแจ้งเตือน
- กรองตามกล่อง / หยุดชั่วคราว / ล้างข้อมูล

## API
| Method | Path | |
|---|---|---|
| POST | `/api/gps` (หรือ path ใดก็ได้ใต้ `/api/`) | รับข้อมูลจากกล่อง |
| GET | `/api/received?limit=200&device=BOX-0001` | ข้อมูลล่าสุด |
| DELETE | `/api/received` | ล้างข้อมูลที่แสดง |
| GET | `/events` | stream ข้อมูลใหม่ (Server-Sent Events) |

ข้อมูลทุกชิ้นบันทึกไว้ที่ `data/received-YYYY-MM-DD.jsonl` ด้วย
