# 16 — Task Event History (ประวัติระดับ Event ต่อ Task) — Proposal

> **จาก:** kittiphong (B) — **ถึง:** paveekornk (A) + พี่เลี้ยง
> **มติต้นทาง:** ไม่ได้มาจาก sprint review — เกิดระหว่าง B วางแผนปิด Sprint 2 (05/10/2569)
> ตอนทบทวนงาน "เริ่มโครง Offline-first (Drift)" (PR #252) แล้วพบว่าความต้องการจริงคือ
> อยากเห็น **ประวัติละเอียดของสิ่งที่ช่างทำกับอุปกรณ์แต่ละเครื่อง** ไม่ใช่แค่ cache
> คิวงานปัจจุบัน
> **สถานะ:** **A approve แนวทางแล้ว (PR #253) · คำถามเปิดใน §9 ตอบครบ 4 ข้อแล้ว (A, issue #262, 2026-10-06)** · **implement แล้วเฉพาะ timeline + note (issue #296, 2026-10-13) — ตัดส่วนแนบรูปออกจากสโคปทั้งหมด** ดูสิ่งที่ทำจริงและจุดที่ต่างจากเอกสารนี้ใน §10
> **จังหวะ:** นอกขอบเขต Sprint 2 เดิม (การ์ด "เริ่มโครง Offline-first" ไม่รวมเรื่องนี้) —
> **ตกลงแล้ว: เริ่มที่ Sprint 4** (ไม่ใช่ Sprint 3 — ดู §9 ข้อ 4)

---

## 1. ปัญหา / ที่มา

`Task` ปัจจุบัน (ทั้ง backend และ cache ที่เพิ่งเพิ่มใน PR #252) เก็บได้แค่ **สถานะล่าสุด**
ของงานหนึ่งชิ้น (`status`, `updatedAt`) — ถ้าอยากรู้ว่า "เครื่องนี้เคยมีปัญหาอะไรมาก่อน"
ตอนนี้ตอบได้แค่ระดับ "เคยมีงานอะไรเกิดขึ้นบ้าง กับใคร เมื่อไหร่ สถานะล่าสุดอะไร"
(ดึงจาก `Task.deviceId` ได้เลยไม่ต้องแก้อะไร) แต่ตอบไม่ได้ว่า **ระหว่างทำงานแต่ละครั้ง
เกิดอะไรขึ้นบ้าง** (เปลี่ยนสถานะกี่รอบ ใครทำตอนไหน มีบันทึก/รูปประกอบอะไรบ้าง)
เพราะ `updatedAt` ถูกเขียนทับทุกครั้งที่สถานะเปลี่ยน ค่าก่อนหน้าหายไป

สิ่งที่ B อยากได้คือ **timeline ต่อ 1 Task** ที่เห็นทุกจุดเปลี่ยนแปลง ไม่ใช่แค่ผลลัพธ์ล่าสุด

## 2. หลักการ

| กฎ | เหตุผล |
|---|---|
| เพิ่มตารางใหม่ `TaskEvent` แยกจาก `Task` ไม่แก้ shape ของ `Task` เดิม | `Task` ยังเป็น "สถานะปัจจุบัน" เหมือนเดิม ไม่กระทบ endpoint/หน้าจอที่ใช้ `Task` อยู่แล้ว (PR #252 ไม่ต้องแก้) |
| เขียน `TaskEvent` ที่ backend ในทรานแซกชันเดียวกับ `PATCH /tasks/{id}` | กันเหตุการณ์หายถ้าเน็ตหลุดระหว่างกลาง — client ไม่ต้องเรียก 2 endpoint แยกกันเพื่อให้สถานะกับ event ตรงกันเสมอ |
| event เป็น **append-only** ไม่มีการแก้/ลบย้อนหลัง | เป็นหลักฐานประวัติ — ต้องเชื่อถือได้ว่าของเดิมไม่ถูกแก้ทีหลัง |
| รูปที่แนบ **ไม่บังคับ** (nullable) | ไม่ใช่ทุกจุดเปลี่ยนสถานะจะมีรูปประกอบ (เช่น "เริ่มงาน" อาจไม่มีรูป) |
| คนละเรื่องกับ `AuditLog` (mutation audit ของระบบ) และ Local Activity Log (`docs/10`, ยกเลิกไปแล้ว) | `TaskEvent` ผูกกับ "เนื้อหางานภาคสนาม" ไม่ใช่ audit ด้าน compliance หรือ activity ส่วนตัวในเครื่อง — ต้อง sync ขึ้น backend เพราะเป็นข้อมูลที่ทีม/Operation ต้องเห็นร่วมกัน |

## 3. Data model — Backend (`schema.prisma`)

```prisma
model TaskEvent {
  id          String      @id @default(cuid())
  taskId      String
  task        Task        @relation(fields: [taskId], references: [id])
  fromStatus  TaskStatus?
  toStatus    TaskStatus
  changedBy   String      // userId ของช่างที่ทำรายการ
  changedAt   DateTime    @default(now())
  note        String?
  photoUrl    String?
  createdAt   DateTime    @default(now())

  @@index([taskId, changedAt])
}
```

เพิ่ม `events TaskEvent[]` เข้า model `Task` เดิม — ไม่แก้ field อื่นของ `Task`

**ตอบแล้ว (§9 ข้อ 1):** `changedBy` เป็น **FK ไป `User`** — `changedBy String` +
`changer User @relation(fields: [changedBy], references: [id])` (ชนิดคอลัมน์เป็น `String`
ตาม type ของ `User.id` เหมือน `Task.assignedTo` ที่ก็เป็น FK ไป `User` อยู่แล้ว)

## 4. API contract ใหม่ (`docs/api/openapi.yaml`)

| Endpoint | ใช้ทำอะไร |
|---|---|
| `PATCH /tasks/{taskId}` (ของเดิม) | เปลี่ยนสถานะ — **แก้ behavior**: backend เขียน `TaskEvent` แถวใหม่อัตโนมัติในทรานแซกชันเดียวกัน (`fromStatus`/`toStatus` จากการเปลี่ยนจริง) |
| `GET /tasks/{taskId}/events` (ใหม่) | ดึง timeline ทั้งหมดของ task นั้น เรียงตาม `changedAt` |
| `POST /tasks/{taskId}/notes` (ใหม่) | เพิ่มบันทึก/รูปที่ไม่ได้ผูกกับการเปลี่ยนสถานะ (เช่น note ระหว่างยัง `in_progress`) — ไม่มี `fromStatus`/`toStatus` |

**คำถามเปิดสำคัญที่สุด — ต้องตอบก่อนเริ่ม implement:** โปรเจกต์มีกลไกอัปโหลดรูปอยู่แล้ว
หรือยัง (เช่นใช้กับ incident report หรือ device photo ที่ไหนมาก่อน)? ถ้ามีให้ใช้ของเดิม
(storage/CDN เดียวกัน) ถ้าไม่มีต้องออกแบบใหม่ทั้งหมด (presigned URL, ที่เก็บไฟล์)
— B ไม่มีข้อมูลพอจะตอบเอง ต้องถาม A/Backend

## 5. ฝั่ง Mobile

ต่อยอดจาก pattern ที่ทำไว้ใน PR #252 (`core/db/`, `CachedApiTaskRepository`):

- ตารางใหม่ `core/db/tables/task_events_table.dart` (mirror `TaskEvent` backend)
- `TaskEventDao` — `getEventsByTaskId`, `upsertEvents`
- `TaskRepository` เพิ่มเมธอด `getEvents(taskId)`, `addNote(taskId, note, {photoPath})`
- UI: หน้า Task Detail เพิ่ม section "Timeline" แสดงรายการเหตุการณ์เรียงเวลา

### 5.1 ของใหม่ที่แอปยังไม่มีเลย — กล้อง/เลือกรูป

เช็คแล้วใน `pubspec.yaml` **ไม่มี** `image_picker` หรือ `camera` อยู่เลย ต้องเพิ่ม
dependency ใหม่ และขอ permission กล้อง/คลังรูปทั้ง Android/iOS — เป็นงานที่ใหญ่กว่า
การต่อ API เฉยๆ ถ้าทีมไม่เคยทำฟีเจอร์ถ่ายรูปในแอปมาก่อนเลย ควรแยกเป็น task ย่อยของตัวเอง

## 6. เอกสารที่ต้องแตะตอน implement

- `docs/api/openapi.yaml` — เพิ่ม `GET /tasks/{taskId}/events`, `POST /tasks/{taskId}/notes`, แก้ response ของ `PATCH /tasks/{taskId}`
- `docs/architecture/RBAC_Matrix.md` — ต้องเช็คว่าใครดู/เขียน `TaskEvent` ได้บ้าง (ตอบแล้ว §9 ข้อ 3: ST/OT self-scoped เหมือน `Task` **และ Operation อ่านได้ด้วย**)
- `docs/database/GPS_Data_Dictionary.xlsx` — เพิ่มตาราง `TaskEvent`
- `prisma/schema.prisma` + migration ใหม่

## 7. ขอบเขตที่ตั้งใจไม่ทำตอนนี้

- ไม่ทำ edit/delete event ย้อนหลัง (append-only ตาม §2)
- ไม่ทำ offline-write สำหรับ event (ต้องมีเน็ตตอนบันทึก note/รูป เหมือน `updateStatus` เดิมใน PR #252)
- ไม่รวมกับ `AuditLog` หรือ Local Activity Log (`docs/10`) — คนละวัตถุประสงค์ตาม §2

## 8. Next step

1. A + พี่เลี้ยงรีวิวเอกสารนี้ — โดยเฉพาะ §3 (`changedBy` FK หรือ string) และ §4 (กลไกอัปโหลดรูป)
2. ถ้าเห็นชอบ แตก backlog item แยกจาก Sprint 2 เดิม อย่างน้อย 3-4 ใบ:
   a. Backend: `TaskEvent` schema + migration + endpoints (§3, §4)
   b. Backend: endpoint อัปโหลดรูป (multipart ผ่าน backend, reuse pattern ของ `FirmwareStorageService` — ดู §9 ข้อ 2)
   c. Mobile: `TaskEvent` local cache + ต่อ API (§5)
   d. Mobile: Timeline UI + กล้อง/แนบรูป (§5.1)
3. จัดเข้า **Sprint 4** ตามความพร้อมของแต่ละใบ (ตกลงแล้ว §9 ข้อ 4 — ไม่ใช่ Sprint 3)

## 9. คำถามเปิด

ตอบโดย A ใน issue #262 (2026-10-06):

| # | คำถาม | คำตอบ / สถานะ |
|---|---|---|
| 1 | `changedBy` ควรเป็น FK ไป `User` หรือเก็บเป็น string เหมือน `Task.assignedTo` | **ตอบแล้ว: FK ไป `User`** — `Task.assignedTo` ที่เดิมเข้าใจว่าเป็น string เฉยๆ จริงๆ เป็น FK ไป `User` อยู่แล้ว (`assignedUser User @relation(fields: [assignedTo], references: [id])`) แค่ชนิดคอลัมน์เป็น `String` ตาม `User.id` (uuid) `TaskEvent.changedBy` ทำแบบเดียวกันเป๊ะ |
| 2 | โปรเจกต์มีกลไกอัปโหลดรูปอยู่แล้วหรือยัง (ใช้ที่ไหนมาก่อน) | **ตอบแล้ว: มีโครงอยู่ — multipart ผ่าน backend ตรงๆ ไม่ใช้ presigned URL** (คำตอบเดิมของ A ใน PR #253 — รอบ issue #262 ตอบคลาดเคลื่อนไปครั้งหนึ่ง แล้ว A ยกเลิกและยืนยันตามคำตอบเดิม) `FirmwareStorageService` (`backend/src/firmware/firmware-storage.service.ts`) ต่อ MinIO (S3-compatible, `@aws-sdk/client-s3`) รันผ่าน docker-compose ตั้งแต่ Sprint 0 — client อัปโหลด multipart เข้า backend (NestJS `FileInterceptor`) แล้ว backend relay เข้า MinIO เอง → TaskEvent photo ใช้ pattern เดียวกันในโมดูล `task` เพิ่ม bucket ใหม่ (เช่น `gps-task-photos`) ไม่ต้องออกแบบกลไกใหม่ ไม่ต้องมี presigned-URL flow |
| 3 | RBAC ของ `TaskEvent` ควรเหมือน `Task` เป๊ะ (self-scoped ST/OT) ไหม หรือมีบทบาทอื่นที่ต้องดูได้ (เช่น Operation ตรวจงาน) | **ตอบแล้ว: ไม่ใช่ self-scoped เท่า `Task`** — **Operation อ่านได้ด้วย** เพราะจุดประสงค์ (§1) คือ "เครื่องนี้เคยมีปัญหาอะไรมาก่อน" Operation ต้องใช้ตรวจสอบ/วินิจฉัยอุปกรณ์ ไม่ใช่แค่ช่างดูงานตัวเองย้อนหลัง (ST/OT ยัง self-scoped เหมือน `Task`) |
| 4 | เริ่ม Sprint 3 เลย หรือรอให้งานค้างของ Sprint 2 ปิดก่อน | **ตอบแล้ว: ปักไว้ที่ Sprint 4** — เหตุผล: ต้องเคลียร์ของเดิมที่ค้างอยู่ใน Sprint 3 ก่อน (ตรวจพบ 2026-10-06: Incident Reporting #236 ยังไม่เริ่มโค้ด, Confirm Install Mobile ยังไม่มี UI, After-sales Campaign ติดอาจารย์ที่ปรึกษา) งานนี้ไม่มีใครรออยู่และไม่ได้ติดขัดเอง (คำตอบเดิมใน PR #253 ที่ว่า "เริ่ม backend คู่ขนานได้" มองแค่ว่างานนี้มีคนรอไหม ไม่ได้ตอบผิด แต่ยังไม่เห็นภาพรวม Sprint 3) · **ข้อยกเว้น:** ถ้า Sprint 3 เสร็จหมดจริงก่อน checkpoint 11/10/2026 ค่อยขยับมาเริ่มก่อนได้ — ต้องยืนยันตอนนั้นว่าของ Sprint 3 เสร็จทั้งหมดแล้ว ไม่ใช่เงื่อนไข "มีเวลาว่าง" แบบหลวมๆ · เข้าเกณฑ์ "Backlog Scope Report" ที่ `docs/planning/02_GPS_Development_Plan.md` แถวที่ 33 |

## 10. สิ่งที่ implement จริง (issue #296, 2026-10-13)

ทำเฉพาะ **timeline + note** — **ตัดส่วนแนบรูปออกจากสโคปรอบนี้ทั้งหมด** (ไม่มี `photoUrl`, ไม่มี
endpoint อัปโหลด, ไม่เพิ่ม `image_picker`/`camera`, ไม่ขอ permission กล้อง/คลังรูป) ไม่มี issue
แยกสำหรับส่วนนี้ — ถ้าจะทำทีหลัง เพิ่มคอลัมน์ `photoUrl` แบบ additive ตาม §3/§5.1 และ §9 ข้อ 2 ได้เลย
หัวข้อ §4 (กลไกอัปโหลด), §5.1 (กล้อง) และ §8 ข้อ 2b/2d (ส่วนรูป) จึงยังไม่ถูกทำ

จุดที่ต่างจากเอกสารนี้ (ตกลงกับ B แล้วก่อนเริ่ม implement):

| เรื่อง | เอกสาร | ที่ทำจริง | เหตุผล |
|---|---|---|---|
| เวลาของ event เปลี่ยนสถานะ | เวลา server (`changedAt @default(now())`) · §7 "ไม่ทำ offline-write สำหรับ event เหมือน `updateStatus` เดิม" | `PATCH /tasks/{id}` รับ `changedAt` (optional) — Mobile ส่งเวลาที่ช่างกดจริงจากคิว offline · อนาคตปัดลงเป็นเวลา server, ก่อนสร้างงานปัดขึ้นเป็น `Task.createdAt` | เอกสารเขียนก่อนมี offline queue (#276) ตอนนี้ `updateStatus` เข้าคิวได้แล้ว ถ้าใช้เวลา server timeline จะเพี้ยนเท่ากับช่วงที่ไม่มีเน็ต ซึ่งเป็นเคสหลักที่ feature นี้ต้องรับมือ |
| `toStatus` | required | nullable | §4 บอกเองว่า note "ไม่มี fromStatus/toStatus" — แถว note มีทั้งคู่เป็น null |
| `changedBy` | required FK | nullable FK | event "สร้างงาน" ที่ backfill ให้งานเก่าไม่รู้ผู้สร้าง (Task ไม่มี createdBy, AuditLog ไม่เก็บ id ของ Task) |
| `id` | `cuid()` | `uuid()` | ทุก model ใน schema ใช้ uuid |
| event "สร้างงาน" | ไม่ได้กำหนด | เขียน `null -> pending` ตอน `POST /tasks` + **backfill 1 แถวต่องานเก่า** ที่ `Task.createdAt` ใน migration | timeline ทุกงานเริ่มจากจุดเดียวกัน · เวลาสร้างงานรู้แน่นอน (ต่างจากการเปลี่ยนสถานะเก่าที่ไม่มีบันทึกเวลา จึงไม่ backfill) |
| การแก้ field อื่น (title, ผู้รับงาน, config) | ไม่ได้กำหนด | ไม่ลง timeline | `TaskEvent` ไม่มีคอลัมน์เก็บ และ `AuditLog` บันทึกไว้แล้ว |
| สิทธิ์อ่าน (§9 ข้อ 3) | ST/OT self-scoped + Operation | กฎเดียวกับ `GET /tasks/{id}` (รวม Auditor/Admin/SuperAdmin) | ใครเห็น Task ได้ควรเห็นประวัติด้วย ไม่มีกฎสองชุด (RBAC_Matrix แก้ครั้งที่ 81) |
| สิทธิ์เพิ่ม note | ไม่ได้กำหนด | Operation (ทุกงาน) + ST/OT เจ้าของงาน · งาน `cancelled` = 409 | |
| Response | ไม่ได้กำหนด shape | `TaskEvent` + `changedByName` (`User.fullName`) | ST/OT บน Mobile อ่านรายชื่อผู้ใช้เองไม่ได้ |
| Mobile repository | เพิ่มเมธอดใน `TaskRepository` | `TaskEventRepository` แยก (`features/task/task_event_repository.dart`) | ไม่ต้องแก้ fake ของ `TaskRepository` ในเทสเดิมทุกตัว · pattern เดียวกับ `ConfirmInstallRepository` |

`PATCH /tasks/{id}` ยังคืน `Task` เหมือนเดิม · `POST /tasks/{id}/notes` เขียน `AuditLog` action
`add_note` (การเพิ่มบันทึกเป็น mutation ตาม Audit Pattern ใน CLAUDE.md)
