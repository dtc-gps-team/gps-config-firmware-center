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

    // ---- device-config-apply (POST /devices/{deviceId}/apply-config) ----
    // ช่างหน้างานใส่ Config ที่อนุมัติแล้วเข้าอุปกรณ์ที่ติดตั้งจริง — ST/OT
    // เท่านั้น (mirror device-connection-test) SW/Operation ไม่ apply หน้างาน
    grant('ST', 'device-config-apply', 'Read'),
    grant('OT', 'device-config-apply', 'Read'),

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
  //    **ที่มาของชื่อ field:** `01_GPS_Build_Reference.md` §5 ("โปรโตคอลที่
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
  const UNKNOWN_SPEC_LEGACY_FIELDS: { fieldName: string; note: string }[] = [
    { fieldName: 'APN1', note: 'APN สำหรับ SIM ช่อง 1' },
    { fieldName: 'APN2', note: 'APN สำหรับ SIM ช่อง 2 (dual-SIM)' },
    { fieldName: 'MTYP', note: 'ประเภท/โหมดการทำงานของอุปกรณ์ (module type)' },
    { fieldName: 'SIM1', note: 'ค่าที่เกี่ยวกับ SIM ช่อง 1' },
    { fieldName: 'SIM2', note: 'ค่าที่เกี่ยวกับ SIM ช่อง 2 (dual-SIM)' },
    { fieldName: 'SEV1', note: 'ปลายทาง server หลัก (host:port) ช่อง 1' },
    { fieldName: 'RS232', note: 'การตั้งค่าพอร์ต RS232' },
    { fieldName: 'PROD', note: 'รหัส/ชื่อรุ่นผลิตภัณฑ์' },
    { fieldName: 'COMP', note: 'ค่าที่เกี่ยวกับ compatibility ของอุปกรณ์' },
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
    supportedModels: { deviceModel: string; protocol: string }[];
  }[] = [
    // ── เครือข่าย / GPRS ──
    {
      fieldName: 'APN_USER',
      dataType: 'string',
      allowedValues: [],
      description: 'ชื่อผู้ใช้ APN (ถ้าผู้ให้บริการกำหนด)',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'APN_PASSWORD',
      dataType: 'string',
      allowedValues: [],
      description: 'รหัสผ่าน APN (ถ้าผู้ให้บริการกำหนด)',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── เซิร์ฟเวอร์ปลายทาง ──
    {
      fieldName: 'SERVER_HOST',
      dataType: 'string',
      allowedValues: [],
      description: 'hostname หรือ IP ของเซิร์ฟเวอร์รับข้อมูลหลัก',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'SERVER_PORT',
      dataType: 'number',
      allowedValues: [],
      description: 'พอร์ต TCP ของเซิร์ฟเวอร์รับข้อมูลหลัก',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'BACKUP_SERVER_HOST',
      dataType: 'string',
      allowedValues: [],
      description: 'hostname หรือ IP ของเซิร์ฟเวอร์สำรอง',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'TRANSPORT_PROTOCOL',
      dataType: 'string',
      allowedValues: ['TCP', 'UDP'],
      description: 'โปรโตคอลขาส่งข้อมูลขึ้นเซิร์ฟเวอร์',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── การรายงานตำแหน่ง ──
    {
      fieldName: 'REPORT_INTERVAL_MOVING',
      dataType: 'number',
      allowedValues: [],
      description: 'ช่วงเวลารายงานตำแหน่งขณะรถเคลื่อนที่ (วินาที)',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'REPORT_INTERVAL_IDLE',
      dataType: 'number',
      allowedValues: [],
      description: 'ช่วงเวลารายงานตำแหน่งขณะรถจอด (วินาที)',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'HEADING_CHANGE_REPORT',
      dataType: 'number',
      allowedValues: [],
      description: 'องศาการเปลี่ยนทิศที่กระตุ้นให้ส่งรายงานเพิ่ม (องศา)',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'GNSS_MODE',
      dataType: 'string',
      allowedValues: ['GPS', 'GPS_GLONASS', 'GPS_BEIDOU'],
      description: 'ชุดระบบดาวเทียมที่ให้โมดูลใช้หาตำแหน่ง',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    // ── เซนเซอร์ / ดิจิทัล I/O ──
    {
      fieldName: 'IGNITION_DETECT_SOURCE',
      dataType: 'string',
      allowedValues: ['ACC_WIRE', 'VOLTAGE', 'MOTION'],
      description: 'วิธีที่อุปกรณ์ใช้ตัดสินว่ารถติดเครื่องอยู่หรือไม่',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'DIGITAL_INPUT_1',
      dataType: 'string',
      allowedValues: ['NONE', 'SOS', 'DOOR', 'PANIC'],
      description: 'ฟังก์ชันที่ผูกกับพอร์ตอินพุตดิจิทัลช่อง 1',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'DIGITAL_OUTPUT_1',
      dataType: 'string',
      allowedValues: ['NONE', 'ENGINE_CUT', 'BUZZER'],
      description: 'ฟังก์ชันที่ผูกกับพอร์ตเอาต์พุตดิจิทัลช่อง 1',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── โหมดประหยัดพลังงาน ──
    {
      fieldName: 'SLEEP_MODE',
      dataType: 'string',
      allowedValues: ['NONE', 'TIME', 'MOTION', 'DEEP'],
      description: 'เงื่อนไขที่ให้อุปกรณ์เข้าสู่โหมดประหยัดพลังงาน',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'LOW_BATTERY_THRESHOLD',
      dataType: 'number',
      allowedValues: [],
      description: 'เปอร์เซ็นต์แบตเตอรี่สำรองที่จะแจ้งเตือน low battery',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── ความปลอดภัย ──
    {
      fieldName: 'COMMAND_PASSWORD',
      dataType: 'string',
      allowedValues: [],
      description: 'รหัสผ่านสำหรับสั่งงานอุปกรณ์ผ่าน SMS / แพลตฟอร์ม',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'SOS_NUMBER_1',
      dataType: 'string',
      allowedValues: [],
      description: 'เบอร์โทรปลายทางลำดับที่ 1 เมื่อกดปุ่ม SOS',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── พฤติกรรมการเก็บข้อมูล ──
    {
      fieldName: 'MILEAGE_COUNTER_ENABLED',
      dataType: 'boolean',
      allowedValues: [],
      description: 'เปิดการสะสมเลขไมล์สะสม (odometer) ในตัวอุปกรณ์',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    {
      fieldName: 'STATIC_DRIFT_FILTER',
      dataType: 'boolean',
      allowedValues: [],
      description: 'กรองการกระเพื่อมของพิกัด GPS ขณะรถจอดนิ่ง',
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    // ── CAN / OBD ──
    {
      fieldName: 'CAN_BUS_ENABLED',
      dataType: 'boolean',
      allowedValues: [],
      description: 'เปิดการอ่านข้อมูลจากสาย CAN bus / OBD ของรถ',
      supportedModels: [KNOWN_LEGACY_MODEL, SECONDARY_LEGACY_MODEL],
    },
    {
      fieldName: 'OBD_PROTOCOL',
      dataType: 'string',
      allowedValues: ['AUTO', 'ISO15765', 'J1939', 'J1708'],
      description: 'โปรโตคอล OBD ที่ให้อุปกรณ์ใช้คุยกับ ECU ของรถ',
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
      supportedModels: [KNOWN_LEGACY_MODEL],
    },
    ...UNKNOWN_SPEC_LEGACY_FIELDS.map((f) => ({
      fieldName: f.fieldName,
      dataType: 'string',
      allowedValues: [],
      required: false,
      unknownSpec: true,
      description: `${f.note} — ยืนยันแค่ชื่อจาก Build Reference §5 ยังไม่มีสเปกเต็ม (unknown_spec)`,
      supportedModels: [KNOWN_LEGACY_MODEL],
    })),
    ...REPRESENTATIVE_FIELDS.map((f) => ({
      fieldName: f.fieldName,
      dataType: f.dataType,
      allowedValues: f.allowedValues,
      required: false,
      unknownSpec: false,
      description: `${f.description} — (ชุด parameter ตัวแทนสำหรับ dev/demo ยังไม่ใช่สเปกฟิลด์จริง ดู #68)`,
      supportedModels: f.supportedModels,
    })),
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
  }[] = [
    {
      deviceId: 'DEV-0001',
      simNumber: '0810000001',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
    },
    {
      deviceId: 'DEV-0002',
      simNumber: '0810000002',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
    },
    {
      deviceId: 'DEV-0003',
      simNumber: '0810000003',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: 'installed',
    },
    {
      deviceId: 'DEV-0004',
      simNumber: '0810000004',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: 'installed',
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

  for (const d of demoDevices) {
    await prisma.device.upsert({
      where: { deviceId: d.deviceId },
      update: {},
      create: {
        ...d,
        installedAt: d.status === 'installed' ? new Date() : null,
      },
    });
  }

  console.log(
    `Seeded ${INITIAL_ROLES.length} roles, ${testUsers.length} users, ${grants.length} permissions, ${configFieldDefinitions.length} config field definitions, ${demoDevices.length} devices.`,
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
