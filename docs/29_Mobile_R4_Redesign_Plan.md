# แผน Mobile Redesign รอบ r4 (ภาพจำลองทุกหน้า → พัฒนาเป็น 10 PR)

> **สถานะ:** แผน — รอ A review · ยังไม่เริ่มเขียนโค้ด · ภาพ r4.2 B ล็อกเป็นสเปกแล้ว 29 ต.ค. 2569
>
> **ชุดภาพ:** draft release ของ repo นี้ (เปิดได้เฉพาะคนที่มีสิทธิ์ push) —
> https://github.com/dtc-gps-team/gps-config-firmware-center/releases/tag/untagged-2f55b0cfd39d199e491a
> แตก ZIP แล้วเปิด `index.html` · เริ่มจาก `preview-overview.jpg` หรือ `unique-images.html`
>
> | ไฟล์ | SHA-256 |
> |---|---|
> | `r4.2-review-bundle.zip` | `585ba346498b1d2bdc546b564d9bd9bd469d8e8e39037decc518bfb2ca695dc1` |
> | `manifest.json` ในชุด (1,448 ภาพ) | `5c06014767bd4485a19d4ca97cb993a1d63dc5c8889216a7af7a921ec8f77751` |
>
> เลข 29 ตามที่จองไว้ใน issue #386 สำหรับแผน Mobile Redesign

## 0. ความสัมพันธ์กับเอกสารเดิม — อ่านก่อน

| เอกสาร | สถานะหลังแผนนี้ |
|---|---|
| `docs/20` (Phase 3) | ถูกแทนที่ไปแล้วโดย docs/22 ไม่เปลี่ยน |
| `docs/22` (Mobile ให้สอดคล้องกับ Web, A approve ใน #347) | **ส่วนหน้าตา (token สี/ฟอนต์/รูปทรง) ถูกแทนที่ด้วยภาพ r4** · โครงที่ทำเสร็จแล้วใช้ต่อ: `AppV2Theme`, shared components, `AppTabShell`, 4 แท็บของ ST/OT, route ที่ตัดออก (§2) |
| token พรีเมียม (#368, docs/22 §4.6) | ถูกแทนที่ใน R4-01 |
| issue #386 (คำถาม P0) | ภาพ r4 **ไม่ใช้** ประเภทงาน สถานที่ หรือ Due Date · สถานะออนไลน์ใช้ `DeviceOnline` (central ก่อน แล้วค่อย /status — #387, #405) · "กล่องรับแล้ว" ใช้สถานะคำขอ (`succeeded`) ตามที่แอปทำอยู่ · จึงไม่ต้องรอคำตอบ #386 เพื่อเริ่มรอบนี้ |

**ประเด็นที่ขอให้ A ตัดสินโดยตรง:** docs/22 ตั้งใจให้ Mobile ใช้สีชุดเดียวกับ Web แต่ภาพ r4 ใช้โทนพื้นเข้ม + เขียวมะนาว
(ค่าใน §4) ซึ่ง**ต่างจาก Web** — Web ไม่ต้องเปลี่ยนตาม ถ้า A ต้องการให้สองฝั่งยังเหมือนกัน ต้องตกลงก่อนเริ่ม R4-01

## 1. ฐานที่ใช้และเงื่อนไขเริ่ม

- ใช้ `main` ล่าสุดเป็นฐานเสมอ ระบบเดิมบน main มี `AppColors` / `AppTypography`, `AppV2Theme`, shared components,
  `AppTabShell` และ 4 แท็บของ ST/OT อยู่แล้ว ให้ปรับระบบเดิม ไม่สร้างระบบ theme หรือ router ซ้ำ
- flow ใหม่จาก #401–#405 และ #408 (ค้นหา+ดาว, ค่าที่กล่องใช้, ประวัติคำขอ, ส่งตรง+หน้าพารามิเตอร์) ต้องคงพฤติกรรมเดิม
  — ภาพ r4 ทำให้ตรงกับ PR เหล่านี้แล้ว
- เอกสารนี้ไม่ได้แทนมติ RBAC, API หรือ Separation of Duty ภาพ `proposed-view` และภาพปฏิเสธสิทธิ์ต้องเทียบ contract
  จริงก่อนนำไปพัฒนา

เริ่ม PR โค้ด R4-01 ได้เมื่อครบทุกข้อ:

1. A review และ approve แผนนี้ (รวมประเด็นสีใน §0)
2. #401–#405 และ #408 เข้า `main` ครบ
3. B ยืนยันวันเริ่ม

ข้อยกเว้นที่ตกลงแล้ว: ภาพ 1272/1307/1342/1377 ปุ่ม "ขออนุมัติค่าที่แก้" เป็นสีเทาตอนค่าผิด — **ทำตามแอป** (กดได้
แล้วขึ้นข้อความแดงใต้ช่อง) · ภาพการโอนงาน (Q8) 28 ภาพเป็นข้อเสนอ ไม่อยู่ในรอบนี้

## 2. สัญญาที่ต้องรักษา

- ST/OT: หน้าแรก · Device Search · Incidents · แจ้งเตือน ส่วน Operation ใช้รายการแท็บและสิทธิ์จากระบบจริง ไม่เพิ่มแท็บงานจากภาพ
- หน้าลูกยังใช้ back stack เดิม; push notification/deep link และการคืน session ต้องทำงานต่อ
- Config ไม่แก้ค่า = ส่งตรงตาม #408; แก้ค่าต้องมีเหตุผลและรอ Operation, แก้กลับเท่าเดิมต้องกลับเป็นส่งตรง Firmware คง approval
- ตรวจสิทธิ์, ผู้ถืองาน, สถานะติดตั้ง, คำขอ active, Config ที่เลือกได้, validation และ offline จาก contract จริง ห้ามให้ UI เป็นผู้อนุญาตแทน backend
- Config Override แสดงค่าที่กล่องใช้ครบตาม #400/#404 รวมค่าที่แก้ไม่ได้ ปกปิดค่าลับและไม่แสดง `data_server.path`
- ไม่คืน route `/simulator`, `/device-connection-test` หรือ `/tasks` ที่ตัดออกตาม docs/22; Device Simulator อยู่ใน flow งานตามระบบปัจจุบัน
- central/legacy ต้องแยกตาม mode เดิม ไม่เปิด Firmware Override หรือ manual confirm ใน central เพราะมีภาพใน catalog
- Q8 ทั้ง 28 ภาพเป็นข้อเสนอ ไม่เพิ่มปุ่มโอนงาน, route, API หรือ backend ในรอบนี้

## 3. ลำดับ PR

ทำตามลำดับด้านล่างทีละ PR ให้ PR ก่อนหน้าเข้า main แล้วจึงตั้งฐานตัวถัดไป เลข R4-xx เป็นลำดับงาน ไม่ใช่เลข GitHub PR

| PR | ขอบเขตและไฟล์หลักบน main | เลขภาพสำหรับเริ่มเทียบ | เทสต์ที่เขียน/เพิ่มก่อนแก้ UI |
|---|---|---|---|
| R4-01 | ปรับ `core/theme/app_tokens.dart`, `app_theme.dart`, `core/ui/app_v2_theme.dart`, shared components และ `core/router/app_shell.dart` ให้ใช้สี ฟอนต์ ขนาด ช่องไฟและแถบล่าง r4 | 0001, 0109, 0817, 1013 และ compact/2.0× ของหน้าราก | ต่อ `app_tokens_test`, `color_contrast_test`, `app_tab_shell_test`, `large_text_layout_test`; เปลี่ยนแท็บแล้วคง stack, แตะแท็บเดิมกลับราก, สิทธิ์ Operation และ unread badge |
| R4-02 | Home และรายการงาน/ตัวกรองที่อยู่ใน Home ปรับ `features/home/home_page.dart`, `home_status_banners.dart` ใช้ data/provider เดิม | กลุ่ม `home`, `all` เริ่ม 0001 และ 0047 | ต่อ `home_page_test`, `home_task_list_test`, `home_task_summary_test`, `task_urgency_test`; ค้นหา/เปิดงาน/ดูทั้งหมด, loading/error/offline และ text 2.0× |
| R4-03 | Device Search การ์ด ดาว ตัวกรองชิป แผ่นล่าง นับผลและ Firmware รักษาพฤติกรรม #401 | 0109–0174, 1288–1291 และกรณี OT/legacy จาก manifest | ต่อ `device_search_page_test`, `device_search_repository_test`; ไม่ค้นไม่โหลดรายการทั้งหมด, ดาวคงหลังเปิดใหม่, เลือก/ล้างตัวกรอง, ผลว่างและ error |
| R4-04 | Device Detail และประวัติรายเครื่อง: `device_detail_page.dart`, `device_online.dart`, `device_header_meta.dart` และหน้าประวัติที่มีหลัง sync main | 0175–0330 | ต่อ `device_detail_page_test`, `device_online_test`; online/ออฟไลน์/ไม่ทราบ, สิทธิ์ action, retry/history pagination, ไม่แสดงกุญแจ |
| R4-05 | Config/Firmware picker และหน้าพารามิเตอร์ที่เข้าจาก #408 ปรับไฟล์จริงหลัง merge ไม่สร้าง picker อีกชุด | 0331–0422, 1259–1276 รวมภาพต่อ และกลุ่ม `parameters` ของ OT/legacy | ต่อ `apply_config_picker_page_test` และเทสต์พารามิเตอร์ที่มากับ #408; readonly/secret, boolean, ชนิด/min/max, เหตุผล, แก้กลับค่าเดิม, กันกดซ้ำและ offline |
| R4-06 | หน้าคำขอ Config/Firmware/Override และฟอร์มขอแก้เฉพาะเครื่อง แสดงสถานะ/เหตุการณ์โดยใช้ request repository เดิม | 0423–0700 ยกเว้น Q8; 1293 และกรณีที่มี scenario เดียวกัน | ต่อเทสต์คำขอจาก #408, `config_override_page_test`, `config_override_repository_test`; ส่งตรงไม่มีเหตุการณ์ Operation อนุมัติ, แก้ค่ารออนุมัติ, Firmware approval, 409/expired/cancelled และกันส่งซ้ำ |
| R4-07 | Task Detail, ผล Device Simulator, บันทึกสถานะ และประวัติคำขอแยก ใช้ `task_detail_page.dart`, `task_timeline_section.dart`, `simulation_result_card.dart` และหน้าประวัติจาก #405 | 0701–0768 ยกเว้น transferred/Q8; 1277–1287, 1292 และ role/mode ที่ตรงกัน | ต่อ `task_detail_page_test`, `task_detail_inflight_test`, `task_detail_simulator_test`, `task_detail_simulator_checklist_test`; Config ผูก/ไม่ผูก, failed ส่งอีกครั้ง, Simulator ไม่ผ่านบล็อกส่ง, history ไม่ซ้ำ latest, close/cancel |
| R4-08 | Incidents รายการ/รายละเอียด/แจ้งปัญหา ใช้ `features/incident/*` | กลุ่ม `incidents`, `incident`, `report` เริ่ม 0817, 0883, 0955 | ต่อ `incident_list_page_test`, `incident_detail_page_test`, `field_report_page_test`; ฟิลเตอร์/validation/retry, prefill device, readonly และสิทธิ์ตามระบบ |
| R4-09 | แจ้งเตือนและบัญชี: `notification_list_page.dart`, `notification_ui.dart`, `features/auth/account_sheet.dart` | กลุ่ม `notifications`, `account` เริ่ม 1013, 1079 | ต่อ `notification_list_page_test`, `notification_ui_config_apply_test`, `push_deeplink_back_stack_test`, `session_expiry_flow_test`; อ่านแล้ว/unread, deep link, logout และข้อความยาว |
| R4-10 | Login Concept 02 และหน้าที่เหลือซึ่งมี contract จริง เช่น manual confirm/Firmware Override ใน legacy; ตรวจเก็บงานทั้งแอป | กลุ่ม `login` เริ่ม 1145; `manualconfirm`, `firmwareoverride`, `note` ตาม manifest | ต่อ `login_form_test`, `auth_controller_test`, `confirm_firmware_install_page_test`, `firmware_override_page_test`, `large_text_layout_test`; session restore, validation, mode guards และ keyboard |

เลขภาพเป็นจุดเริ่มเทียบเท่านั้น ใช้ `r4-image-pr-map.csv` เพื่อค้นทุกภาพใน PR รวมภาพต่อ/OT/legacy/compact/ข้อความ 2.0× เลขภาพช่วงเดียวกันอาจมี Q8 ปน จึงต้องกรอง `scope=excluded-q8` ออกเสมอ

หาก PR ใดยังใหญ่ ให้แยกหน้าออกเป็น PR ต่อเนื่องภายใต้ลำดับเดียวกัน แต่ไม่แยกจน merge แล้ว flow ใช้งานไม่ได้ R4-10 เก็บเฉพาะหน้าที่มี feature จริงอยู่แล้ว; `note` หรือ `proposed-view` ที่ไม่มี contract ให้จดช่องว่างเสนอ B/A ไม่เพิ่ม feature จากภาพโดยอัตโนมัติ

## 4. รายละเอียด PR แรกสำหรับ A review

ชื่อเสนอ: `feat(mobile): apply r4 shared tokens and tab styling`

- ใช้ Anuphan ที่ bundle อยู่แล้ว ปรับ semantic token ของ Mobile ให้ตรงต้นแบบ r4: ink `#22261F`, paper `#F5F6F1`, surface `#FFFFFF`, line `#E7EAE0`, text `#252821`, muted `#5F675A`, lime `#D7EDAC`, lime-ink `#344126`
- คงชื่อ token ที่ผู้ใช้โค้ดเรียกอยู่และเติมเฉพาะค่าที่ต้องใช้ ไม่เพิ่ม palette คู่ขนาน ไม่แก้ Web ให้ตาม Mobile โดยปริยาย
- ทบทวน contrast ของข้อความ/ปุ่ม/ขอบช่องกรอกจริง รวม selected/unselected บนแถบเข้ม หากต้องปรับค่าสีจากภาพเพื่อให้อ่านได้ ให้เสนอเลขภาพและค่าที่เปลี่ยนก่อนล็อก
- ปรับ shared card/header/button/input และ AppTabBar เดิมให้ได้รูปทรง/ช่องไฟของภาพ แถบล่างอยู่ที่หน้ารากเหมือนเดิม หน้าลูกมีพื้นที่ action และ safe area ของตัวเอง
- ถ้าหน้าเก่าอ้างสีตรงจนเปลี่ยน token แล้วสีขัดกัน ให้เก็บ compatibility ภายใน component เดิมชั่วคราวพร้อมรายการนำออกใน PR ของหน้านั้น ไม่เปลี่ยน repository/model/API ใน PR นี้
- ก่อนแก้ UI เพิ่ม behavioral regression ที่จำเป็น แล้วรันชุด token/components/tab/router; หลังแก้จึงบันทึกภาพ emulator ของหน้าราก ST/OT และ Operation

## 5. วิธีตรวจแต่ละ PR

1. ตั้งข้อมูล DEMO และ clock/network/mode ให้ตรง case ใน manifest เขียนเทสต์ behavior ที่เปลี่ยนก่อนแก้ implementation ไม่เขียนเทสต์เพียงยืนยันค่าที่คัดลอกจากโค้ด
2. รัน targeted widget/repository tests ที่ระบุในตาราง จากนั้น `flutter analyze` และ `flutter test` ตาม CI ของ Mobile จากฐานที่ sync แล้ว ถ้าแก้ backend/API จริงต้องแยก scope พร้อม contract/tests และ lint OpenAPI ตามกฎ repository
3. ถ่าย emulator screenshot ด้วยขนาดเนื้อหาเท่าภาพ 390×844 และ 360×640 (logical pixels), text scale 1.0/2.0 ที่เป็นกรณี normal; ตรวจ loading/empty/error/offline ของหน้าที่แก้ด้วย
4. ตรวจภาพเต็มหน้าและภาพต่อเมื่อ scroll รวม keyboard, bottom action, safe area, hit target และข้อความไม่ถูกตัด เก็บ side-by-side หรือ diff โดยแยก status bar/platform rendering ที่ต่างออกจาก content
5. แนบตาราง evidence ใน PR: เลขภาพต้นแบบ, role, mode, view/scenario, viewport/text scale, ชื่อภาพ emulator, ผลเทียบและข้อแตกต่างที่ยอมรับ ห้ามนับภาพต้นแบบเป็นผลทดสอบ emulator
6. ขอ A review รอ CI ที่จำเป็นผ่านครบ แล้ว squash merge ตามกฎ repository จากนั้น sync main ก่อนเริ่ม PR ถัดไป

## 6. รายการภาพต่อ PR

ตารางจับคู่ภาพทั้ง 1,448 ภาพกับ PR (`r4-image-pr-map.csv`) แนบไว้ใน draft release เดียวกับชุดภาพ ไม่ใส่ใน repo
เพราะเป็นข้อมูลอ้างอิงของชุดภาพ (276 KB) · ภาพ Q8 อยู่ในตารางแต่ช่อง PR ว่าง (`scope=excluded-q8`) ต้องกรองออกเสมอ

ถ้าชุดภาพเปลี่ยน ต้องล็อกรอบใหม่ อัปเดต hash ในหัวเอกสารนี้ และอัปโหลดชุดใหม่แทน

## 7. สิ่งที่แผนนี้ไม่ทำ

- ไม่เปลี่ยน Web, backend หรือ API — ถ้าหน้าไหนต้องการ API ใหม่ แยกเป็นข้อเสนอให้ A ตัดสินก่อน
- ไม่ทำการโอนงาน (Q8) และหน้าที่ยังไม่มี contract จริง
- ไม่ commit ชุดภาพเข้า repo
