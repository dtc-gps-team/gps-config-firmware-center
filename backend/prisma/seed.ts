import { PrismaClient, Role, ActionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // ---------------------------------------------------------------------
  // 1) User ทดสอบ 6 role — ต้อง seed ก่อน Task/Notification เสมอ เพราะทั้งคู่
  //    มี foreign key มาหา User แล้ว (ดู schema.prisma: Task.assignedUser,
  //    Notification.user ที่ kittiphong เพิ่มเข้ามา)
  //    รหัสผ่าน "password123" เป็นค่า dev/test เท่านั้น ห้ามใช้ใน production
  // ---------------------------------------------------------------------
  const testUsers: { username: string; fullName: string; role: Role }[] = [
    { username: 'sw.test', fullName: 'SW Tester', role: 'SW' },
    { username: 'operation.test', fullName: 'Operation Tester', role: 'Operation' },
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
  const permissions: { role: Role; resource: string; action: ActionType }[] = [
    // ---- config ----
    { role: 'SW', resource: 'config', action: 'Create' }, // createConfig, importConfig
    { role: 'SW', resource: 'config', action: 'Update' }, // simulateConfig (dry-run ก่อนส่ง Operation)
    { role: 'Operation', resource: 'config', action: 'Read' },
    { role: 'Operation', resource: 'config', action: 'Approve' }, // approveConfig, rejectConfig
    { role: 'ST', resource: 'config', action: 'Read' },
    { role: 'OT', resource: 'config', action: 'Read' },
    { role: 'Auditor', resource: 'config', action: 'Read' },
    { role: 'Admin', resource: 'config', action: 'Read' },

    // ---- notifications (ทุก role อ่าน/mark read ได้ — เฉพาะของตัวเอง) ----
    ...(['SW', 'Operation', 'ST', 'OT', 'Auditor', 'Admin'] as Role[]).flatMap((role) => [
      { role, resource: 'notifications', action: 'Read' as ActionType },
      { role, resource: 'notifications', action: 'Update' as ActionType }, // markNotificationRead
    ]),

    // ---- tasks ----
    { role: 'SW', resource: 'tasks', action: 'Read' },
    { role: 'Operation', resource: 'tasks', action: 'Create' },
    { role: 'Operation', resource: 'tasks', action: 'Read' },
    { role: 'Operation', resource: 'tasks', action: 'Update' },
    { role: 'ST', resource: 'tasks', action: 'Read' },
    { role: 'OT', resource: 'tasks', action: 'Create' },
    { role: 'OT', resource: 'tasks', action: 'Read' },
    { role: 'OT', resource: 'tasks', action: 'Update' },
    { role: 'Auditor', resource: 'tasks', action: 'Read' },
    { role: 'Admin', resource: 'tasks', action: 'Read' },

    // ---- firmware ----
    { role: 'SW', resource: 'firmware', action: 'Create' },
    { role: 'SW', resource: 'firmware', action: 'Update' }, // simulateFirmware
    { role: 'Operation', resource: 'firmware', action: 'Read' },
    { role: 'ST', resource: 'firmware', action: 'Read' },
    { role: 'OT', resource: 'firmware', action: 'Read' },
    { role: 'Auditor', resource: 'firmware', action: 'Read' },
    { role: 'Admin', resource: 'firmware', action: 'Read' },

    // ---- devices (getDeviceStatus — ทุก role อ่านได้) ----
    ...(['SW', 'Operation', 'ST', 'OT', 'Auditor', 'Admin'] as Role[]).map((role) => ({
      role,
      resource: 'devices',
      action: 'Read' as ActionType,
    })),
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { role_resource_action: p },
      update: {},
      create: p,
    });
  }

  console.log(`Seeded ${testUsers.length} users, ${permissions.length} permissions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
