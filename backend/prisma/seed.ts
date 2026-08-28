import { PrismaClient, Role, ActionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

type Permission = { role: Role; resource: string; action: ActionType };

// helper ที่มี parameter type ชัดเจนทุกตัว — กัน TS widen ตัว action เป็น
// string เฉยๆ ตอนอยู่ในอาร์เรย์ใหญ่ที่มีทั้ง literal ปนกับ spread จาก
// flatMap/map (ปัญหาที่ทำให้ ts-node compile ไม่ผ่านตอนรัน seed จริง)
function perm(role: Role, resource: string, action: ActionType): Permission {
  return { role, resource, action };
}

const ALL_ROLES: Role[] = ['SW', 'Operation', 'ST', 'OT', 'Auditor', 'Admin'];

async function main() {
  // ---------------------------------------------------------------------
  // 1) User ทดสอบ 6 role — ต้อง seed ก่อน Task/Notification เสมอ เพราะทั้งคู่
  //    มี foreign key มาหา User แล้ว (ดู schema.prisma: Task.assignedUser,
  //    Notification.user ที่ kittiphong เพิ่มเข้ามา)
  //    รหัสผ่าน "password123" เป็นค่า dev/test เท่านั้น ห้ามใช้ใน production
  // ---------------------------------------------------------------------
  const testUsers: { username: string; fullName: string; role: Role }[] = [
    { username: 'sw.test', fullName: 'SW Tester', role: 'SW' },
    {
      username: 'operation.test',
      fullName: 'Operation Tester',
      role: 'Operation',
    },
    { username: 'st.test', fullName: 'ST Tester', role: 'ST' },
    { username: 'ot.test', fullName: 'OT Tester', role: 'OT' },
    { username: 'auditor.test', fullName: 'Auditor Tester', role: 'Auditor' },
    { username: 'admin.test', fullName: 'Admin Tester', role: 'Admin' },
  ];

  const passwordHash = await bcrypt.hash('password123', 10);

  for (const u of testUsers) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
  }

  // ---------------------------------------------------------------------
  // 2) Permission (role × resource × action) — resource ตั้งชื่อตาม path หลัก
  //    ใน docs/api/openapi.yaml (main) เฉพาะ endpoint ที่มีจริงในตาราง 4.1
  //    ของ docs/architecture/RBAC_Matrix.md ห้ามเดา resource ของตาราง 4.2
  //    (endpoint ที่ยังไม่มีจริง เช่น campaign, override, decommission)
  // ---------------------------------------------------------------------
  const permissions: Permission[] = [
    // ---- config ----
    // createConfig, importConfig
    perm('SW', 'config', 'Create'),
    // simulateConfig (dry-run ก่อนส่ง Operation)
    perm('SW', 'config', 'Update'),
    perm('Operation', 'config', 'Read'),
    // approveConfig, rejectConfig
    perm('Operation', 'config', 'Approve'),
    perm('ST', 'config', 'Read'),
    perm('OT', 'config', 'Read'),
    perm('Auditor', 'config', 'Read'),
    perm('Admin', 'config', 'Read'),

    // ---- notifications (ทุก role อ่าน/mark read ได้ — เฉพาะของตัวเอง) ----
    ...ALL_ROLES.flatMap((role) => [
      perm(role, 'notifications', 'Read'),
      perm(role, 'notifications', 'Update'), // markNotificationRead
    ]),

    // ---- tasks (ตาม RBAC_Matrix.md §4.3 — ปิดโดย kittiphong:
    //      Operation สั่งงาน/อนุมัติ, ST/OT ปฏิบัติงาน) ----
    perm('Operation', 'tasks', 'Create'),
    perm('Operation', 'tasks', 'Read'),
    perm('Operation', 'tasks', 'Update'),
    // ST/OT แก้ status ของงานตัวเองเท่านั้น — ownership check (assignedTo =
    // user id ที่ login) อยู่ที่ Guard/service ไม่ใช่ที่ตารางนี้
    perm('ST', 'tasks', 'Read'),
    perm('ST', 'tasks', 'Update'),
    perm('OT', 'tasks', 'Read'),
    perm('OT', 'tasks', 'Update'),
    perm('SW', 'tasks', 'Read'),
    perm('Auditor', 'tasks', 'Read'),
    perm('Admin', 'tasks', 'Read'),

    // ---- firmware ----
    perm('SW', 'firmware', 'Create'),
    perm('SW', 'firmware', 'Update'), // simulateFirmware
    perm('Operation', 'firmware', 'Read'),
    perm('ST', 'firmware', 'Read'),
    perm('OT', 'firmware', 'Read'),
    perm('Auditor', 'firmware', 'Read'),
    perm('Admin', 'firmware', 'Read'),

    // ---- devices (getDeviceStatus — ทุก role อ่านได้) ----
    ...ALL_ROLES.map((role) => perm(role, 'devices', 'Read')),
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { role_resource_action: p },
      update: {},
      create: p,
    });
  }

  console.log(
    `Seeded ${testUsers.length} users, ${permissions.length} permissions.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
