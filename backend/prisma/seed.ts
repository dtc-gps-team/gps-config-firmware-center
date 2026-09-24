import { PrismaClient, ActionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// code ของ Role เริ่มต้นทั้ง 9 ตัว (แทน enum เดิม) — ตรงกับ CLAUDE.md §Role Enum
// + docs/architecture/RBAC_Matrix.md §1 · Role ใหม่ที่ Admin สร้างเพิ่มทีหลัง
// ผ่านหน้า User/Role Management ไม่ต้องอยู่ในรายการนี้ ไฟล์นี้ seed แค่ค่า
// เริ่มต้นตอน dev/test เท่านั้น
//
// อัปเดต 2026-09-17 (docs/13_Role_Redesign_Proposal.md, PR #174): ยกเลิก `SW`
// แยกเป็น 3 role ตาม PDF ต้นฉบับ §13.1 ที่แยกหน้าที่นี้ไว้ชัดเจนอยู่แล้ว (SW
// เดิมรวมทั้ง 3 อย่างไว้ในตัวเดียว) — ConfigEngineer/FirmwareEngineer ตัด
// ตามรอยต่อสิทธิ์เดิมของ SW (config vs firmware) ส่วน QAEngineer เป็น role
// ใหม่ทั้งหมด ไม่เคยมีสิทธิ์อะไรมาก่อน (ดู grant ใหม่ 'firmware-decision'
// ด้านล่าง)
//
// **หมายเหตุสำหรับใครที่ re-seed บน DB เดิมที่เคยมี role `SW` อยู่แล้ว**: ลูป
// upsert ด้านล่างไม่ลบ role/user ที่ตัดออกจากรายการนี้ให้อัตโนมัติ (`SW` +
// `sw.test` จะยังค้างอยู่ใน DB เดิม ไม่ถูกลบเอง) เพราะการลบ Role/User มี
// FK เกี่ยวข้องหลายตาราง (Config.createdBy, Firmware.uploadedBy ฯลฯ) เสี่ยง
// เกินไปที่จะให้ script นี้ลบอัตโนมัติแบบไม่มีคนตรวจสอบก่อน — บน local dev
// DB ที่ไม่มีข้อมูลสำคัญ ให้ `docker compose down -v` แล้ว up ใหม่ก่อน migrate
// deploy + seed สะอาดที่สุด
const INITIAL_ROLES: { code: string; name: string; description: string }[] = [
  {
    code: 'ConfigEngineer',
    name: 'Config Engineer',
    description: 'สร้าง/แก้ไข/Import Config, รัน Simulation',
  },
  {
    code: 'FirmwareEngineer',
    name: 'Firmware Engineer',
    description: 'อัปโหลด Firmware, แก้ Compatibility Tag',
  },
  {
    code: 'QAEngineer',
    name: 'QA Engineer',
    description: 'ตรวจ/อนุมัติคุณภาพ Firmware ก่อนใช้งานจริง',
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
    // เปลี่ยนชื่อแสดงผลจาก "Operation-Technician" เป็น "Operation Technician"
    // (ตัดขีดกลางออก) — docs/13 §3.4: กันสับสนกับ role `Operation` เอง (คนละ
    // role กันโดยสิ้นเชิง) แต่ยังคงคำว่า "Technician" ต่อท้ายเสมอเพื่อไม่ให้
    // ชนกับชื่อ `Operation` ตรงๆ
    name: 'Operation Technician',
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
  {
    // = Admin ทุกอย่าง + อนุมัติคำขอลบ Config, จัดการบัญชี Admin/SuperAdmin,
    // แก้ role/permission · ไม่ข้าม Separation of Duty (docs/11 §6, RBAC §1)
    code: 'SuperAdmin',
    name: 'System Super Admin',
    description:
      'ทุกอย่างที่ Admin ทำได้ + อนุมัติคำขอลบ Config, จัดการบัญชี Admin/SuperAdmin, แก้ role/permission',
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
    // อัปเดต 2026-09-17: เดิม `update: {}` (insert-only) — เจอบั๊กจริงระหว่าง
    // ทดสอบ role redesign นี้เอง: รัน seed ซ้ำบน DB ที่มี Role เดิมอยู่แล้ว
    // (เช่น เปลี่ยนชื่อแสดงผลของ `OT` เป็น "Operation Technician") ค่าใหม่
    // ไม่ถูก apply เลยเพราะ update ว่างเปล่า — ต่างจาก ConfigFieldDefinition
    // ที่ตั้งใจ insert-only (มีคอมเมนต์อธิบายเหตุผลไว้ที่จุดนั้นแยกต่างหาก)
    // Role ควร sync `name`/`description` ทุกครั้งที่ seed เพราะไฟล์นี้คือ
    // source of truth ของ metadata role ไม่ใช่ข้อมูลที่ผู้ใช้แก้เองได้ทีหลัง
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
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
      {
        username: 'config.test',
        fullName: 'Config Engineer Tester',
        roleCode: 'ConfigEngineer',
      },
      {
        username: 'firmware.test',
        fullName: 'Firmware Engineer Tester',
        roleCode: 'FirmwareEngineer',
      },
      {
        username: 'qa.test',
        fullName: 'QA Engineer Tester',
        roleCode: 'QAEngineer',
      },
      {
        username: 'operation.test',
        fullName: 'Operation Tester',
        roleCode: 'Operation',
      },
      // Operation เพิ่ม 2 คน — ให้ dropdown "เจาะจงผู้อนุมัติ" (Approval Center
      // #19) มีตัวเลือกมากกว่า 1 ตอน dev/demo
      {
        username: 'operation2.test',
        fullName: 'Operation Tester 2',
        roleCode: 'Operation',
      },
      {
        username: 'operation3.test',
        fullName: 'Operation Tester 3',
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
      {
        username: 'superadmin.test',
        fullName: 'SuperAdmin Tester',
        roleCode: 'SuperAdmin',
      },
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
    grant('ConfigEngineer', 'config', 'Create'),
    // updateConfig (PUT), removeConfig (DELETE ใช้ action Update เดิม — ดู
    // config.controller.ts comment) — เดิมคอมเมนต์แถวนี้เขียนว่าเป็นของ
    // simulateConfig ผิด (ตอนนั้น Stage 3 ยังไม่ได้เริ่มทำจริง) แก้ให้ตรงตอนเริ่ม
    // Stage 3 จริง: simulateConfig ใช้ resource 'config-simulation' แยกต่างหาก
    // ด้านล่าง ไม่ได้ใช้ตัวนี้
    grant('ConfigEngineer', 'config', 'Update'),
    // เพิ่มใหม่: RBAC_Matrix.md ระบุ Config Editor = ConfigEngineer: C,R,U แต่ seed เดิมมีแค่ C,U ขาด R
    grant('ConfigEngineer', 'config', 'Read'),
    grant('Operation', 'config', 'Read'),
    // approveConfig, rejectConfig
    grant('Operation', 'config', 'Approve'),
    grant('ST', 'config', 'Read'),
    grant('OT', 'config', 'Read'),
    grant('Auditor', 'config', 'Read'),
    grant('Admin', 'config', 'Read'),

    // ---- config-override (Per-Field Override ACL, issue #185) ----
    // overrideConfig — ให้เฉพาะ ST เท่านั้น ไม่ให้ OT เลยสักฟิลด์ (ตัดสินใจ
    // ร่วมกับ B 2026-09-18 — ชื่อ resource สื่อ "ST เท่านั้น" ตรงตัว) —
    // แยก resource ใหม่จาก 'config'+Update เพราะเป็นคนละ flow กันโดยสิ้นเชิง
    // (override ข้าม Approval Center ไปเลย ต้องคุมแยกจาก Update ปกติที่ไม่มี
    // role ไหนได้อยู่แล้วในตอนนี้) ถ้าต้องการเปิดให้ role ที่ 3 override ได้
    // ทีหลัง เพิ่ม grant ตรงนี้ได้เลย ไม่ต้องแก้ schema (YAGNI — ดูคอมเมนต์
    // ที่ ConfigFieldDefinition.stOverridable ใน schema.prisma)
    grant('ST', 'config-override', 'Override'),

    // ---- config-simulation (Stage 3, #26) ----
    // simulateConfig — resource แยกจาก 'config' ธรรมดาโดยตั้งใจ: ConfigEngineer/
    // Operation/ST/OT ต้องเรียกได้ทั้งคู่ แต่ 'config'+Read ถูก grant ให้ Auditor/Admin
    // ไว้แล้ว (สำหรับดูรายการ/รายละเอียดเฉยๆ) ซึ่งตาม RBAC_Matrix.md ตาราง 4.1
    // Auditor/Admin ไม่ควรเรียก simulate ได้ — ถ้าใช้ 'config'+Read ร่วมกันจะ
    // เผลอเปิดสิทธิ์ให้ 2 role นี้ไปด้วยโดยไม่ตั้งใจ จึงต้องแยก resource ใหม่
    grant('ConfigEngineer', 'config-simulation', 'Read'),
    grant('Operation', 'config-simulation', 'Read'),
    grant('ST', 'config-simulation', 'Read'),
    grant('OT', 'config-simulation', 'Read'),

    // ---- config-decision (Stage 4, #26) ----
    // decideConfig — resource แยกจาก 'config' ธรรมดาโดยตั้งใจ (ดูคอมเมนต์เต็ม
    // ใน config.controller.ts): แม้ตอนนี้มีแค่ ConfigEngineer ที่มีสิทธิ์ ก็ไม่อยากใช้
    // 'config'+Update ร่วมกับสิทธิ์แก้ไข field ปกติ เพราะเป็นคนละ action กัน
    grant('ConfigEngineer', 'config-decision', 'Approve'),

    // ---- config-definition (Config Definition Lookup, task #12) ----
    // listConfigDefinitions — catalog อ่านอย่างเดียวของ field ที่ระบบรู้จัก
    // ไม่ใช่ข้อมูลอ่อนไหว เปิดให้ทุก role ที่ทำงานกับ Config (ConfigEngineer/Operation/ST/OT)
    // อ่านได้ แพทเทิร์นเดียวกับ 'config-simulation' ด้านบน — Auditor/Admin ยังไม่
    // ให้เพราะยังไม่มี use case (เพิ่มทีหลังได้ถ้าต้องการ ไม่มี side effect)
    grant('ConfigEngineer', 'config-definition', 'Read'),
    grant('Operation', 'config-definition', 'Read'),
    grant('ST', 'config-definition', 'Read'),
    grant('OT', 'config-definition', 'Read'),
    // createConfigDefinition (Semantic Validation, #26 — ตัดสินใจร่วมกับ B
    // และพี่เลี้ยง 2569-09): เฉพาะ ConfigEngineer คนเดียวที่สร้าง field definition ใหม่ได้
    // ไม่ต้องผ่านอนุมัติ — ดูเหตุผลเต็มใน config-definition.service.ts และ
    // RBAC_Matrix.md changelog
    grant('ConfigEngineer', 'config-definition', 'Create'),

    // ---- device-connection-test (POST /devices/{deviceId}/test-connection) ----
    // ทดสอบสัญญาณอุปกรณ์ที่ติดตั้งจริง — grant ให้ ST/OT เท่านั้น (คนหน้างานที่
    // ใช้ Mobile) paveekornkwork-dev (A) ยืนยันบนคอมเมนต์ PR #52 ว่ายังไม่เปิด
    // ให้ SW/Operation เพราะยังไม่เห็น use case ชัดเจน — เปิดกว้างทีหลังได้
    grant('ST', 'device-connection-test', 'Read'),
    grant('OT', 'device-connection-test', 'Read'),

    // ---- device-config-apply (POST /devices/{deviceId}/apply-config) ----
    // ช่างหน้างานใส่ Config ที่อนุมัติแล้วเข้าอุปกรณ์ที่ติดตั้งจริง — ST/OT
    // เท่านั้น (mirror device-connection-test) SW/Operation ไม่ apply หน้างาน
    grant('ST', 'device-config-apply', 'Read'),
    grant('OT', 'device-config-apply', 'Read'),

    // ---- device-current-config (GET /devices/{deviceId}/config) ----
    // Config Override Phase 2 (Mobile, issue #211) — ช่างต้องรู้ว่า Config
    // ปัจจุบันของอุปกรณ์คืออะไรก่อนเปิดหน้า Override ได้ — resource แยกจาก
    // `device-config-apply` แม้ action เดียวกัน (`Read`) เพราะคนละความหมาย
    // (`device-config-apply` = สิทธิ์ "ส่ง Config เข้าอุปกรณ์", ตัวนี้ = สิทธิ์
    // "อ่าน Config ปัจจุบันของอุปกรณ์") ST/OT เท่านั้น (mirror
    // device-connection-test/device-config-apply — คนหน้างานที่ใช้ Mobile)
    grant('ST', 'device-current-config', 'Read'),
    grant('OT', 'device-current-config', 'Read'),

    // ---- device-firmware-confirm (POST /devices/{deviceId}/confirm-firmware-install) ----
    // ช่างหน้างานยืนยันว่าติดตั้ง Firmware เข้าอุปกรณ์เสร็จแล้ว (issue #181) —
    // ST/OT เท่านั้น (mirror device-config-apply) action `Create` ไม่ใช่ `Read`
    // เพราะ endpoint นี้เขียน AuditLog จริง — ดู device.controller.ts
    grant('ST', 'device-firmware-confirm', 'Create'),
    grant('OT', 'device-firmware-confirm', 'Create'),

    // ---- device-config-override (issue #223, มติ 2026-09-24) ----
    // Per-device Config Override — mirror config-override เดิม (issue #185)
    // เรื่อง grant ให้ ST เท่านั้น ไม่ให้ OT เลยสักฟิลด์ (ดู
    // grant('ST', 'config-override', 'Override') ด้านบน) resource แยกจากของเดิม
    // เพราะคนละ endpoint/scope กัน (เครื่องเดียว ไม่ใช่ Config ทั้งชุด)
    //
    // POST /devices/{deviceId}/config-override — ST ส่งคำขอ (สถานะ pending)
    grant('ST', 'device-config-override', 'Override'),
    // GET /device-config-overrides — Operation ดูคิวคำขอรออนุมัติ (mirror
    // resource `config-deletion` action Read สำหรับ list เดียวกัน)
    grant('Operation', 'device-config-override', 'Read'),
    // POST /device-config-overrides/{id}/approve · .../reject — Operation
    // ตัดสินใจ (Separation of Duty เดิม — ST ส่งคำขอ Operation อนุมัติ)
    // action เดียวกันคุมทั้ง approve/reject mirror `config-deletion`
    // (`rejectConfigDeletionRequest` ก็ใช้ action Approve เดียวกับ approve)
    grant('Operation', 'device-config-override', 'Approve'),

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
    // เดิมมี grant('SW', 'tasks', 'Read') ตรงนี้ — ตัดทิ้งตอนแยก role (docs/13
    // §3.1) เช็คแล้วไม่เคยถูกใช้งานจริงในหน้าจอไหนเลย ตกค้างมาจากก่อน Task
    // Management จะถูกยกเลิกถาวร (ดู nav.ts comment) ไม่มีเหตุผลต้องคงไว้ให้
    // Config/Firmware/QA Engineer ตัวไหนเลย
    grant('Auditor', 'tasks', 'Read'),
    grant('Admin', 'tasks', 'Read'),

    // ---- firmware (Sprint 3 #23 — Firmware Repository) ----
    grant('FirmwareEngineer', 'firmware', 'Create'),
    grant('FirmwareEngineer', 'firmware', 'Update'), // updateFirmwareCompatibility (Compatibility Tag)
    // เพิ่มใหม่: RBAC_Matrix.md Section 2 ระบุ Firmware Repository = SW (เดิม)
    // C,R,U แต่ seed เดิมมีแค่ C,U ขาด R — บั๊กเดียวกับที่เคยเจอกับ config (ดู
    // comment เหนือ grant('ConfigEngineer','config','Read') ด้านบน) ทำให้เปิดหน้า
    // /firmware เองไม่ได้เลย (403 "ไม่มีสิทธิ์ Read บน resource firmware")
    grant('FirmwareEngineer', 'firmware', 'Read'),
    // QAEngineer ต้อง Read ได้ด้วย — เข้ามาตรวจ/อนุมัติคุณภาพก่อนใช้งานจริง
    // (docs/13 §3.1/§3.2, role ใหม่ทั้งหมด ไม่เคยมีสิทธิ์นี้มาก่อน)
    grant('QAEngineer', 'firmware', 'Read'),
    grant('Operation', 'firmware', 'Read'),
    grant('ST', 'firmware', 'Read'),
    grant('OT', 'firmware', 'Read'),
    grant('Auditor', 'firmware', 'Read'),
    grant('Admin', 'firmware', 'Read'),

    // ---- firmware-simulation (แยกจาก firmware ธรรมดา mirror
    // config/config-simulation — กัน Auditor/Admin ที่มีแค่ firmware.Read
    // เรียก simulate ได้โดยไม่ตั้งใจ) ----
    grant('FirmwareEngineer', 'firmware-simulation', 'Read'),
    // QAEngineer ดูผลทดสอบ/simulation ก่อนตัดสินใจอนุมัติคุณภาพ (docs/13 §3.1)
    grant('QAEngineer', 'firmware-simulation', 'Read'),
    grant('Operation', 'firmware-simulation', 'Read'),
    grant('ST', 'firmware-simulation', 'Read'),
    grant('OT', 'firmware-simulation', 'Read'),

    // ---- firmware-decision (ใหม่ทั้งหมด — Firmware Approval Lifecycle,
    // docs/13 §3.2) — QAEngineer อนุมัติ/ปฏิเสธคุณภาพ Firmware ก่อนใช้ใน
    // Campaign ได้จริง มิเรอร์ pattern เดียวกับ 'config-decision' ของ
    // ConfigEngineer ด้านบน (resource แยกจาก 'firmware' ธรรมดาโดยตั้งใจ
    // เหตุผลเดียวกัน — คนละ action จากการแก้ไข field ปกติ)
    grant('QAEngineer', 'firmware-decision', 'Approve'),

    // ---- campaign (Sprint 3 #21 — Campaign Wizard) ----
    // RBAC_Matrix.md §2 แถว "Campaign Wizard": Operation = C, R, U (U ยังไม่มี
    // endpoint จริง — รอ Campaign Monitor แถวที่ 22) role อื่นทั้งหมด = R
    // แก้ครั้งที่ 39 — เพิ่ม Approve (Campaign Approval) ให้ Operation เท่านั้น
    // เหมือน Create/Read เดิม (SoD check ว่าห้ามอนุมัติของตัวเองอยู่ใน service
    // layer ไม่ใช่ grant นี้ — grant แค่บอกว่า role Operation ใช้ endpoint
    // approve/reject ได้ ไม่ได้บอกว่า instance ไหนอนุมัติได้บ้าง)
    grant('ConfigEngineer', 'campaign', 'Read'),
    grant('Operation', 'campaign', 'Create'),
    grant('Operation', 'campaign', 'Read'),
    grant('Operation', 'campaign', 'Approve'),
    grant('ST', 'campaign', 'Read'),
    grant('OT', 'campaign', 'Read'),
    grant('Auditor', 'campaign', 'Read'),
    grant('Admin', 'campaign', 'Read'),

    // ---- devices (getDeviceStatus — ทุก role อ่านได้) ----
    ...ALL_ROLE_CODES.map((roleCode) => grant(roleCode, 'devices', 'Read')),

    // ---- incidents (read-only list/detail — ทุก role อ่านได้) ----
    // RBAC_Matrix.md §2 แถว "Incident & Rollback" = R ทุกคอลัมน์ (SW/Operation/
    // ST/OT/Auditor/Admin/SuperAdmin) · Create/Update ยังไม่เปิดผ่าน API
    ...ALL_ROLE_CODES.map((roleCode) => grant(roleCode, 'incidents', 'Read')),

    // ---- audit-logs (GET /audit-logs — Sprint 3 #27) ----
    // RBAC_Matrix.md §2 แถว "Audit Log" = R ทุก Role ยกเว้น ConfigEngineer/
    // FirmwareEngineer/QAEngineer (เดิม SW ตัวเดียว — "-" ทั้งแถว ไม่มีสิทธิ์
    // เข้าถึงจอนี้เลย ทั้ง 3 role ที่แยกออกมาสืบทอดข้อจำกัดนี้เหมือนกันหมด)
    // SuperAdmin ได้อัตโนมัติจากการ copy สิทธิ์ Admin ด้านล่าง ไม่ต้องเพิ่มตรงนี้
    grant('Operation', 'audit-logs', 'Read'),
    grant('ST', 'audit-logs', 'Read'),
    grant('OT', 'audit-logs', 'Read'),
    grant('Auditor', 'audit-logs', 'Read'),
    grant('Admin', 'audit-logs', 'Read'),

    // ---- user-management (User / Role Management — บัญชีทั่วไปเท่านั้น,
    // RBAC_Matrix.md §2) — Admin เท่านั้น (SuperAdmin ได้อัตโนมัติจากการ copy
    // สิทธิ์ Admin ด้านล่าง) จัดการบัญชี Admin/SuperAdmin เองเป็นสิทธิ์แยก
    // (`admin-management`) ที่ยังไม่ finalize (docs/11) — ไม่ seed grant นี้ให้
    // role ไหนตอนนี้
    grant('Admin', 'user-management', 'Create'),
    grant('Admin', 'user-management', 'Read'),
    grant('Admin', 'user-management', 'Update'),

    // ---- device-model (DeviceModel registry — issue #209, docs/15) ----
    // Admin/SuperAdmin เท่านั้นที่สร้าง/แก้ได้ (master/reference data ที่
    // เพิ่มไม่บ่อย — mirror pattern เดียวกับ user-management ไม่ใช่
    // self-service แบบ config-definition ที่ ConfigEngineer เพิ่มบ่อยตามงาน
    // จริง) SuperAdmin ได้อัตโนมัติจากการ copy สิทธิ์ Admin ด้านล่าง —
    // `GET /device-models` **ไม่ต้องมี grant เลย** เพราะไม่มี PermissionGuard
    // (เปิดกว้างให้ทุก role ที่ login แล้วอ่านได้ mirror `GET /users`)
    grant('Admin', 'device-model', 'Create'),
    grant('Admin', 'device-model', 'Update'),
  ];

  // ---- SuperAdmin (docs/11 Part B) ----
  // = ทุก grant ที่ Admin มี — derive อัตโนมัติกันหลุด sync ถ้ามีการเพิ่มสิทธิ์
  // Admin ทีหลัง (SuperAdmin "ทำได้ทุกอย่างที่ Admin ทำ" ตาม RBAC_Matrix.md §1)
  // upsert idempotent อยู่แล้ว → grant ของ notifications/devices ที่ ALL_ROLE_CODES
  // ให้ SuperAdmin ไปแล้วข้างบน ซ้ำได้ไม่เป็นไร
  for (const g of grants.filter((x) => x.roleCode === 'Admin')) {
    grants.push(grant('SuperAdmin', g.resource, g.action));
  }
  // สิทธิ์เฉพาะ SuperAdmin: อนุมัติ/ปฏิเสธคำขอลบ Config (docs/11 §5–6) — action
  // `Approve` ครอบทั้ง approve+reject (แพทเทิร์นเดียวกับ config:Approve) · endpoint
  // จริงมากับ Part A (โมดูล config, ทีม B) — grant ล่วงหน้าให้ handoff ไหลลื่น
  // admin-management / role-management เลื่อนไป seed พร้อม endpoint (Part B2)
  grants.push(
    grant('SuperAdmin', 'config-deletion', 'Read'),
    grant('SuperAdmin', 'config-deletion', 'Approve'),
  );

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
  //
  //    หลัง Semantic Validation (#26) merge เข้า main แล้ว `validateFields()`
  //    บล็อก (400) ทุก field ที่ไม่มีนิยามในคลัง — catalog ที่มีแค่ `APN` ตัว
  //    เดียวทำให้สร้าง/แก้ Config เกือบทุกอันไม่ได้ (kittiphong เปิด issue #68
  //    [Blocker] + ฝากไว้ใน review PR #62) จึง seed 3 ชุดตรงนี้:
  //      (ก) `APN` — นิยามชัดเจน (`unknownSpec: false`, required)
  //      (ข) `UNKNOWN_SPEC_LEGACY_FIELDS` — ชื่อ field ยืนยันจริง 9 ตัว
  //          แต่ยังไม่รู้กฎ semantic (`unknownSpec: true`)
  //      (ค) `REPRESENTATIVE_FIELDS` — ชุด parameter "ตัวแทน" สำหรับ dev/demo
  //          (ยังไม่ใช่สเปกจริง — ดูคอมเมนต์เต็มเหนือ array นั้น)
  //
  //    **ที่มาของชื่อ field:** `docs/planning/01_GPS_Build_Reference.md` §5 ("โปรโตคอลที่
  //    ยืนยันแล้วกับระบบเดิม `config.dtc.co.th:909`") ระบุตัวอย่าง field ที่
  //    ยืนยันแล้วว่ามีจริงในระบบเดิม: APN1, MTYP, SIM1, SEV1, RS232, PROD, COMP
  //    (+ APN2/SIM2 คู่ dual-SIM ตามที่ kittiphong ระบุใน #68) — **ยืนยันแค่
  //    "ชื่อ" เท่านั้น** เอกสารสเปกฟิลด์เต็ม (~262 ค่า) จากพี่ในทีมยังไม่เข้า
  //    repo และ GPS_Data_Dictionary.xlsx เก็บแค่ schema ของตาราง
  //    CONFIG_DEFINITION ไม่ได้เก็บนิยามราย parameter → catalog นี้ยังไม่ครบ
  //    ตาม #68 ทั้งหมด (ส่วนที่เหลือรอเอกสารต้นฉบับ)
  //
  //    **ที่มาของ dataType:** ระบบเดิมเป็น Text-based Key-Value ผ่าน TCP
  //    (Build Reference §5) — ทุกค่าเป็น string บนสาย field เหล่านี้เป็น
  //    identifier/endpoint/โหมด ไม่มีตัวไหนที่ต้องเป็นตัวเลข จึงใส่ `string`
  //    (ไม่ใช่การเดา type จากชื่อ) ส่วนกฎ semantic ที่ลึกกว่านั้น (allowedValues
  //    / required / ช่วงค่า) ยัง **ไม่รู้** → mark `unknownSpec: true` ตาม
  //    Phase 1 ข้อ 2 ("ที่เหลือ mark เป็น unknown_spec: true ไว้ในตาราง")
  //    เทียบกับ `APN` ที่ `unknownSpec: false` (รู้กฎชัดว่าเป็น APN string
  //    บังคับกรอก) — flag นี้คือ Metadata "รู้กฎ vs รู้แค่ Data Type" ที่
  //    Checkpoint Phase 1 ข้อ 6 ต้องการ
  // ---------------------------------------------------------------------
  const KNOWN_LEGACY_MODEL = { deviceModel: 'GT06N', protocol: 'TCP' };
  // รุ่นที่สองสำหรับ demo การผูก field เข้าหลาย (deviceModel, protocol) —
  // GT06L อยู่ในตระกูลเดียวกับ GT06N ใช้โปรโตคอล text KV ผ่าน TCP เหมือนกัน
  const SECONDARY_LEGACY_MODEL = { deviceModel: 'GT06L', protocol: 'TCP' };

  // field ที่ยืนยันแค่ชื่อจาก Build Reference §5 — dataType=string (โปรโตคอล
  // text KV), unknownSpec=true (ยังไม่รู้กฎ semantic), ไม่บังคับกรอก
  //
  // APN2/SIM2 ไม่ได้อยู่ในรายการตัวอย่าง §5 ตรงๆ แต่ kittiphong ระบุใน issue
  // #68 ("APN1/2") + อุปกรณ์ tracker เป็น dual-SIM มาตรฐาน (ช่อง 2 คู่กับช่อง
  // 1) — เพิ่มเป็นคู่ให้ครบ ยัง unknownSpec เหมือนกัน
  // category/restartRequired เพิ่มตาม PDF §5.1 (ดู comment เหนือ model
  // ConfigFieldDefinition ใน schema.prisma) — sensitive ไม่มีตัวไหนในกลุ่มนี้
  // เป็นค่าลับ จึงไม่ต้องระบุต่อรายการ (default false)
  const UNKNOWN_SPEC_LEGACY_FIELDS: {
    fieldName: string;
    note: string;
    category: string;
    restartRequired: boolean;
  }[] = [
    {
      fieldName: 'APN1',
      note: 'APN สำหรับ SIM ช่อง 1',
      category: 'Network',
      restartRequired: true,
    },
    {
      fieldName: 'APN2',
      note: 'APN สำหรับ SIM ช่อง 2 (dual-SIM)',
      category: 'Network',
      restartRequired: true,
    },
    {
      fieldName: 'MTYP',
      note: 'ประเภท/โหมดการทำงานของอุปกรณ์ (module type)',
      category: 'General',
      restartRequired: false,
    },
    {
      fieldName: 'SIM1',
      note: 'ค่าที่เกี่ยวกับ SIM ช่อง 1',
      category: 'Network',
      restartRequired: true,
    },
    {
      fieldName: 'SIM2',
      note: 'ค่าที่เกี่ยวกับ SIM ช่อง 2 (dual-SIM)',
      category: 'Network',
      restartRequired: true,
    },
    {
      fieldName: 'SEV1',
      note: 'ปลายทาง server หลัก (host:port) ช่อง 1',
      category: 'Server',
      restartRequired: true,
    },
    {
      fieldName: 'RS232',
      note: 'การตั้งค่าพอร์ต RS232',
      category: 'Hardware',
      restartRequired: false,
    },
    {
      fieldName: 'PROD',
      note: 'รหัส/ชื่อรุ่นผลิตภัณฑ์',
      category: 'General',
      restartRequired: false,
    },
    {
      fieldName: 'COMP',
      note: 'ค่าที่เกี่ยวกับ compatibility ของอุปกรณ์',
      category: 'General',
      restartRequired: false,
    },
  ];

  // -------------------------------------------------------------------
  //  ชุด parameter "ตัวแทน" สำหรับ dev / demo — ยังไม่ใช่สเปกฟิลด์จริง
  // -------------------------------------------------------------------
  //  โปรเจกต์นี้ยังไม่ได้รับเอกสารสเปก config field ตัวจริง (~262 ค่า) จาก
  //  ทีมระบบเดิม (ดู issue #68) — catalog ที่มีแค่ APN + ชื่อ field ยืนยัน 9
  //  ตัว (unknown_spec) ทำให้ทดสอบ Config flow / validation ได้เคสเดียว
  //
  //  ชุดนี้เป็น parameter ที่ "เป็นตัวแทนได้" ของ GPS tracker ตระกูล GT06 —
  //  ชื่อ / dataType / allowedValues อ้างอิงความสามารถมาตรฐานของอุปกรณ์กลุ่ม
  //  นี้ (network/server/report interval/digital I/O/CAN ฯลฯ) เพื่อให้ Web
  //  Config Editor + simulate + Semantic Validation มีข้อมูลพอ demo ได้ครบ
  //  ทุก branch (dataType string/number/boolean, allowedValues, หลาย
  //  deviceModel)
  //
  //  **กติกา (CLAUDE.md — ห้ามเบี่ยงจาก Data Dictionary เงียบๆ):**
  //  - `unknownSpec: false` เพราะ "ภายในชุด mock นี้" กฎครบ (validateFields
  //    บังคับ dataType/allowedValues ได้จริง) — คำเตือนว่าเป็น mock อยู่ใน
  //    `description` ของทุกตัว ไม่ใช่ที่ flag นี้
  //  - `required: false` ทุกตัว — ความจำเป็นรายฟิลด์ต่อรุ่นเป็นข้อมูลที่ยัง
  //    ไม่รู้จริง ไม่เดา (APN ตัวเดียวที่ `required: true` ตามที่ยืนยันใน #68)
  //  - เมื่อได้เอกสารจริง: **เพิ่ม** field ใหม่ในชุดนี้ได้เลย (ลูป upsert ด้าน
  //    ล่างเป็น insert-only — `update: {}`) แต่ถ้าจะ**แก้ค่าเดิมทับ** (เช่น
  //    เปลี่ยน dataType/allowedValues/required ของ field ที่ seed ไปแล้ว) ต้อง
  //    แก้ `update: {}` ในลูปให้ใส่ field ที่จะอัปเดตด้วย ไม่งั้นรัน seed ซ้ำบน
  //    DB เดิมจะไม่เปลี่ยน — และปรับ `description` ออกจาก "(ชุดตัวแทน)"
  const REPRESENTATIVE_FIELDS: {
    fieldName: string;
    dataType: 'string' | 'number' | 'boolean';
    allowedValues: string[];
    description: string;
    /** หน่วยของค่า (metadata แสดงผลข้าง input ตอนสร้าง Config — frame 08) */
    unit?: string;
    // category ตาม PDF §5.1 (ตัวอย่าง: GPS, Network, Server, CAN, Sensor,
    // Camera, Security — ที่นี่เพิ่ม General/Hardware/Power ให้ครอบกลุ่มที่
    // PDF ไม่มีตัวอย่างตรงๆ เพราะ field ไม่ใช่ enum) sensitive/restartRequired
    // default false ถ้าไม่ระบุ (ส่วนใหญ่ของชุดนี้ไม่ใช่ค่าลับและไม่ต้อง restart)
    category: string;
    sensitive?: boolean;
    restartRequired?: boolean;
    supportedModels: { deviceModel: string; protocol: string }[];
  }[] = [
    // ── เครือข่าย / GPRS ──
    {
      fieldName: 'APN_USER',
      dataType: 'string',
      allowedValues: [],
      description: 'ชื่อผู้ใช้ APN (ถ้าผู้ให้บริการกำหนด)',
      category: 'Network',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'APN_PASSWORD',
      dataType: 'string',
      allowedValues: [],
      description: 'รหัสผ่าน APN (ถ้าผู้ให้บริการกำหนด)',
      category: 'Network',
      sensitive: true,
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── เซิร์ฟเวอร์ปลายทาง ──
    {
      fieldName: 'SERVER_HOST',
      dataType: 'string',
      allowedValues: [],
      description: 'hostname หรือ IP ของเซิร์ฟเวอร์รับข้อมูลหลัก',
      category: 'Server',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'SERVER_PORT',
      dataType: 'number',
      allowedValues: [],
      description: 'พอร์ต TCP ของเซิร์ฟเวอร์รับข้อมูลหลัก',
      unit: 'พอร์ต',
      category: 'Server',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'BACKUP_SERVER_HOST',
      dataType: 'string',
      allowedValues: [],
      description: 'hostname หรือ IP ของเซิร์ฟเวอร์สำรอง',
      category: 'Server',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'TRANSPORT_PROTOCOL',
      dataType: 'string',
      allowedValues: ['TCP', 'UDP'],
      description: 'โปรโตคอลขาส่งข้อมูลขึ้นเซิร์ฟเวอร์',
      category: 'Server',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── การรายงานตำแหน่ง ──
    {
      fieldName: 'REPORT_INTERVAL_MOVING',
      dataType: 'number',
      allowedValues: [],
      description: 'ช่วงเวลารายงานตำแหน่งขณะรถเคลื่อนที่ (วินาที)',
      unit: 'วินาที',
      category: 'GPS',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'REPORT_INTERVAL_IDLE',
      dataType: 'number',
      allowedValues: [],
      description: 'ช่วงเวลารายงานตำแหน่งขณะรถจอด (วินาที)',
      unit: 'วินาที',
      category: 'GPS',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'HEADING_CHANGE_REPORT',
      dataType: 'number',
      allowedValues: [],
      description: 'องศาการเปลี่ยนทิศที่กระตุ้นให้ส่งรายงานเพิ่ม (องศา)',
      unit: 'องศา',
      category: 'GPS',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'GNSS_MODE',
      dataType: 'string',
      allowedValues: ['GPS', 'GPS_GLONASS', 'GPS_BEIDOU'],
      description: 'ชุดระบบดาวเทียมที่ให้โมดูลใช้หาตำแหน่ง',
      category: 'GPS',
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    // ── เซนเซอร์ / ดิจิทัล I/O ──
    {
      fieldName: 'IGNITION_DETECT_SOURCE',
      dataType: 'string',
      allowedValues: ['ACC_WIRE', 'VOLTAGE', 'MOTION'],
      description: 'วิธีที่อุปกรณ์ใช้ตัดสินว่ารถติดเครื่องอยู่หรือไม่',
      category: 'Sensor',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'DIGITAL_INPUT_1',
      dataType: 'string',
      allowedValues: ['NONE', 'SOS', 'DOOR', 'PANIC'],
      description: 'ฟังก์ชันที่ผูกกับพอร์ตอินพุตดิจิทัลช่อง 1',
      category: 'Sensor',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'DIGITAL_OUTPUT_1',
      dataType: 'string',
      allowedValues: ['NONE', 'ENGINE_CUT', 'BUZZER'],
      description: 'ฟังก์ชันที่ผูกกับพอร์ตเอาต์พุตดิจิทัลช่อง 1',
      category: 'Sensor',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── โหมดประหยัดพลังงาน ──
    {
      fieldName: 'SLEEP_MODE',
      dataType: 'string',
      allowedValues: ['NONE', 'TIME', 'MOTION', 'DEEP'],
      description: 'เงื่อนไขที่ให้อุปกรณ์เข้าสู่โหมดประหยัดพลังงาน',
      category: 'Power',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'LOW_BATTERY_THRESHOLD',
      dataType: 'number',
      allowedValues: [],
      description: 'เปอร์เซ็นต์แบตเตอรี่สำรองที่จะแจ้งเตือน low battery',
      unit: '%',
      category: 'Power',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── ความปลอดภัย ──
    {
      fieldName: 'COMMAND_PASSWORD',
      dataType: 'string',
      allowedValues: [],
      description: 'รหัสผ่านสำหรับสั่งงานอุปกรณ์ผ่าน SMS / แพลตฟอร์ม',
      category: 'Security',
      sensitive: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'SOS_NUMBER_1',
      dataType: 'string',
      allowedValues: [],
      description: 'เบอร์โทรปลายทางลำดับที่ 1 เมื่อกดปุ่ม SOS',
      category: 'Security',
      sensitive: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── พฤติกรรมการเก็บข้อมูล ──
    {
      fieldName: 'MILEAGE_COUNTER_ENABLED',
      dataType: 'boolean',
      allowedValues: [],
      description: 'เปิดการสะสมเลขไมล์สะสม (odometer) ในตัวอุปกรณ์',
      category: 'General',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'STATIC_DRIFT_FILTER',
      dataType: 'boolean',
      allowedValues: [],
      description: 'กรองการกระเพื่อมของพิกัด GPS ขณะรถจอดนิ่ง',
      category: 'GPS',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── CAN / OBD ──
    {
      fieldName: 'CAN_BUS_ENABLED',
      dataType: 'boolean',
      allowedValues: [],
      description: 'เปิดการอ่านข้อมูลจากสาย CAN bus / OBD ของรถ',
      category: 'CAN',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'OBD_PROTOCOL',
      dataType: 'string',
      allowedValues: ['AUTO', 'ISO15765', 'J1939', 'J1708'],
      description: 'โปรโตคอล OBD ที่ให้อุปกรณ์ใช้คุยกับ ECU ของรถ',
      category: 'CAN',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
  ];

  const configFieldDefinitions: {
    fieldName: string;
    dataType: string;
    allowedValues: string[];
    required: boolean;
    unknownSpec: boolean;
    description: string;
    unit: string | null;
    // ST override ค่า field นี้บนอุปกรณ์ได้ไหม (issue #185) — ไม่ระบุ = false
    // (override ไม่ได้) มีแค่ APN ด้านล่างที่เปิดไว้เป็นตัวอย่าง demo/ทดสอบ
    stOverridable?: boolean;
    // category/sensitive/restartRequired เพิ่มตาม PDF §5.1 (ดู comment เหนือ
    // model ConfigFieldDefinition ใน schema.prisma) — mirror ที่มาแบบเดียวกับ
    // unit ด้านบน
    category: string | null;
    sensitive: boolean;
    restartRequired: boolean;
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
      unit: null,
      // เคสตัวอย่างที่พบบ่อยหน้างานจริง (ลูกค้าขอเปลี่ยน APN เพราะเปลี่ยน
      // ผู้ให้บริการซิม) — เปิด stOverridable ไว้ให้ demo/ทดสอบ #185 ได้ทันที
      // โดยไม่ต้องสร้าง field ใหม่ก่อน (field อื่นทั้งหมดยัง default false)
      stOverridable: true,
      category: 'Network',
      sensitive: false,
      restartRequired: true,
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    ...UNKNOWN_SPEC_LEGACY_FIELDS.map((f) => ({
      fieldName: f.fieldName,
      dataType: 'string',
      allowedValues: [],
      required: false,
      unknownSpec: true,
      description: `${f.note} — ยืนยันแค่ชื่อจาก Build Reference §5 ยังไม่มีสเปกเต็ม (unknown_spec)`,
      unit: null,
      category: f.category,
      sensitive: false,
      restartRequired: f.restartRequired,
      supportedModels: [KNOWN_LEGACY_MODEL],
    })),
    ...REPRESENTATIVE_FIELDS.map((f) => ({
      fieldName: f.fieldName,
      dataType: f.dataType,
      allowedValues: f.allowedValues,
      required: false,
      unknownSpec: false,
      description: `${f.description} — (ชุด parameter ตัวแทนสำหรับ dev/demo ยังไม่ใช่สเปกฟิลด์จริง ดู #68)`,
      unit: f.unit ?? null,
      category: f.category,
      sensitive: f.sensitive ?? false,
      restartRequired: f.restartRequired ?? false,
      supportedModels: f.supportedModels,
    })),
  ];

  for (const def of configFieldDefinitions) {
    const { supportedModels, ...fieldData } = def;
    const existing = await prisma.configFieldDefinition.upsert({
      where: { fieldName: def.fieldName },
      // ปกติลูปนี้ insert-only (`update: {}`) — ยกเว้น field ที่เพิ่มเป็น
      // คอลัมน์ใหม่ทีหลัง (unit, stOverridable, category, sensitive,
      // restartRequired) backfill ให้ DB เดิมตอน re-seed ได้ปลอดภัย
      update: {
        unit: fieldData.unit,
        stOverridable: fieldData.stOverridable ?? false,
        category: fieldData.category,
        sensitive: fieldData.sensitive,
        restartRequired: fieldData.restartRequired,
      },
      create: { ...fieldData, stOverridable: fieldData.stOverridable ?? false },
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

  // ---------------------------------------------------------------------
  // 5) Device ตัวอย่าง — ให้ dev/demo มีเลขเครื่องจริงไว้ยิง
  //    `POST /devices/{deviceId}/test-connection` และ `.../apply-config`
  //
  //    **`deviceId` ใช้รูปแบบ `DEV-00xx` ชั่วคราว** — kittiphong (B) ยืนยันว่า
  //    ยังไม่มี barcode scan / จอเลือกอุปกรณ์ในแผน (ช่างเปิดจาก Task ที่มี
  //    `Task.deviceId` ติดมา) รูปแบบเลขเครื่องจริงของระบบเดิม (IMEI / serial /
  //    ICCID) รอ Device Registration Flow ฝั่ง Mobile (Phase 5) — ตอนนั้นค่อย
  //    ปรับ seed + migration ให้ตรง
  //
  //    ทีม B ที่ทำ Task module: ใช้ deviceId ชุดนี้ตอน seed `Task.deviceId`
  //    ด้วย จะได้ทดสอบ apply-config ทะลุจาก Task ได้
  // ---------------------------------------------------------------------
  const demoDevices: {
    deviceId: string;
    simNumber: string;
    deviceModel: string;
    protocol: string;
    status: 'registered' | 'installed';
    // ชื่อบริษัทสมมติ (ดู demoCustomers ด้านล่าง) — undefined = ยังไม่ผูกลูกค้า
    // (docs/12_CustomerScope_Proposal.md เฟส B, PR #127) ตั้งชื่อเองล้วนๆ
    // **ห้ามใช้ชื่อ/ข้อมูลจริงจาก schema DMS เดิมที่พี่เลี้ยงให้มาเด็ดขาด**
    // (มี PII จริง เก็บไว้นอก repo เท่านั้น — ดู docs/12 §3.5)
    customerName?: string;
  }[] = [
    {
      deviceId: 'DEV-0001',
      simNumber: '0810000001',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
      customerName: 'ABC Logistics',
    },
    {
      deviceId: 'DEV-0002',
      simNumber: '0810000002',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
      customerName: 'ABC Logistics',
    },
    {
      deviceId: 'DEV-0003',
      simNumber: '0810000003',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: 'installed',
      customerName: 'Northern Fleet',
    },
    {
      deviceId: 'DEV-0004',
      simNumber: '0810000004',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
      // ไม่ผูกลูกค้า — ไว้ทดสอบ filter "ลูกค้า: ไม่ระบุ" / แถวที่ customerId null
    },
    // ยังไม่ติดตั้ง — ไว้ทดสอบ 409 ของ test-connection / apply-config
    {
      deviceId: 'DEV-0009',
      simNumber: '0810000009',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'registered',
    },
  ];

  // Customer ตัวอย่าง (docs/12_CustomerScope_Proposal.md เฟส B, PR #127) — ชื่อ
  // สมมติล้วนๆ ตาม mockup หน้า Device Search ที่ A ทำไว้ (ABC Logistics /
  // Northern Fleet / Metro Transit) ไม่ได้อิงจากข้อมูลลูกค้าจริงใดๆ — Metro
  // Transit ตั้งใจไม่ผูกกับ device ไหนเลย ไว้ทดสอบว่าลูกค้าที่ยังไม่มีอุปกรณ์
  // เลยก็ยังต้องโผล่ใน dropdown filter ได้ปกติ
  const demoCustomers = [
    { companyName: 'ABC Logistics' },
    { companyName: 'Northern Fleet' },
    { companyName: 'Metro Transit' },
  ];

  for (const c of demoCustomers) {
    await prisma.customer.upsert({
      where: { companyName: c.companyName },
      update: {},
      create: c,
    });
  }

  // DeviceModel registry (issue #209, docs/15) — canonical registry ของ
  // "รุ่นสินค้า" แทน string อิสระเดิม backfill จากค่า `deviceModel`/`protocol`
  // ที่ distinct อยู่แล้วในข้อมูลปัจจุบัน (`demoDevices` ด้านบน) ทั้งคู่ใช้
  // แค่ protocol เดียว (TCP) จริงตอนนี้ — ไม่ auto-map เดา ระบุตรงๆ ทีละรุ่น
  // ตามที่ตกลงไว้ (ห้าม auto-map เหมารวมแบบไม่ตรวจสอบ)
  const DEVICE_MODELS: {
    name: string;
    supportedProtocols: string[];
  }[] = [
    { name: 'GT06N', supportedProtocols: ['TCP'] },
    { name: 'GT06L', supportedProtocols: ['TCP'] },
  ];

  const deviceModelByName = new Map<string, { id: string }>();
  for (const m of DEVICE_MODELS) {
    const row = await prisma.deviceModel.upsert({
      where: { name: m.name },
      update: { supportedProtocols: m.supportedProtocols },
      create: m,
    });
    deviceModelByName.set(m.name, row);
  }

  for (const { customerName, ...d } of demoDevices) {
    const customer = customerName
      ? await prisma.customer.findUniqueOrThrow({
          where: { companyName: customerName },
        })
      : null;
    // modelId backfill (issue #209 migration step 1 — nullable ก่อน) — ทุก
    // deviceModel string ใน demoDevices ต้องมีคู่ใน DEVICE_MODELS เสมอ
    // (ถ้าไม่มีคือลืมเพิ่ม DEVICE_MODELS ตอนเพิ่ม demoDevice รุ่นใหม่ —
    // ให้พังทันทีตอน seed ดีกว่าเงียบๆ)
    const model = deviceModelByName.get(d.deviceModel);
    if (!model) {
      throw new Error(
        `demoDevices ใช้ deviceModel "${d.deviceModel}" ที่ไม่มีอยู่ใน DEVICE_MODELS — เพิ่มเข้า DEVICE_MODELS ก่อน`,
      );
    }
    await prisma.device.upsert({
      where: { deviceId: d.deviceId },
      // update ด้วย เพื่อ backfill modelId ให้แถวที่เคย seed ไว้ก่อนรอบนี้
      // (mirror pattern เดียวกับที่ configFieldDefinitions backfill unit/
      // stOverridable/category/sensitive/restartRequired ด้านบน)
      update: { modelId: model.id },
      create: {
        ...d,
        installedAt: d.status === 'installed' ? new Date() : null,
        customerId: customer?.id,
        modelId: model.id,
      },
    });
  }

  // ---------------------------------------------------------------------
  // 6) Config ตัวอย่างที่ approved/synced แล้ว — ให้ dev/demo มี Config ที่
  //    สร้างแคมเปญได้ทันที (`APPLICABLE_CONFIG_STATUSES` ใน
  //    device/config-applier.ts ต้องเป็น approved/synced เท่านั้น) ตรง
  //    deviceModel/protocol กับ demoDevices ด้านบนพอดี (GT06N/TCP ผูกกับ
  //    ABC Logistics, GT06L/TCP ผูกกับ Northern Fleet) จะได้ลองสร้างแคมเปญ
  //    ข้ามลูกค้าดูความแตกต่างของ filter ได้ด้วย
  // ---------------------------------------------------------------------
  const configEngineerUser = await prisma.user.findUniqueOrThrow({
    where: { username: 'config.test' },
  });
  const firmwareEngineerUser = await prisma.user.findUniqueOrThrow({
    where: { username: 'firmware.test' },
  });
  const operationUser = await prisma.user.findUniqueOrThrow({
    where: { username: 'operation.test' },
  });

  const demoConfigs: {
    name: string;
    deviceModel: string;
    protocol: string;
    status: 'approved' | 'synced';
    fields: Record<string, string>;
  }[] = [
    {
      name: 'GT06N/TCP มาตรฐาน',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'approved',
      fields: {
        APN: 'internet',
        SERVER_HOST: 'config.dtc.co.th',
        SERVER_PORT: '909',
      },
    },
    {
      name: 'GT06L/TCP มาตรฐาน',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: 'synced',
      fields: {
        APN: 'internet',
        SERVER_HOST: 'config.dtc.co.th',
        SERVER_PORT: '909',
      },
    },
  ];

  for (const c of demoConfigs) {
    await prisma.config.upsert({
      where: { name: c.name },
      update: {},
      create: {
        name: c.name,
        deviceModel: c.deviceModel,
        protocol: c.protocol,
        status: c.status,
        fields: c.fields,
        createdBy: configEngineerUser.id,
        approvedBy: operationUser.id,
      },
    });
  }

  // ---------------------------------------------------------------------
  // 7) Firmware ตัวอย่างที่ uploadStatus=stored — ให้ dev/demo ทดสอบสร้าง
  //    แคมเปญแบบ payloadType: Firmware ได้ทันที (แก้ไข 2026-09-14 — เปิดใช้
  //    งาน Firmware payload ใน Campaign) **หมายเหตุ:** insert ตรงผ่าน seed
  //    ไม่ได้อัปโหลดขึ้น MinIO จริง — objectKey ด้านล่างจึงไม่มีไฟล์จริงรออยู่
  //    ที่ Object Storage พอสำหรับทดสอบ flow สร้างแคมเปญ (ที่ไม่อ่านเนื้อไฟล์
  //    เลย) แต่ยังกดดาวน์โหลดไฟล์จริงไม่ได้ — ถ้าต้องการไฟล์จริงให้อัปโหลด
  //    ผ่าน `POST /firmware` ตามปกติแทน
  // ---------------------------------------------------------------------
  const demoFirmware: {
    version: string;
    deviceModelCompatibility: string[];
  }[] = [{ version: '2.4.1', deviceModelCompatibility: ['GT06N', 'GT06L'] }];

  for (const f of demoFirmware) {
    const existing = await prisma.firmware.findFirst({
      where: { version: f.version },
    });
    if (existing) continue;
    await prisma.firmware.create({
      data: {
        version: f.version,
        deviceModelCompatibility: f.deviceModelCompatibility,
        uploadStatus: 'stored',
        objectKey: `firmware/seed-${f.version}/firmware.bin`,
        originalFilename: 'firmware.bin',
        fileSizeBytes: 1024,
        uploadedBy: firmwareEngineerUser.id,
      },
    });
  }

  console.log(
    `Seeded ${INITIAL_ROLES.length} roles, ${testUsers.length} users, ${grants.length} permissions, ${configFieldDefinitions.length} config field definitions, ${demoCustomers.length} customers, ${demoDevices.length} devices, ${demoConfigs.length} configs, ${demoFirmware.length} firmware.`,
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
