-- Task Event History (issue #296, docs/16_Task_Event_History_Proposal.md)
-- additive ล้วน: ตารางใหม่ + FK ไป Task/User — ไม่แตะตารางเดิม

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_changedAt_idx" ON "TaskEvent"("taskId", "changedAt");

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill event "สร้างงาน" (null -> pending) ให้ Task ที่มีอยู่ก่อน feature นี้
-- 1 แถวต่อ Task — เวลาแม่นยำเพราะใช้ Task.createdAt ตรงๆ และงานทุกงานเริ่มที่
-- pending เสมอ (CreateTaskDto ไม่รับ status) · ไม่ backfill การเปลี่ยนสถานะอื่น
-- เพราะไม่มีบันทึกเวลาจริงไว้ (updatedAt ถูกเขียนทับทุกครั้ง) · changedBy = NULL
-- เพราะ Task ไม่มี createdBy และ AuditLog ไม่เก็บ id ของ Task จึงไม่รู้ว่าใครสร้าง
INSERT INTO "TaskEvent" ("id", "taskId", "fromStatus", "toStatus", "changedBy", "changedAt", "createdAt")
SELECT gen_random_uuid()::text, t."id", NULL, 'pending', NULL, t."createdAt", CURRENT_TIMESTAMP
FROM "Task" t;
