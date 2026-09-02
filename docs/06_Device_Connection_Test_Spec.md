# 06 — Device Connection Test: Endpoint ทดสอบสัญญาณอุปกรณ์ที่ติดตั้งจริง

> เสนอโดย: kittiphong (B) — 2026-09-02
> สถานะ: **เอกสารเสนอ ยังไม่ได้เขียนโค้ดจริง** — รอ paveekornk (A) รีวิวก่อนเริ่ม implement

## ที่มา

`POST /config/{configId}/simulate` (Stage 3, PR #49) ออกแบบไว้สำหรับ SW dry-run
Config **ระหว่างร่างอยู่** เท่านั้น — `SIMULATABLE_CONFIG_STATUSES` จึงอนุญาตแค่
สถานะ `draft`/`testing` ทำให้ช่างหน้างาน (ST/OT ผ่าน Mobile) ใช้ endpoint นี้
ทดสอบสัญญาณของอุปกรณ์ที่ติดตั้งจริงแล้ว (สถานะ `approved`/`synced` เสมอ) ไม่ได้
เลย (โดน 409 ทุกครั้ง) — ดูรายละเอียดเต็มใน `docs/architecture/RBAC_Matrix.md`
Section 6 (แก้ครั้งที่ 11)

เอกสารนี้เสนอ endpoint ใหม่แยกต่างหาก แทนที่จะขยาย `simulate` เดิม เพราะเป็น
คนละความหมายกัน: `simulate` ตรวจ**ค่า field ใน Config template** ว่าสมเหตุสมผล
ไหม ส่วน endpoint นี้ต้องตรวจ**การเชื่อมต่อจริงของอุปกรณ์เครื่องนั้น**

## 1. Path + Method

`POST /devices/{deviceId}/test-connection`

อ้างอิงด้วย **Device id** ไม่ใช่ Config id — ตั้งชื่อให้เข้าชุดกับ
`/devices/{deviceId}/status` ที่มีอยู่แล้ว

## 2. Request/Response

Request: ไม่มี body (server ดึงข้อมูล Device จาก DB เองจาก `deviceId` ใน path)

Response (`200`) — ข้อเสนอเบื้องต้น ยังไม่ fix รอ A ออกแบบร่วม:

```json
{
  "passed": true,
  "signalStrength": -67,
  "details": ["เชื่อมต่อสำเร็จ — RSSI -67 dBm (mock)"],
  "testedAt": "2026-09-02T10:00:00Z"
}
```

`signalStrength` เป็น optional — ยังไม่แน่ใจว่าจำเป็นต้องมีตั้งแต่ mock mode
หรือรอ real implementation ค่อยเติม (ต้องคุยกับ A)

## 3. RBAC (ยังไม่ fix — รอคุยกับ A)

Resource ใหม่: `device-connection-test`, action `Read` — เสนอ grant ให้ **ST, OT**
ก่อน (คนหน้างานที่ใช้ Mobile) ส่วนจะเปิดให้ SW/Operation อ่านด้วยไหม ยังเป็น
open question

## 4. กลไกทดสอบจริง

เสนอแยก env var ใหม่ `DEVICE_CONNECTION_TEST_MODE` (`mock` default | `real`)
**ไม่ใช้ตัวเดียวกับ `DEVICE_SIMULATOR_MODE`** เพราะเป็นคนละ capability กัน
(mock/real ของแต่ละอันอาจ progress ไปคนละจังหวะ) ตาม Mock Mode Pattern เดิม

โครง interface แยก Implementation ตาม pattern เดียวกับ `DeviceSimulator` ใน
`backend/src/config/device-simulator.ts`:

```ts
export interface DeviceConnectionTester {
  testConnection: (device: TestableDevice) => Promise<DeviceConnectionTestResult>;
}
export const DEVICE_CONNECTION_TESTER = Symbol('DEVICE_CONNECTION_TESTER');
```

Mock implementation เบื้องต้น: ตรวจแค่ `Device.status` (ดู `DeviceLifecycleStatus`
ใน `schema.prisma`) — ถ้า `installed` ให้ผ่าน (mock)

## 5. Error cases

- `404` — ไม่พบ Device (`deviceId` ผิด)
- `409` — Device ยังไม่ถึงสถานะ `installed` (ยังเป็น `registered` หรือ
  `decommissioned` ไปแล้ว) — ทดสอบสัญญาณอุปกรณ์ที่ยังไม่ติดตั้งไม่มีความหมาย
- `200` + `passed: false` — ทดสอบแล้วไม่ผ่าน (ไม่ตอบสนอง/สัญญาณอ่อน) — ไม่ใช่
  error เป็นผลลัพธ์ปกติที่ช่างต้องเห็น
- (real mode ในอนาคต) timeout — ยังไม่ต้องคิดตอนนี้เพราะ mock ไม่ต้องรอจริง

## ต้องคุยกับ A ก่อนเริ่ม implement จริง

- RBAC ข้อ 3 — เปิดให้ SW/Operation อ่านด้วยไหม
- `signalStrength` จำเป็นตั้งแต่ mock mode เลยไหม
- ใครเป็นเจ้าของ implementation (module `device` เดิม A ดูแลอยู่ไหม)
- Timeline — รอ B ออกแบบหน้า Mobile "ทดสอบสัญญาณ" เสร็จก่อนไหม
