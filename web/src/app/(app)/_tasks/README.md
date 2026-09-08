# _tasks — ซ่อนชั่วคราว (Next.js private folder)

โฟลเดอร์นี้ขึ้นต้นด้วย `_` = Next.js App Router **ไม่ route ให้** (`/tasks` ไม่มีอยู่จริง)

## ทำไม

มติจาก Sprint 1 review (ข้อ 1 — ดู `docs/09_Sprint1_Review_Decisions.md` §2):

> จอ Task Management เดิม scaffold ไว้แบบ "ตาราง Task + ปุ่มสร้าง/มอบหมาย"
> ซึ่งพี่เลี้ยงมองว่าโน้มไปทาง planning tool เกินขอบเขต · สิ่งที่ต้องการจริงคือ
> **"ช่างรู้ว่าต้องทำงานไหนบ้าง"** — list งานที่ได้รับมอบหมาย + ฟอร์มมอบหมาย
> พื้นฐาน (Web) ไม่ใช่จัดตารางงาน / วางแผนกำลังคน / ปฏิทิน / บอร์ด workload

## จะกลับมาใช้เมื่อไหร่

หลัง redesign เป็น list + ฟอร์มมอบหมายพื้นฐาน — ตอนนั้นค่อย:

1. `git mv _tasks tasks` (เอา `_` ออก)
2. เพิ่ม entry กลับใน `web/src/lib/nav.ts`
3. redesign `page.tsx` / `create-task-button.tsx` ตามขอบเขตใหม่

backend `task` module (ฝั่ง B) **ไม่ได้แตะ** — Mobile ยังใช้ `GET /tasks` ปกติ
