# แผนฟีเจอร์ "กล่องจำลอง" ในแอป Mobile

> **สถานะ:** แผนเพื่อขอความเห็น — **ยังไม่มีโค้ดใน PR นี้** · ร่างแรก 20 ต.ค. 2569 โดย B (kittiphong)
>
> **เขียน §1–§9 ใหม่ทั้งหมด (22 ต.ค. 2569)** ตามทิศทางที่ตกลงกับ A ใน #357 (รีวิว A 20 ต.ค. + B ตอบรับวันเดียวกัน):
> **มือถือ 1 เครื่องเป็นกล่องอีกตัวบน ws-gateway ของพี่เลี้ยง** พูด protocol เดียวกับ ESP32 แทนแผนรุ่นก่อน (กล่องจำลอง
> หลายตัวที่ดึงงานจาก `/device-sync` ของเรา) · §10–§12 คงเดิม
>
> **ที่มาของข้อมูล:**
> - ระบบพี่เลี้ยง `arduino_gps`: `ws-gateway/src/{ws.js, commands.js}`, `firmware/esp32_gps_box/mgmt.h`,
>   `delivery-server/src/*` (อ่านโค้ด 20–22 ต.ค. 2569 ไม่ได้ทดลองต่อจริงจากมือถือ)
> - ระบบเรา: `main` หลัง #364 merge (`beb09fa`) และ #362 (โหมด `central`, ยังไม่ merge)
> - **โปรแกรมจำลองกล่องตัวอย่างของ A ยังไม่ได้แชร์** — เนื้อหาโปรโตคอลในเอกสารนี้มาจากโค้ดของพี่เลี้ยงโดยตรง เมื่อได้ตัวอย่างของ A
>   จะเทียบอีกรอบ

---

## 1. บริบทและเป้าหมาย

- **เป้าหมาย:** มีกล่อง **2 ตัว** บนระบบเดียวกัน — ESP32 จริงของพี่เลี้ยง 1 ตัว (`BOX-0001`) + มือถือ 1 เครื่อง — เพื่อให้สร้าง Campaign
  Rollout ที่มีมากกว่าหนึ่งเครื่องได้ และทดสอบผลปนกัน (สำเร็จ/ล้มเหลว/ออฟไลน์) โดยไม่ต้องมีฮาร์ดแวร์ตัวที่สอง
- **วิธี:** แอปทำตัวเป็นกล่องอีกตัวที่ต่อ `ws-gateway` ของพี่เลี้ยงตรง พูด protocol เดียวกับ ESP32 ทุกขั้น (WebSocket + ดึง Config จาก
  `delivery-server`) — สำหรับระบบพี่เลี้ยงและระบบเรา มือถือก็คือ "กล่องอีกตัว" เท่านั้น
- **ระบบเราส่งงานทางเดียว:** backend ของเราเป็น client ของ Admin API ของพี่เลี้ยง (โหมด `central` ของ #362) สั่งได้ทั้งสองกล่องใน
  Campaign เดียวกัน **ไม่มีเส้นทางส่งงานแยกสำหรับกล่องจำลอง**
- **ขอบเขต:** มือถือ 1 เครื่อง = 1 กล่อง (`mobile-sim-001`, §10–§11) ไม่ใช่การสร้างกล่องจำลองหลายตัวในแอป (A ยืนยันใน #357)
- **ไม่ใช้ `/device-sync` ของเรา** (B ตอบใน #357) — แผนรุ่นก่อนที่ต้องมี `POST /devices/simulated`, `isSimulated`, cap, cleanup
  ถูกตัดออกทั้งหมด

## 2. ข้อเท็จจริงจาก protocol ของพี่เลี้ยง

### 2.1 การเชื่อมต่อ (`ws-gateway/src/ws.js`)

| ขั้น | รายละเอียด |
|---|---|
| upgrade | `ws://<gateway>/ws/device` พร้อม header `Authorization: Bearer <token>` + `X-Device-Id: <device_id>` · token ผิด = 401 ตอน upgrade (ไม่ได้เปิด socket) · path อื่น = 404 |
| 1 connection ต่อ device_id | connection ใหม่เตะตัวเก่าออกด้วย `close(4000, 'replaced by new connection')` (§11.1) |
| `HELLO` (ต้องเป็นข้อความแรก) | `hardware_model` (string), `firmware_version` (semver `x.y.z`), `schema_version` (int ≥ 1), `config_version` (int ≥ 0), `boot_id` (string ≤ 64) · ผิดรูปแบบ = `ERROR INVALID_HELLO` + `fields` · ส่งอย่างอื่นก่อน = `ERROR HELLO_REQUIRED` |
| `WELCOME` | `device_id`, `server_time`, `heartbeat_interval_sec` (ค่าเริ่มต้น 30), `pending_commands` · จากนั้น gateway ส่งงานที่ยังไม่จบทั้งหมดซ้ำ |
| `HEARTBEAT` | `status` (object อิสระ) → ตอบ `HEARTBEAT_ACK` + `server_time` |
| `device_id` ใน message | ถ้าใส่ต้องตรงกับที่ยืนยันตัวไว้ ไม่งั้น `ERROR DEVICE_ID_MISMATCH` |
| ข้อความต้องเป็น JSON object (text) | binary / JSON เสีย = `ERROR INVALID_JSON` · type อื่น = `ERROR UNKNOWN_TYPE` |

### 2.2 งาน (`ws-gateway/src/commands.js`)

- **`COMMAND` ที่ gateway ส่งมา:** `command_id`, `device_id`, `action` (`UPDATE_CONFIG` \| `UPDATE_FIRMWARE`), `issued_at`,
  `expires_at`, `nonce` + `target_config_version` หรือ `target_firmware_version`
- **ส่งซ้ำได้** (ตอนต่อใหม่ / งานค้าง) → กล่องต้องกันทำซ้ำด้วย `command_id` เอง
- **`COMMAND_STATUS` ที่กล่องส่ง:** `command_id`, `status` (`ACKNOWLEDGED` / `DOWNLOADING` / `VALIDATING` / `INSTALLING` /
  `REBOOTING` / `SUCCESS` / `FAILED` / `ROLLED_BACK`), `progress_percent` (0–100), `reported_config_version` หรือ
  `reported_firmware_version`, `error_code`, `error_detail` (≤ 200 ตัวอักษร) → gateway ตอบ `STATUS_ACK` (`duplicate: true` ถ้างานจบแล้ว)
- **gateway ตรวจ SUCCESS เอง** (`SUCCESS_NOT_VERIFIED` ถ้าไม่ผ่าน):
  - Config: `reported_config_version` ต้องเท่ากับ `target_config_version`
  - Firmware: `reported_firmware_version` **และ** `firmware_version` ใน `HELLO` หลังต่อใหม่ ต้องเท่ากับ target
- สถานะทั้งหมด, timeout และกรณีพิเศษอยู่ที่ §11.4

### 2.3 ค่า Config มาจาก `delivery-server` ไม่ได้มากับ `COMMAND` (`firmware/esp32_gps_box/mgmt.h` `doConfigUpdate`)

1. ถ้า `target_config_version` เท่ากับ config ปัจจุบันอยู่แล้ว → `SUCCESS` ทันที
2. `ACKNOWLEDGED`
3. `GET <delivery>/api/device/me/config` (header เดียวกับตอนต่อ WebSocket) → `{ config_version, schema_version, settings }`
   - HTTP ไม่ใช่ 200 → `FAILED` `CONFIG_HTTP_<code>`
   - `config_version` ไม่ตรง target → `FAILED` `CONFIG_VERSION_MISMATCH`
   - `schema_version` < 1 หรือมากกว่าที่กล่องรองรับ → `FAILED` `SCHEMA_NOT_SUPPORTED` (schema เพิ่ม parameter อย่างเดียว กล่องรับ
     schema เดิมหรือเก่ากว่าได้)
   - `settings` ไม่ผ่านการตรวจของกล่อง → `FAILED` พร้อมรหัสของข้อนั้น
4. บันทึก Config ใหม่ แล้ว `SUCCESS` + `reported_config_version`

Firmware ใช้ `GET <delivery>/api/device/me/firmware-manifest?target=…&current=…` (§11.6) — ใช้ใน Phase 1b (§5)

### 2.4 ฝั่งระบบเรา

| เรื่อง | ของจริงตอนนี้ | ผลต่อแผน |
|---|---|---|
| ส่ง Config ไปกล่อง | #362 (ยังไม่ merge): `DEVICE_CONFIG_APPLY_MODE=central` + `CENTRAL_MODE=real` → หลังปล่อย Rollout backend สั่ง `PUT /api/admin/devices/{id}/config` ทีละเครื่อง แล้ว poll ผล (§12.3) | มือถือรับงานแบบเดียวกับ `BOX-0001` **ไม่ต้องแก้ backend ฝั่งส่งงาน** |
| ส่ง Firmware | #362 ยังไม่มี (A แจ้งใน #362 ว่ากำลังเพิ่มโหมด `central` ให้ Firmware ในใบเดียวกัน) | Phase 1b รอส่วนนี้ (§5) |
| แถวอุปกรณ์ในระบบเรา | Campaign เลือกเป้าหมายจากตาราง `Device` · ลงทะเบียนผ่านเว็บได้ตามปกติ (`POST /devices`, Admin/SuperAdmin) | ลงทะเบียน `deviceId = mobile-sim-001` ให้ตรงกับ `device_id` ของพี่เลี้ยง · **สถานะต้องรับงานได้** — ดู §9 Q2 |
| สิทธิ์ ST/OT สร้างกล่อง | ไม่มี และ**ไม่ต้องมีแล้ว** — admin ลงทะเบียนกล่องเดียวครั้งเดียว | ตัด endpoint ใหม่ทั้งหมดของแผนรุ่นก่อน |
| token ของ gateway | ตัดสินแล้วใน §10 (เก็บที่ backend เรา มือถือขอผ่าน staff JWT ไม่เก็บถาวร) | ใช้ตาม §10 |
| Mobile `ApiClient` | Dio ตัวเดียว ใส่ `Authorization` ของ staff แบบ global + interceptor ถือว่า 401 = session หมดอายุ | WebSocket และคำขอไป `delivery-server` ต้องใช้ client แยก (§4.2.3) |

## 3. แบ่งเป็น Phase

| Phase | ทำอะไร | พึ่งใคร |
|---|---|---|
| **0 — เตรียม** | (ก) พี่เลี้ยง/admin ลงทะเบียน `mobile-sim-001` ที่ `delivery-server` + `ws-gateway` (§11.2) · (ข) admin ลงทะเบียน `mobile-sim-001` ในระบบเราผ่านเว็บ · (ค) **งาน backend/web ของ §10:** ตาราง credential เข้ารหัส, endpoint ตั้งค่า (Admin) และ endpoint ให้มือถือขอ token (ST/OT), หน้าตั้งค่าบนเว็บ, resource ใหม่ใน RBAC — **ยังไม่ได้ตกลงว่าใครทำ** (A ขอให้จดแยกเป็นงานฝั่ง backend/web ในรีวิว 20 ต.ค.) ต้องเสร็จก่อนมือถือต่อ gateway ได้ | พี่เลี้ยง, Admin, ผู้ทำ §10 (ตกลงกันอีกที) |
| **1 — Config** | ต่อ gateway, HELLO/HEARTBEAT, รับงาน `UPDATE_CONFIG`, ดึง Config จาก `delivery-server`, รายงานผล, โหมดกดผลเอง/อัตโนมัติ | Phase 0 · #362 merge (ส่งงานจากระบบเรา) — ระหว่างรอ ทดสอบด้วยการสั่งจาก Admin API ของพี่เลี้ยงตรงได้ |
| **1b — Firmware** | รับงาน `UPDATE_FIRMWARE`, จำลองดาวน์โหลด/ติดตั้ง/รีบูต, รายงานเวอร์ชันใหม่ | ส่วน Firmware ของ #362 (A) (§5) |
| **2 — Telemetry** | ส่งพิกัดเข้า backend เรา | `docs/23` (merge แล้ว) และ endpoint รับ telemetry (§7) |

## 4. Phase 1 — กล่องจำลอง (Config)

### 4.1 Backend / Web ของเรา

- **ไม่มี endpoint ใหม่ฝั่งส่งงาน** — ใช้โหมด `central` ของ #362 ทั้งหมด
- **มีแค่งานของ §10** (Phase 0 ข้อ ค) — ตอน implement ให้รวมข้อเสนอของ A จากรีวิว 20 ต.ค. ด้วย:
  - ลง `AuditLog` ทุกครั้งที่มีการขอ token (ใคร เมื่อไหร่ ไม่ใส่ค่า token) และจำกัดอัตราการเรียก
  - เขียนลำดับขั้นตอนหมุน token ที่ต้องทำ 3 ที่ (`delivery-server`, `ws-gateway`, backend เรา) ให้ครบ
- แถว `Device` ของ `mobile-sim-001` ลงทะเบียนผ่านเว็บตามปกติ — ไม่แก้ schema

### 4.2 Mobile

#### 4.2.1 หน้า "กล่องจำลอง"

- หน้าเดียว (ตำแหน่งในแอปตัดสินตอน implement ใช้ design system v2 ตาม `docs/22`) แสดง:
  - สถานะการเชื่อมต่อ (กำลังต่อ / ออนไลน์ / ต่อใหม่ใน N วินาที / หยุดเพราะ 401)
  - `device_id`, เวอร์ชัน Config / Firmware / schema ที่กล่องจำลองถืออยู่
  - งานปัจจุบันและบันทึกขั้นที่ผ่านมา (เวลา + สถานะ + `error_code`)
- ปุ่มเปิด/ปิดกล่อง (ปิด = ปิด socket ใช้ทดสอบกรณีออฟไลน์)
- **ใช้ได้เฉพาะ ST/OT** (สิทธิ์ขอ token ตาม §10.3)

#### 4.2.2 ค่าที่ผู้ทดสอบตั้ง

- URL ของ `ws-gateway` และ `delivery-server` — กรอกในแอป (แบบเดียวกับที่ตกลงใน `docs/19` §8) ไม่ฝังใน build
- `device_id` และ token มาจาก backend เรา (§10.3) **ผู้ทดสอบไม่ต้องกรอก token**

#### 4.2.3 client แยกจาก staff

- WebSocket ตัวใหม่ที่ใส่ header `Authorization: Bearer <gateway token>` + `X-Device-Id` (Android/iOS รองรับ header ตอน upgrade ผ่าน
  `dart:io` `WebSocket.connect(headers: …)`)
- คำขอไป `delivery-server` ใช้ Dio อีกตัวที่ไม่มี interceptor ของ staff — กัน 401 ของ gateway ทำให้แอปคิดว่า session ช่างหมดอายุ และ
  กัน JWT ของช่างหลุดไประบบพี่เลี้ยง
- **cleartext:** server พี่เลี้ยงเป็น `ws://` / `http://` บน LAN — Android ต้องอนุญาต cleartext ให้ host นั้น (ดู §9 Q3) และมือถือ
  ต้องอยู่ Wi-Fi เดียวกับ server

#### 4.2.4 สถานะของกล่องจำลองที่แอปเก็บเอง

| ค่า | เริ่มต้น | หมายเหตุ |
|---|---|---|
| `hardware_model` | ตามที่ลงทะเบียนกับพี่เลี้ยง (`ESP32-DEVKIT-V1`) | ใช้ schema ของรุ่นนี้ |
| `firmware_version` | ค่าที่ตกลงตอนลงทะเบียน (เช่น `1.0.0`) | เปลี่ยนเฉพาะ Phase 1b |
| `schema_version` | ค่าที่ลงทะเบียนไว้ที่ `delivery-server` | กล่องจำลองรับ Config ของ schema นี้หรือเก่ากว่า (เหมือนกล่องจริง) |
| `config_version` + `settings` | `0` / ว่าง | อัปเดตเมื่องาน Config สำเร็จ |
| `boot_id` | สุ่มใหม่ทุกครั้งที่ "บูต" (เปิดกล่องในแอป / จำลองรีบูต) | ≤ 64 ตัวอักษร |
| `command_id` ที่ทำเสร็จแล้ว | ว่าง | กันทำงานซ้ำ (§2.2) |

- เก็บในเครื่องแบบไม่ลับ (ไม่ใช่ secret) — **ไม่เก็บ token** (§10.4)

#### 4.2.5 ทำตัวเป็นกล่อง

- ต่อ → `HELLO` → รอ `WELCOME` → `HEARTBEAT` ตาม `heartbeat_interval_sec` · ต่อใหม่ตามตาราง §11.3 (backoff 2 → 60 วินาที + jitter,
  รีเซ็ตเมื่อได้ `WELCOME`)
- **401 ตอน upgrade:** ขอ token ใหม่จาก backend 1 ครั้ง (§10.4) ถ้ายัง 401 → หยุดและแจ้งผู้ใช้ ไม่วนต่อ
- **ทำงานเฉพาะตอนแอปเปิดอยู่ (foreground)** — ปิดแอป = กล่องออฟไลน์ (ใช้ทดสอบ `DEVICE_OFFLINE` / `skipped_offline` ได้พอดี)
- ทำทีละงาน · ระหว่างแต่ละขั้นรายงานห่างกันไม่เกิน 180 วินาที (§11.4)

#### 4.2.6 งาน `UPDATE_CONFIG`

ทำตามลำดับเดียวกับกล่องจริง (§2.3) ทุกขั้น ต่างแค่ "ตรวจ settings" ที่แอปทำเท่าที่ schema ระบุ

| โหมดผลลัพธ์ (ตาม `docs/19` §8) | พฤติกรรม |
|---|---|
| **อัตโนมัติ** (ค่าเริ่มต้น) | ทำตามจริง สำเร็จถ้าทุกข้อผ่าน · ตั้งอัตราล้มเหลว % ได้ เพื่อทดสอบ Auto Pause |
| **กดเอง** | หยุดรอหลัง `ACKNOWLEDGED` ให้ผู้ทดสอบกด สำเร็จ / ล้มเหลว (เลือก `error_code` + ข้อความ) |

- ผลล้มเหลวที่แอปสร้างเองใช้ `error_code` ขึ้นต้น `SIM_` (เช่น `SIM_FORCED_FAIL`) ให้แยกจากความล้มเหลวจริงได้บนหน้า Rollout
- ใส่หน่วงเวลาสั้นๆ ระหว่างขั้น (เช่น 1–3 วินาที) ให้เห็นขั้นในแอปและบนหน้า Rollout แต่อยู่ในกรอบเวลา §11.4

#### 4.2.7 แยกกล่องจำลองออกจากกล่องจริงที่เว็บ

- A ตั้งข้อสังเกตใน #357: กล่องมือถือปนกับกล่องจริงในหน้าเลือกเป้าหมาย Campaign และ Dashboard อาจทำให้ตัวเลขและเกณฑ์
  Auto Pause (> 5%) เพี้ยน ควรมีป้ายหรือวิธีแยกที่เว็บ
- แผนรุ่นก่อนใช้ field `isSimulated` ซึ่งตัดไปแล้ว — **วิธีแยกยังไม่ได้ตกลง** ดู §9 Q1

## 5. Phase 1b — จำลอง OTA Firmware (รอส่วน Firmware ของ #362)

- **ไม่ต้องตรวจลายเซ็นหรือ health check เอง** (A อ่านโค้ด `firmware/esp32_gps_box` แล้วยืนยันใน #357) — แค่รายงานขั้นให้ถูกลำดับ
- ลำดับ:
  1. `ACKNOWLEDGED`
  2. `DOWNLOADING` พร้อม `progress_percent` — ขอ manifest ใหม่ทุกครั้งก่อนดาวน์โหลด (§11.6) จะดาวน์โหลดไฟล์จริงหรือจำลองความคืบหน้า
     ตัดสินตอน implement
  3. `VALIDATING` → `INSTALLING` → `REBOOTING`
  4. **รีบูต = ปิด socket แล้วต่อใหม่** ด้วย `HELLO` ที่ `firmware_version` เป็นเวอร์ชันใหม่ และ `boot_id` ใหม่ ภายใน 300 วินาที
  5. `SUCCESS` + `reported_firmware_version` (gateway ตรวจกับ `HELLO` ตาม §2.2)
- จำลองกรณีพิเศษ: `ROLLED_BACK` (ต่อใหม่ด้วยเวอร์ชันเดิม) และสั่งเวอร์ชันที่ติดตั้งอยู่แล้ว (`SUCCESS` ทันทีแบบกล่องจริง §11.4)

## 6. Downgrade (ย้อนเวอร์ชัน)

- **ระบบเรา:** ไม่มีกติกาเทียบเวอร์ชัน Firmware (Operation เลือกรุ่นที่อนุมัติแล้วรุ่นไหนก็ได้)
- **ระบบพี่เลี้ยง:** มีกติกาที่ `delivery-server` (`ALLOW_FIRMWARE_DOWNGRADE` / header `X-Allow-Downgrade`) — การบล็อกหรืออนุญาต
  เกิดที่ server ก่อนสร้างงาน
- **กล่องจำลอง:** รับเวอร์ชันที่ gateway ส่งมาเสมอ ไม่ตัดสินเอง (กติกาอยู่ฝั่ง server)
- **Config:** "ย้อน" = Rollback ของ Campaign ซึ่งสร้างงาน Config ใหม่ — กล่องจำลองรับได้เหมือนงานปกติ

## 7. Phase 2 — จำลองส่ง GPS telemetry

- ทำตาม `docs/23` (merge แล้ว) เมื่อ backend มี endpoint รับ telemetry จริง · แนวคิด: ส่งพิกัดจาก GPS ของมือถือ หรือเส้นทางสมมติ
- token ของ telemetry เป็นคนละตัวกับ token ของ gateway (`docs/23` §7)

## 8. นอกขอบเขต

- **PR นี้เป็นเอกสารแผนเท่านั้น** — ไม่แก้ schema, ไม่สร้าง endpoint, ไม่แก้โค้ด Mobile/Web
- **ตัดออกจากแผนรุ่นก่อน:** `POST /devices/simulated`, `DELETE /devices/simulated/:deviceId`, `Device.isSimulated` /
  `simulatedById`, cap ต่อบัญชี, cleanup อัตโนมัติ, การดึงงานผ่าน `/device-sync` ของเรา
- ไม่สร้างกล่องจำลองหลายตัว · ไม่ทำงานในพื้นหลัง · ไม่แฟลชหรือติดตั้ง firmware จริงบนมือถือ
- ไม่ใช้หรือฝัง Web Admin ของ `delivery-server` (§12.2) และไม่ใส่ token ร่วมหรือ `ADMIN_TOKEN` ในแอปหรือ repo
- จะเปิด PR implementation แยก (backend/web ของ §10, mobile) หลังตกลง §9

## 9. คำถามเปิด

> **Q1–Q3 เดิม (endpoint แยก, cap ต่อบัญชี, cleanup) ปิดไปแล้ว** — ไม่มีความหมายเมื่อไม่สร้างกล่องจำลองในระบบเรา (A ระบุใน #357)

**Q1 (ใหม่) — แยกกล่องจำลองที่เว็บ:** ควรแยก `mobile-sim-001` ออกจากกล่องจริงในหน้าเลือกเป้าหมาย Campaign, Dashboard และการนับ
Auto Pause อย่างไร (§4.2.7) — เช่น ป้ายจากรูปแบบ `deviceId`, field ใหม่ใน `Device`, หรือไม่แยก (กล่องเดียว ใช้ทดสอบอย่างเดียว)

**Q2 (ใหม่) — สถานะของแถว `Device`:** `POST /devices` สร้างเป็น `registered` และยังไม่มี endpoint เปลี่ยนเป็น `installed` (ข้อสังเกต
เดิมของแผนรุ่นก่อน) — การส่ง Config ของระบบเราต้องการเครื่องที่ `installed` · `BOX-0001` ตั้งสถานะนี้อย่างไร และ `mobile-sim-001`
ควรใช้วิธีเดียวกันไหม

**Q3 (ใหม่) — cleartext บน Android:** อนุญาต `ws://` / `http://` ไปที่ server พี่เลี้ยงแบบไหน — เปิดเฉพาะ build สำหรับทดสอบ
(network security config ระบุ host) หรือทุก build

**Q4 — ระบบเราสั่งงานไปที่ delivery-server:** ส่วน Config มีแผนแล้วใน #362 · ส่วน Firmware และการจำกัดสิทธิ์ credential ยังเปิดอยู่ ดู §12.3

---

## 10. Token Management สำหรับ Gateway Connection

> **สถานะของหัวข้อนี้: ตัดสินใจแล้ว (B, 20 ต.ค. 2569) และไม่ขึ้นกับโค้ดตัวอย่างของ A**
> เพิ่มหลังจากตกลงกับ A ใน PR #357 ว่าจะเปลี่ยนทิศทางเป็น "มือถือต่อ ws-gateway ของพี่เลี้ยงตรง" (มือถือเป็นกล่องอีกตัว
> ในระบบ `arduino_gps`) · §1–§9 เขียนใหม่ตามทิศทางนี้แล้ว (22 ต.ค. 2569) ไม่ใช่แผนรุ่นก่อน (`/device-sync` + กล่องจำลอง
> หลายตัว) อีกต่อไป · เนื้อหา protocol ใน §2 มาจากโค้ดของพี่เลี้ยงโดยตรง เพราะโค้ดตัวอย่างของ A ยังไม่ได้แชร์
>
> หัวข้อนี้ใช้แทนสองจุดเดิมเฉพาะเรื่อง token ของ Gateway: การเก็บ key ใน `flutter_secure_storage` (§4.2) และการให้ผู้ทดสอบกรอก
> key เอง (`docs/19` §8)

### 10.1 ที่มาของ token

- ออก token ให้ device_id เฉพาะ **`mobile-sim-001`** ผ่าน Admin API ของพี่เลี้ยง **ไม่ใช้รหัสร่วมของ auto-register**
  - ตรวจข้อมูลจริงแล้ว (20 ต.ค.): กล่องจริง `BOX-0001` ไม่ได้มาจาก auto-register มี `DEVICE_REGISTER` โดย `admin` ใน audit
    ของทั้งสองเซอร์วิส และ record ไม่มี `auto_registered`
- ต้องลงทะเบียน **ทั้ง 2 เซอร์วิสด้วย token เดียวกัน** (สองระบบไม่ sync กันเอง แบบเดียวกับ `BOX-0001`):
  - `delivery-server` `POST /api/admin/devices` (ระบุ `hardware_model` + `schema_version` ที่มี schema อยู่จริง) ถ้าไม่ส่ง
    `token` server จะสร้างให้ (32 ตัวอักษร) และตอบกลับเป็น plaintext **ครั้งเดียว**
  - `ws-gateway` `POST /api/admin/devices` ส่ง `token` ค่าเดียวกันเข้าไป
- ต้องเป็น device_id ของมือถือเอง ห้ามใช้ `BOX-0001` เพราะ gateway เก็บได้ 1 connection ต่อ device_id
  connection ใหม่จะเตะ connection เดิมออก (`close(4000, 'replaced by new connection')`)

### 10.2 เก็บที่ backend ของทีมเรา ไม่เก็บในตัวแอป

- **config entry ใหม่ ไม่ใช้ตาราง `Device` เดิม:** token นี้เป็น credential ของระบบภายนอก ไม่ใช่กล่องของเรา
  - backend ยังไม่มีตาราง setting หรือ util เข้ารหัสอยู่เลย จึงต้องเพิ่มใหม่ (additive migration) ชื่อและรูปแบบจะตกลงตอน
    implement เช่น `IntegrationCredential { key @unique, externalDeviceId, encryptedToken, iv, authTag, updatedById, updatedAt }`
    ใช้ `key` เป็น `mentor-gateway` ไว้แยกกับ credential ภายนอกตัวอื่นในอนาคต
- **เข้ารหัสแบบถอดกลับได้ (encrypt at rest):** เช่น AES-256-GCM ด้วย key จาก env var ใหม่ (ห้าม commit ค่าเข้า repo)
  - ต่างจาก `Device.apiKeyHash` ของกล่องจริงที่เป็น bcrypt (hash ทางเดียว) เพราะ backend ของเราแค่ **ตรวจ** key ที่กล่อง
    ส่งมา แต่ token นี้มือถือต้องเอา **ค่าจริง** ไปยิงออกไปที่ ws-gateway
- **ตั้งและดูค่าได้เฉพาะ Admin / SuperAdmin** ตาม pattern เดิม (`@RequirePermission(resource, ActionType)` + grant ใน `seed.ts`)
  เช่น resource ใหม่ `simulator-gateway-config` action `Read` / `Update` grant ให้ Admin (SuperAdmin สืบทอด)
  - Admin / SuperAdmin เข้า Mobile ไม่ได้ (`webOnlyRoles`) จึงตั้งค่าผ่าน Web เท่านั้น
  - การตั้งหรือเปลี่ยน token เป็น mutation ต้องลง `AuditLog` (ไม่ใส่ค่า token ใน log) หน้า Web ควรแสดงแบบปิดบังเป็นค่าเริ่มต้น

### 10.3 Endpoint ใหม่ให้มือถือขอ token

- ยืนยันตัวตนด้วย **staff JWT ปกติของมือถือ** (`JwtAuthGuard`) ไม่ใช่ `DeviceApiKeyGuard` / `X-Device-Api-Key`
- จำกัดสิทธิ์ด้วย permission ใหม่ของฟีเจอร์นี้ เช่น resource `simulator-gateway-token` action `Read` grant ให้ **ST / OT**
- backend ถอดรหัสแล้วตอบ token จริง เช่น `{ "deviceId": "mobile-sim-001", "token": "…" }` พร้อม header
  `Cache-Control: no-store` ถ้ายังไม่ได้ตั้งค่าตอบ 404
- **path:** ที่ร่างไว้คือ `GET /devices/simulator-gateway-token` แต่ใน `device.controller.ts` มี `@Get(':deviceId')` อยู่แล้ว
  path นี้จะชนกับ route นั้น (ถูกตีความเป็น deviceId) จึงเสนอแยก path เช่น `GET /simulator/gateway-token` หรือถ้าจะอยู่ใต้
  `/devices` ต้องประกาศ route นี้ก่อน `:deviceId`
- ตอน implement ต้องอัปเดต `openapi.yaml` (operationId, tag, 401/403/404) และ `RBAC_Matrix.md` ตามกฎใน `CLAUDE.md`

### 10.4 ฝั่งมือถือไม่เก็บ token ถาวร

- ขอ token จาก backend ทุกครั้งที่เริ่มใช้ฟีเจอร์ simulator และ cache ไว้ใน memory ระหว่าง session เดียวเท่านั้น
- ทิ้งเมื่อปิดแอปหรือ logout **ไม่ใช้ `flutter_secure_storage`** หรือที่เก็บถาวรอื่นของเครื่อง และไม่ log ค่า token
- ถ้า ws-gateway ปฏิเสธ (401 ตอน upgrade) ให้ขอ token จาก backend ใหม่ 1 ครั้ง เผื่อเพิ่งเปลี่ยน token ถ้ายังไม่ผ่านให้หยุดและแจ้งผู้ใช้

### 10.5 ข้อดีและข้อจำกัด

**ข้อดี**
- เพิกถอนหรือเปลี่ยน token ได้จากที่เดียว (แก้ที่ backend ของเรา) ไม่ต้องไล่แก้ในเครื่องผู้ใช้
- ไม่มี token ค้างอยู่ในเครื่องมือถือที่อาจหายหรือถูกแครก

**ข้อจำกัดที่ต้องรู้**
- ระหว่างใช้งาน token ยังเป็น plaintext อยู่ใน memory ของแอป และผู้ที่มีสิทธิ์ ST/OT ขอค่าได้ทุกคน แนวทางนี้ลดการค้างของ
  token ในเครื่อง ไม่ได้ซ่อน token จากผู้ใช้ที่มีสิทธิ์
- การเปลี่ยน token ต้องทำ 3 ที่ให้ตรงกัน: `delivery-server`, `ws-gateway` (พี่เลี้ยง) และค่าที่เก็บใน backend ของเรา
- device_id เดียว (`mobile-sim-001`) ต่อ gateway ได้ทีละ 1 เครื่อง ถ้าช่าง 2 คนเปิด simulator พร้อมกันจะเตะกันเอง
  (ดู §10.1) ถ้าต้องให้หลายเครื่องใช้พร้อมกัน ต้องออก device_id + token แยกต่อเครื่อง ซึ่งยังไม่อยู่ในขอบเขตตอนนี้

---

## 11. ข้อเท็จจริงจากระบบ `arduino_gps` ที่ยืนยันแล้ว (ไม่ขึ้นกับโค้ดตัวอย่างของ A)

> **ที่มา:** B อ่านโค้ดและข้อมูลจริงของระบบพี่เลี้ยงที่รันอยู่ (`ws-gateway`, `delivery-server`, `data-monitor`, firmware
> `esp32_gps_box`) เมื่อ 20 ต.ค. 2569 ไม่ได้ทดลองกับกล่องจริง ข้อมูลงานมาจากประวัติงานจริง 41 งานใน `ws-gateway`
> (UPDATE_FIRMWARE 34, UPDATE_CONFIG 7) · ค่า timeout / TTL ในหัวข้อนี้เป็น**ค่าเริ่มต้นในโค้ด** `.env` ของพี่เลี้ยงตั้งทับได้
>
> หัวข้อนี้เป็นข้อกำหนดที่แอปต้องทำตาม ส่วน flow การเชื่อม Gateway และโครงสร้าง WebSocket client ในแอปยังรอโค้ดตัวอย่างจาก A
> · ตาราง §4.2.4 เดิมเป็นการเทียบกับ `/device-sync` ของเรา (แผนรุ่นก่อน) ตารางสถานะของ Gateway อยู่ที่ §11.4 แทน

### 11.1 Device ID ของมือถือ

- ต้องใช้ device_id ของมือถือเอง **ห้ามซ้ำกับ `BOX-0001`** ใช้ `mobile-sim-001` ตามที่ตัดสินใจใน §10.1
- เหตุผลจากโค้ด `ws-gateway` (`src/ws.js`): gateway เก็บได้ 1 connection ต่อ device_id เมื่อ connection ใหม่ยืนยันตัวผ่าน
  connection เดิมจะโดน `close(4000, 'replaced by new connection')` ทันที ถ้าใช้ device_id เดียวกับกล่องจริง กล่องจริงจะหลุด
  แล้วต่อกลับมาเตะมือถือออก สลับกันไปเรื่อยๆ

### 11.2 ขั้นตอนลงทะเบียน (admin / พี่เลี้ยงทำ ทำผ่านแอปไม่ได้)

1. `delivery-server` `POST /api/admin/devices` ก่อน
   - ระบุ `device_id`, `hardware_model` และ `schema_version` ที่มี schema ลงทะเบียนไว้แล้ว (ตอนนี้มี schema 1, 2, 3 ของ
     `ESP32-DEVKIT-V1`)
   - ถ้าไม่ส่ง `token` server สร้างให้ (สุ่ม 24 byte แบบ base64url = 32 ตัวอักษร) และตอบเป็น plaintext **ครั้งเดียว** ใน
     response 201 server เก็บแค่ hash
   - ถ้าใส่ `token` เอง ต้องยาวอย่างน้อย `MIN_DEVICE_TOKEN_LENGTH` (ค่าเริ่มต้น 24 ตัวอักษร)
2. `ws-gateway` `POST /api/admin/devices` ด้วย `device_id` และ **token ค่าเดียวกัน** (สองระบบไม่ sync กันเอง)
3. admin นำ token ไปตั้งค่าที่ backend ของเราผ่าน Web ตาม §10.2 มือถือขอผ่าน endpoint ใน §10.3 **ผู้ทดสอบไม่ต้องกรอก token
   ในแอป**

**ไม่ใช้ auto-register ด้วยรหัสร่วม:** `BOX-0001` ก็ลงทะเบียนด้วยมือแบบนี้ (audit ของทั้งสองเซอร์วิสมี `DEVICE_REGISTER` โดย
`admin` hash ของ token ตรงกันทั้งสองระบบ และ record ไม่มี `auto_registered`) แต่คู่มือของพี่เลี้ยง (`คู่มือการใช้งาน.md`)
เขียนว่า "ไม่ต้องลงทะเบียนกล่อง ใช้รหัสร่วมที่ฝังใน firmware" **คู่มือกับของจริงขัดกัน ควรถามพี่เลี้ยงให้ชัดตอนมีโอกาส**

### 11.3 การต่อใหม่ (reconnect) ให้ทำตามกล่องจริง

| เรื่อง | กล่องจริงทำ / gateway ทำ | แอปต้องทำ |
|---|---|---|
| Backoff | เริ่ม 2 วินาที เพิ่ม 2 เท่าทุกรอบ สูงสุด 60 วินาที บวก jitter สุ่มไม่เกิน 1 วินาที รีเซ็ตเป็น 2 วินาทีเมื่อได้ `WELCOME` (HELLO ผ่าน) ไม่ใช่แค่เปิด socket ได้ | ทำแบบเดียวกัน |
| HELLO | ต้องเป็นข้อความแรกทุกครั้งที่ต่อใหม่ ถ้าไม่ส่งก่อน message อื่นจะได้ `HELLO_REQUIRED` | ส่ง HELLO ทุกครั้งหลังเชื่อมต่อ |
| HEARTBEAT | gateway บอก `heartbeat_interval_sec` (ค่าเริ่มต้น 30) ใน `WELCOME` | ส่ง HEARTBEAT ตามรอบนั้น |
| งานค้างตอนต่อกลับ | หลัง HELLO gateway ส่ง**งานที่ยังไม่จบทั้งหมดซ้ำ** (ไม่ใช่แค่ PENDING) | กันทำซ้ำด้วย `command_id` เอง |
| รายงานซ้ำหลังงานจบ | gateway ตอบสถานะเดิมพร้อม `duplicate: true` | ส่งซ้ำได้ ไม่ต้องกลัวเปลี่ยนผล |
| ws ping | gateway ส่ง ping ทุก `heartbeat_interval_sec` | ตอบ pong (`WebSocket` มาตรฐานของ Dart ตอบให้อัตโนมัติ) |
| ตัดสินว่า offline | ถ้าไม่มี pong หรือ message ใดๆ เข้ามาก่อน ping รอบถัดไป gateway จะ `terminate()` (รู้ภายใน 30–60 วินาที) | — |

### 11.4 สถานะงานของ Gateway (11 สถานะ)

| สถานะ | ใครตั้ง | ความหมาย / ที่เห็นจริง |
|---|---|---|
| PENDING | gateway | สร้างงานแล้ว รอส่ง |
| DELIVERED | gateway | ส่งถึง connection ที่ HELLO แล้ว (กล่องออนไลน์ = ~0 วินาทีหลังสร้าง) |
| ACKNOWLEDGED | กล่อง | รับงานแล้ว |
| DOWNLOADING | กล่อง | ส่งซ้ำพร้อม `progress_percent` 0, 10 … 100 (ไฟล์ ~1.3 MB ใช้ ~9 วินาที) |
| VALIDATING | กล่อง | ตรวจไฟล์ |
| INSTALLING | กล่อง | |
| REBOOTING | กล่อง | |
| SUCCESS | กล่อง | Firmware: ต้องมาหลังต่อใหม่ด้วย HELLO ที่มีเวอร์ชันใหม่ (เห็นจริง ~6 วินาทีหลัง REBOOTING) · Config: ~0.2 วินาทีหลัง ACKNOWLEDGED |
| FAILED | กล่อง หรือ gateway (timeout) | ของจริงเกิดหลัง ACKNOWLEDGED ทันทีได้ (เช่น `MANIFEST_HTTP_409`, `UPDATE_BEGIN_FAILED`, `DOWNLOAD_HTTP_-1`) |
| ROLLED_BACK | กล่อง | หลัง REBOOTING เมื่อ firmware ใหม่ไม่ผ่าน health check (`NEW_FIRMWARE_FAILED_HEALTH_CHECK`) รายงานเวอร์ชันเดิม |
| **EXPIRED** | gateway | **สถานะที่ 11** ไม่อยู่ในรายการ 10 สถานะที่วางไว้เดิม · `TTL_EXPIRED` = ค้างที่ PENDING / DELIVERED / ACKNOWLEDGED เกินอายุงาน (24 ชั่วโมง) · `SUPERSEDED` = งาน Config ที่ยังไม่เริ่มถูกงาน Config ใหม่แทน |

กรณีพิเศษที่เห็นจริง: สั่ง Firmware เวอร์ชันที่ติดตั้งอยู่แล้ว กล่องตอบ SUCCESS ทันทีโดยข้าม ACKNOWLEDGED (PENDING → DELIVERED →
SUCCESS) · PENDING / DELIVERED / EXPIRED เป็นสถานะของ gateway กล่องรายงานเองไม่ได้

**Timeout ของ server ที่ทำให้งาน FAILED** (`expireSweep` ทุก 5 วินาที นับจากเวลาที่งานอัปเดตล่าสุด):

| สถานการณ์ | Timeout | ผล |
|---|---|---|
| ยังเป็น PENDING | 600 วินาที (`COMMAND_DELIVERY_TIMEOUT_SEC`) | FAILED `DEVICE_OFFLINE` |
| ส่งถึงแล้วแต่เงียบ | 180 วินาที (`COMMAND_RESPONSE_TIMEOUT_SEC`) | FAILED `DEVICE_NO_RESPONSE` |
| ค้างที่ REBOOTING | 300 วินาที (`COMMAND_REBOOT_TIMEOUT_SEC`) | FAILED `DEVICE_NO_RESPONSE` |
| อายุงานทั้งหมด | 24 ชั่วโมง (`COMMAND_TTL_SEC`) | EXPIRED `TTL_EXPIRED` |

**สิ่งที่แอปต้องทำ:** ถ้าจำลองขั้น REBOOTING ต้องต่อกลับและส่ง HELLO ด้วยเวอร์ชันใหม่ภายใน 300 วินาที ไม่งั้นงานจะ FAILED เอง
และระหว่างแต่ละขั้นต้องรายงานสถานะห่างกันไม่เกิน 180 วินาที

### 11.5 Signature ของ firmware (ถ้าจะตรวจบนมือถือ)

- firmware ทุกเวอร์ชันใน `delivery-server` (1.0.0, 1.1.0, 1.2.0) ใช้ `signature_alg` = **`ECDSA_P256_SHA256`** และ server
  เป็นคนเซ็นตอนอัปโหลด (`signed_by_server: true`)
- ลายเซ็นเข้ารหัสแบบ **DER แล้วแปลงเป็น base64** (`crypto.sign(..., { dsaEncoding: 'der' })`) **ไม่ใช่** r‖s 64 byte แบบ
  JOSE / `ES256` มาตรฐาน ถ้าจะตรวจบนมือถือต้อง decode DER เอง ใช้ library JWT ทั่วไปตรงๆ ไม่ได้
- กล่องจริงตรวจด้วย `mbedtls_pk_verify` ใช้ public key ที่ฝังใน firmware มือถือต้องได้ public key จากพี่เลี้ยงถ้าจะตรวจ
- **ต้องถาม A ให้ชัดตอนได้โค้ดตัวอย่าง** ว่ามือถือจำเป็นต้องตรวจ signature เองจริงไหม หรือข้ามขั้นนี้ได้ (A เคยคอมเมนต์ใน
  PR #357 ว่ามือถือไม่ต้องตรวจลายเซ็นเอง)

### 11.6 Flow ดาวน์โหลดไฟล์: ไม่ยึดค่า TTL คงที่

- กล่องขอ `GET /api/device/me/firmware-manifest?target=…&current=…` จาก `delivery-server` ได้ `url` แบบ signed
  (`/firmware/download/{model}/{version}?device=…&exp=…&sig=…`) พร้อม `url_expires_at`
- อายุ URL (`DOWNLOAD_URL_TTL_SEC`) ค่าจริง**ไม่ทราบ** ค่าเริ่มต้นในโค้ดคือ 600 วินาทีแต่ `.env` ตั้งทับได้ และไม่มี log ไหน
  เก็บ `url_expires_at` ไว้ให้คำนวณ
- **แอปขอ manifest ใหม่ทันทีก่อนดาวน์โหลดทุกครั้ง** ไม่เก็บ URL ไว้ใช้ซ้ำข้ามเวลา จึงไม่ต้องพึ่งค่า TTL ที่แน่นอน
- ตัดสินใจแล้วว่าไม่ต้องหาค่าจริงเพิ่ม ไม่คุ้มกับความซับซ้อนที่ต้องเพิ่มใน Phase 1

## 12. สถานะของ `arduino_gps` และขอบเขตการเชื่อมต่อ (ยืนยันกับพี่เลี้ยง 21 ต.ค. 2569)

### 12.1 สถานะ

- `arduino_gps` (firmware ESP32 + `ws-gateway` + `delivery-server` + `data-monitor`) เป็น**ต้นแบบสาธิต**ในตอนนี้ และเป็น
  **คนละงาน**กับกล่อง SMARTEYEPLUS / ระบบเดิม `config.dtc.co.th` — ไม่ปรับแกนของระบบตาม ESP32
- ฝั่งเราเขียนโค้ดให้**พร้อมใช้กับของจริง**: mock mode เป็นค่าเริ่มต้น และเชื่อมกันผ่าน API อย่างเดียว (แบบเดียวกับ `CENTRAL_MODE`
  ของ #359 และ `token` ใน §10) — พี่เลี้ยงยืนยันว่าแนวทางนี้ถูกแล้ว
- ออกแบบโดยถือว่า firmware / schema ของกล่องที่ติดตั้งแล้ว**แก้ไม่ได้** (สภาพจริงภาคสนาม) — รายละเอียดอยู่ใน `docs/23` §1

### 12.2 ไม่รวม Web Admin ของ `arduino_gps` เข้ากับ Config & Firmware Center

- ไม่นำหน้า Web Admin ของ `delivery-server` มาใช้หรือฝังในระบบเรา — Config & Firmware Center มี RBAC, Separation of Duty
  (อนุมัติได้เฉพาะ Operation) และ AuditLog ซึ่ง Web Admin นั้นไม่มี ถ้าใช้ทั้งสองที่จะมีหน้าจัดการสองแห่งที่ข้ามขั้นตอนอนุมัติกันได้
- เชื่อมกันผ่าน API เท่านั้น

### 12.3 ระบบเราสั่งงานไปที่ delivery-server (Config มีแผนแล้ว · Firmware / credential ยังเปิดอยู่)

> **ส่วน Config มีแผนแล้ว → #362** (A, `feat(rollout): โหมด central ส่ง Config ไปกล่องผ่าน Server กลางจาก Rollout`)
> · **ส่วน Firmware และการจำกัดสิทธิ์ credential ยังเป็นคำถามเปิด**

**ที่ #362 ทำ (เฉพาะ Config):**
- โหมดใหม่ `DEVICE_CONFIG_APPLY_MODE=central` (ต้องตั้ง `CENTRAL_MODE=real` คู่กันถึงจะส่งถึงกล่องจริง): หลัง Operation
  อนุมัติและปล่อย Campaign Rollout backend สั่ง `PUT /api/admin/devices/{id}/config` ของ `delivery-server` ทีละเครื่อง
  ผ่านขั้นอนุมัติและ AuditLog (`apply-config` พร้อมรหัสคำสั่ง) ของระบบเรา
- แปลง Config ของเราตาม schema ที่กล่อง**รายงานว่ารันอยู่จริง** (`GET /api/admin/schemas/{model}/{version}`) — คีย์ที่ schema
  ไม่มีหรือค่าที่แปลงชนิดไม่ได้ ไม่ส่งทั้งชุด · ช่วงค่า (min/max) ให้ `delivery-server` ตรวจ
- เก็บรหัสคำสั่งที่ `CampaignRolloutTarget.centralCommandId` แล้วถามผล `GET /api/gw/jobs/{id}` ทุก 4 วินาที แปลงผลตาม
  ตาราง §11.4: SUCCESS → success · FAILED / ROLLED_BACK / DEVICE_NO_RESPONSE → failed (นับ Auto Pause) ·
  DEVICE_OFFLINE / TTL_EXPIRED / SUPERSEDED / CANCELLED → skipped_offline (ไม่นับล้มเหลว)
- ไม่รู้จักกล่อง / ไม่อยู่ในทะเบียน / ติดต่อ Server กลางไม่ได้ → failed ทันทีพร้อมเหตุผล
- ยังไม่เคยทดสอบสั่ง Config กับกล่องจริง (BOX-0001) — A จะนัดทดสอบพร้อมทีม

**คำถามเปิดที่ยังเหลือ (Q4 ใน §9):**
1. **Firmware** — #362 ส่งเฉพาะ Config · Rollout แบบ Firmware ยังเป็น `mock` เสมอ ยังไม่มีทางสั่ง
   `POST /api/admin/devices/{id}/firmware` จากระบบเรา (การอัปโหลด / OTA ให้ ESP32 ยังต้องทำที่ `delivery-server` โดยตรง)
2. **credential สิทธิ์เต็ม** — ยังใช้บัญชีที่ได้ `ADMIN_TOKEN` ของ `delivery-server` ซึ่งทำได้ทุกอย่าง (ลงทะเบียน / revoke กล่อง,
   อัปโหลด firmware, ส่ง Config) เก็บใน env เท่านั้น ยังไม่มีการจำกัดสิทธิ์เพิ่ม — ตอนนี้ backend ใช้ทั้งอ่านและสั่ง Config ด้วย
   credential ตัวเดียวกัน
3. **ปิดทางสั่งตรง** — เมื่อมีทางผ่านระบบเราแล้ว admin ยังสั่งตรงที่ Web Admin ของ `delivery-server` ได้ ซึ่งข้ามการอนุมัติ ·
   ยังไม่ได้ตกลงว่าจะห้ามด้วยกติกาทีม หรือจำกัดที่ฝั่ง `delivery-server`
