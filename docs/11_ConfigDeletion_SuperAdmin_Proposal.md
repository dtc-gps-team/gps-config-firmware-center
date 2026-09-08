# 11 — คำขอลบ Config อัตโนมัติ + Role SuperAdmin — Proposal

> **จาก:** paveekornk (A) — **ถึง:** kittiphong (B) + พี่เลี้ยง
> **มติต้นทาง:** Sprint 1 review **ข้อ 5 + ข้อ 7** (ดู `09_Sprint1_Review_Decisions.md` §2 — สองข้อผูกกันเพราะ SuperAdmin คือผู้อนุมัติคำขอลบ)
> **สถานะ:** **B รีวิว + อนุมัติแล้ว (PR #105)** — ตอบคำถามเปิดครบใน §10 (รวมยืนยัน 2 `NotificationType` ใหม่ในโมดูล B) · รอพี่เลี้ยงเคาะ flow แล้วเข้าคิว
> **จังหวะ:** **Sprint 3** (ยืนยันตามรีวิว B — PR #99 §5 ข้อ 5 + PR #105)

---

## 1. ปัญหา / สิ่งที่พี่เลี้ยงขอ

**ข้อ 5:** Config ที่สร้าง/แก้แล้วลืมลบ — เป็น `draft` หรือ `rejected` ค้างไว้นาน ไม่ผูกกับ
อุปกรณ์ใดเลย — ควรมีกลไกกวาดออก แต่ **ไม่ลบทันทีแบบเงียบ ๆ** ต้องผ่านการอนุมัติ

**ข้อ 7:** เพิ่ม role `SuperAdmin` — ให้เป็นคนอนุมัติคำขอลบข้างบน + งานดูแลระบบระดับสูง
ที่ Admin ปกติไม่ควรทำเอง (จัดการบัญชี Admin, แก้ permission)

---

## PART A — คำขอลบ Config อัตโนมัติ

## 2. เกณฑ์ "Config ไม่ได้ใช้" (ต้องครบ **ทุกข้อ**)

| # | เงื่อนไข | เช็คจาก |
|---|---|---|
| 1 | `status ∈ { draft, rejected }` | `Config.status` — **เริ่มแค่ 2 สถานะนี้** · `testing` ไม่รวม (กำลังรออนุมัติ) · `approved`/`synced` **ห้ามแตะเด็ดขาด** |
| 2 | ไม่มี `Task` ผูก | `Config.tasks` ว่าง (`Task.configId`) |
| 3 | ไม่มี `Campaign` ผูก | `Config.campaigns` ว่าง |
| 4 | ไม่มี `Incident` ผูก | `Config.incidents` ว่าง |
| 5 | `updatedAt` เก่ากว่า **90 วัน** | `Config.updatedAt < now() - 90d` |
| 6 | ไม่มีคำขอลบ `pending` ของ Config นี้ค้างอยู่ | `ConfigDeletionRequest` |
| 7 | ไม่อยู่ใน cooldown (เพิ่งถูก reject) | `ConfigDeletionRequest` ที่ `rejected` + `reviewedAt` ใน 90 วันล่าสุด → ข้าม |

> Config ที่มี `ConfigVersion` แปลว่าเคยผ่าน `approved` มาก่อน → `status` ปัจจุบันจะเป็น
> `approved`/`synced` เสมอ (กลับไป draft ไม่ได้หลัง approve) → เกณฑ์ข้อ 1 กันไว้อยู่แล้ว

## 3. กลไก

```
scheduled job (วันละครั้ง, @nestjs/schedule)
   │
   ├─ หา Config ที่เข้าเกณฑ์ §2 ทั้งหมด
   │
   ├─ สำหรับแต่ละตัว → สร้าง ConfigDeletionRequest { status: "pending", reason: "..." }
   │
   └─ ยิง notification 2 ทาง (ดู §7):
        • → ผู้สร้าง Config (Config.createdBy): "Config X ถูกเสนอลบ — กด 'เก็บไว้' ภายใน 7 วันถ้ายังต้องใช้"
        • → SuperAdmin ทุกคน: "มีคำขอลบ Config รออนุมัติ"

ระหว่าง grace period 7 วัน:
   • ผู้สร้าง (หรือ SW คนใด) กด "เก็บไว้"  → request.status = "cancelled" + แตะ Config.updatedAt (reset นาฬิกา 90 วัน)
   • ไม่มีใครทำอะไร                        → รอ SuperAdmin ตัดสิน

SuperAdmin:
   • Approve → soft delete: Config.deletedAt = now() · request.status = "approved"
   • Reject  → request.status = "rejected" (Config อยู่ต่อ, เข้า cooldown 90 วันตามเกณฑ์ §2.7)
```

- **soft delete เท่านั้น** — `Config.deletedAt DateTime?` · ทุก query ของ `config.service.ts`
  เติม `where: { deletedAt: null }` · กู้คืนได้ (undelete = เซ็ต `deletedAt` กลับเป็น null — endpoint แยก SuperAdmin, หรือ manual, out of scope v1)
- **hard delete ไม่อยู่ใน scope** เอกสารนี้ — ถ้าต้องล้างจริงทำเป็นงานแยกทีหลัง

## 4. Data model — `ConfigDeletionRequest` (แยกของตัวเอง)

ยืนยันตามรีวิว B (PR #99 §5 ข้อ 2): **ไม่ใช้ approval framework กลาง** — business rule ของ
config/firmware/campaign approval ต่างกันพอควร รวมตอนนี้เสี่ยง over-engineer

```prisma
model ConfigDeletionRequest {
  id         String    @id @default(uuid())
  configId   String
  // เหตุผลที่ job สร้างคำขอ — human-readable สำหรับ SuperAdmin อ่านตอนตัดสิน
  reason     String
  // pending → (รอ SuperAdmin) · approved (soft-deleted) · rejected (เก็บไว้ + cooldown)
  // · cancelled (ผู้สร้างกด "เก็บไว้" ระหว่าง grace)
  status     String    @default("pending")
  detectedAt DateTime  @default(now())
  reviewedBy String?
  reviewedAt DateTime?
  decisionNote String?

  config   Config @relation(fields: [configId], references: [id], onDelete: Cascade)
  reviewer User?  @relation("ConfigDeletionReviewer", fields: [reviewedBy], references: [id])

  @@index([configId])
  @@index([status])
}
```

- `Config` เพิ่ม: `deletedAt DateTime?` + relation `deletionRequests ConfigDeletionRequest[]`
- `User` เพิ่ม relation: `configDeletionReviews ConfigDeletionRequest[] @relation("ConfigDeletionReviewer")`
- migration additive · `ConfigDeletionRequest` ตารางใหม่ (ว่าง) + `Config.deletedAt` nullable → ไม่ต้อง backfill

## 5. Endpoints (backend, module `config`)

| method + path | สิทธิ์ | ทำอะไร |
|---|---|---|
| `GET /config-deletion-requests?status=pending` | `config-deletion` · Read | SuperAdmin ดูรายการคำขอ |
| `POST /config-deletion-requests/{id}/approve` | `config-deletion` · Approve | soft delete Config · 409 ถ้า status ไม่ใช่ `pending` |
| `POST /config-deletion-requests/{id}/reject` | `config-deletion` · Approve | body `{ note }` · Config อยู่ต่อ + cooldown |
| `POST /config-deletion-requests/{id}/keep` | `config` · Update (SW) | ผู้สร้าง/SW กด "เก็บไว้" ระหว่าง grace → `cancelled` |

- ทุก action ลง `AuditLog` (`auditModule: "config-deletion"`)
- scheduled job อยู่ใน `config.module` — ต้อง `npm i @nestjs/schedule` + `ScheduleModule.forRoot()` ใน `AppModule` (ยังไม่มีในโปรเจกต์ตอนนี้)

### 5.1 Notification (โมดูล B — ยืนยันแล้ว PR #105)

เพิ่ม `NotificationType` **2 ค่าใหม่** (`backend/prisma/schema.prisma` enum + mobile `NotificationType` + `NotificationTypeStyle`):

| ค่า | ผู้รับ | ยิงเมื่อ |
|---|---|---|
| `config_deletion_pending` | SuperAdmin ทุกคน | job สร้าง `ConfigDeletionRequest` |
| `config_deletion_grace` | ผู้สร้าง Config (`Config.createdBy`) | request เข้า state `grace` — เตือนให้กด "เก็บไว้" ภายใน 7 วัน |

แยก type ชัดเจนกว่า reuse ค่าเดิม — ผู้ใช้แยกแยะประเภทแจ้งเตือนได้ · B รับ 2 type นี้ตอน implement Sprint 3

---

## PART B — Role SuperAdmin

## 6. นิยาม

**SuperAdmin = ทุกอย่างที่ Admin ทำได้ + เพิ่ม:**

| สิทธิ์เพิ่ม | resource ใหม่ | action |
|---|---|---|
| อนุมัติ/ปฏิเสธคำขอลบ Config | `config-deletion` | Read, Approve |
| สร้าง/ปิด/เปลี่ยน role ของบัญชี **Admin และ SuperAdmin** | `admin-management` | Create, Read, Update |
| เพิ่ม Role ใหม่ + แก้ `RolePermission` | `role-management` | Create, Read, Update |

> แยก `admin-management` / `role-management` เป็น 2 resource ตามรีวิว B (PR #99 §5 ข้อ 3) —
> ยืดหยุ่นกว่าถ้าอนาคตต้องแยกสิทธิ์ 2 อย่างนี้ออกจากกัน

**SuperAdmin ทำ *ไม่ได้* (เท่ากับ Admin):**
- อนุมัติ Config / Firmware / Campaign แทน Operation
- ข้าม Separation of Duty ใด ๆ · Override Config/Firmware (นั่นเป็นของ ST/OT)
- ถ้า Operation ไม่อยู่ → SuperAdmin ตั้ง user เป็น Operation เพิ่ม (ทำได้ผ่าน user management ปกติ) ไม่ใช่ทำแทนเอง

## 7. กติกาป้องกัน

| กติกา | บังคับที่ |
|---|---|
| Admin ปกติ **จัดการบัญชี Admin/SuperAdmin ไม่ได้** (กันยกระดับตัวเอง) | guard `admin-management` — Admin ไม่มี grant นี้ · user management ปกติของ Admin filter `role.code NOT IN ('Admin','SuperAdmin')` |
| ต้องมี SuperAdmin **≥ 1 คนเสมอ** | service เช็คก่อน delete/downgrade บัญชี SuperAdmin คนสุดท้าย → 409 |
| ทุก action ของ SuperAdmin ลง `AuditLog` | pattern เดิม (`auditModule` ต่อ endpoint) |

## 8. ไฟล์ที่ต้องแตะ (ตอน implement — Sprint 3)

### Backend
- `package.json` — `+ @nestjs/schedule`
- `src/app.module.ts` — `ScheduleModule.forRoot()`
- `prisma/schema.prisma` — model `ConfigDeletionRequest` + `Config.deletedAt` + relations + `enum NotificationType` เพิ่ม `config_deletion_pending` / `config_deletion_grace` (§5.1) (**`git pull` ก่อน** — shared · enum NotificationType เป็นของโมดูล B ประสานก่อนแก้)
- `prisma/migrations/<ts>_add_config_deletion_request/` — additive (รวม 2 ค่า enum ใหม่)
- `prisma/seed.ts` — Role row `SuperAdmin` (`INITIAL_ROLES`) + user ทดสอบ `superadmin.test` + grants: ทุก grant ที่ Admin มี **+** `config-deletion`/`admin-management`/`role-management` · **ไม่มี migration สำหรับ Role** (เป็นตาราง, `code` เป็น free string)
- `src/config/` — `config-deletion.service.ts` + controller endpoints + scheduled job · เติม `deletedAt: null` ในทุก query เดิมของ `config.service.ts`
- `src/config/*.spec.ts` + integration — เกณฑ์ §2, flow approve/reject/keep, guard §7
- `src/common/guards/` — resource ใหม่ + logic "ห้ามแตะ SuperAdmin/Admin" ใน user management
- `src/notification/` (B) — ยิง `config_deletion_pending` / `config_deletion_grace` ที่ event ของ job/flow (§5.1)

### Mobile (B)
- `lib/core/api/models.dart` `NotificationType` + `notification_ui.dart` `NotificationTypeStyle` — เพิ่ม 2 ค่าใหม่ (label + icon)

### เอกสาร
- `CLAUDE.md` §Role Enum — **แก้แล้วใน PR #101** (6→7, SuperAdmin) · ไม่ต้องแตะซ้ำ
- `docs/architecture/RBAC_Matrix.md` — §1 มี SuperAdmin แล้ว (PR #101) · **ต้องเพิ่ม**: คอลัมน์ `SuperAdmin` ใน §2 (Web matrix), แถว resource ใหม่ 3 ตัวใน §4, changelog
- `docs/api/openapi.yaml` — endpoints §5 + `ConfigDeletionRequest` schema + `LoginResponse.role` มี SuperAdmin แล้ว (PR #101) · `redocly lint`
- `GPS_Data_Dictionary.xlsx` — ROLE table มี `SuperAdmin` แล้ว (PR #101) · **ต้องเพิ่ม**: `CONFIG.deleted_at` + ตาราง `CONFIG_DELETION_REQUEST` ใหม่ (2 sheet: Data Dictionary + By Table)
- `docs/planning/02_GPS_Development_Plan.md` — backlog มีแถวนี้แล้ว (PR #101)

## 9. Next step

1. ~~B รีวิว §5.1 (notification)~~ ✅ (PR #105) · พี่เลี้ยงเคาะ: grace period 7 วัน + cooldown 90 วัน + soft-delete-only
2. เข้าคิว **Sprint 3** — implement **Part B** (SuperAdmin + seed) ก่อน แล้ว **Part A** ตามหลัง (Part A ต้องมี SuperAdmin เป็นผู้อนุมัติก่อน)

## 10. คำถามเปิด → ตอบครบแล้ว (B, PR #105)

| # | คำถาม | มติ |
|---|---|---|
| 1 | `NotificationType` ใหม่กี่ตัว | **2 ตัว** — `config_deletion_pending` (→ SuperAdmin), `config_deletion_grace` (→ ผู้สร้าง Config) · แยก type ชัดกว่า reuse (ดู §5.1) |
| 2 | grace period — pre-notification แยก หรือ state เดียว | **state เดียว** (`grace` 7 วันก่อนโผล่ในคิว SuperAdmin) — track ง่ายกว่า ไม่ต้องมี state พิเศษก่อนสร้าง request |
| 3 | cooldown หลัง reject — query หรือเพิ่ม field | **query** `ConfigDeletionRequest` ล่าสุดที่ `rejected` — ไม่เพิ่ม `Config.deletionCooldownUntil` ลด surface ของ schema |
| 4 | ช่องโหว่ `config-sync-writer` (sync Config ที่ `deletedAt != null`) | **ไม่มีช่องโหว่** — sync trigger จาก `approved`→`synced` เกิดก่อน delete เสมอ (เกณฑ์ §2.1 กัน `approved`/`synced` ไว้แล้ว) |
