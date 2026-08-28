/*
  แก้ตามที่ kittiphong รีวิวเจอ (2026-08-28): เดิม migration นี้ DROP COLUMN "role"
  แล้ว ADD COLUMN "roleId" NOT NULL ตรงๆ โดยไม่ backfill ก่อน — พังทันทีกับ DB ที่มี
  ข้อมูล user อยู่แล้ว (P3018) และ DROP COLUMN "role" ก่อนหน้านั้นทำลายข้อมูลต้นทาง
  ไปแล้วด้วย ตอนนี้เขียนใหม่เป็น multi-step: backfill roleId จาก role เดิมก่อน
  (join ด้วย code) แล้วค่อย DROP COLUMN "role" ทีหลังสุด — เช่นเดียวกับฝั่ง
  Permission -> RolePermission ที่ย้ายข้อมูลก่อน DROP TABLE เดิม
*/

-- Step 1: แปลงคอลัมน์ "role" (enum) เป็น TEXT ชั่วคราว เพื่อเลิกผูกกับ enum type
--         "Role" (ต้อง free ชื่อ "Role" ไว้ให้ตารางใหม่ใช้ชื่อเดียวกัน)
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "Permission" ALTER COLUMN "role" TYPE TEXT USING "role"::text;

-- Step 2: ปลด enum type "Role" เดิม (ไม่มีคอลัมน์ไหนอ้างอิงแล้วหลัง step 1)
DROP TYPE "Role";

-- Step 3: สร้างตาราง Role ใหม่
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- Step 4: seed ค่าเริ่มต้น 6 role ตรงกับ prisma/seed.ts (INITIAL_ROLES) — ต้อง insert
--         ที่นี่ (ไม่ใช่รอ seed.ts) เพราะ backfill ด้านล่างต้องมี Role.code ให้ join แล้ว
INSERT INTO "Role" ("id", "code", "name", "description", "createdAt", "updatedAt") VALUES
    (gen_random_uuid(), 'SW', 'Software Engineer', 'สร้าง/แก้ไข/Import Config, รัน Simulation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Operation', 'Operation', 'อนุมัติ Config, จัดการ Campaign/Task', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ST', 'Senior Technician', 'Override Config/Firmware, ดูแล Incident เชิงเทคนิค', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'OT', 'Operation-Technician', 'สนับสนุนงานปฏิบัติการ, Override Config/Firmware', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Auditor', 'Auditor', 'ดูข้อมูลอย่างเดียวทุกจอเพื่อ compliance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Admin', 'System Admin', 'จัดการ User/Role, Decommission Device', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Step 5: เพิ่มคอลัมน์ roleId แบบ nullable ก่อน (ยังไม่บังคับ NOT NULL จนกว่าจะ backfill เสร็จ)
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;

-- Step 6: backfill roleId จากคอลัมน์ role เดิม (join ด้วย code)
UPDATE "User" u
SET "roleId" = r."id"
FROM "Role" r
WHERE r."code" = u."role";

-- Step 7: กันเหนียว — ถ้ามี user ที่ role เดิมไม่ตรง code ไหนเลย (ข้อมูลเพี้ยน) ให้
--         migration fail ทันทีพร้อมข้อความชัดเจน แทนที่จะไปพังที่ NOT NULL ด้านล่าง
--         แบบไม่รู้สาเหตุ
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "roleId" IS NULL) THEN
    RAISE EXCEPTION 'Found User rows whose role does not match any seeded Role.code — fix data before migrating';
  END IF;
END $$;

-- Step 8: backfill ครบแล้ว ค่อยบังคับ NOT NULL + ผูก FK + drop คอลัมน์ role เดิม
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" DROP COLUMN "role";

-- Step 9: สร้างตาราง RolePermission (แทน Permission เดิม)
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RolePermission_roleId_resource_action_key" ON "RolePermission"("roleId", "resource", "action");

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 10: ย้ายข้อมูลจาก Permission (เดิม) เข้า RolePermission ก่อน — join role code
--          กับ Role.code ที่ seed ไว้ใน step 4
INSERT INTO "RolePermission" ("id", "roleId", "resource", "action")
SELECT gen_random_uuid(), r."id", p."resource", p."action"
FROM "Permission" p
JOIN "Role" r ON r."code" = p."role";

-- Step 11: ข้อมูลย้ายครบแล้ว ค่อย drop ตารางเก่า
DROP TABLE "Permission";
