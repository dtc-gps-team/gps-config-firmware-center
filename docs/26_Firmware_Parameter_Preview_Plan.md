# แผนแสดงพารามิเตอร์ของ Firmware ตอนอัปโหลด และนำเข้า Parameter Library อัตโนมัติ

> **สถานะ:** แผน — ยังไม่มีโค้ด และยังไม่แก้ schema, backend หรือ Web ใน PR นี้
>
> **ผู้เขียน/ผู้รีวิว:** ร่างโดย B (kittiphong) วันที่ 26 ต.ค. 2569 · **งานทั้งหมดอยู่ในโมดูลของ A** (`firmware`,
> `config` Parameter Library, `central-device` และหน้า Web) จึงขอให้ A รีวิวและเป็นคนทำ ตามที่แบ่งงานไว้ใน `CLAUDE.md`
>
> **ต่อยอดจาก (ต้อง merge ก่อนเริ่มทำ):**
> - #362: `CentralDeviceClient.getSchema()` ทั้งตัวจริงและ mock
> - #372: `central-schema-import.ts` ตรรกะแปลง schema ของกล่องเป็น `ConfigFieldDefinition`
>
> **ที่มาของข้อมูล:** อ่านจาก `main` ที่ `ec8764b` + branch ของ #362 (`86e96e8`) และ #372 (`6ec7253`)
> และระบบ `arduino_gps` ในเครื่อง B (`delivery-server/src/firmware.js`, `schemas/ESP32-DEVKIT-V1/*.json`)

---

## 1. ปัญหาและเป้าหมาย

ตอนนี้การเพิ่มพารามิเตอร์ใหม่ให้กล่อง (เช่น บัซเซอร์ใน firmware 1.3.0) ต้องรันสคริปต์ใน terminal เพื่อนำ schema เข้า
Parameter Library และผู้ใช้บนเว็บไม่รู้เลยว่า firmware แต่ละเวอร์ชันรับพารามิเตอร์อะไรได้บ้าง

**เป้าหมาย:**

1. FirmwareEngineer อัปโหลด firmware เวอร์ชันใหม่บนเว็บ แล้ว**หน้าเว็บแสดงรายการพารามิเตอร์ที่ firmware นี้รองรับ**
   พร้อมป้าย **"ใหม่"** สำหรับพารามิเตอร์ที่เวอร์ชันก่อนหน้าไม่มี
2. พอ QAEngineer อนุมัติ firmware แล้ว พารามิเตอร์**เข้า Parameter Library เอง** ConfigEngineer สร้าง Config ที่ใช้
   พารามิเตอร์ใหม่ได้ทันที ไม่ต้องรันสคริปต์
3. **flow ส่งเข้ากล่องเหมือนเดิมทุกอย่าง:** QA อนุมัติ → Rollout → Operation อนุมัติ → ส่งผ่าน Server กลาง (#362)
   ส่วน Config ใช้ขั้นอนุมัติเดิม ไม่มีทางลัดใหม่

**ไม่ได้ทำ:** การเขียนโค้ดและ build firmware ยังทำในเครื่องนักพัฒนาเหมือนเดิม (ต้อง compile และเซ็นด้วย private key)

## 2. สถานะปัจจุบัน

### 2.1 ไฟล์ firmware บอกเลข schema อยู่แล้ว

firmware ของกล่องฝังป้ายนี้ไว้ในไฟล์ `.bin` ทุกเวอร์ชัน (`firmware/esp32_gps_box/version.h`):

```
@@FWVER:1.2.0;SCHEMA:3;MODEL:ESP32-DEVKIT-V1@@
```

`delivery-server` อ่านป้ายนี้ตอนรับไฟล์อยู่แล้ว (`delivery-server/src/firmware.js` ใช้ regex
`^(\d+\.\d+\.\d+);SCHEMA:(\d+);MODEL:([A-Za-z0-9._-]+)$`) และไฟล์รุ่นเก่าที่ไม่มีป้ายจะได้ `null`

**ป้ายบอกแค่เลข schema ไม่ได้บอกรายการพารามิเตอร์:** รายการจริงอยู่ในไฟล์ schema ที่ `delivery-server`
(`schemas/{model}/{N}.json`) และอ่านได้ผ่าน `GET /api/admin/schemas/{model}/{N}` ซึ่งรวมพารามิเตอร์ของเวอร์ชันที่
สืบทอดมาให้แล้ว (`inherits`)

### 2.2 ระบบเรา

| ส่วน | ตอนนี้ | ที่ไฟล์ |
|---|---|---|
| อัปโหลด firmware | รับ `file` + `version` + `deviceModel` ที่ผู้ใช้กรอกเอง **ไม่ได้อ่านอะไรจากตัวไฟล์** นอกจาก sha256 | `firmware.service.ts` `upload()` |
| ตาราง `Firmware` | ไม่มีช่องเก็บเลข schema | `schema.prisma` |
| QA อนุมัติ | `approve()` เปลี่ยน `approvalStatus` อย่างเดียว | `firmware.service.ts` `approve()` |
| ถาม schema จาก Server กลาง | `CentralDeviceClient.getSchema(model, version)` มีทั้งตัวจริงและ mock | #362 `central-device.client.ts` |
| แปลง schema เป็นพารามิเตอร์ของเรา | `central-schema-import.ts` (boolean→boolean, integer→integer, number→decimal, enum/string/hostname→string) แต่เรียกจากสคริปต์อย่างเดียว | #372 |
| Parameter Library | `ConfigFieldDefinition` (`fieldName` unique) + `ConfigFieldDefinitionModelSupport` (`deviceModel` + `protocol`) | `schema.prisma` |
| ตรวจตอนส่งเข้ากล่อง | `buildCentralSettings()` ปฏิเสธ key ที่ schema ของกล่องไม่มี | #362 `central-config.ts` |

## 3. ออกแบบ

### 3.1 ภาพรวม

```
FirmwareEngineer อัปโหลด .bin
  └─ backend อ่านป้าย @@FWVER@@ จากไฟล์ → เก็บ schemaVersion ลง Firmware
       └─ หน้า Firmware Detail: GET /firmware/{id}/parameters
            └─ backend ถาม Server กลาง getSchema(model, schemaVersion) → แสดงรายการ + ป้าย "ใหม่"
QAEngineer อนุมัติ
  └─ backend นำพารามิเตอร์เข้า Parameter Library (upsert ตาม central-schema-import ของ #372)
ConfigEngineer สร้าง Config ที่มีพารามิเตอร์ใหม่ → flow เดิมทุกอย่าง
```

### 3.2 ตอนอัปโหลด: อ่านป้ายจากไฟล์

- ใน `FirmwareService.upload()` ค้นหา `@@FWVER:` ใน `file.buffer` ด้วย regex เดียวกับ `delivery-server`
- **มีป้าย:**
  - เก็บ `schemaVersion` (ตัวเลข) ลง `Firmware`
  - ตรวจว่าป้ายตรงกับที่ผู้ใช้กรอก ทั้ง `version` และ `deviceModel` ถ้าไม่ตรงให้ตอบ 400 พร้อมบอกค่าที่อ่านได้จากไฟล์ (กันอัปโหลดไฟล์ผิดเวอร์ชัน) — **ดู Q1**
- **ไม่มีป้าย** (firmware ของกล่องรุ่นอื่น เช่น GT06N หรือ ESP32 รุ่นเก่า): `schemaVersion = null` อัปโหลดผ่านตามเดิม
  หน้าเว็บแสดงว่า "ไฟล์นี้ไม่มีข้อมูลพารามิเตอร์"
- **ไม่ต้องคุยกับ Server กลางตอนอัปโหลด:** อ่านจากไฟล์อย่างเดียว อัปโหลดจึงไม่ล้มเพราะ Server กลางล่ม

### 3.3 แสดงรายการ: `GET /firmware/{id}/parameters`

- สิทธิ์ `firmware:Read` (เท่ากับ `GET /firmware/{id}`)
- backend เรียก `getSchema(deviceModelCompatibility[0], schemaVersion)` ถ้า Firmware ไม่มี `schemaVersion` ให้ตอบ
  `{ status: "no_schema_tag" }`
- **ป้าย "ใหม่":**
  - เทียบกับ schema ของ firmware ตัวก่อนหน้าของรุ่นเดียวกัน คือตัวที่ `schemaVersion` สูงสุดที่ยังต่ำกว่าตัวนี้ และ
    `approvalStatus = approved`
  - ถ้าไม่มีตัวก่อนหน้า ไม่ติดป้ายเลย
- ทุกรายการบอกด้วยว่ามีใน Parameter Library แล้วหรือยัง (`inLibrary: boolean`)
- **ตัวอย่างคำตอบ:**
  ```json
  {
    "status": "ok",
    "hardwareModel": "ESP32-DEVKIT-V1",
    "schemaVersion": 4,
    "comparedWithSchemaVersion": 3,
    "parameters": [
      { "key": "output.enabled", "label": "เปิดใช้ขา output", "type": "boolean", "default": false,
        "isNew": true, "inLibrary": false },
      { "key": "speed_limit.max_kmh", "label": "ความเร็วสูงสุด", "type": "number", "min": 1, "max": 200,
        "unit": "km/h", "default": 80, "isNew": false, "inLibrary": true }
    ]
  }
  ```
- **Server กลางไม่รู้จัก schema นี้** (ยังไม่ได้ลงทะเบียน `N.json` ที่ `delivery-server`): ตอบ
  `{ status: "schema_not_found" }` หน้าเว็บบอกให้ลงทะเบียน schema ก่อน
- **ติดต่อ Server กลางไม่ได้:** ตอบ `{ status: "unavailable" }` ไม่ตอบ 5xx

### 3.4 หน้าเว็บ

- **Firmware Detail:** เพิ่มการ์ด "พารามิเตอร์ที่รองรับ"
  - ตารางมีคอลัมน์: key, ชื่อ (label), ชนิด, ช่วงค่าหรือตัวเลือก, ค่าเริ่มต้น และหน่วย
  - เรียงตัวที่เป็น **"ใหม่"** ไว้บนสุด
  - ตัวที่ยังไม่อยู่ใน Library ให้ติดป้าย "ยังไม่อยู่ใน Library (เข้าเองเมื่อ QA อนุมัติ)"
- **หลังอัปโหลดสำเร็จ:** ข้อความยืนยันบอกว่า "firmware นี้มีพารามิเตอร์ใหม่ N ตัว" แล้วลิงก์ไปหน้า Detail
- **สถานะอื่นของ `GET /firmware/{id}/parameters`:** `no_schema_tag`, `schema_not_found` และ `unavailable`
  แสดงเป็นข้อความอธิบาย ไม่ใช่ error สีแดง

### 3.5 QA อนุมัติ: นำเข้า Parameter Library

- ใน `FirmwareService.approve()` หลังเปลี่ยนสถานะเป็น `approved` แล้ว ให้เรียกตรรกะของ #372
  (`central-schema-import.ts`) ย้ายออกจากสคริปต์มาเป็น service ที่ใช้ได้ทั้งสคริปต์และ endpoint
- `ConfigFieldDefinition` upsert ตาม `fieldName` และ `ConfigFieldDefinitionModelSupport` upsert ตามรุ่น + protocol
  - protocol ใช้ `DeviceModel.supportedProtocols[0]` ของรุ่นนั้น (มติพี่เลี้ยงคือ 1 รุ่นใช้ได้โปรโตคอลเดียว)
  - **รุ่นไม่มีใน `DeviceModel` ของเรา:** ไม่สร้างรุ่นให้เอง ดู Q4
- **ตอนนำเข้าห้ามเขียนทับของเดิมเงียบๆ:**
  - ถ้า `fieldName` มีอยู่แล้วแต่ชนิดหรือตัวเลือกต่างจาก schema ใหม่ ห้ามเขียนทับ
  - ให้บันทึกเป็น "ขัดแย้ง" แล้วแสดงในหน้า Firmware Detail ดู Q5
- **นำเข้าไม่สำเร็จ ไม่บล็อกการอนุมัติ** (เช่น Server กลางล่มตอนนั้น):
  - การอนุมัติคุณภาพเป็นเรื่องของ QA ไม่ควรล้มเพราะระบบภายนอก
  - เก็บผลไว้ แล้วมีปุ่ม "นำเข้าพารามิเตอร์อีกครั้ง" ดู Q2
- **AuditLog:** `firmware/import-parameters` (mutation) metadata มี `firmwareId`, `schemaVersion` และจำนวนที่เพิ่ม/
  ขัดแย้ง ไม่มีค่าลับ

### 3.6 สิ่งที่ไม่เปลี่ยน

- **flow ส่งเข้ากล่อง:** Rollout → อนุมัติ → `pushFirmwareToCentral()` / `pushToCentral()` ของ #362
- **ขั้นอนุมัติ Config และ Separation of Duty**
- **ตรวจ key ตอนส่ง:** `buildCentralSettings()` ยังตรวจ key กับ schema ที่**กล่องรายงานว่ารันอยู่จริง** ถ้า Config มี
  `output.*` แต่กล่องยังเป็น 1.2.0 จะถูกปฏิเสธพร้อมเหตุผลเหมือนเดิม (ข้อจำกัดที่รู้อยู่แล้ว ดู §6)

## 4. ผลกระทบต่อ schema และเอกสาร

- **`Firmware`** เพิ่ม 2 ช่อง (additive migration ไม่มี FK ใหม่):
  - `schemaVersion Int?`: อ่านจากป้ายในไฟล์ (`null` = ไฟล์ไม่มีป้าย) และ **firmware ที่อัปโหลดก่อนมีฟีเจอร์นี้ไม่ backfill**
    ถ้าจะให้เห็นรายการต้องอัปโหลดใหม่ ดู Q3
  - `parametersImportedAt DateTime?`: เวลาที่นำเข้า Library สำเร็จ (`null` = ยังไม่ได้นำเข้า หรือนำเข้าไม่สำเร็จ)
- **endpoint ใหม่ 2 ตัว** ต้องอัปเดตคู่กันใน `openapi.yaml`:
  - `GET /firmware/{id}/parameters`
  - `POST /firmware/{id}/import-parameters` สำหรับปุ่มนำเข้าอีกครั้ง
- **`RBAC_Matrix.md`:** ไม่มี resource ใหม่ ใช้ `firmware:Read` และ `firmware-decision:Approve`
- **`GPS_Data_Dictionary.xlsx`:** เพิ่ม `FIRMWARE.schema_version` และ `FIRMWARE.parameters_imported_at`

## 5. แบ่งงาน

| งาน | ใคร | หมายเหตุ |
|---|---|---|
| migration + อ่านป้ายใน `upload()` + เทส | A | โมดูล `firmware` |
| ย้ายตรรกะนำเข้าจากสคริปต์ #372 เป็น service + เรียกใน `approve()` + endpoint นำเข้าอีกครั้ง | A | โมดูล `firmware` / `config` / `central-device` |
| `GET /firmware/{id}/parameters` | A | |
| หน้า Firmware Detail + ข้อความหลังอัปโหลด | A | Web |
| `openapi.yaml`, Data Dictionary | A (B รีวิว) | |
| ทดสอบกับกล่องจริงด้วย firmware 1.3.0 (บัซเซอร์) | B | B ทำ firmware 1.3.0 + `4.json` ใน `arduino_gps` แยกต่างหาก |
| รีวิว PR | B | |

**ลำดับ:** #362 และ #372 merge → A ทำตามแผนนี้ → B ทดสอบกับ BOX-0001

## 6. ข้อจำกัดที่รู้อยู่แล้ว (ไม่แก้ในแผนนี้)

- **Parameter Library ไม่ได้บอกว่าแต่ละพารามิเตอร์ต้องใช้ firmware เวอร์ชันไหน:** ConfigEngineer ใส่ `output.*` ใน Config
  ได้ แม้กล่องในกลุ่มจะยังเป็น 1.2.0 อยู่ จะไปถูกปฏิเสธตอนส่งรายเครื่องแทน ถ้าอยากให้เตือนตั้งแต่ตอนสร้าง Config
  ต้องเก็บ "schema ขั้นต่ำ" ต่อพารามิเตอร์เพิ่ม ซึ่งค่อยทำเป็นงานถัดไป
- **ลงทะเบียน schema ที่ `delivery-server` ยังทำบนเว็บเราไม่ได้:** ต้องวาง `N.json` หรือใช้หน้า `/admin` ของ
  `delivery-server` เอง ถ้าข้อมูลยังไม่มี หน้าเว็บเราจะบอกว่า `schema_not_found`
- **กล่องที่ไม่มีป้ายในไฟล์:** ไม่ได้ประโยชน์จากฟีเจอร์นี้ ใช้ Parameter Library แบบกรอกมือเหมือนเดิม

## 7. คำถามถึง A

- **Q1 — ป้ายในไฟล์ไม่ตรงกับที่กรอก:** ให้ตอบ 400 ตามที่เสนอ หรือให้ใช้ค่าจากไฟล์แทนค่าที่กรอก (หรือให้หน้าเว็บอ่านป้าย
  จากไฟล์แล้วเติมฟอร์มให้ก่อนกดอัปโหลด)
- **Q2 — ปุ่มนำเข้าอีกครั้ง:** ใครกดได้ เสนอ `firmware-decision:Approve` (QAEngineer คนที่อนุมัติ) หรือควรเป็น
  ConfigEngineer ซึ่งเป็นเจ้าของ Parameter Library
- **Q3 — firmware ที่อัปโหลดไปแล้วก่อนมีฟีเจอร์นี้:** ปล่อยไว้ (อัปโหลดใหม่ถ้าต้องการ) หรือทำสคริปต์ backfill อ่านป้าย
  จากไฟล์ใน Object Storage
- **Q4 — รุ่นที่ไม่มีใน `DeviceModel` ของเรา:** ข้ามแล้วแจ้งให้ Admin สร้างรุ่นก่อน (ที่เสนอ) หรือสร้างรุ่นให้อัตโนมัติ
  เหมือนสคริปต์ #372
- **Q5 — พารามิเตอร์ชื่อเดิมแต่ชนิดเปลี่ยน:** ไม่เขียนทับแล้วแจ้งว่าขัดแย้ง (ที่เสนอ) หรือยอมเขียนทับเมื่อเป็น firmware
  เวอร์ชันใหม่กว่า

## 8. นอกขอบเขต

- อัปโหลด schema ไปที่ `delivery-server` จากเว็บเรา
- เตือนตั้งแต่ตอนสร้าง Config ว่าพารามิเตอร์ต้องใช้ firmware ขั้นต่ำเวอร์ชันไหน (§6)
- build firmware บนเว็บหรือใน CI
