# ข้อมูลสำหรับสร้างระบบ (Build Reference)
## GPS Config & Firmware Center

**อ้างอิงจาก:** GPS_Project_Structure_Formal.md เวอร์ชัน 3.7
**วัตถุประสงค์ของเอกสารนี้:** รวบรวมข้อมูลที่ทีมพัฒนาต้องใช้จริงตอนลงมือเขียนโค้ด (Interface, โครงสร้างไฟล์, ตัวแปร Environment, จุดที่ต้อง Mock/Stub) ให้อยู่ในที่เดียว ไม่ต้องไปไล่หาในเอกสารสถาปัตยกรรมฉบับเต็ม

---

> **อัปเดต v3.1:** เพิ่มฟีเจอร์ Import Config จากไฟล์ (นอกเหนือจากกรอกผ่านฟอร์ม Config Editor) — ดู Section 3.1 และ Section 8
> **อัปเดต v3.2:** ปิด TBD รูปแบบไฟล์ — เลือกใช้ **JSON** เป็นจุดเริ่มต้น (ยังไม่ตายตัว อาจปรับเปลี่ยนภายหลังได้)
> **อัปเดต v3.3:** ยืนยันแล้วว่ากล่องเช็คเวอร์ชันตัวเองเมื่อ**เปิดเครื่อง (Power-on/Boot)** ไม่ใช่ตามคาบเวลาคงที่ — เปิด TBD ใหม่คือ "กล่องเปิด/ปิดเครื่องบ่อยแค่ไหนในสนามจริง" ดู Section 4.2 และ 8
> **อัปเดต v3.4:** ⏸ ทีมชะลอการเชื่อมต่อ Production ของระบบเดิม (`config.dtc.co.th`) ไว้ก่อน — พัฒนา/ทดสอบด้วย mock/docker ต่อไปได้ตามปกติ แต่ห้ามเข้าโหมด production จนกว่าจะได้รับคำสั่งเริ่มชัดเจนอีกครั้ง (ดู Section 4.1)
> **อัปเดต v3.5:** เพิ่มฟีเจอร์ทดสอบกับ Device Simulator ซ้ำหน้างานผ่าน Mobile ก่อนกด "ยืนยันติดตั้งสำเร็จ" (ไม่บังคับ) — ดู Section 3.2 ใหม่ด้านล่าง
> **อัปเดต v3.6:** ทีมอยากให้กล่องเช็คเวอร์ชันทั้งตอนเปิดเครื่องและตามรอบเวลาคงที่ (เช่น ทุก 6 ชม.) — เป็น TBD ใหม่เรื่องพฤติกรรม Firmware กล่อง ไม่ใช่สิ่งที่ซอฟต์แวร์เราสร้างเอง ดู Section 4.2
> **อัปเดต v3.7:** ตัดช่องทางรับไฟล์ Firmware แบบ "ดึงจากระบบเดิม" ออก — เหลือ**อัปโหลดตรงเข้าระบบเราทางเดียว** จากนั้นรอกล่องดึงไปเองผ่านระบบเดิมตามปกติ และกำหนดสถานะที่ต้องดูให้ชัดเป็น 2 ฝั่ง: (1) สถานะอัปโหลด/จัดเก็บฝั่งเรา (2) สถานะอัปเดตเวอร์ชันจริงของกล่องผ่าน `device-status` — ดู Section 3, 6

## 1. ภาพรวมระบบแบบสั้นที่สุด

ระบบมี 3 โปรเจกต์อิสระในโมโนรีโป: `web/` (Next.js + shadcn/ui), `backend/` (NestJS), `mobile/` (Flutter) สื่อสารกันผ่าน Backend API เท่านั้น ไม่มีโปรเจกต์ Device Gateway ของตัวเอง

กล่อง GPS เช็คเวอร์ชัน Config/Firmware ของตัวเองกับ "data กลาง" (ระบบเดิม `config.dtc.co.th:909`) อัตโนมัติทุกครั้งที่ทำงาน แล้วอัปเดตตัวเองถ้าพบว่าเก่ากว่า — **ระบบเราไม่ต้องกระตุ้นกล่องด้วยวิธีใดๆ เลย** หน้าที่เดียวของระบบเราคือเขียนข้อมูลที่อนุมัติแล้วเข้าระบบเดิมให้ถูกต้องและทันเวลา ผ่านโมดูล `config-sync-writer`

---

## 2. โครงสร้างไฟล์ตั้งต้น (Monorepo)

```
gps-config-firmware-center/
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
│
├── web/                              (Next.js + shadcn/ui)
│   ├── app/
│   │   ├── (dashboard)/              Admin / SW Engineer / Auditor / Operation
│   │   └── (override)/               Config/Firmware Override — เฉพาะ ST/OT
│   ├── components/ui/
│   ├── lib/api-client.ts
│   ├── middleware.ts                 ตรวจสิทธิ์ตาม Role ก่อนเข้าแต่ละ route group
│   └── package.json
│
├── backend/                          (NestJS)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── config/                สร้าง/ทดสอบ/อนุมัติ Config
│   │   │   ├── firmware/              เก็บไฟล์ Firmware (เก็บอย่างเดียว)
│   │   │   ├── config-sync-writer/    เขียนข้อมูลเข้าระบบเดิม (ดู Section 4)
│   │   │   ├── device-status/         เช็คสถานะกล่อง (ดู Section 4)
│   │   │   ├── task/
│   │   │   ├── campaign/              ปล่อยเวอร์ชันเป็นกลุ่ม (Pilot/Canary/Batch)
│   │   │   ├── incident/
│   │   │   ├── notification/          FCM (Mobile) + WebSocket (Web)
│   │   │   └── audit/
│   │   ├── common/{guards,filters,interceptors}/
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/schema.prisma
│   └── package.json
│
├── mobile/                            (Flutter)
│   ├── lib/
│   │   ├── screens/{dashboard,task,campaign,incident,device}/
│   │   ├── widgets/
│   │   ├── services/                  (ไม่มีโมดูลสื่อสารกับกล่อง GPS)
│   │   └── models/
│   └── pubspec.yaml
│
└── docs/{architecture,planning,design,sitemap,screen-map,api}/
```

**กติกาแยกโปรเจกต์:** ห้าม import โค้ดข้าม `web/`, `backend/`, `mobile/` โดยตรง สื่อสารผ่าน REST API เท่านั้น ใส่เลขเวอร์ชันใน URL (`/api/v1/...`) และให้ Backend เป็นเจ้าของ "หน้าตาข้อมูล" ที่เดียว (generate Swagger/OpenAPI ไว้ที่ `docs/api/` ให้ Web/Mobile ดึงไปใช้)

---

## 3. รายการ Backend Modules ที่ต้องสร้าง

| โมดูล | หน้าที่ | ระดับความพร้อม |
|---|---|---|
| `auth` | ยืนยันตัวตน + RBAC ตาม Role | สร้างได้เต็มรูปแบบทันที |
| `config` | CRUD Config ผ่านฟอร์ม **หรือ Import จากไฟล์ JSON** (v3.2 — เลือก JSON เป็นจุดเริ่มต้น อาจปรับเปลี่ยนภายหลัง), เรียกทดสอบกับ Device Simulator, ส่งเข้า flow อนุมัติ | สร้างได้เต็มรูปแบบทันที ทั้งฟอร์มและ Import JSON (ดู Section 3.1 ด้านล่าง) |
| `firmware` | รับไฟล์ Firmware ผ่าน**การอัปโหลดตรงเข้าระบบเราทางเดียวเท่านั้น** (v3.7 — ตัดช่องทาง "ดึงจากระบบเดิม" ออก) เก็บอย่างเดียว พร้อมรายงานสถานะอัปโหลด/จัดเก็บฝั่งเรา | สร้างได้เต็มรูปแบบทันที |
| `config-sync-writer` | เขียน Config/Firmware ที่อนุมัติแล้วเข้าระบบเดิม `config.dtc.co.th` | **ต้อง Mock/Stub ก่อน** — ดู Section 4.1 |
| `device-status` | เช็คสถานะกล่องอัตโนมัติ แสดงบนหน้าเว็บ — ครอบคลุมทั้ง Config และสถานะอัปเดตเวอร์ชัน Firmware ของกล่อง (v3.7) | **ต้อง Placeholder ก่อน** — ดู Section 4.2 |
| `task` | มอบหมาย/ติดตามงาน | สร้างได้เต็มรูปแบบทันที |
| `campaign` | จัดลำดับ/ทยอยเขียนข้อมูลเข้าระบบเดิมเป็นกลุ่ม (Pilot/Canary/Batch) | สร้างได้เต็มรูปแบบทันที (เรียกผ่าน `config-sync-writer`) |
| `incident` | สร้าง/ติดตาม Incident | สร้างได้เต็มรูปแบบทันที |
| `notification` | แจ้งเตือนผ่าน FCM (Mobile) และ WebSocket (Web) | สร้างได้เต็มรูปแบบทันที |
| `audit` | บันทึกประวัติการเปลี่ยนแปลง | สร้างได้เต็มรูปแบบทันที |

> ไม่มีโมดูล `device-gateway` หรือ `device-notify` อีกต่อไป — ถูกตัดออกแล้วเพราะไม่มี Device Gateway และไม่มีกลไก SMS ในระบบ

### 3.1 Config Import จากไฟล์ (v3.2 — เลือก JSON เป็นจุดเริ่มต้น)

นอกจากกรอก Config ผ่านฟอร์ม Config Editor บนหน้าเว็บแล้ว ทีมต้องการให้ SW Import Config จากไฟล์ได้ด้วย — ยืนยันแล้วว่าไม่ว่าจะเข้าทางไหน **ต้องเข้าสู่ flow ทดสอบกับ Device Simulator และอนุมัติของ Operation แบบเดียวกันทุกประการ ไม่มีทางลัดข้ามการตรวจสอบ**

ทีมตัดสินใจแล้ว (v3.2) ว่าจะรองรับ **JSON** เป็นรูปแบบไฟล์แรก — ยังไม่ใช่คำตอบตายตัว อาจปรับเปลี่ยนภายหลังได้ถ้าพบว่ารูปแบบอื่นเหมาะกว่าตอนใช้งานจริง (เช่น Excel/CSV หรือ Text Key-Value แบบระบบเดิม) จึงออกแบบ Interface ให้แยกจาก Format ไว้ตั้งแต่ต้น:

```typescript
// backend/src/modules/config/config-import.interface.ts
export interface ConfigImporter {
  parseConfigFile(file: Buffer, format: ConfigFileFormat): Promise<DeviceConfigDraft>;
}

export type ConfigFileFormat = 'json'; // เพิ่ม 'csv' | 'excel' | 'legacy-kv' ทีหลังได้โดยไม่กระทบ interface นี้

// ตัวอย่างโครงสร้างไฟล์ JSON ที่รองรับ (ตั้งต้น — ปรับฟิลด์จริงตามสเปก Config ทีหลังได้)
// {
//   "deviceModel": "SMARTEYEPLUS",
//   "protocol": "TCP",
//   "fields": {
//     "APN1": "...",
//     "MTYP": "...",
//     "SIM1": "...",
//     "SEV1": "..."
//   }
// }
```

- **Implementation:** เขียน `JsonConfigImporter implements ConfigImporter` เป็นตัวแรก — parse JSON แล้ว map เข้า `DeviceConfigDraft` โครงสร้างเดียวกับที่ Config Editor (ฟอร์ม) สร้าง เพื่อให้เข้า flow ทดสอบ/อนุมัติเดียวกันได้โดยไม่ต้องแยกโค้ด
- **Validation:** ตรวจ Schema ของไฟล์ JSON ก่อน (เช่นด้วย Zod ตัวเดียวกับที่ฝั่งฟอร์มใช้อยู่แล้ว) ก่อนส่งเข้า Device Simulator — ป้องกันไฟล์รูปแบบผิดหลุดเข้า flow ทดสอบ
- **UI ฝั่ง Web:** เพิ่มปุ่ม "Import จากไฟล์ (JSON)" ในหน้า Config Editor เป็นอีกทางเลือกควบคู่กับกรอกฟอร์มเอง ไม่ใช่หน้าจอแยกต่างหาก
- **ถ้าต้องเปลี่ยนรูปแบบไฟล์ทีหลัง:** เพิ่ม Implementation ใหม่ของ `ConfigImporter` (เช่น `ExcelConfigImporter`) และเพิ่มค่าใน `ConfigFileFormat` — ไม่ต้องแก้โค้ดส่วนอื่นที่เรียกผ่าน Interface

---

### 3.2 ทดสอบกับ Device Simulator ซ้ำหน้างานผ่าน Mobile (ใหม่ v3.5 — ไม่บังคับ)

ก่อนช่างหน้างานกด "ยืนยันติดตั้งสำเร็จ" (Confirm Install) แอป Mobile มีปุ่มให้เลือกทดสอบ Config/Firmware ที่กำลังจะติดตั้งกับ Device Simulator ซ้ำอีกครั้งได้ — **เป็นทางเลือก ไม่บังคับ** ข้ามได้ตามปกติ

```typescript
// เรียก Endpoint เดียวกับที่ Web ใช้ตอน SW ทดสอบ Config ก่อนอนุมัติ
// backend/src/modules/config/config-simulation.controller.ts
POST /api/v1/config/{configId}/simulate
// หรือสำหรับ Firmware
POST /api/v1/firmware/{firmwareId}/simulate
// Body: { deviceModel: string }
// Response: { passed: boolean, details: string[] }
```

- **Mobile ไม่เชื่อมต่อกับ Device Simulator โดยตรง** — เรียกผ่าน Backend API ตัวเดียวกับที่ Web ใช้เท่านั้น (สอดคล้องกับหลักการที่ Mobile ไม่มีบทบาทสื่อสารกับกล่อง GPS หรือระบบจำลองโดยตรง)
- **ผลผ่าน:** ปุ่ม "ยืนยันติดตั้งสำเร็จ" ใช้งานได้ตามปกติ
- **ผลไม่ผ่าน:** disable ปุ่ม "ยืนยันติดตั้งสำเร็จ" ทันที (กดไม่ได้) และเรียก `incident` module สร้าง Incident อัตโนมัติพร้อมเหตุผลจาก `details` ที่ Simulator ส่งกลับมา ผูกกับ Task/Device ที่กำลังติดตั้งอยู่
- **Offline:** ถ้าไม่มีสัญญาณตอนหน้างาน ปุ่มทดสอบนี้ควร disable ไปเลย (ต้องใช้ Backend) แต่ปุ่ม "ยืนยันติดตั้งสำเร็จ" ยังกดได้ตามปกติผ่าน Offline-first Sync Queue เพราะขั้นตอนนี้เป็นทางเลือกไม่บังคับ

---

## 4. Interface ที่ต้องแยกจาก Implementation (จุดที่ยังมี TBD)

หลักการ: เขียน Interface ให้นิ่งตั้งแต่ต้น ส่วน Implementation จริงค่อยเติมทีหลังเมื่อได้คำตอบจากพี่ในทีม โค้ดส่วนอื่น (flow อนุมัติ, หน้าจอ Web/Mobile) เรียกผ่าน Interface เท่านั้น ไม่ต้องรอ

### 4.1 `config-sync-writer` — เขียนข้อมูลเข้าระบบเดิม

```typescript
// backend/src/modules/config-sync-writer/config-sync-writer.interface.ts
export interface ConfigSyncWriter {
  writeConfigToLegacySystem(config: DeviceConfig): Promise<void>;
  writeFirmwarePointerToLegacySystem(firmware: FirmwareRelease): Promise<void>;
}
```

- **TBD ที่บล็อกอยู่:** รูปแบบคำสั่ง "เขียนค่า" (Write/Set) บนระบบเดิม — ตอนนี้มีแต่ตัวอย่างคำสั่งอ่านค่า (`##A,V=940,S=8966032020112743590$`) จากเครื่องมือ Hercules
- **วิธี Mock ระหว่างรอคำตอบ:** ทำ Implementation แบบเขียน Log แทนการยิง TCP จริง หรือยิงไปที่เครื่อง Local/Docker ทดสอบเท่านั้น (`127.0.0.1:801` — เครื่องเดียวกับที่ใช้ทำรายงาน TCP Compare)
- **คุมด้วย Environment Variable:**
  ```
  LEGACY_SYNC_MODE=mock       # เขียน Log อย่างเดียว ใช้ตอน dev/เทสต์ทั่วไป
  LEGACY_SYNC_MODE=docker     # ยิงไปเครื่อง Local/Docker ทดสอบ (127.0.0.1:801)
  LEGACY_SYNC_MODE=production # ยิงเข้า config.dtc.co.th:909 จริง — ห้ามใช้จนกว่าจะยืนยันรูปแบบคำสั่ง Write/Set แล้ว
  ```
- **ก่อนเปิด `production` จริง ต้องยืนยันเพิ่ม:** สิทธิ์การเข้าถึง/เขียนข้อมูลเข้าระบบเดิม (ต้องขอสิทธิ์จากผู้ดูแลระบบเดิมหรือไม่), รูปแบบคำสั่ง Write/Set ฉบับเต็ม — ทดสอบผ่าน Local/Docker ให้ผ่านก่อนเสมอ ห้ามเดารูปแบบคำสั่งเองแล้วยิงเข้า Production ตรงๆ

### 4.2 `device-status` — เช็คสถานะกล่อง

```typescript
// backend/src/modules/device-status/device-status.interface.ts
export interface DeviceStatusChecker {
  checkDeviceStatus(box: DeviceBox): Promise<DeviceStatus>;
}
```

- **ปิดบางส่วนแล้ว (v3.3):** ยืนยันแล้วว่ากล่องเช็คเวอร์ชันตัวเองทุกครั้งที่ **เปิดเครื่อง (Power-on/Boot)** ไม่ใช่ตามคาบเวลาคงที่แบบ Polling — เปลี่ยนวิธี implement `checkDeviceStatus()` จาก "Poll ทุก N นาที" เป็น "เช็คสถานะเมื่อได้รับสัญญาณ Telemetry ใหม่จากกล่อง" (เพราะกล่องจะส่ง Telemetry เข้าระบบเดิมทุกครั้งที่เปิดเครื่องอยู่แล้ว) — แต่ยัง Poll เป็นระยะสั้นๆ ไว้ก่อนเพื่อความง่าย (เช่นทุก 1 นาที) จนกว่าจะออกแบบแบบ Event-driven ได้
- **TBD ที่บล็อกอยู่ตอนนี้:** กล่อง GPS เปิด/ปิดเครื่อง (Boot) บ่อยแค่ไหนในสภาพใช้งานจริง (ทุกครั้งที่สตาร์ทรถ, มีรอบรีสตาร์ทอัตโนมัติในตัวกล่องไหม, หรือบางกล่องเปิดเครื่องค้างไว้ตลอด) — เป็น TBD ที่สำคัญที่สุดตอนนี้ เพราะกำหนดว่า UI ต้องบอกผู้ใช้ว่า "รอนานแค่ไหน"
- **TBD เพิ่มเติม (v3.6):** ทีมอยากให้กล่องเช็คเวอร์ชันทั้งตอนเปิดเครื่อง**และ**ตามรอบเวลาคงที่เพิ่มเติมด้วย (เช่น ทุก 6 ชม.) เพื่อไม่ต้องพึ่งพฤติกรรมเปิด/ปิดเครื่องของผู้ใช้อย่างเดียว — **นี่เป็นพฤติกรรม Firmware ของกล่อง ไม่ใช่สิ่งที่ Backend/config-sync-writer ของเราสร้างหรือคุมได้เอง** ต้องถามพี่ในทีม/ผู้ผลิตกล่องว่า Firmware ปัจจุบันรองรับการตั้งค่านี้ได้ไหม ถ้ารองรับได้ น่าจะเป็นแค่ฟิลด์ Config อีกตัวที่เราเขียนผ่าน `config-sync-writer` ตามปกติ (ไม่ต้องสร้างกลไกใหม่) ถ้าไม่รองรับ ต้องแจ้งทีมว่าเป็นข้อจำกัดของ Firmware ปัจจุบัน
- **แนวทาง UI/UX ระหว่างนี้:** ห้ามสัญญาว่าอัปเดตจะเห็นผล "ทันที" ให้ใช้ข้อความ **"จะได้รับการอัปเดตในการเปิดเครื่องครั้งถัดไปของกล่อง"** แทนการระบุเวลาที่แน่นอน

### 4.3 หลักการออกแบบให้ขยายได้ในอนาคต (Extensibility)

ตอนนี้รองรับ Protocol เดียว (TCP) และกล่องรุ่นเดียว แต่ทีมต้องการขยายในอนาคต — **ไม่ต้องสร้าง Adapter/Registry/Profile/Queue แบบ Device Gateway เดิม** (ถูกตัดออกไปแล้วเพราะไม่ตรงกับกลไกจริง) แค่ทำ 2 อย่างพอ:

1. เก็บฟิลด์ `device_model` / `protocol` ไว้ในตาราง Config/Task ตั้งแต่ต้น แม้ตอนนี้จะมีค่าเดียว (เช่น `SMARTEYEPLUS/TCP`)
2. เขียน Interface ของ `config-sync-writer` และ `device-status` ให้เป็นกลาง ไม่ผูกกับ TCP โดยตรงในชั้น Interface — ให้ TCP เป็นแค่ 1 Implementation ที่เป็นไปได้

---

## 5. โปรโตคอลที่ยืนยันแล้วกับระบบเดิม (`config.dtc.co.th:909`)

- Protocol: **Text-based Key-Value ผ่าน TCP** (ไม่ใช่ JSON, ไม่ใช่ MQTT/CoAP)
- มีฟิลด์ Config ประมาณ 262 ค่า (ตัวอย่าง: `APN1`, `MTYP`, `SIM1`, `SEV1`, `RS232`, `PROD`, `COMP`)
- ตัวอย่างคำสั่งอ่านค่า (ยืนยันแล้ว จากเครื่องมือ Hercules SETUP):
  ```
  Send:     ##A,V=940,S=8966032020112743590$
  Received: #A,V=...!oKoK
  ```
- **ยังไม่มีตัวอย่างคำสั่งเขียนค่า (Write/Set)** — เป็น TBD หลักที่บล็อกการพัฒนา `config-sync-writer` ตัวจริง
- เครื่อง Local/Docker สำหรับทดสอบ: `127.0.0.1:801` (แยกจาก Production `config.dtc.co.th:909`)

---

## 6. Database — สิ่งที่ต้องมีตั้งแต่ต้น

ยังไม่มี Schema ฉบับเต็มในเอกสารสถาปัตยกรรม แต่จากขั้นตอนงานที่ยืนยันแล้ว ต้องมีอย่างน้อย:

- **ตาราง Config**: field ข้อมูล Config, `status` (draft / testing / sw_approved / operation_approved / rejected / synced), `device_model`, `protocol`, ผลการทดสอบจาก Device Simulator, ผู้สร้าง/ผู้อนุมัติ, เวลาอนุมัติ
- **ตาราง Firmware**: metadata เวอร์ชัน, path ใน Object Storage, `upload_status` (สถานะอัปโหลด/จัดเก็บฝั่งเรา — v3.7 เหลือช่องทางอัปโหลดตรงทางเดียว), `device_update_status` (สถานะอัปเดตเวอร์ชันจริงของกล่อง อ้างอิงจาก `device-status`)
- **ตาราง Task**: งานที่มอบหมายให้ช่างหน้างาน เชื่อมกับ Config/Firmware ที่เกี่ยวข้อง
- **ตาราง Campaign**: การปล่อยเวอร์ชันเป็นกลุ่ม (Pilot/Canary/Batch) พร้อมสถานะการเขียนเข้าระบบเดิมของแต่ละกล่องในกลุ่ม
- **ตาราง Incident**: ปัญหาที่เกิดขึ้นระหว่างการอัปเดต
- **ตาราง Audit Log**: ประวัติการเปลี่ยนแปลงทุกจุดที่สำคัญ (ใครอนุมัติ/ปฏิเสธ/แก้ไขอะไรเมื่อไหร่)
- **ตาราง Device Status (หรือฝังในตาราง Device/Box)**: ผลเช็คสถานะล่าสุดจาก `device-status` module

> ข้อควรระวัง: มีเอกสาร `06-database-design-NEW.md` เก่าอยู่ใน `docs/design/` แต่เอกสารนั้นถูกติดป้ายว่าล้าสมัยแล้ว (ออกแบบมาจากสถาปัตยกรรมคนละเวอร์ชัน มี RBAC 6 role, 49 ตาราง) — **ห้ามใช้เป็นต้นแบบ Schema ของระบบปัจจุบัน**

---

## 7. Environment Variables ที่ต้องเตรียม

```bash
# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Auth
JWT_SECRET=...

# Object Storage (Firmware)
OBJECT_STORAGE_ENDPOINT=...      # MinIO ช่วงเริ่มต้น → AWS S3 ตอนใช้งานจริง
OBJECT_STORAGE_BUCKET=...

# Legacy System Sync (config-sync-writer) — ดู Section 4.1
LEGACY_SYNC_MODE=mock            # mock | docker | production
LEGACY_SYSTEM_HOST=127.0.0.1     # docker: 127.0.0.1, production: config.dtc.co.th
LEGACY_SYSTEM_PORT=801           # docker: 801, production: 909

# Notification
FCM_SERVER_KEY=...

# API Versioning
API_PREFIX=/api/v1
```

---

## 8. รายการ TBD ที่ต้องตามพี่ในทีมต่อ (เรียงตามความสำคัญ)

| ลำดับ | TBD | กระทบอะไร | ระหว่างนี้ทำยังไง |
|---|---|---|---|
| 1 | รูปแบบคำสั่ง Write/Set บนระบบเดิม | `config-sync-writer` เขียนข้อมูลจริงไม่ได้จนกว่าจะรู้ | ใช้ `LEGACY_SYNC_MODE=mock/docker` |
| ~~2~~ | ~~กล่องเช็คเวอร์ชันตัวเองบ่อยแค่ไหน~~ | **ปิดบางส่วนแล้ว (v3.3):** เช็คทุกครั้งที่เปิดเครื่อง (Boot) — แต่ยังไม่รู้ว่าเปิดเครื่องบ่อยแค่ไหนจริง (ดูแถวถัดไป) | — |
| 2b (ใหม่ v3.3) | กล่อง GPS เปิด/ปิดเครื่อง (Boot) บ่อยแค่ไหนในสภาพใช้งานจริง | UI ต้องบอกผู้ใช้ว่ารอนานแค่ไหน — เป็น TBD สำคัญที่สุดตอนนี้ | ใช้ข้อความ "จะได้รับการอัปเดตในการเปิดเครื่องครั้งถัดไปของกล่อง" แทนการระบุเวลาแน่นอน |
| 2c (ใหม่ v3.6) | กล่องรองรับการเช็คเวอร์ชันตามรอบเวลาคงที่เพิ่มเติมได้ไหม (นอกจากตอนเปิดเครื่อง) | ถ้ารองรับได้ จะช่วยลดปัญหาข้อ 2b สำหรับกล่องที่เปิดเครื่องค้างไว้นาน | ยังทำอะไรไม่ได้จนกว่าจะรู้คำตอบ — ถ้ารองรับได้ค่อยเพิ่มเป็นฟิลด์ Config ที่เขียนผ่าน `config-sync-writer` ตามปกติ |
| 3 | มีวิธีเร่งให้กล่องเช็คทันทีไหม | ฟีเจอร์กรณีเร่งด่วน (ถ้ามี) | ยังไม่ต้องออกแบบฟีเจอร์นี้ก่อน |
| 4 | กลไกที่กล่องดาวน์โหลดไฟล์ Firmware จริง (ไม่ใช่แค่ค่า Config) | รายละเอียดการ implement `config-sync-writer` ฝั่ง Firmware | เก็บไฟล์ไว้ก่อน ยังไม่ implement การ sync จริง |
| ~~5~~ | ~~รูปแบบไฟล์สำหรับ Import Config~~ | **ปิดแล้ว (v3.2):** เลือก JSON เป็นจุดเริ่มต้น — อาจปรับเปลี่ยนภายหลังได้ (ดู Section 3.1) |

---

## 9. ข้อควรระวังสำคัญ (สรุปจาก Section 11 ของเอกสารสถาปัตยกรรม)

- ห้าม hardcode API Key/รหัสผ่าน — ใช้ `.env` เท่านั้น
- Web ห้ามต่อ Database ตรง ต้องผ่าน Backend API เท่านั้น
- ไม่มีกลไกกระตุ้นกล่องอีกต่อไป (ทั้ง SMS และ TCP Client บน Mobile) — อย่าพัฒนาโมดูลเหล่านี้กลับมาอีก
- การเขียนเข้าระบบเดิมกระทบ Production ของทีมอื่นโดยตรง ต้องทดสอบกับ Local/Docker ให้ผ่านก่อนเสมอ
- อย่าสัญญาผู้ใช้ว่าอัปเดตจะเห็นผล "ทันที" — ใช้ข้อความ "รอกล่องอัปเดตในรอบถัดไป" แทน
