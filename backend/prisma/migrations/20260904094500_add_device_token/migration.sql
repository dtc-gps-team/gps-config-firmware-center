-- DeviceToken: ที่เก็บ FCM device token ต่อ user (Push Notification groundwork,
-- Sprint 3 #17, PR A) — ยังไม่มีโค้ดส่ง push จริงในรอบนี้
--
-- Additive-only — สร้างตารางใหม่ล้วน ไม่แตะตารางเดิม ไม่มี orphan data
-- เป็นไปได้ · ไม่แตะตาราง Device จึงไม่กระทบ partial unique index
-- "Device_simNumber_active_key"
--
-- เขียน migration.sql เองแล้วใช้ `prisma migrate deploy` (ไม่ใช่ `migrate dev`)
-- แบบเดียวกับ PR #85 — เครื่อง dev มี checksum drift บน migration
-- 20260831023429 (เคยถูกแก้ in-place ตอน PR #38) ทำให้ `migrate dev` สั่ง reset
-- ค่า SQL ด้านล่าง generate จาก `prisma migrate diff` เทียบ schema.prisma แล้ว

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
