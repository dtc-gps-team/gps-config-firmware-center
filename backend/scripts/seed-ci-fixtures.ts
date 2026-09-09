import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// รันผ่าน plain `ts-node` (ไม่ผ่าน prisma.config.ts) จึงต้องโหลด root .env เอง —
// convention เดียวกับ backend/prisma.config.ts · CI ตั้ง DATABASE_URL เป็น env
// var อยู่แล้ว dotenv จะไม่ override ค่าที่มี ไฟล์ .env ไม่มีก็ข้ามเงียบๆ
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * Fixtures สำหรับ integration test (E2E) ฝั่ง Mobile เท่านั้น — รันใน CI
 * (`.github/workflows/mobile-integration-test.yml`) หลัง `prisma db seed`
 *
 * ทำไมต้องมีไฟล์นี้แยกจาก `prisma/seed.ts`:
 * `prisma/seed.ts` seed แค่ Role + User + RolePermission + ConfigFieldDefinition
 * + Device (ข้อมูลอ้างอิงที่ระบบต้องมีเสมอ) — **ไม่ seed Task/Notification** เพราะ
 * เป็นข้อมูล transactional ที่ dev สร้างเองตอนใช้งาน แต่ integration test บน CI
 * รันกับ DB สดใหม่ทุกครั้ง (ไม่มีข้อมูลสะสมจากการทดสอบมือ) — `task_flow_test.dart`
 * คาดหวังว่า `st.test` มีงานผูกอยู่, `notification_flow_test.dart` คาดหวังว่ามี
 * การแจ้งเตือน (บางอันยังไม่อ่าน) ต้อง seed ตรงนี้ให้
 *
 * แยกไฟล์แทนการเติม flag ใน `prisma/seed.ts` โดยตั้งใจ: กันไม่ให้กระทบพฤติกรรม
 * `prisma db seed` / `npm run start:dev` ที่ทั้ง A และ B ใช้ประจำ และ fixture
 * ชุดนี้ผูกแน่นกับสิ่งที่เทส 2 ไฟล์นั้น assert (index 0 = รายการล่าสุด, ต้องเป็น
 * pending / unread) — เป็นเรื่องของเทส ไม่ใช่ seed หลัก
 *
 * ปลอดภัยกับการรันซ้ำ: ลบ Task/Notification ของ st.test ทิ้งก่อนแล้วสร้างใหม่
 */
const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-ci-fixtures.ts ห้ามรันบน production');
  }

  const st = await prisma.user.findUnique({ where: { username: 'st.test' } });
  if (!st) {
    throw new Error(
      "ไม่พบ user 'st.test' — ต้องรัน `prisma db seed` ก่อน seed-ci-fixtures",
    );
  }

  // รันซ้ำได้: ล้างของเดิมของ st.test ก่อน
  await prisma.task.deleteMany({ where: { assignedTo: st.id } });
  await prisma.notification.deleteMany({ where: { userId: st.id } });

  const now = Date.now();

  // Task — เรียง createdAt desc ใน GET /tasks ⇒ index 0 = ตัวล่าสุด (createdAt
  // มากสุด) ต้องเป็น pending เพื่อให้ ST กดเปลี่ยนเป็น in_progress ได้ใน
  // task_flow_test.dart · กำหนด createdAt ห่างกันชัดเจนกันลำดับสลับ
  await prisma.task.createMany({
    data: [
      {
        title: 'ตรวจสอบสัญญาณ GPS DEV-0001',
        description: 'เช็คว่าอุปกรณ์ยังส่งพิกัดเข้าเซิร์ฟเวอร์ปกติ',
        assignedTo: st.id,
        deviceId: 'DEV-0001',
        status: 'completed',
        createdAt: new Date(now - 3 * HOUR),
      },
      {
        title: 'เปลี่ยนซิมการ์ด DEV-0002',
        description: 'ซิมเดิมหมดอายุแพ็กเกจ เปลี่ยนเป็นเบอร์ใหม่',
        assignedTo: st.id,
        deviceId: 'DEV-0002',
        status: 'in_progress',
        createdAt: new Date(now - 2 * HOUR),
      },
      {
        title: 'ติดตั้งอุปกรณ์ DEV-0003',
        description: 'ติดตั้งเครื่องใหม่ที่รถลูกค้า แล้วยืนยันการทำงาน',
        assignedTo: st.id,
        deviceId: 'DEV-0003',
        status: 'pending',
        createdAt: new Date(now - 1 * HOUR),
      },
    ],
  });

  // Notification — เรียง createdAt desc ใน GET /notifications ⇒ index 0 = ตัว
  // ล่าสุด ต้อง read=false เพื่อให้ notification_flow_test.dart กดแล้วเห็น
  // unread_dot ลดลง · ต้องมี unread ≥ 1 ให้ badge บน Home โผล่
  await prisma.notification.createMany({
    data: [
      {
        userId: st.id,
        type: 'incident_alert',
        payload: { message: 'อุปกรณ์ DEV-0001 ขาดการติดต่อเกิน 30 นาที' },
        read: true,
        sentAt: new Date(now - 4 * HOUR),
        createdAt: new Date(now - 4 * HOUR),
      },
      {
        userId: st.id,
        type: 'config_approved',
        payload: { configId: 'demo-config-1' },
        read: true,
        sentAt: new Date(now - 3 * HOUR),
        createdAt: new Date(now - 3 * HOUR),
      },
      {
        userId: st.id,
        type: 'firmware_ready',
        payload: { firmwareId: 'demo-fw-1' },
        read: false,
        sentAt: new Date(now - 2 * HOUR),
        createdAt: new Date(now - 2 * HOUR),
      },
      {
        userId: st.id,
        type: 'task_assigned',
        payload: {
          taskId: 'demo-task-latest',
          title: 'ติดตั้งอุปกรณ์ DEV-0003',
        },
        read: false,
        sentAt: new Date(now - 1 * HOUR),
        createdAt: new Date(now - 1 * HOUR),
      },
    ],
  });

  const taskCount = await prisma.task.count({ where: { assignedTo: st.id } });
  const unread = await prisma.notification.count({
    where: { userId: st.id, read: false },
  });
  console.log(
    `CI fixtures: st.test -> ${taskCount} tasks, ${unread} unread notifications`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
