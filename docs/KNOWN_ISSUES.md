# ปัญหาที่รู้แล้วและงานค้าง

รวบรวม ณ 18 พ.ย. 2569 ตอนส่งมอบ · เรียงตามผลกระทบ · ลำดับงานที่แนะนำอยู่ใน [HANDOVER.md §7](HANDOVER.md#7-งานที่ควรทำต่อ-เรียงตามความสำคัญ)

---

## 1. ต้องแก้ก่อนขึ้น server จริง (จากทดสอบโหลด)

ผลเต็มและเงื่อนไขการทดสอบ: [docs/32 §8](32_Load_Testing_Plan.md) · ผลมาจากโน้ตบุ๊กเครื่องเดียว (k6 + backend แย่ง CPU กัน) ตัวเลขจริงบน server น่าจะดีกว่า

| # | ปัญหา | ผลกระทบ | แนวทาง |
|---|---|---|---|
| 1.1 | **job ลบ telemetry เก่าตามไม่ทัน** — ลบได้ 50,000 แถว/ชม. (เพดานต่อรอบ) แต่ที่ 300 กล่องข้อมูลเข้า ~108,000 แถว/ชม. | เกิน ~138 กล่อง ฐานโตไม่หยุดจน disk เต็ม · ~317 ไบต์/แถว → 300 กล่อง ≈ 0.8 GB/วัน | ลบเป็นก้อนจนหมดในรอบเดียว, รันถี่ขึ้น หรือ partition ตารางตามวันแล้ว drop |
| 1.2 | **เพดาน 300 คำขอ/นาที/IP** (`TelemetryRateLimitGuard`) | ซิมที่ออก IP ร่วม (CGNAT) รับได้ ~50 กล่อง/IP · 100 กล่อง IP เดียวข้อมูลหาย 50% และกล่องไม่ส่งซ้ำ | ถามผู้ให้บริการซิม แล้วยก `TELEMETRY_RATE_LIMIT_PER_IP` หรือพึ่ง limit ต่อเครื่องอย่างเดียว |
| 1.3 | **`GET /devices` ไม่แบ่งหน้า** ส่งทุกเครื่องทุกครั้ง | 6,000 เครื่อง p95 855 ms (หน้าอื่น 24–38 ms) และแย่ง CPU กับ telemetry | pagination ทั้ง backend, เว็บ และมือถือ |
| 1.4 | **backend เป็น Node process เดียว** | CPU เต็ม 1 core ที่ ~800 คำขอ/วิ → connection refused = telemetry หายถาวร | หลาย instance (PM2 cluster / หลาย container) หรือแยกตัวรับ telemetry ออกจาก API หลัก |

## 2. Server กลางและ firmware (`arduino_gps/`)

| # | ปัญหา | สถานะ |
|---|---|---|
| 2.1 | **กล่อง crash (`pbuf_free` ใน lwIP) ระหว่างทดลองบูต firmware ใหม่ → ย้อนเวอร์ชันเอง** — firmware ยืนยันตัวเองหลังได้ WELCOME เท่านั้น crash ก่อนหน้านั้นจึงย้อน firmware ที่ดีกลับ | แก้ลำดับ member ของ `HttpConn` (use-after-free) แล้วใน 1.1.1 / 1.2.1 · OTA 1.2.0 → 1.2.1 สำเร็จ **แต่ทดสอบรอบเดียว** — ต้องทดสอบซ้ำหลายรอบก่อนถือว่าหาย · 1.0.0–1.2.0 ใน `firmware/dist` เก่าเป็น build ก่อนแก้ |
| 2.2 | [#367](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/367) Server กลางเก็บค่า Config เก่าค้างข้าม schema version (merge ไม่มีทางลบ) → `INVALID_CONFIG` | delivery-server เพิ่มการรีเซ็ตหลังย้อน firmware แล้ว (`0f5ccc5`) **ยังไม่ได้ยืนยันว่าแก้ครอบเคสใน issue** |
| 2.3 | `AUTO_REGISTER_TOKEN` / `DEFAULT_DEVICE_TOKEN` = `1234` และรหัส WiFi โหมดตั้งค่า `12345678` ฝังใน firmware | ค่าตั้งต้นที่อยู่ใน repo public — ต้องเปลี่ยนพร้อม build firmware สำหรับกล่องจริง (`arduino_gps/README.md`) |
| 2.4 | Server กลางเก็บข้อมูลเป็นไฟล์ JSON (`data/db.json`) ไม่ใช่ฐานข้อมูล | พอสำหรับต้นแบบ ไม่เหมาะกับกล่องจำนวนมาก |
| 2.5 | test ของ Server กลางไม่อยู่ใน CI · firmware ไม่มี unit test | — |

## 3. Backend

| # | ปัญหา | หมายเหตุ |
|---|---|---|
| 3.1 | `npm run start:prod` ชี้ `dist/main` แต่ `nest build` วางไฟล์ที่ `dist/src/main.js` | Dockerfile ใช้ path ถูกแล้ว · รันมือใช้ `node dist/src/main.js` |
| 3.2 | [#293](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/293) หลายโมดูลเขียน AuditLog นอกทรานแซกชัน ถ้าบันทึกล้มจะแค่ warning | ข้อมูลเปลี่ยนได้โดยไม่มีร่องรอย |
| 3.3 | [#243](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/243) `recordTargetResult()` หา target ด้วย deviceId + payload ไม่ใช่ rolloutId | ผลอาจไปลง Rollout ผิดตัวเมื่อเครื่องเดียวมีหลาย Rollout ค้าง |
| 3.4 | [#269](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/269) Incident ที่ส่งต่อเป็น Campaign แล้วค้างสถานะ `investigating` | ไม่มี flow ปิดต่อ |
| 3.5 | โหมด `real` ของ simulator / connection test ยังไม่มี (throw ตอน startup) · `LEGACY_SYNC_MODE` ใช้ได้แค่ `mock` | ดู HANDOVER §3 |
| 3.6 | comment ใน `device.controller.ts` (บรรทัด ~91) ยังเขียนว่า `GET /devices/:deviceId/status` ไม่ได้ implement ทั้งที่มี route แล้ว | comment เก่า |

## 4. มือถือ

| # | ปัญหา | หมายเหตุ |
|---|---|---|
| 4.1 | ยังไม่มี iOS (push, `GoogleService-Info.plist`, entitlements) · `_platform` ของ push hardcode `android` | docs/05 §งานที่ยังเหลือ |
| 4.2 | ยังไม่เคยใช้ Firebase project production | ทดสอบกับ project dev เท่านั้น |
| 4.3 | ช่างลงทะเบียนกล่องใหม่จากมือถือไม่ได้ ([#295](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/295)) | backend มี `POST /devices` แล้ว แต่ยังไม่มีหน้าจอ |
| 4.4 | "กล่องจำลอง" ในแอป (docs/24, [#297](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/297), [#298](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/298)) | แผนอย่างเดียว ไม่ได้ทำ |
| 4.5 | Flutter ในเครื่องต่างเวอร์ชันกับ CI ทำให้ `dart format` ต่างกัน | ใช้ 3.47.x ตาม `mobile-ci.yml` |

## 5. เว็บ

| # | ปัญหา | หมายเหตุ |
|---|---|---|
| 5.1 | แสดงพารามิเตอร์ของ Firmware ตอนอัปโหลด + นำเข้า Parameter Library อัตโนมัติ (docs/26) | แผนอย่างเดียว ไม่ได้ทำ |
| 5.2 | [#280](https://github.com/dtc-gps-team/gps-config-firmware-center/issues/280) Audit Log ไม่มี pagination / filter ตามวันและชื่อ | ข้อเสนอ ยังไม่ทำ |

## 6. issue ที่ยังเปิดอยู่ (คัดแล้ว)

| issue | เรื่อง | แนะนำ |
|---|---|---|
| #367 | Server กลางเก็บ Config เก่าข้าม schema | **เก็บไว้** — §2.2 |
| #293 | Audit Log นอกทรานแซกชัน | **เก็บไว้** — §3.2 |
| #243 | `recordTargetResult()` match ข้าม Rollout | **เก็บไว้** — §3.3 |
| #269 | Incident ค้าง `investigating` | **เก็บไว้** — §3.4 |
| #295, #297, #298 | ลงทะเบียนกล่อง / กล่องจำลองบนมือถือ | **เก็บไว้** เป็น backlog — §4.3, §4.4 |
| #280 | Audit Log pagination | **เก็บไว้** เป็น backlog — §5.2 |
| #106 | เก็บพิกัดที่ช่างทำงานลง Task + AuditLog | **เก็บไว้** เป็น backlog (ข้อ 6 จาก Sprint 1 review) |
| #245 | `GET /devices/{deviceId}/status` ยังไม่ implement | **ปิดได้** — มี route แล้ว (เหลือ comment เก่า §3.6) |
| #289 | Nightly Mobile E2E พังต่อเนื่อง | **ปิดได้** — รันผ่านต่อเนื่องตั้งแต่ ~11 พ.ย. |
| #236 | Field Incident Report → Campaign | **ปิดได้** — ทำแล้ว (`incident_report_*`) เหลือ #269 |
| #388 | B2 ทำส่วน A1 ที่ Firmware ใช้ | **ปิดได้** — docs/27 B2/B3 merge แล้ว |
| #386 | คำถามก่อนเขียนแผน Mobile Redesign | **ปิดได้** — R4 เสร็จแล้ว (docs/29) |
| #157 | อุปกรณ์ดึง Config/Firmware ตรงจาก Backend | **ปิดได้** — ทำตาม docs/14 / docs/19 แล้ว ต่อมาใช้ Server กลางเป็นเส้นทางหลัก |
