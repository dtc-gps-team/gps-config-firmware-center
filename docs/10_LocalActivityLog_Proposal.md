> **❌ ยกเลิกแล้ว (10/09/2026)** — ทีมตกลงตัดฟีเจอร์นี้ทิ้ง (คุยกับ paveekornkwork-dev แล้ว) เหตุผล:
> ประโยชน์ของ "ทางลัดย้อนกลับหน้าที่เพิ่งดู" น้อยกว่าที่คาดตอนเสนอ เพราะแอป Mobile เป็น
> Home-centric อยู่แล้ว (ทุกหน้าห่างจาก Home แค่ 1-2 tap) — เก็บเอกสารนี้ไว้เป็นบันทึกประวัติ
> การตัดสินใจเท่านั้น โค้ดถูกลบออกจาก `mobile/` แล้วทั้งหมด (ดู commit นี้) ฝั่ง Web ไม่เคย
> implement เลย ไม่มีอะไรต้องลบเพิ่ม

# 10 — Local Activity Log (read-level activity) — Proposal

> **จาก:** paveekornk (A) — **ถึง:** kittiphong (B) + พี่เลี้ยง
> **มติต้นทาง:** Sprint 1 review **ข้อ 3** (ดู `09_Sprint1_Review_Decisions.md` §2)
> **สถานะ:** **B รีวิว + อนุมัติแล้ว (PR #105)** — ตอบคำถามเปิดครบใน §9 · รอพี่เลี้ยงเคาะ retention (§4) แล้วเริ่ม implement ได้
> **จังหวะ:** implement หลัง `docs/11` (Sprint 3) — web (A) + mobile (B) แยกกันทำ pattern เดียวกัน · เริ่มได้แค่ `navigation` ก่อน, `search`/`filter` รอข้อ 2 (ฟิลเตอร์ตาราง)

---

## 1. ปัญหา / สิ่งที่พี่เลี้ยงขอ

พี่เลี้ยงขอให้ระบบ "ตรวจจับทุกการกระทำการใช้งานล่าสุดเสมอ เช่น เปลี่ยนหน้า เสิร์ช
หรืออื่น ๆ" — คือให้ผู้ใช้ (และเครื่องของผู้ใช้) รู้ว่าเพิ่งทำอะไรไปบ้าง

**นี่ไม่ใช่งาน audit / compliance** — เป็นความสะดวกส่วนตัวของผู้ใช้บนเครื่องนั้น
(เช่น "เมื่อกี้เปิดหน้าไหน" "เพิ่งเสิร์ชคำว่าอะไร") ไม่ใช่หลักฐานที่องค์กรเก็บ

## 2. หลักการ (ยึดตามมติ §2 ข้อ 3 — ห้ามเบี่ยง)

| กฎ | เหตุผล |
|---|---|
| เก็บ **local ในเครื่องผู้ใช้เท่านั้น** ไม่ยิง backend เลย | เป็นข้อมูลส่วนตัวระดับเครื่อง ไม่ใช่ข้อมูลระบบ · ไม่เพิ่มโหลด API / DB |
| **`AuditLog` (DB) ยังเป็น mutation-only เหมือนเดิม** | read-level activity (เปิดหน้า/เสิร์ช) ไม่ลง `AuditLog` — ยืนยันแล้วใน `CLAUDE.md` §Audit Pattern + `RBAC_Matrix.md` |
| ไม่ sync ข้ามเครื่อง / ข้ามผู้ใช้ | login เครื่องใหม่ = activity log เปล่า เป็นพฤติกรรมที่ถูกต้อง |
| Auditor / Admin / ผู้ใช้คนอื่น **มองไม่เห็น** log นี้ | ไม่ใช่ compliance data — ไม่มี endpoint ให้ดึงข้าม user |
| storage เต็ม / โดนเคลียร์ / private mode → **degrade เงียบ ๆ** | wrap ทุก read/write ใน try/catch — ฟีเจอร์นี้พังได้โดยไม่กระทบงานหลัก |

## 3. เก็บอะไรบ้าง

### 3.1 เก็บ

| type | เกิดเมื่อ | `detail` เก็บอะไร |
|---|---|---|
| `navigation` | เปลี่ยน route (เข้าหน้าใหม่) | `{ path, title }` — เช่น `{ path: "/config", title: "Config Editor" }` |
| `search` | ผู้ใช้เสิร์ช (submit หรือหยุดพิมพ์ ≥ 500ms) | `{ scope, query }` — เช่น `{ scope: "devices", query: "GT06N" }` |
| `filter` | เปิด/เปลี่ยนฟิลเตอร์ตาราง (ข้อ 2) | `{ scope, field, value }` — เช่น `{ scope: "config", field: "status", value: "testing" }` |

### 3.2 ไม่เก็บ

- ทุก keystroke ระหว่างพิมพ์ (เฉพาะคำเสิร์ชสุดท้าย — debounce)
- ค่าใน field ของฟอร์ม, รหัสผ่าน, token, ข้อมูลใน record ที่เปิดดู
- mutation (สร้าง/แก้/อนุมัติ/ลบ) — พวกนี้ลง `AuditLog` จริงที่ backend อยู่แล้ว **ไม่ซ้ำที่นี่**
- action ของผู้ใช้คนอื่น

### 3.3 shape ของ entry (เหมือนกันทั้ง web + mobile)

```jsonc
{
  "id": "uuid-v4",          // gen ฝั่ง client
  "type": "navigation",     // navigation | search | filter
  "at": "2026-09-08T10:32:00.000Z",  // ISO 8601, เวลาเครื่อง
  "detail": { "path": "/config", "title": "Config Editor" }
}
```

## 4. Retention (rolling — ตัดตัวเก่าสุดออก)

| แพลตฟอร์ม | เพดาน | เหตุผล |
|---|---|---|
| **Web** | **30 วัน หรือ 1000 รายการ** แล้วแต่อันไหนถึงก่อน | storage เบราว์เซอร์ยืดหยุ่นกว่า |
| **Mobile** | **14 วัน หรือ 300 รายการ** แล้วแต่อันไหนถึงก่อน | storage มือถือจำกัดกว่า · ใช้ `shared_preferences` เก็บ JSON list — deserialize ทั้งก้อนที่ ≤ 300 รายการไม่หนัก (ยืนยันตามรีวิว B PR #99 + #105) |

- เช็ค + ตัดตอน **write** ทุกครั้ง (ไม่ต้องมี background job) — append entry ใหม่ แล้วลบ entry ที่ `at` เก่ากว่า cutoff หรือเกินจำนวนสูงสุด
- ล้างทั้งหมดเมื่อ **logout** (เครื่องอาจใช้ร่วมกัน — activity ของคนก่อนไม่ควรค้าง)

> **ต้องให้พี่เลี้ยงเคาะ:** ตัวเลข 30/1000 · 14/300 เหมาะสมไหม — เป็น baseline จากรีวิว B ปรับได้

## 5. ฝั่ง Web (งาน A)

### 5.1 Storage — IndexedDB

- **ไม่ใช้ `localStorage`** — โดนแชร์ sync ทั้งหมดทุกครั้งที่เขียน + โควตาเล็ก (~5MB) + เก็บได้แค่ string
- IndexedDB: object store `activity` · keyPath `id` · index `by-at` บน `at` (ไว้ prune + query เรียงเวลา)
- util ใหม่: `web/src/lib/activity-log.ts` — `recordActivity(entry)`, `listActivity({ limit })`, `clearActivity()` ทุกตัว wrap try/catch คืน `[]` / no-op เมื่อพัง

### 5.2 จุด hook

| event | จุดต่อ |
|---|---|
| `navigation` | client component ครอบใน `web/src/components/app-shell/app-shell.tsx` — `useEffect` ฟัง `usePathname()` แล้ว map path → title จาก `NAV_ITEMS` (`web/src/lib/nav.ts`) |
| `search` | component ช่องค้นหา (จะเกิดตอนทำข้อ 2 ฟิลเตอร์) — เรียก `recordActivity` ใน handler เดียวกับที่ set query (debounced) |
| `filter` | เหมือน search — hook ใน component ฟิลเตอร์ต่อคอลัมน์ (ข้อ 2) |

> ข้อ 2 (ฟิลเตอร์) กับข้อ 3 นี้เกี่ยวกัน — search/filter hook รอ component ฟิลเตอร์
> ของข้อ 2 ก่อน · `navigation` ทำแยกได้เลยไม่ต้องรอ

### 5.3 UI แสดงผล

- v1: dropdown "กิจกรรมล่าสุด" ที่ header (`app-shell.tsx`) — list 10–20 รายการล่าสุด กดแล้วเด้งไปหน้าที่เกี่ยวข้อง (เฉพาะ type `navigation`)
- ไม่ทำหน้า route เต็มใน v1 (ประเมินทีหลังว่าจำเป็นไหม)

## 6. ฝั่ง Mobile (งาน B — ขอ B ช่วยเติม/แก้ส่วนนี้)

### 6.1 Storage — `shared_preferences` (มติ B)

- เก็บเป็น **JSON list** ใน `shared_preferences` — ไม่มี sqlite ในโปรเจกต์อยู่แล้ว, เพดาน 300 รายการ deserialize ทั้งก้อนทุกครั้งไม่หนัก
- ถ้าวันหน้าต้อง scale ค่อยย้ายเป็น sqlite

### 6.2 จุด hook

| event | จุดต่อ | จังหวะ |
|---|---|---|
| `navigation` | `NavigatorObserver` เพิ่มใน `GoRouter` (`mobile/lib/core/router/app_router.dart`) — override `didPush`/`didReplace` แล้ว record `route.settings.name` | **เริ่มได้เลย** |
| `search` / `filter` | **มือถือยังไม่มีหน้าไหนมีช่องค้นตอนนี้ (ตรวจแล้ว โดย B)** — รอ implement พร้อมข้อ 2 (ฟิลเตอร์ตาราง) ค่อยเลือก scope | รอข้อ 2 |

### 6.3 UI — Home section (มติ B)

section "กิจกรรมล่าสุด" ในหน้า Home (`mobile/lib/features/home/home_page.dart`) — เห็นทันทีตอนเปิดแอป เข้ากับ pattern การ์ดสรุปที่ Home มีอยู่แล้ว

### 6.4 logout

hook ล้าง activity ใน flow logout ของ `auth_controller.dart` (เทียบเท่า web §4)

## 7. เอกสารที่ต้องแตะตอน implement

- `docs/planning/01_GPS_Build_Reference.md` — มี note "read-level activity = local เท่านั้น" อยู่แล้ว (PR #101) · เพิ่ม pointer มาที่เอกสารนี้
- `CLAUDE.md` §Audit Pattern — มี retention อยู่แล้ว (PR #101) · ไม่ต้องแก้
- **ไม่แตะ** `openapi.yaml` — ไม่มี endpoint ใหม่ (ทั้งหมด local)
- **ไม่แตะ** `schema.prisma` / migration — ไม่มีตาราง DB ใหม่

## 8. Next step

1. ~~B รีวิว §6~~ ✅ (PR #105) · พี่เลี้ยงเคาะ retention §4
2. เข้าคิว **หลัง `docs/11` (Sprint 3)** — แยกเป็น 2 PR (web / mobile)
3. web + mobile เริ่ม `navigation` ก่อน · `search`/`filter` ตามหลังข้อ 2 (ฟิลเตอร์ตาราง)
4. อัปเดตเอกสารตาม §7 คู่กับ PR

## 9. คำถามเปิด → ตอบครบแล้ว (B, PR #105)

| # | คำถาม | มติ |
|---|---|---|
| 1 | mobile storage — `shared_preferences` หรือ sqlite | **`shared_preferences`** (JSON list ≤ 300) — ไม่มี sqlite ในโปรเจกต์, ย้ายทีหลังได้ถ้าต้อง scale |
| 2 | `search`/`filter` มือถือ — จอไหนมีช่องค้น | **ยังไม่มีจอไหนมีช่องค้นตอนนี้** — event 2 ตัวนี้รอ implement พร้อมข้อ 2 · เริ่มแค่ `navigation` ก่อน |
| 3 | UI "กิจกรรมล่าสุด" มือถือ — Home section หรือ drawer | **Home section** — เห็นทันทีตอนเปิดแอป เข้ากับการ์ดสรุปที่มีอยู่ |
| 4 | ขอบเขต v1 — แค่ navigation/search/filter พอไหม | **พอ** — ตรงตามที่พี่เลี้ยงขอ ไม่ over-engineer ตั้งแต่ v1 เพิ่มทีหลังได้ถ้าจำเป็นจริง |
