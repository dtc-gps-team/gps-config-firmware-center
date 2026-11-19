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

## ค่าตั้ง (env)

| env | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `DEVICE_HUB_TCP_PORT` | `5000` | port ที่กล่องต่อเข้ามา |
| `DEVICE_HUB_BACKEND_URL` | (ไม่ตั้ง = ไม่ส่งพิกัด) | เช่น `http://localhost:3001/api/v1` |
| `DEVICE_HUB_DEVICES_FILE` | `devices.json` | ทะเบียนเครื่องที่อนุญาต |
| `DEVICE_HUB_LOG_DIR` | `logs` | log อ่านง่าย (`<วันที่>.log`) + hex (`<วันที่>.raw.log`) เวลาเป็น UTC |

กล่องที่ IMEI ไม่อยู่ใน `devices.json` จะถูกตัดสายทันที · IP เดียวเปิดสายพร้อมกันได้ไม่เกิน 5 สาย

## ส่งพิกัดเข้า backend

- แปลงเป็นรูปเดียวกับกล่อง ESP32 · event 19 → `OVERSPEED`, 20 → `GEOFENCE_ENTER`, 21 → `GEOFENCE_EXIT` · event อื่นส่งเป็นพิกัดธรรมดา
- ตำแหน่งที่ไม่ได้มาจาก GPS (เสา/Wi-Fi) ส่งเป็น `fix: false` — หน้าเว็บ/แอปกรองออกเหมือนกล่อง ESP32
- ชะลอเองไม่เกิน 60 ครั้ง/นาที/เครื่อง และ 240 ครั้ง/นาทีรวม (backend จำกัด 60/เครื่อง และ 300/IP)
- backend ล่ม → เก็บรอส่งใหม่ (สูงสุด 5000 จุดต่อเครื่อง) · backend ปฏิเสธ (4xx) → ทิ้งจุดนั้นพร้อม log

## เอกสารโปรโตคอล

อ้างอิง "TA255 GPRS Protocol V1.0 (2022-09-21)" ของ Meitrack — เอกสาร Confidential **ห้ามใส่ใน repo** ขอจากพี่เลี้ยง
