# Firmware ESP32 GPS Box (v1.0.0 / v1.1.0 / v1.2.0 / v1.2.1)

Firmware ฝั่งกล่องที่ต่อกับ **ws-gateway** (WebSocket) และ **delivery-server** (Config / Firmware)

| เวอร์ชัน | Schema | ความสามารถ |
|---|---|---|
| **1.0.0** | 1 | GPS (GPIO13), ส่งพิกัดไป Data Server ตาม Config, LED สถานะ, Remote Config, OTA |
| **1.1.0** | 2 | + ตรวจจับความเร็วเกิน `speed_limit` → ส่ง event `OVERSPEED` |
| **1.2.0** | 3 | + แจ้งเตือนเข้า/ออกพื้นที่ `geofence` → ส่ง event `GEOFENCE_EXIT` / `GEOFENCE_ENTER` |
| **1.2.1** | 3 | แก้การยืนยัน OTA และเพิ่ม app-level rollback trial; ความสามารถเท่า v1.2.0 |

ทุกเวอร์ชันใช้โค้ดชุดเดียวกัน ([esp32_gps_box/](esp32_gps_box/)) โดย build แยก `FW_MAJOR`, `FW_MINOR` และ `FW_PATCH` ใน [version.h](esp32_gps_box/version.h)

## ต่อสาย

| GPS (GY-GPS6MV2) | ESP32 |
|---|---|
| VCC | VIN (5V) |
| GND | GND |
| TX | GPIO13 |

LED สถานะคือ LED บนบอร์ด (GPIO2)
- **ติดค้าง** = ต่อ Server ส่วนกลางแล้ว
- **กระพริบช้า** = มี WiFi แต่ยังไม่ต่อ Server
- **กระพริบสั้น ๆ** = ยังไม่มี WiFi
- **กระพริบเร็ว** = มีการแจ้งเตือน (ความเร็วเกิน / ออกนอกพื้นที่)

## Library ที่ต้องมี (Arduino Library Manager)

- **TinyGPSPlus** (Mikal Hart)
- **ArduinoJson** 7.x (Benoit Blanchon)
- **WebSockets** 2.7.x (Markus Sattler)
- Board: **esp32 by Espressif** 3.x

## Build เวอร์ชัน firmware

```bash
node firmware/build.js
```

ได้ไฟล์ใน `firmware/dist/`:
- `esp32_gps_box-<ver>.bin` สำหรับอัปโหลดขึ้น delivery-server (OTA)
- `esp32_gps_box-<ver>.merged.bin` สำหรับแฟลชผ่าน USB ครั้งแรก
- `releases.json` เก็บ sha256 และลายเซ็นของแต่ละเวอร์ชัน

สคริปต์จะเซ็นไฟล์ด้วย `delivery-server/keys/firmware-signing-private.pem` และใส่ลายเซ็นลงใน Postman environment ให้เอง

## แฟลช v1.0.0 ผ่าน USB (ครั้งแรกครั้งเดียว)

**ต้องใช้ Partition Scheme "Minimal SPIFFS (1.9MB APP with OTA)"** ไม่อย่างนั้น OTA จะไม่มีพื้นที่

- **Arduino IDE:** เปิด `firmware/esp32_gps_box/esp32_gps_box.ino` → Tools → Board: *ESP32 Dev Module* → Partition Scheme: *Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)* → Upload (`version.h` ตั้งเป็น 1.0.0 ไว้แล้ว)
- **หรือใช้ arduino-cli:**
  ```bash
  arduino-cli upload -b esp32:esp32:esp32:PartitionScheme=min_spiffs -p COM5 --input-dir firmware/dist/build/1.0.0
  ```

## ตั้งค่ากล่อง

1. มือถือต่อ WiFi `ESP32-GPS-Setup` รหัส `12345678` แล้วหน้าตั้งค่าจะเด้งขึ้นมาเอง
2. เลือก WiFi บ้าน + ใส่รหัส
3. **Device ID** = `BOX-0001`, **Device Token** = token ที่ได้จาก Postman ขั้น *01 Register*
4. **Gateway URL** / **Delivery URL** มีค่าเริ่มต้นชี้ไปที่เครื่องนี้ (`192.168.1.100`) อยู่แล้ว ถ้า IP เครื่องเปลี่ยนหรือย้ายไป server จริงให้แก้ตรงนี้ ไม่ต้องแฟลชใหม่
5. กดบันทึก เมื่อกล่องเชื่อมต่อได้ จะแสดง IP ให้ เปิด IP นั้นแล้วจะเห็นหน้าสถานะ (เวอร์ชัน, config, คำสั่งล่าสุด, GPS)

ถ้าจะเปลี่ยน WiFi หรือ Server ทีหลัง: กด **"ตั้งค่าใหม่"** ในหน้าสถานะ หรือกดปุ่ม BOOT ค้าง 3 วินาที

## สคริปต์สาธิต (Postman โฟลเดอร์ "0. DEMO")

| ขั้น | ทำอะไร | ผู้ชมจะเห็นอะไร |
|---|---|---|
| 01–02 | ลงทะเบียน BOX-0001 + อัปโหลด firmware 3 เวอร์ชัน | ได้ token |
| — | ตั้งค่ากล่องด้วย token | LED ติดค้าง และหน้าเว็บกล่องขึ้น "เชื่อมต่อ Server ส่วนกลางแล้ว" |
| 03 | ตรวจว่ากล่องออนไลน์ | `online: true`, `firmware_version_reported: 1.0.0` |
| 04 → 05 → 06 | ตั้ง Config + สั่งอัปเดต | หน้าเว็บกล่องแสดง config_version ใหม่ และ job ขึ้น `SUCCESS` |
| 07 → 05 | ปิด LED จากระยะไกล | **LED บนบอร์ดดับทันที** |
| 08 | ตั้ง speed_limit บน v1.0.0 | **400** เพราะ firmware ยังไม่รองรับ |
| 09 → 06 (กดซ้ำ) | OTA → 1.1.0 | DOWNLOADING 0..100% → VALIDATING → INSTALLING → REBOOTING → **SUCCESS** แล้วหน้าเว็บกล่องขึ้น v1.1.0 + Speed limit |
| 10 → 05 | ตั้ง speed limit 80 | config ใหม่มีหัวข้อ `speed_limit` |
| 11 → 06 | OTA → 1.2.0 | หน้าเว็บกล่องขึ้น v1.2.0 + Geofence |
| 12 → 05 | ตั้ง geofence (แก้พิกัดเป็นที่สาธิต) | config มี `geofence` |
| 13, 14 | ดูสถานะรวม + ประวัติคำสั่ง | desired = reported (`in_sync: true`) |

## ความปลอดภัยของ OTA

1. ขอ manifest จาก delivery-server (ต้องใช้ device token)
2. ดาวน์โหลดผ่านลิงก์อายุสั้น เขียนลง OTA partition ที่ไม่ได้ใช้อยู่ พร้อมคำนวณ SHA-256 ไปด้วย
3. ตรวจ **SHA-256** และ **ลายเซ็น ECDSA P-256** ด้วย public key ที่ฝังใน [signing_key.h](esp32_gps_box/signing_key.h) ถ้าไม่ผ่านจะยกเลิก ไม่ติดตั้ง
4. รีบูตเข้า firmware ใหม่ในโหมดทดลอง ต้องต่อ Gateway ได้ภายใน 3 นาที (health check) ไม่อย่างนั้น **rollback กลับเวอร์ชันเดิมเอง** แล้วรายงาน `ROLLED_BACK`
5. Gateway ส่งคำสั่งเดิมมาอีกครั้ง กล่องตอบ `SUCCESS` พร้อมเวอร์ชันใหม่

## หมายเหตุ

- `ws://` / `http://` ใช้ได้เฉพาะการสาธิตในวง LAN ถ้าใช้บน server จริงให้ใช้ `wss://` / `https://` กล่องจะตรวจ certificate ด้วย CA bundle ที่มากับ ESP32 core
- Data Server (`data.example.com/api/gps`) ต้องมี API รับ POST จริง ไม่อย่างนั้นหน้าเว็บกล่องจะแสดง HTTP 404 หรือ error อื่น แต่ระบบจัดการกล่องยังทำงานได้ตามปกติ
- ความเร็วสูงสุดเป็นแค่เกณฑ์แจ้งเตือน ไม่ได้ควบคุมรถจริง
- ถ้าสร้างกุญแจใหม่ด้วย `npm run keygen --force` ต้องแก้ `signing_key.h` แล้วแฟลชผ่าน USB ใหม่ทุกกล่อง
