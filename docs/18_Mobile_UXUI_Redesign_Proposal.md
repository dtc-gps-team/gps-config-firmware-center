# Mobile UX/UI Redesign — Phase 1-2 Proposal (Screen Inventory + Gap Analysis)

**สถานะ:** ขอ review จาก A ก่อนเข้า Phase 3 (ออกแบบหน้าจอใหม่จริง)
**สโคป:** Mobile application เท่านั้น — ไม่แตะ Web/Backend ในรอบนี้
**หลักฐานอ้างอิง:** [คลังภาพหน้าจอ GPS Mobile](https://claude.ai/artifact/MFTVyn1bLebq6Q8CqwejoW)
(50 ภาพ ครอบคลุม 24 หน้าจอ ทุก Role, ตรวจสอบภาพจริงเทียบกับ README แล้วตรงกันทุกจุด —
ถ้าเปิดลิงก์ไม่ได้ให้ทักมาขอสิทธิ์เพิ่ม)

เอกสารนี้สรุปสองอย่าง: (1) gap ระหว่างข้อมูลที่ backend มีให้กับสิ่งที่ UI แสดงจริงในแต่ละ
หน้าจอ (2) ทิศทางที่เสนอปรับ พร้อมคำถามเปิดที่ต้องการคำตอบจาก A ก่อนเริ่มออกแบบจริง —
คอมเมนต์ในบรรทัดที่เกี่ยวข้องได้เลยถ้ามีความเห็นต่าง

---

## กลุ่ม A — หน้าที่ ST/OT เจอทุกวัน (priority สูงสุด)

### 1. Home — การ์ดประวัติงานไม่พอใช้งานจริง

การ์ด "ประวัติงานล่าสุด" บน Home โชว์แค่ชื่องาน + deviceId + สถานะ ไม่มี `dueDate`,
`description`, `configId` และที่สำคัญกว่านั้น **งานที่ pending/in_progress ไม่ขึ้นบน Home
เลย** ต้องกดเข้า "งานของฉัน" ถึงจะเห็น ทั้งที่งานค้างคือสิ่งที่ช่างอยากเห็นก่อนสุดตอนเปิดแอป
สาเหตุคือ section นี้ (`_HistorySection`) ถูกออกแบบมาเพื่อโชว์ "ประวัติ" ตั้งแต่แรก ไม่ใช่
"งานที่ต้องทำวันนี้"

**เสนอ:** สลับลำดับความสำคัญ — เอางานค้าง (pending + in_progress, จำกัดจำนวนที่โชว์ เช่น
3-4 งาน + ปุ่ม "ดูทั้งหมด") ขึ้นเป็น section แรก ส่วนการ์ดสถิติเลื่อนลงเป็น section รอง

> **ตอบแล้วจาก B:** ST/OT หนึ่งคนมีงานค้างเฉลี่ย ~10 งาน (ข้อมูลทดสอบ) — มากพอที่ต้องจำกัด
> จำนวนที่โชว์บน Home จริง ไม่ใช่แสดงทุกงาน

### 2. Task List — ไม่มีการจัดกลุ่ม ไม่มีการกรอง

รายการงานเรียงตามที่ API ส่งมาเฉย ๆ ไม่มี sort/group/filter ฝั่ง client โชว์แค่ชื่องาน +
deviceId + สถานะ งานทดสอบ (RETEST, T287, E2E281) ปนกับงาน push notification test
(PUSH_A_background ฯลฯ) แยกด้วยสายตาไม่ได้เลย

**เสนอ:** sort เริ่มต้นตาม `createdAt` (งานเก่าสุด/ค้างนานสุดขึ้นก่อน) + filter chip ด้านบน
(ทั้งหมด/กำลังทำ/รอดำเนินการ/เสร็จแล้ว) ให้ consistent กับ chip ใน Task Detail

> **ตอบแล้วจาก B:** `dueDate` เป็นค่าว่างในทางปฏิบัติ — เปลี่ยนจาก sort-by-dueDate (ที่เสนอ
> ไว้ตอนแรก) มาเป็น sort-by-createdAt แทน

### 3. Task Detail — ปุ่ม "บันทึกสถานะ" ดูเหมือนปุ่มเสีย

ปุ่มเป็นสีเทาจางมากจนแยกไม่ออกจากปุ่มที่ปิดใช้งานถาวร ต้องกดเปลี่ยน chip สถานะก่อน
(`_dirty` state) ปุ่มถึงจะติดสี โดยเฉพาะหน้า pending-no-device ที่ไม่มี chip ไหนถูกเลือกไว้
เลย ทำให้งงว่าสถานะปัจจุบันคืออะไร

**เสนอ:** แสดงสถานะปัจจุบันเป็น label แยกจาก chip เลือก ("สถานะตอนนี้: รอดำเนินการ") แล้ว
ค่อยมีแถว chip ให้เลือกสถานะใหม่ด้านล่าง ไม่พึ่ง chip บอกสถานะปัจจุบัน + ปรับสไตล์ปุ่ม
disabled ให้ต่างจาก active ชัดเจนกว่านี้

> **ตอบแล้วจาก B:** งานที่ "เสร็จแล้ว" **ห้ามเปลี่ยนสถานะกลับ** เป็น business rule — ต้องล็อก
> chip หลัง completed และควรบังคับที่ backend ด้วย ไม่ใช่แค่ซ่อนปุ่มฝั่ง UI (ถ้า backend ยัง
> accept request ย้อนสถานะได้ คนยิง API ตรงก็ยังทำได้) — ❓ **ขอความเห็น A**: จุดนี้ต้องแก้
> backend เพิ่มด้วยไหม หรือมี validation กันไว้แล้ว?

### 4. Simulator — dropdown Config แยกตัวเลือกไม่ออก + role ที่ใช้ไม่ได้เข้าถึงได้

dropdown Config แสดงแค่ `deviceModel/protocol · status` เช่น "GT06N/TCP · approved" —
ถ้ามี Config ซ้ำรุ่นกัน 2 ตัวจะแยกไม่ออก ส่วน Operation/Auditor/Admin กดเข้าหน้านี้จาก
ทางลัดบน Home ได้ แต่ใช้งานไม่ได้เลยเพราะ `taskListProvider` คืนค่าว่างให้ role เหล่านี้เสมอ

**เสนอ:** ใช้ `Config.name` เป็น label หลัก (fallback เป็น deviceModel/protocol ถ้าไม่มีชื่อ)

> ❓ **รอคำตอบ A**: role Operation/Auditor/Admin จำเป็นต้องใช้งานฝั่ง Mobile จริงไหม หรือควร
> ใช้ผ่านเว็บเป็นหลัก — ถ้าไม่จำเป็น จะตัดทางลัด "ทดสอบการตั้งค่า" ออกจาก Home ของ role
> พวกนี้ไปเลย (ส่งคำถามนี้แยกไปแล้วทางแชท รอคำตอบ)

### 5. Notifications — แตะแล้วไม่พาไปไหน + ไม่มีหน้าตัดสินใจของ Operation

การ์ดแจ้งเตือนมี payload นำทางได้ (`taskId`, `configId`, `firmwareId`, `incidentId`) แต่
แตะแล้ว mark-read เฉย ๆ ต่างจากแตะ push notification ที่ deep link ได้จริง

**เสนอ:** reuse deep-link logic จาก push handler มาใช้กับการแตะการ์ดใน
`NotificationListPage` ทุกประเภท

**เพิ่มเติมจากการตรวจโค้ด (ไม่ใช่แค่ UX เล็ก ๆ):** backend มี endpoint
`POST /incidents/:id/decide` ให้ Operation อนุมัติ/ปฏิเสธ field report พร้อมใช้งานมาตั้งแต่
issue #236 (ยัง OPEN) comment ในโค้ด Mobile เขียนว่า "ตัดสินใจกันที่ Web" แต่ตรวจจริงแล้ว
**ฝั่ง Web ก็ไม่มีหน้านี้เหมือนกัน** — ตอนนี้ทั้งระบบไม่มีใครตัดสินใจ incident พวกนี้ได้จาก
หน้าจอไหนเลย

> ❓ **รอคำตอบ A**: ควรทำหน้าตัดสินใจนี้ที่ฝั่งไหน (Web ตามที่ comment ตั้งใจไว้เดิม หรือย้าย
> มา Mobile เพราะ Operation น่าจะอยู่หน้างานบ่อยกว่า) และควรทำตอนนี้หรือรอรอบหลัง — **ยังไม่
> รวมเข้าสโคป Mobile redesign รอบนี้จนกว่าจะตอบ**

---

## กลุ่ม B — ใช้บ่อยรองลงมา

### 6. Device Detail — ข้อมูลที่ backend มีเกินครึ่งไม่ถูกแสดง

โชว์แค่ sim/รุ่น/โปรโตคอล/สถานะ/config-firmware status/วันที่ลงทะเบียน-ติดตั้ง และแถว
"ออนไลน์/ออฟไลน์" ที่ตายตัวเป็น "ไม่ทราบ" เสมอ (รอ #245) แต่ backend ส่ง
`customer.companyName`, `activePartition`, `partitionAFirmwareId/B`,
`hardwareRevisionCode`, `imei`, `serialNumber`, `blackboxId`, `bootloader` มาด้วย โมเดล
`Device` ฝั่ง Mobile ไม่ parse field พวกนี้เลยแม้แต่ field เดียว

**เสนอ:** แบ่งหน้าเป็น "ข้อมูลอุปกรณ์" (sim/รุ่น/imei/serial/blackbox/hardware revision),
"ลูกค้า" (companyName), "สถานะระบบ" (config/firmware/partition) แถว "ออนไลน์/ออฟไลน์" ซ่อน
ไปก่อนจนกว่า #245 จะเสร็จ

> **ตอบแล้วจาก B:** `imei`/`serialNumber`/`blackboxId` เป็น field บังคับกรอก จะไม่เป็น null
> ในข้อมูลจริง (ค่า null ที่เห็นในภาพเป็นแค่ข้อมูลทดสอบที่ยังไม่ได้กรอก) — ออกแบบแบบ "มีค่า
> เสมอ" ได้เลย ไม่ต้องทำ empty state พิเศษ

### 7. Device Search / Device Picker — field สำคัญซ่อนอยู่

`customer.companyName` มีค่าจริง (เช่น "ABC Logistics") แต่ไม่โชว์ในผลค้นหา ช่างต้องเดาจาก
deviceId อย่างเดียว

**เสนอ:** เพิ่มชื่อลูกค้าเป็นบรรทัดรองใต้ deviceId ในผลค้นหาทุกที่ที่โชว์รายการอุปกรณ์

### 8. Config Override / Firmware Override — แสดงค่าดิบ ไม่มีคำอธิบาย

หน้า Config Override โชว์ `fieldName` ดิบ ไม่มี description/unit ที่ backend มีให้ หน้า
Firmware Override/Confirm Install ไม่โชว์ `deviceModelCompatibility`/`approvalStatus`
เสี่ยงเลือก firmware ผิดรุ่น

**เสนอ:** เพิ่ม helper text จาก `ConfigFieldDefinition.description`+`unit` ใต้แต่ละ field +
เพิ่ม badge เตือนถ้า `deviceModelCompatibility` ไม่ตรงกับอุปกรณ์ที่เลือก

> **เพิ่มจากรีวิว PR #290 (2026-10-13):** badge "มี override เครื่องนี้" กับข้อความ
> "ค่านี้แก้เฉพาะอุปกรณ์เครื่องนี้ · ต้องรอ Operation อนุมัติ…" ใน `ConfigOverridePage`
> อยู่ติดกันในหน้าจอ (บรรทัด 256-275) ข้อความนี้เป็น static text อธิบายแค่ผลของการส่งคำขอ
> ใหม่เท่านั้น (ไม่เกี่ยวกับ override เดิมที่ badge บอก) แต่ตำแหน่งที่ติดกันทำให้ผู้ใช้อ่าน
> รวมกันแล้วเข้าใจผิดได้ว่า override ที่มีอยู่แล้วยังไม่มีผล — ตอนออกแบบหน้านี้ใหม่ควรแยกระยะ
> หรือจัดกลุ่มภาพให้ชัดว่าเป็นคนละข้อมูลกัน (สถานะปัจจุบัน vs ผลของการส่งคำขอใหม่)

---

## กลุ่ม C — ใช้ไม่บ่อย / quick win (ไม่ต้องคุยเพิ่ม)

- **Field Report:** validation โชว์ทีละข้อความ → เปลี่ยนเป็นไฮไลต์กรอบแดงที่ field ที่ error
- **Incident List/Detail:** `reportedBy`, `reviewedBy`, `reviewedAt`, `reviewNote` โมเดล
  parse ไว้แล้วแค่ไม่ render → เพิ่ม UI ดึงมาโชว์ (ไม่ต้องแก้โมเดล), `source` โชว์ค่าดิบ
  "field-report" → map เป็นข้อความอ่านง่าย
- **Login/SuperAdmin blocked:** ไม่มีปัญหา ไม่ต้องปรับ

---

## สรุปคำถามเปิดที่รอคำตอบ A ก่อนเข้า Phase 3

1. ❓ Business rule "งานเสร็จแล้วห้ามเปลี่ยนสถานะกลับ" — ต้องแก้ backend เพิ่มด้วยไหม
2. ❓ role Operation/Auditor/Admin จำเป็นต้องใช้งานฝั่ง Mobile จริงไหม
3. ❓ หน้าตัดสินใจ incident ของ Operation — ทำที่ Web หรือย้ายมา Mobile และทำตอนนี้หรือรอ
   รอบหลัง

ตอบครบ 3 ข้อนี้เมื่อไหร่ เริ่ม Phase 3 (โครงร่างหน้าจอใหม่ทีละหน้า) ต่อได้ทันที — ส่วนที่
ไม่ติดคำถามเปิด (กลุ่ม A ข้อ 1-3, กลุ่ม B ทั้งหมด, กลุ่ม C) เริ่มออกแบบคู่ขนานไปได้เลยโดย
ไม่ต้องรอ
