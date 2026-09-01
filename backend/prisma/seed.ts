import { PrismaClient, ActionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// code ของ Role เริ่มต้นทั้ง 6 ตัว (แทน enum เดิม) — ตรงกับ docs/api/openapi.yaml
// Role ใหม่ที่ Admin สร้างเพิ่มทีหลังผ่านหน้า User/Role Management ไม่ต้องอยู่ใน
// รายการนี้ ไฟล์นี้ seed แค่ค่าเริ่มต้นตอน dev/test เท่านั้น
const INITIAL_ROLES: { code: string; name: string; description: string }[] = [
  {
    code: 'SW',
    name: 'Software Engineer',
    description: 'สร้าง/แก้ไข/Import Config, รัน Simulation',
  },
  {
    code: 'Operation',
    name: 'Operation',
    description: 'อนุมัติ Config, จัดการ Campaign/Task',
  },
  {
    code: 'ST',
    name: 'Senior Technician',
    description: 'Override Config/Firmware, ดูแล Incident เชิงเทคนิค',
  },
  {
    code: 'OT',
    name: 'Operation-Technician',
    description: 'สนับสนุนงานปฏิบัติการ, Override Config/Firmware',
  },
  {
    code: 'Auditor',
    name: 'Auditor',
    description: 'ดูข้อมูลอย่างเดียวทุกจอเพื่อ compliance',
  },
  {
    code: 'Admin',
    name: 'System Admin',
    description: 'จัดการ User/Role, Decommission Device',
  },
];

type Grant = { roleCode: string; resource: string; action: ActionType };

function grant(roleCode: string, resource: string, action: ActionType): Grant {
  return { roleCode, resource, action };
}

const ALL_ROLE_CODES = INITIAL_ROLES.map((r) => r.code);

async function main() {
  // ---------------------------------------------------------------------
  // 1) Role — seed ก่อนสุด เพราะ User และ RolePermission มี FK มาหา Role.id
  // ---------------------------------------------------------------------
  const roleIdByCode = new Map<string, string>();

  for (const r of INITIAL_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: r,
    });
    roleIdByCode.set(r.code, role.id);
  }

  // ---------------------------------------------------------------------
  // 2) User ทดสอบ 6 role — ต้อง seed ก่อน Task/Notification เสมอ เพราะทั้งคู่
  //    มี foreign key มาหา User แล้ว (ดู schema.prisma: Task.assignedUser,
  //    Notification.user ที่ kittiphong เพิ่มเข้ามา)
  //    รหัสผ่าน "password123" เป็นค่า dev/test เท่านั้น ห้ามใช้ใน production
  // ---------------------------------------------------------------------
  const testUsers: { username: string; fullName: string; roleCode: string }[] =
    [
      { username: 'sw.test', fullName: 'SW Tester', roleCode: 'SW' },
      {
        username: 'operation.test',
        fullName: 'Operation Tester',
        roleCode: 'Operation',
      },
      { username: 'st.test', fullName: 'ST Tester', roleCode: 'ST' },
      { username: 'ot.test', fullName: 'OT Tester', roleCode: 'OT' },
      {
        username: 'auditor.test',
        fullName: 'Auditor Tester',
        roleCode: 'Auditor',
      },
      { username: 'admin.test', fullName: 'Admin Tester', roleCode: 'Admin' },
    ];

  const passwordHash = await bcrypt.hash('password123', 10);

  for (const u of testUsers) {
    const roleId = roleIdByCode.get(u.roleCode);
    if (!roleId) throw new Error(`Role code not seeded yet: ${u.roleCode}`);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        fullName: u.fullName,
        passwordHash,
        roleId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // 3) RolePermission (role × resource × action) — resource ตั้งชื่อตาม path
  //    หลักใน docs/api/openapi.yaml (main) เฉพาะ endpoint ที่มีจริงในตาราง 4.1
  //    ของ docs/architecture/RBAC_Matrix.md ห้ามเดา resource ของตาราง 4.2
  //    (endpoint ที่ยังไม่มีจริง เช่น campaign, override, decommission)
  // ---------------------------------------------------------------------
  const grants: Grant[] = [
    // ---- config ----
    // createConfig, importConfig
    grant('SW', 'config', 'Create'),
    // simulateConfig (dry-run ก่อนส่ง Operation), updateConfig, deleteConfig
    // (DELETE reuse action Update — ไม่มี ActionType.Delete แยก ตัดสินใจไว้
    // ตอน schema follow-up ก่อน #26)
    grant('SW', 'config', 'Update'),
    // แก้เพิ่มตอนทำ #26 (Stage 1 CRUD): RBAC_Matrix.md แถว "Config Editor"
    // ระบุ SW = C,R,U แต่ seed เดิมไม่มี Read ให้ SW เลย ทำให้ SW เรียก
    // getConfig/listConfigs (GET) ของตัวเองไม่ได้เลยหลุดมาโดยไม่ตั้งใจ
    grant('SW', 'config', 'Read'),
    grant('Operation', 'config', 'Read'),
    // approveConfig, rejectConfig
    grant('Operation', 'config', 'Approve'),
    grant('ST', 'config', 'Read'),
    grant('OT', 'config', 'Read'),
    grant('Auditor', 'config', 'Read'),
    grant('Admin', 'config', 'Read'),

    // ---- notifications (ทุก role อ่าน/mark read ได้ — เฉพาะของตัวเอง) ----
    ...ALL_ROLE_CODES.flatMap((roleCode) => [
      grant(roleCode, 'notifications', 'Read'),
      grant(roleCode, 'notifications', 'Update'), // markNotificationRead
    ]),

    // ---- tasks (ตาม RBAC_Matrix.md §4.3 — ปิดโดย kittiphong:
    //      Operation สั่งงาน/อนุมัติ, ST/OT ปฏิบัติงาน) ----
    grant('Operation', 'tasks', 'Create'),
    grant('Operation', 'tasks', 'Read'),
    grant('Operation', 'tasks', 'Update'),
    // ST/OT แก้ status ของงานตัวเองเท่านั้น — ownership check (assignedTo =
    // user id ที่ login) อยู่ที่ Guard/service ไม่ใช่ที่ตารางนี้
    grant('ST', 'tasks', 'Read'),
    grant('ST', 'tasks', 'Update'),
    grant('OT', 'tasks', 'Read'),
    grant('OT', 'tasks', 'Update'),
    grant('SW', 'tasks', 'Read'),
    grant('Auditor', 'tasks', 'Read'),
    grant('Admin', 'tasks', 'Read'),

    // ---- firmware ----
    grant('SW', 'firmware', 'Create'),
    grant('SW', 'firmware', 'Update'), // simulateFirmware
    grant('Operation', 'firmware', 'Read'),
    grant('ST', 'firmware', 'Read'),
    grant('OT', 'firmware', 'Read'),
    grant('Auditor', 'firmware', 'Read'),
    grant('Admin', 'firmware', 'Read'),

    // ---- devices (getDeviceStatus — ทุก role อ่านได้) ----
    ...ALL_ROLE_CODES.map((roleCode) => grant(roleCode, 'devices', 'Read')),
  ];

  for (const g of grants) {
    const roleId = roleIdByCode.get(g.roleCode);
    if (!roleId) throw new Error(`Role code not seeded yet: ${g.roleCode}`);
    await prisma.rolePermission.upsert({
      where: {
        roleId_resource_action: {
          roleId,
          resource: g.resource,
          action: g.action,
        },
      },
      update: {},
      create: { roleId, resource: g.resource, action: g.action },
    });
  }

  console.log(
    `Seeded ${INITIAL_ROLES.length} roles, ${testUsers.length} users, ${grants.length} permissions.`,
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
