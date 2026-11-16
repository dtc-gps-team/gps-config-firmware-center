# สารบัญเอกสาร

สถานะตรวจ ณ 18 พ.ย. 2569 เทียบกับโค้ดบน `main` · **หัวเอกสารหลายฉบับยังเขียนสถานะตอนร่าง (เช่น "แผน ยังไม่มีโค้ด")
ให้ยึดสถานะในหน้านี้**

| ป้าย | ความหมาย |
|---|---|
| ✅ | ทำตามเอกสารแล้ว — ใช้อ้างอิงพฤติกรรมจริงได้ (ถ้าโค้ดกับเอกสารไม่ตรงกัน ให้ยึดโค้ดและ `openapi.yaml`) |
| 🟡 | ทำบางส่วน / มีงานค้าง |
| ⏸ | แผนอย่างเดียว ยังไม่ได้ทำ |
| 📜 | ประวัติ — มติหรือข้อเสนอที่ถูกแทนแล้ว อ่านเพื่อเข้าใจที่มาเท่านั้น |
| ❌ | ยกเลิก |

## เริ่มที่นี่

| เอกสาร | เนื้อหา |
|---|---|
| [HANDOVER.md](HANDOVER.md) | สถานะระบบ ณ วันส่งมอบ, ค่าลับ, งานต่อ |
| [Config_Flow_Summary.md](Config_Flow_Summary.md) | flow หลัก Parameter → Config → ส่งเข้ากล่อง (โหมด central) |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | ปัญหาที่รู้แล้ว + issue ที่ยังเปิด |
| [deploy/OPERATIONS.md](deploy/OPERATIONS.md) | env บน production, backup, migrate, LAN |
| [deploy/docker-compose.md](deploy/docker-compose.md) | ระบบเต็มชุดด้วย Docker |
| [api/openapi.yaml](api/openapi.yaml) | **ข้อกำหนด API (ต้นฉบับ)** |
| [architecture/RBAC_Matrix.md](architecture/RBAC_Matrix.md) | บทบาทไหนทำอะไรได้ |
| [database/GPS_Data_Dictionary.xlsx](database/GPS_Data_Dictionary.xlsx) | **ต้นฉบับ data model** |

## เอกสารออกแบบ (เรียงตามเลข)

| เลข | เรื่อง | สถานะ |
|---|---|---|
| [04](04_Phase1_A_ConfigWorkflow.md) | Config Workflow (Phase 1-A) | ✅ |
| [05](05_Mobile_Notification_FCM.md) | Push ผ่าน FCM | ✅ Android · iOS ยังไม่ทำ |
| [06](06_Device_Connection_Test_Spec.md) | ทดสอบสัญญาณอุปกรณ์ (`test-connection`) | 🟡 โหมด mock เท่านั้น |
| [07](07_ConfigSyncWriter_Proposal.md) | config-sync-writer (ส่งเข้าระบบเดิม) | 🟡 โหมด mock เท่านั้น |
| [08](08_ConfigSimulator_Phase2_Proposal.md) | จำลอง Config + อุปกรณ์ (`simulate-config`) | 🟡 โหมด mock เท่านั้น |
| [09](09_Sprint1_Review_Decisions.md) | มติจาก Sprint 1 Review | 📜 (บางข้อถูกแทนภายหลัง เช่น ขอบเขต SuperAdmin) |
| [10](10_LocalActivityLog_Proposal.md) | Local Activity Log | ❌ ยกเลิก 10 ก.ย. 2569 |
| [11](11_ConfigDeletion_SuperAdmin_Proposal.md) | คำขอลบ Config + SuperAdmin | ✅ (ขอบเขต SuperAdmin เปลี่ยนตามมติ 30 ต.ค. — ดู `CLAUDE.md`) |
| [12](12_Campaign_Feature_Spec.md) | Campaign | ✅ (รวมกลุ่มผูกรุ่นเดียว 13 พ.ย.) |
| [13](13_Role_Redesign_Proposal.md) | แยก SW เป็น 3 บทบาท | ✅ |
| [14](14_Device_Sync_Proposal.md) | อุปกรณ์ดึง Config/Firmware เอง | ✅ (เส้นทางหลักภายหลังคือ Server กลาง) |
| [15](15_Device_Model_Association_Proposal.md) | ผูกอุปกรณ์/Config กับรุ่น | ✅ |
| [16](16_Task_Event_History_Proposal.md) | ประวัติงานแบบ timeline | ✅ |
| [17](17_Rollout_Device_Values_Proposal.md) | ค่า Config เฉพาะเครื่องตอน Rollout | ✅ |
| [18](18_Mobile_UXUI_Redesign_Proposal.md) | Mobile UX/UI Phase 1-2 | 📜 แทนด้วย 22 / 29 |
| [19](19_Device_Pull_Test_Proposal.md) | อุปกรณ์ดึง Config เองและรายงานผล + วันทดสอบ | ✅ |
| [20](20_Mobile_Redesign_Phase3_Design.md) | Mobile Redesign Phase 3 | 📜 แทนด้วย 22 |
| [21](21_Mobile_UX_Audit_Round1.md) | UX Audit มือถือรอบแรก | ✅ (สถานะรายข้ออยู่ในเอกสาร) |
| [22](22_Mobile_UI_Redesign_Plan.md) | รื้อ UI มือถือ | ✅ |
| [23](23_GPS_Telemetry_Integration_Plan.md) | รับ telemetry จากกล่อง | ✅ |
| [24](24_Mobile_Device_Simulator_Plan.md) | กล่องจำลองในแอป | ⏸ |
| [25](25_Mobile_Config_Apply_Request_Plan.md) | ขอส่ง Config เข้ากล่องจากมือถือ | ✅ |
| [26](26_Firmware_Parameter_Preview_Plan.md) | แสดงพารามิเตอร์ Firmware ตอนอัปโหลด | ⏸ |
| [27](27_Field_Apply_Approve_Then_Release_Plan.md) | คำขอจากหน้างาน v2 (อนุมัติแล้วช่างกดส่ง) | ✅ |
| [28](28_Technician_Started_Task_Plan.md) | ช่างเริ่มงานเองจากหน้ากล่อง | ✅ |
| [29](29_Mobile_R4_Redesign_Plan.md) | Mobile Redesign r4 | ✅ |
| [30](30_Config_Override_Via_Apply_Request_Plan.md) | แก้ค่าเฉพาะเครื่องผ่านคำขอส่งเข้ากล่อง | ✅ (รวม Override ใช้ครั้งเดียว §11) |
| [31](31_Field_Apply_Auto_Retry_Plan.md) | ลองส่งเข้ากล่องใหม่อัตโนมัติ | ✅ |
| [32](32_Load_Testing_Plan.md) | ทดสอบโหลด k6 | 🟡 ทดสอบแล้ว สิ่งที่ต้องแก้ §8.1 ยังไม่ทำ |

## แผนตั้งต้นของโปรเจกต์ (`planning/`)

📜 แผนช่วงเริ่มโปรเจกต์ (Sprint 0–4) — โครงสร้างหลักยังตรง แต่รายละเอียดหลายจุดถูกแทนด้วยเอกสารออกแบบข้างบน

| เอกสาร | เนื้อหา |
|---|---|
| [00_Sprint0_Setup_Guide.md](planning/00_Sprint0_Setup_Guide.md) | ตั้งค่าเครื่องช่วงแรก (ใช้ README หลักแทน) |
| [01_GPS_Build_Reference.md](planning/01_GPS_Build_Reference.md) | ภาพรวมสถาปัตยกรรม |
| [02_GPS_Development_Plan.md](planning/02_GPS_Development_Plan.md) | แผน Sprint และการแบ่งงาน |
| [03_GPS_Detailed_Build_Steps.md](planning/03_GPS_Detailed_Build_Steps.md) | ขั้นตอนสร้างละเอียด |

## อื่นๆ

| ที่ | เนื้อหา |
|---|---|
| [testing/](testing/) | คู่มือทดสอบร่วมเว็บ + มือถือ, รันแอปบนมือถือ, รายงานผลทดสอบ push / ยืนยันติดตั้ง Firmware |
| [architecture/diagrams/](architecture/diagrams/) | diagram สถาปัตยกรรม |
| [ui-renovation/](ui-renovation/) | ระบบดีไซน์ของเว็บ (`DESIGN.md`) |
| [GPS_Config_Firmware_Center_Design.pdf](GPS_Config_Firmware_Center_Design.pdf) | เอกสารออกแบบต้นฉบับ (PDF) |
| `../arduino_gps/` | คู่มือและสเปกของ Server กลาง + firmware — [README](../arduino_gps/README.md) |
| `../backend/test/load/` | สคริปต์ทดสอบโหลด — [README](../backend/test/load/README.md) |
