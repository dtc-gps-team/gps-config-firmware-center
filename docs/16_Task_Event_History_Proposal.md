# 16 — Task Event History (ประวัติระดับ Event ต่อ Task) — Proposal

> **จาก:** kittiphong (B) — **ถึง:** paveekornk (A) + พี่เลี้ยง
> **มติต้นทาง:** ไม่ได้มาจาก sprint review — เกิดระหว่าง B วางแผนปิด Sprint 2 (05/10/2569)
> ตอนทบทวนงาน "เริ่มโครง Offline-first (Drift)" (PR #252) แล้วพบว่าความต้องการจริงคือ
> อยากเห็น **ประวัติละเอียดของสิ่งที่ช่างทำกับอุปกรณ์แต่ละเครื่อง** ไม่ใช่แค่ cache
> คิวงานปัจจุบัน
> **สถานะ:** **ร่างเสนอ — รอ A + พี่เลี้ยงรีวิว** (ยังไม่เริ่ม implement)
> **จังหวะ:** นอกขอบเขต Sprint 2 เดิม (การ์ด "เริ่มโครง Offline-first" ไม่รวมเรื่องนี้) —
> เสนอให้เป็น backlog ใหม่ใน Sprint 3+ หลังตกลงขอบเขตกันแล้ว

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

**คำถามเปิดสำหรับ A/Backend:** `changedBy` ควรเป็น FK ไป `User` เลยไหม หรือเก็บเป็น userId
string เฉยๆ แบบ `Task.assignedTo` เดิม (เพื่อความสม่ำเสมอ)?

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
- `docs/architecture/RBAC_Matrix.md` — ต้องเช็คว่าใครดู/เขียน `TaskEvent` ได้บ้าง (เดาว่า scope เดียวกับ `Task` คือ self-scoped สำหรับ ST/OT แต่ต้องยืนยัน)
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
   b. Backend: กลไกอัปโหลดรูป (ถ้ายังไม่มี)
   c. Mobile: `TaskEvent` local cache + ต่อ API (§5)
   d. Mobile: Timeline UI + กล้อง/แนบรูป (§5.1)
3. จัดเข้า Sprint 3 ตามความพร้อมของแต่ละใบ

## 9. คำถามเปิด

| # | คำถาม | สถานะ |
|---|---|---|
| 1 | `changedBy` ควรเป็น FK ไป `User` หรือเก็บเป็น string เหมือน `Task.assignedTo` | รอ A/Backend ตอบ |
| 2 | โปรเจกต์มีกลไกอัปโหลดรูปอยู่แล้วหรือยัง (ใช้ที่ไหนมาก่อน) | รอ A/Backend ตอบ — สำคัญที่สุด ตัดสินใจเรื่องนี้ก่อนถึงเริ่ม implement ได้ |
| 3 | RBAC ของ `TaskEvent` ควรเหมือน `Task` เป๊ะ (self-scoped ST/OT) ไหม หรือมีบทบาทอื่นที่ต้องดูได้ (เช่น Operation ตรวจงาน) | รอ A/พี่เลี้ยงตอบ |
| 4 | เริ่ม Sprint 3 เลย หรือรอให้งานค้างของ Sprint 2 (§ดู Sprint plan) ปิดก่อน | รอ A/พี่เลี้ยงตอบ |
