# ผลทดสอบ PR #287 — ยืนยันติดตั้ง Firmware + rolloutId

วันที่ทดสอบ: 12 ต.ค. 2026

## Environment

| รายการ | ค่า |
|---|---|
| Commit ที่ทดสอบ | `bfc7b84` (head ของ `feat/mobile-confirm-firmware-install`, base = main `6ddc831`) ใน worktree แยก |
| Backend | โค้ดจาก branch เดียวกัน (ไม่มี diff ฝั่ง backend จาก main), `NOTIFICATION_MODE=mock`, port 3001, Docker postgres/redis/minio |
| App | build debug flavor `dev` (`com.example.mobile.dev`), `PUSH_NOTIFICATIONS_ENABLED=false`, ติดตั้งด้วย `adb install -r` (ไม่ใช่ `flutter run`) |
| Emulator | AVD `Pixel_10a` (emulator-5554), Android 17 |
| Users | `st.test` (ST), `ot.test` (OT) |
| การจับ request | reverse proxy ชั่วคราว (`:3002` → `:3001`, สคริปต์ใน scratchpad) บันทึก body ของ request ที่ไม่ใช่ GET และผลของ `GET /status` — แอปชี้ `API_BASE_URL` ที่ proxy |
| ไฟล์ที่แก้เฉพาะ worktree ทดสอบ (ไม่ได้ commit) | `build.gradle.kts` (flavor), `pubspec.yaml` (default-flavor), `src/dev/google-services.json` |

## ข้อมูลทดสอบ (seed ด้วย SQL ลง DB local — ไม่ได้อัปโหลดไฟล์จริงผ่าน MinIO)

- Firmware 3 ตัว (stored + approved + GT06N): `T287-PLAN-7.0.0`, `T287-OTHER-7.1.0`, `T287-AMBIG-7.2.0` (+ `2.4.1` เดิมใน seed)
- **R1** (Firmware rollout `active`, firmware=PLAN) → DEV-0001 pending → ใช้ทดสอบ 409 gate และ 200
- **R2a + R2b** (Firmware rollout `active` 2 รอบ คนละ Campaign, firmware=AMBIG ตัวเดียวกัน) → DEV-0002 เป็น pending target ของทั้งคู่ (R2a เก่ากว่า, R2b ใหม่กว่า — `GET /status` ชี้ R2b) = ambiguous case ของ #243
- **R4** (Config rollout `active`, config `GT06N/TCP มาตรฐาน`) → DEV-0002 pending
- DEV-0004: ไม่มี rollout เลย · DEV-0009: สถานะ `registered` (ใช้ทดสอบ 409 อื่น)
- Task 2 งานของ st.test (in_progress, config เดียวกัน): ที่ DEV-0002 (มี Config rollout) และ DEV-0004 (ไม่มี)

## สรุป

| ข้อ | ผล |
|---|---|
| a. ปุ่ม "ยืนยันติดตั้ง Firmware" ที่ Device Detail (ST + OT) | **ผ่าน** |
| b. 409 gate: ข้อความ + ปุ่มลิงก์ไป Firmware Override (เฉพาะ ST) | **ผ่าน** |
| c. 200 สำเร็จ + ปุ่มล็อกกันกดซ้ำ | **ผ่าน** |
| d. `rolloutId` ส่งเมื่อ pending / ไม่ส่งเมื่อไม่มีค่า | **ผ่าน** |
| e. apply-config ใน Task Detail ส่ง `configRolloutId` | **ผ่าน** |
| เพิ่ม: 409 อื่นไม่เกิดปุ่มลิงก์ผิด (false positive) | **ผ่าน** |

ไม่พบบั๊กที่ทำให้ฟังก์ชันพัง มี 2 ข้อสังเกตด้าน UX/ความเปราะบาง (ท้ายรายงาน)

## a. ปุ่มที่ Device Detail

- login `ot.test` → DEV-0001: เห็นปุ่ม **"ยืนยันติดตั้ง Firmware"** เพียงปุ่มเดียว (ไม่เห็น "Override ค่าพารามิเตอร์" / "ขอ Firmware Override" — เหมือนเดิม OT ไม่มีสิทธิ์)
- login `st.test` → DEV-0001: เห็น 3 ปุ่มเรียง: ยืนยันติดตั้ง Firmware, Override ค่าพารามิเตอร์, ขอ Firmware Override (ครบในหน้าจอเดียว ไม่ต้องเลื่อน)
- หน้ายืนยัน: dropdown แสดง Firmware 4 ตัวที่ติดตั้งได้กับ GT06N (PLAN, OTHER, AMBIG, 2.4.1) — ไม่แสดงตัวที่ไม่ผ่านเงื่อนไข

## b. 409 gate (จุดเสี่ยง string matching) — ทดสอบกับ backend จริง ไม่ใช่ fake

DEV-0001 มี R1 (แผน = PLAN) เลือก **OTHER** แล้วกดยืนยัน:

- request: `POST /devices/DEV-0001/confirm-firmware-install` body `{"firmwareId":"…f2","rolloutId":"…a1"}` → **409**
- ข้อความจาก backend (จริง): "Firmware นี้ไม่ตรงกับแผนที่ Campaign กำหนดไว้ (00000287-…-f1) — ต้องขอ Firmware Override ก่อน (หรือ override เดิมถูกใช้ไปแล้ว)"
- **OT:** เห็นกล่อง error + คำอธิบาย "Firmware นี้ยืนยันติดตั้งไม่ได้เพราะไม่ตรงกับแผน Campaign…" **ไม่มีปุ่มลิงก์** (ตรงตามที่ออกแบบ)
- **ST:** เห็นข้อความเดียวกัน + ปุ่ม **"ขอ Firmware Override"** ในกล่อง error → กดแล้วเปิดหน้า "ขอ Firmware Override" ของ DEV-0001 (ยืนยันจากหัวข้อหน้าและฟอร์ม "Firmware ที่ต้องการติดตั้ง / เหตุผล") ✓
- ปุ่มลิงก์ขึ้นจริงกับข้อความจริงของ backend — string matching (`contains('Firmware Override')`) ใช้ได้กับข้อความปัจจุบัน
- เช็ค false positive: DEV-0009 (สถานะ `registered`) → 409 "Device สถานะปัจจุบัน (registered) ยังยืนยันติดตั้ง Firmware ไม่ได้…" แสดงเป็น error ธรรมดา **ไม่มีคำอธิบาย gate และไม่มีปุ่มลิงก์**, ปุ่มยืนยันไม่ล็อก

## c. 200 สำเร็จ

DEV-0001 เลือก **PLAN** (ตรงแผน R1) → `POST …` body `{"firmwareId":"…f1","rolloutId":"…a1"}` → **200** `{"deviceId":"DEV-0001","firmwareId":"…f1","confirmedAt":"2026-10-12T08:21:35Z"}`

- หน้าแสดง: อุปกรณ์ DEV-0001 / Firmware vT287-PLAN-7.0.0 / เมื่อ 12/10/2026 15:21 (เวลาท้องถิ่นถูกต้อง)
- dropdown ถูกปิด ปุ่ม "ยืนยันติดตั้ง Firmware" เป็นสีเทา กดซ้ำไม่ได้
- หลังสำเร็จแอปโหลดสถานะใหม่ (`GET /status` → `firmwareStatus: up_to_date`, `firmwareRolloutId: null`)
- DB: R1 target ของ DEV-0001 → `success`, detail "ยืนยันติดตั้ง Firmware T287-PLAN-7.0.0 สำเร็จ (confirm-firmware-install)"; มีแถว AuditLog `confirm-firmware-install`

## d. `rolloutId` — หลักฐานจาก proxy + DB

| กรณี | request body | ผล |
|---|---|---|
| DEV-0001 pending (R1) | `{"firmwareId":"…f1","rolloutId":"…a1"}` | 200, target ของ R1 → success |
| **DEV-0002 ambiguous** (R2a เก่า + R2b ใหม่ pending พร้อมกัน, firmware เดียวกัน) | `{"firmwareId":"…f3","rolloutId":"…a3"}` (a3 = R2b ตามที่ `GET /status` ชี้) | 200 → **R2b target = success, R2a target ยัง `pending` (ไม่ถูกแตะ)** |
| DEV-0004 ไม่มี rollout | `{"firmwareId":"…f3"}` — **ไม่มี key `rolloutId` เลย** | 200 |

หมายเหตุ: ไม่ได้พิสูจน์ฝั่ง counterfactual (ถ้าไม่ส่ง `rolloutId` backend จะเลือก R2a จริงไหม) — `recordTargetResult` ไม่มี `orderBy` จึงไม่การันตีลำดับ ผลที่เห็นคือ "target ที่ถูกแก้ตรงกับรอบที่แอประบุ และอีกรอบไม่ถูกแตะ" ซึ่งสอดคล้องกับ #265/#243

ตัวอย่างอื่นที่เห็นจาก proxy: ครั้งที่ 409 ที่ DEV-0001 แอปก็ส่ง `rolloutId` ไปด้วย (เพราะ firmwareStatus ตอนนั้น pending) และ `DEV-0009` (ไม่มี rollout) ส่งแค่ `firmwareId`

## e. apply-config ใน Task Detail

| งาน | request body | ผล |
|---|---|---|
| T287 apply-config DEV-0002 (Config rollout R4 pending) | `{"configId":"1d00dfed-…","rolloutId":"…a4"}` | 200 `applied:true` (mock) → target ของ R4 = `success`; หน้างานขึ้น "ส่ง Config เข้าเครื่องแล้ว" ปุ่มล็อก |
| T287 apply-config DEV-0004 (ไม่มี rollout) | `{"configId":"1d00dfed-…"}` — ไม่มี `rolloutId` | 200 `applied:true` |

flow เดิมของหน้า (เลือกสถานะ + ปุ่ม "บันทึกสถานะ" + ปุ่มส่ง Config) ทำงานเหมือนเดิม

## ข้อสังเกต (ไม่ใช่บั๊กที่ทำให้พัง — รอตัดสินใจ)

1. **ข้อความ 409 gate โชว์ UUID ดิบของ Firmware ที่เป็นแผน** ("…(00000287-…-f1)…") เพราะ backend ส่งมาและแอปแสดงตรง ๆ — ช่างอ่านไม่ออกว่าคือตัวไหน ถ้าจะปรับให้อ่านง่าย (แปลงเป็นเลขเวอร์ชัน) ต้องแก้ที่ backend หรือให้แอปดึง Firmware จาก id มาเทียบ
2. **การแยก 409 gate ใช้ข้อความ** — ใช้งานได้กับข้อความปัจจุบัน (ยืนยันจากของจริงทั้ง 2 ทาง) แต่ยังเปราะถ้า backend เปลี่ยนข้อความ ควรให้ backend ส่ง error code แยกถ้าจะให้แน่นกว่านี้ (ตามที่เขียนไว้ใน PR)

## ที่ไม่ได้ทดสอบ

- กรณี gate ที่ "override เดิมถูกใช้ไปแล้ว" (consumed) และกรณีมี Firmware Override ที่ approved แล้วยืนยันผ่าน (ต้อง approve ฝั่ง Operation/Web ก่อน)
- กรณีออฟไลน์ตอนกดยืนยัน และกรณี Firmware ไม่มีให้เลือกบนเครื่องจริง (มีเทส widget ครอบแล้ว)
- ไม่ได้อัปโหลดไฟล์ Firmware จริงผ่าน MinIO/QA approval flow — seed ตรงลง DB

## หลักฐาน

บันทึก request ทั้งหมด: `scratchpad/t287/requests.log`, ภาพหน้าจอ `scratchpad/qa/m_*.png`, seed: `scratchpad/t287/seed.sql` · ข้อมูลทดสอบ (Firmware/Campaign/Rollout `00000287-…`, 2 task) ยังอยู่ใน DB local
