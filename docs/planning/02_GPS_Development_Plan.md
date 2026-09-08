# แผนการสร้างระบบ (Development Plan)
## GPS Config & Firmware Center

**อ้างอิงจาก:** GPS_Project_Structure_Formal.md v3.7 + 01_GPS_Build_Reference.md + Sprint Checklist จริงของทีม (GPS_Agile_Dev_Plan.xlsx)
**อัปเดตล่าสุด:** ปรับให้ตรงกับตาราง Sprint Checklist จริงที่มีวันที่ Checkpoint แล้ว — เปลี่ยนชื่อฟีเจอร์แถว Sprint 2 จาก "Device Gateway Pipeline" เป็น **"config-sync-writer Pipeline"** ให้ตรงกับสถาปัตยกรรม v3.0 (ไม่มี Device Gateway/Queue อีกต่อไป — ดูหมายเหตุท้ายตาราง)
**อัปเดต v3.7:** Firmware Repository (แถวที่ 23) เหลือรับไฟล์ผ่าน**อัปโหลดตรงเข้าระบบเราทางเดียว** (ตัดช่องทาง "ดึงจากระบบเดิม" ออก) และต้องแสดงสถานะ 2 ฝั่ง — อัปโหลด/จัดเก็บฝั่งเรา และสถานะอัปเดตเวอร์ชันจริงของกล่องผ่าน `device-status`

**หลักการสำคัญของแผนนี้:** เริ่มพัฒนาได้ทันทีโดยไม่ต้องรอ 2 TBD หลัก (รูปแบบคำสั่ง Write/Set ของระบบเดิม, คาบเวลาที่กล่องเช็คตัวเอง) — ใช้วิธีแยก Interface ออกจาก Implementation แล้วใส่ Mock/Placeholder ไปก่อน ค่อยกลับมาเติมทีหลังโดยไม่ต้องรื้อโครงสร้าง (รายละเอียดดู 01_GPS_Build_Reference.md Section 4)

---

## หลักการแบ่งงาน 2 คน (ปรับใหม่ — แบ่งตามแพลตฟอร์ม)

**แทนที่หลักการแบ่งงานแบบเดิมที่วางไว้ใน `docs/planning/Team_Task_Plan_2Persons.md`** (ซึ่งแบ่งตามสายงาน Core/Data vs Workflow) ทีมต้องการแบ่งใหม่ตามแพลตฟอร์มแทน: **Web = A, Mobile = B** ส่วน **Backend แบ่งกันตามโมดูล** — โมดูล Backend ไหนเป็นของฝั่งไหนเป็นหลัก คนที่ดูแลฝั่งนั้นก็ดูแล Backend module นั้นไปด้วย เพื่อให้แต่ละคนเห็น flow ของงานตัวเองครบตั้งแต่หน้าจอถึง Backend ไม่ต้องส่งต่องานข้ามคนบ่อยเกินไป:

- **A (paveekornkwork-dev) — Web + Backend ฝั่ง Web:** Web (Next.js) ทั้งหมด (Config Editor, Approval Center, Campaign, Firmware Repository, Audit Log, Dashboard, หน้า Override) **+ Backend module:** `auth`/RBAC, `config`, `firmware`, `campaign`, `incident` (ฝั่งจัดการ/Dashboard), `audit`, `device-status` (แสดงผลบนหน้าเว็บ)
- **B (kittiphongkubkub) — Mobile + Backend ฝั่ง Mobile:** Mobile (Flutter) ทั้งหมด (5 หมวดตาม Sitemap, ปุ่มทดสอบ Device Simulator ก่อนติดตั้ง, Push Notification) **+ Backend module:** `task`, `notification` (FCM Push)
- **ร่วมกัน (ทั้งคู่):** `config-sync-writer` (Critical Infra เขียนเข้าระบบเดิม — กระทบทั้งระบบถ้าพลาด ต้องคุยกันตลอดและห้ามคนใดคนหนึ่งแก้เดี่ยวๆ), RBAC/Permission Matrix ตอนออกแบบเริ่มต้น (แม้ A เป็นคนสร้าง แต่ต้องตกลงเนื้อหาร่วมกับ B ก่อน เพราะ B ต้องเอาไปใช้ทำ RBAC ฝั่ง Mobile), Infra/CI-CD, Rollback Mechanism, งานที่ Mobile กับ Web ต้องเชื่อมกันโดยตรง (เช่น Incident Realtime, Change Request, ทดสอบ Simulator ก่อนติดตั้ง), Demo/Report ท้าย Sprint

**กติกาสำคัญ:** แม้ A จะเป็นคนสร้าง RBAC Backend แต่ B ต้องรอ Permission Matrix ฉบับร่างจาก A ก่อนถึงจะ Finalize สิทธิ์บน Mobile ได้ — เช่นเดียวกัน งานฝั่ง Mobile ที่ต้องเรียก Backend module ของ A (เช่น แถวที่ 26b เรียก Endpoint Simulate ที่อยู่ใน `config` module ของ A) ให้ A ทำ Interface/Endpoint ให้นิ่งก่อน แล้ว B ค่อยเชื่อมต่อฝั่ง Mobile — ดูจุดส่งมอบ (Handoff) ที่ทำเครื่องหมายไว้ในตาราง Sprint Checklist และใน `03_GPS_Detailed_Build_Steps.md`

---

## Sprint Checklist

| No. | Sprint | วันที่ Checkpoint | ฟีเจอร์ | ฝั่ง | ผู้รับผิดชอบ | ผลตรวจ |
|---|---|---|---|---|---|---|
| 1 | Sprint 0 | 30/08/2026 | Branch Protection | Infra | ร่วมกัน | Not Tested |
| 2 | Sprint 0 | 30/08/2026 | API Spec (OpenAPI) | Infra | ร่วมกัน | Not Tested |
| 3 | Sprint 1 | 13/09/2026 | Login | Web | A | Not Tested |
| 4 | Sprint 1 | 13/09/2026 | Login | Mobile | B | Not Tested |
| 5 | Sprint 1 | 13/09/2026 | Role-Based Access Control (RBAC) | Web + Mobile | **A** (Backend RBAC/Permission Matrix — ต้องเสร็จก่อน B ถึงจะ Finalize สิทธิ์ฝั่ง Mobile ได้) | Not Tested |
| 6 | Sprint 1 | 13/09/2026 | Config Definition Lookup (ตั้ง field ของ Config) | Backend | A | Not Tested |
| 7 | Sprint 2 | 27/09/2026 | Task Management | Web | A | Not Tested |
| 8 | Sprint 2 | 27/09/2026 | Task Management | Mobile | B | Not Tested |
| 9 | Sprint 2 | 27/09/2026 | **config-sync-writer Pipeline (mock → Docker → Production)** | Backend | ร่วมกัน (Critical Infra) | Not Tested |
| 10 | Sprint 2 | 27/09/2026 | Dashboard/Main | Web | A | Not Tested |
| 11 | Sprint 2 | 27/09/2026 | Device Search + Device Detail | Web | A | Not Tested |
| 12 | Sprint 2 | 27/09/2026 | Config Editor (ร่าง/บันทึกร่าง) | Web | A | Not Tested |
| 12b | Sprint 2 | 27/09/2026 | **Config Import จากไฟล์ (JSON — v3.2)** | Web + Backend | A | Not Tested |
| 13 | Sprint 2 | 27/09/2026 | Config Simulation (dry-run) | Backend | A | Not Tested |
| 14 | Sprint 3 | 11/10/2026 | Offline-first Sync | Mobile | B | Not Tested |
| 15 | Sprint 3 | 11/10/2026 | Incident Reporting + แจ้งเตือน Real-time | Mobile → Web | ร่วมกัน (B ฝั่ง Mobile ส่ง / A ฝั่ง Web รับ Realtime) | Not Tested |
| 16 | Sprint 3 | 11/10/2026 | Firmware/Config Override Access Control | Web | A | Not Tested |
| 17 | Sprint 3 | 11/10/2026 | Push Notification | Mobile | B | Not Tested |
| 18 | Sprint 3 | 11/10/2026 | Config Simulation Gate (บล็อก/แก้ไข/ผ่าน) | Web + Backend | A | Not Tested |
| 19 | Sprint 3 | 11/10/2026 | Approval Center (อนุมัติ/ปฏิเสธจริง) | Web | A | Not Tested |
| 20 | Sprint 3 | 11/10/2026 | Change Request (ส่งจากมือถือ → เข้า Inbox เว็บ) | Mobile + Web | ร่วมกัน (B ฝั่ง Mobile ส่ง / A ฝั่ง Web รับเข้า Inbox) | Not Tested |
| 21 | Sprint 3 | 11/10/2026 | Campaign Wizard (สร้างแคมเปญครบขั้นตอน) | Web | A | Not Tested |
| 22 | Sprint 3 | 11/10/2026 | Campaign Monitor (ติดตาม Failure Rate จริง) | Web | A | Not Tested |
| 23 | Sprint 3 | 11/10/2026 | Firmware Repository (อัปโหลด/Compatibility Tag) | Web | A | Not Tested |
| 24 | Sprint 3 | 11/10/2026 | Firmware Override รายเครื่อง | Web | A | Not Tested |
| 25 | Sprint 3 | 11/10/2026 | Device Config Override | Web | A | Not Tested |
| 26 | Sprint 3 | 11/10/2026 | Confirm Install (ช่างยืนยันติดตั้งสำเร็จ) | Mobile | B | Not Tested |
| 26b | Sprint 3 | 11/10/2026 | **ทดสอบกับ Device Simulator ก่อนยืนยันติดตั้ง (ไม่บังคับ — v3.5)** | Mobile + Backend | B (Mobile UI) + A (Backend Endpoint `/simulate` — อยู่ใน `config` module ของ A) | Not Tested |
| 27 | Sprint 3 | 11/10/2026 | Audit Log (ทุก action) | Web | A | Not Tested |
| 28 | Sprint 3 | 11/10/2026 | Incident & Rollback | Web | ร่วมกัน (Rollback กระทบทั้ง `config`/`config-sync-writer` — ต้องคุยกันก่อนออกแบบ) | Not Tested |
| 29 | Sprint 4 | 23/10/2026 | End-to-End Demo (ครบ user journey ทั้งระบบ) | ทั้งหมด | ร่วมกัน | Not Tested |
| 30 | Sprint 4 | 23/10/2026 | Deployment ทุกระบบพร้อมกัน (docker-compose) | Infra | ร่วมกัน | Not Tested |
| 31 | Sprint 4 | 23/10/2026 | CI Pipeline เขียวทั้งหมด | Infra | ร่วมกัน | Not Tested |
| 32 | Sprint 4 | 23/10/2026 | Config Simulation Demo + Scope Report | Web + Backend | ร่วมกัน | Not Tested |
| 33 | Sprint 4 | 23/10/2026 | Backlog Scope Report (งานที่ตัดออก) | ทีม | ร่วมกัน | Not Tested |

**จุดส่งมอบ (Handoff) ที่ต้องระวัง:** แถวที่ 5 (RBAC — A ทำ) ต้องเสร็จก่อนแถวที่ 6, 12, 18, 19 (ของ A เอง) และก่อนที่ B จะ Finalize สิทธิ์ฝั่ง Mobile ได้ — ถ้า A ทำ RBAC ไม่ทันตามนัด ทั้งคู่ยังเริ่มหน้าจอ/ฟีเจอร์อื่นที่ไม่ต้องพึ่ง Permission Check ได้ก่อน แต่ต้องพักส่วนตรวจสิทธิ์ไว้ก่อน อย่ารอจนตัน — อีกจุดคือแถวที่ 26b ที่ B ต้องรอ Endpoint `/simulate` จาก A (แถวที่ 13/18) ให้นิ่งก่อนถึงจะเชื่อมฝั่ง Mobile ได้เต็มรูปแบบ

---

## หมายเหตุเรื่องแถวที่ 26b — ทดสอบกับ Device Simulator ก่อนยืนยันติดตั้ง (v3.5)

ก่อนช่างหน้างานกด "ยืนยันติดตั้งสำเร็จ" (แถวที่ 26) เพิ่มปุ่มให้เลือกทดสอบ Config/Firmware ที่กำลังจะติดตั้งกับ Device Simulator ซ้ำหน้างานได้อีกครั้ง (เรียก Endpoint เดียวกับที่ Web ใช้ตอน SW ทดสอบก่อนอนุมัติ) — **เป็นทางเลือก ไม่บังคับ** ช่างข้ามได้ตามปกติ แต่ถ้าเลือกทดสอบแล้วผลออกมาไม่ผ่าน ระบบจะบล็อกปุ่ม "ยืนยันติดตั้งสำเร็จ" ทันที และบันทึกเหตุผลไว้เป็น Incident อัตโนมัติ (รายละเอียด Interface ดู `01_GPS_Build_Reference.md` Section 3.2)

---

## หมายเหตุเรื่องแถวที่ 12b — Config Import จากไฟล์ (JSON — v3.2)

ฟีเจอร์นี้เพิ่มเข้ามาใหม่ตามที่ทีมต้องการ: นอกจากกรอก Config ผ่านฟอร์ม Config Editor แล้ว SW ต้องการ Import Config จากไฟล์ได้ด้วย ทีมตัดสินใจแล้วว่าจะรองรับ **JSON** เป็นรูปแบบแรก (ยังไม่ตายตัว — อาจปรับเปลี่ยนภายหลังได้ถ้าพบว่ารูปแบบอื่นเหมาะกว่า) ยืนยันแล้วว่าไฟล์ที่ Import เข้ามาต้องผ่าน Config Simulation (แถวที่ 13/18) และ Approval Center (แถวที่ 19) แบบเดียวกับ Config ที่กรอกผ่านฟอร์มทุกประการ ไม่มีทางลัด

เขียน `ConfigImporter` interface แยกจาก Format ตั้งแต่ต้น (ดู `01_GPS_Build_Reference.md` Section 3.1 สำหรับโค้ด Interface และตัวอย่างโครงสร้างไฟล์ JSON) เพื่อให้เพิ่ม Parser รูปแบบอื่นทีหลังได้โดยไม่กระทบโค้ดส่วนอื่น

---

## หมายเหตุสำคัญเรื่องแถวที่ 9 — config-sync-writer Pipeline

แถวนี้เดิมชื่อ **"Device Gateway Pipeline (mock → Queue → Backend)"** ซึ่งมาจากการออกแบบคนละเวอร์ชันที่ถูกตัดออกไปแล้ว (ไม่มี Device Gateway service, ไม่มี Message Queue สำหรับสื่อสารกับอุปกรณ์อีกต่อไป — ดู GPS_Project_Structure_Formal.md v3.0) เปลี่ยนเป็น **config-sync-writer Pipeline (mock → Docker → Production)** ให้ตรงกับกลไกจริงที่ยืนยันแล้ว:

- **mock** — Implementation เขียน Log แทนการยิง TCP จริง (`LEGACY_SYNC_MODE=mock`) ใช้ตอน dev/เทสต์ Flow ทั่วไปใน Sprint 2
- **Docker** — ยิงเข้าเครื่อง Local/Docker ทดสอบจริง (`LEGACY_SYSTEM_HOST=127.0.0.1`, `LEGACY_SYSTEM_PORT=801`) เพื่อยืนยันว่าเขียนค่าได้ถูกต้องตรงกับที่ Hercules เขียนได้ก่อนแตะของจริง
- **Production** — ยิงเข้า `config.dtc.co.th:909` จริง — **⏸ ชะลอไว้ก่อนตามคำสั่งของทีม (27 สิงหาคม 2569): ทีมยืนยันว่ายังไม่ต้องการเชื่อมต่อ Production ในตอนนี้** พัฒนาและทดสอบด้วยโหมด mock/Docker ไปก่อนได้ตามปกติ แม้จะได้คำตอบ TBD เรื่องรูปแบบคำสั่ง Write/Set แล้วก็ตาม ก็ยังต้องรอคำสั่งเริ่มต่อ Production แยกต่างหากอีกครั้ง (ดู 01_GPS_Build_Reference.md Section 4.1 และ 8)

ถ้าถึง Checkpoint Sprint 2 (27/09/2026) แล้วยังไม่ได้คำตอบ TBD นี้ ให้ผ่านขั้น mock/Docker ไปก่อน ปรับ "ผลตรวจ" เป็นผ่านเฉพาะ 2 โหมดแรก และเปิด Backlog item แยกสำหรับขั้น Production ไว้ ไม่ต้องบล็อก Sprint 2 ทั้ง Sprint

---

## จุดที่ต้องเฝ้าระวังเรื่อง TBD ตาม Timeline นี้

| Checkpoint | ความเสี่ยงจาก TBD | แนวทางถ้ายังไม่ได้คำตอบ |
|---|---|---|
| Sprint 2 (27/09/2026) — config-sync-writer Pipeline | ยังไม่รู้รูปแบบคำสั่ง Write/Set จริง | ทดสอบผ่านแค่ mock/Docker ก่อน เลื่อนขั้น Production ไป Sprint ถัดไป |
| Sprint 2 (27/09/2026) — Dashboard/Main, Device Search + Device Detail | ยืนยันแล้ว (v3.3) ว่ากล่องเช็คตัวเองทุกครั้งที่เปิดเครื่อง แต่ยังไม่รู้ว่าเปิดเครื่องบ่อยแค่ไหนจริง กระทบข้อความสถานะบนหน้าจอ | ใช้ข้อความ UX "จะได้รับการอัปเดตในการเปิดเครื่องครั้งถัดไปของกล่อง" แทนการระบุเวลาแน่นอน (ดู Build Reference Section 4.2) |
| Sprint 4 (23/10/2026) — End-to-End Demo | ถ้า Production ของ config-sync-writer ยังไม่พร้อม | ทำ Demo ด้วยโหมด Docker แทน Production ได้ ระบุใน Scope Report (แถวที่ 33) ว่าเป็นข้อจำกัดที่ทราบอยู่แล้ว |
| Sprint 2 (27/09/2026) — Config Import จากไฟล์ | เลือก JSON ไว้ก่อน อาจต้องเปลี่ยน format ทีหลังถ้าใช้งานจริงแล้วไม่เหมาะ | ออกแบบ Interface แยกจาก Format ไว้แล้ว เพิ่ม Parser รูปแบบอื่นทีหลังได้โดยไม่กระทบโค้ดส่วนอื่น (ดู Build Reference Section 3.1) |
| ตลอดโครงการ — กล่องเช็คเวอร์ชันตามรอบเวลาคงที่ได้ไหม (v3.6) | ทีมอยากได้ทั้งเช็คตอนเปิดเครื่องและตามรอบเวลาคงที่ (เช่น ทุก 6 ชม.) แต่เป็นพฤติกรรม Firmware กล่อง ไม่ใช่สิ่งที่ซอฟต์แวร์เราสร้างเอง | ไม่กระทบแผนพัฒนาตอนนี้ — รอคำตอบจากพี่ในทีม/ผู้ผลิตกล่อง ถ้ารองรับได้ค่อยเพิ่มเป็นฟิลด์ Config ปกติ |

---

## เอกสารสนับสนุนเพิ่มเติม

รายละเอียดเชิงเทคนิค (Interface, Environment Variable, โครงสร้างไฟล์, TBD ทั้งหมด) อยู่ใน `01_GPS_Build_Reference.md` — แผนงานแบบละเอียดกว่านี้ (PoC plan) มีอยู่แล้วที่ `docs/planning/` (GPS_Agile_Dev_Plan.md, PoC_Plan_Person1.md, PoC_Plan_Person2.md, PoC_Task_Plan_2Persons.md, GPS_Repo_Setup_Plan.md) ซึ่งได้รับการปรับให้ตรงกับสถาปัตยกรรม v3.0 แล้วเช่นกัน (ตัด Device Gateway/MQTT/SMS ออก แทนที่ด้วยงาน config-sync-writer/device-status)

> **หมายเหตุ:** `docs/planning/Team_Task_Plan_2Persons.md` เป็นแผนแบ่งงานฉบับเก่า (แบ่งตามสาย Core/Data vs Workflow) ซึ่ง**ถูกแทนที่แล้วโดยหลักการแบ่งงานใหม่ในเอกสารนี้** (แบ่งตามแพลตฟอร์ม Web=A/Mobile=B/Backend แบ่งตามโมดูล) — ใช้เอกสารนี้และ `03_GPS_Detailed_Build_Steps.md` เป็นหลักแทน ไม่ต้องอ้างอิงการแบ่งงานจากไฟล์เก่านั้นอีก
