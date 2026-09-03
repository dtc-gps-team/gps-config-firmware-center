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
    // updateConfig (PUT), removeConfig (DELETE ใช้ action Update เดิม — ดู
    // config.controller.ts comment) — เดิมคอมเมนต์แถวนี้เขียนว่าเป็นของ
    // simulateConfig ผิด (ตอนนั้น Stage 3 ยังไม่ได้เริ่มทำจริง) แก้ให้ตรงตอนเริ่ม
    // Stage 3 จริง: simulateConfig ใช้ resource 'config-simulation' แยกต่างหาก
    // ด้านล่าง ไม่ได้ใช้ตัวนี้
    grant('SW', 'config', 'Update'),
    // เพิ่มใหม่: RBAC_Matrix.md ระบุ Config Editor = SW: C,R,U แต่ seed เดิมมีแค่ C,U ขาด R
    grant('SW', 'config', 'Read'),
    grant('Operation', 'config', 'Read'),
    // approveConfig, rejectConfig
    grant('Operation', 'config', 'Approve'),
    grant('ST', 'config', 'Read'),
    grant('OT', 'config', 'Read'),
    grant('Auditor', 'config', 'Read'),
    grant('Admin', 'config', 'Read'),

    // ---- config-simulation (Stage 3, #26) ----
    // simulateConfig — resource แยกจาก 'config' ธรรมดาโดยตั้งใจ: SW/Operation/
    // ST/OT ต้องเรียกได้ทั้งคู่ แต่ 'config'+Read ถูก grant ให้ Auditor/Admin
    // ไว้แล้ว (สำหรับดูรายการ/รายละเอียดเฉยๆ) ซึ่งตาม RBAC_Matrix.md ตาราง 4.1
    // Auditor/Admin ไม่ควรเรียก simulate ได้ — ถ้าใช้ 'config'+Read ร่วมกันจะ
    // เผลอเปิดสิทธิ์ให้ 2 role นี้ไปด้วยโดยไม่ตั้งใจ จึงต้องแยก resource ใหม่
    grant('SW', 'config-simulation', 'Read'),
    grant('Operation', 'config-simulation', 'Read'),
    grant('ST', 'config-simulation', 'Read'),
    grant('OT', 'config-simulation', 'Read'),

    // ---- config-decision (Stage 4, #26) ----
    // decideConfig — resource แยกจาก 'config' ธรรมดาโดยตั้งใจ (ดูคอมเมนต์เต็ม
    // ใน config.controller.ts): แม้ตอนนี้มีแค่ SW ที่มีสิทธิ์ ก็ไม่อยากใช้
    // 'config'+Update ร่วมกับสิทธิ์แก้ไข field ปกติ เพราะเป็นคนละ action กัน
    grant('SW', 'config-decision', 'Approve'),

    // ---- config-definition (Config Definition Lookup, task #12) ----
    // listConfigDefinitions — catalog อ่านอย่างเดียวของ field ที่ระบบรู้จัก
    // ไม่ใช่ข้อมูลอ่อนไหว เปิดให้ทุก role ที่ทำงานกับ Config (SW/Operation/ST/OT)
    // อ่านได้ แพทเทิร์นเดียวกับ 'config-simulation' ด้านบน — Auditor/Admin ยังไม่
    // ให้เพราะยังไม่มี use case (เพิ่มทีหลังได้ถ้าต้องการ ไม่มี side effect)
    grant('SW', 'config-definition', 'Read'),
    grant('Operation', 'config-definition', 'Read'),
    grant('ST', 'config-definition', 'Read'),
    grant('OT', 'config-definition', 'Read'),
    // createConfigDefinition (Semantic Validation, #26 — ตัดสินใจร่วมกับ B
    // และพี่เลี้ยง 2569-09): เฉพาะ SW คนเดียวที่สร้าง field definition ใหม่ได้
    // ไม่ต้องผ่านอนุมัติ — ดูเหตุผลเต็มใน config-definition.service.ts และ
    // RBAC_Matrix.md changelog
    grant('SW', 'config-definition', 'Create'),

    // ---- device-connection-test (POST /devices/{deviceId}/test-connection) ----
    // ทดสอบสัญญาณอุปกรณ์ที่ติดตั้งจริง — grant ให้ ST/OT เท่านั้น (คนหน้างานที่
    // ใช้ Mobile) paveekornkwork-dev (A) ยืนยันบนคอมเมนต์ PR #52 ว่ายังไม่เปิด
    // ให้ SW/Operation เพราะยังไม่เห็น use case ชัดเจน — เปิดกว้างทีหลังได้
    grant('ST', 'device-connection-test', 'Read'),
    grant('OT', 'device-connection-test', 'Read'),

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

  // ---------------------------------------------------------------------
  // 4) ConfigFieldDefinition (Config Definition Lookup, task #12) — catalog
  //    ของ field ที่ระบบรู้จัก ใช้อ้างอิงตอนกรอก/ตรวจ Config
  //    seed เฉพาะ field ที่ยืนยันได้จริงจาก GPS_Data_Dictionary.xlsx เท่านั้น
  //    เริ่มจาก APN ก่อน (field แรกที่นิยามไว้ชัดสุด) — field อื่นทยอยเพิ่มเมื่อ
  //    verify กับ Data Dictionary แล้ว ห้ามเดา
  // ---------------------------------------------------------------------
  const configFieldDefinitions: {
    fieldName: string;
    dataType: string;
    allowedValues: string[];
    required: boolean;
    unknownSpec: boolean;
    description: string;
    // (deviceModel, protocol) ที่ field นี้รองรับ — ตั้งแต่ Semantic
    // Validation (#26) field ที่ supportedModels ว่างเปล่าใช้งานไม่ได้เลย
    // (validateFields บล็อกทุก deviceModel/protocol ถ้าไม่มีคู่ไหนตรงกัน
    // เลย) ใช้ GT06N/TCP เป็น device model มาตรฐานเดียวกับที่ทุก test file
    // ในโปรเจกต์ใช้ตรงกัน (ไม่ใช่ค่าที่เดาขึ้นใหม่)
    supportedModels: { deviceModel: string; protocol: string }[];
  }[] = [
    {
      fieldName: 'APN',
      dataType: 'string',
      allowedValues: [],
      required: true,
      unknownSpec: false,
      description: 'Access Point Name สำหรับเชื่อมต่อ GPRS/4G ของอุปกรณ์',
      supportedModels: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
    },
  ];

  for (const def of configFieldDefinitions) {
    const { supportedModels, ...fieldData } = def;
    const existing = await prisma.configFieldDefinition.upsert({
      where: { fieldName: def.fieldName },
      update: {},
      create: fieldData,
    });
    for (const support of supportedModels) {
      await prisma.configFieldDefinitionModelSupport.upsert({
        where: {
          fieldDefinitionId_deviceModel_protocol: {
            fieldDefinitionId: existing.id,
            deviceModel: support.deviceModel,
            protocol: support.protocol,
          },
        },
        update: {},
        create: { fieldDefinitionId: existing.id, ...support },
      });
    }
  }

  console.log(
    `Seeded ${INITIAL_ROLES.length} roles, ${testUsers.length} users, ${grants.length} permissions, ${configFieldDefinitions.length} config field definitions.`,
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
