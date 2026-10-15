import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

// รันผ่าน plain `ts-node` (ไม่ผ่าน prisma.config.ts) จึงต้องโหลด root .env เอง
// convention เดียวกับ scripts/seed-ci-fixtures.ts
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * ข้อมูลตัวอย่างสำหรับ demo / รีวิวกับพี่เลี้ยง / ทดสอบร่วม Mobile กับ Web
 * (`npm run seed:demo`) — ต้องสั่งเอง ไม่รันอัตโนมัติ ไม่กระทบ `prisma db seed`
 *
 * ทำไมต้องอยู่ใน repo: เดิมสคริปต์อยู่นอก repo ข้อมูลตัวอย่างเลยมีแค่ใน DB
 * เครื่องของ A ส่วน DB ของ B มีแต่เครื่อง seed รุ่นเก่า คุยงานจากภาพหน้าจอแล้ว
 * เห็นข้อมูลไม่ตรงกัน (เช่น IMEI/Serial/Blackbox ID ว่างหมดในเครื่อง B)
 *
 * กติกาข้อมูล:
 * - อุปกรณ์ทุกเครื่องมี IMEI, Serial Number และ Blackbox ID ครบ (บังคับกรอก
 *   ตามมติ A กับ B 13 ต.ค. 2569)
 * - `hardwareRevisionCode` ว่าง = รุ่นมาตรฐาน มีค่า = รุ่นพิเศษ
 * - ข้อความที่ผู้ใช้เห็นไม่มี em dash, จุดคั่นกลาง หรือป้าย "(ข้อมูลตัวอย่าง)"
 * - ชื่อบริษัท/คน/เบอร์เป็นค่าสมมติทั้งหมด ห้ามใช้ข้อมูลจริงจากระบบเดิม
 *
 * รันซ้ำได้: ข้ามแถวที่มีอยู่แล้ว (ดูจาก key ของแต่ละชนิด) ยกเว้นเติม IMEI/
 * Serial/Blackbox ID ให้เครื่องตัวอย่างที่ยังว่าง (DB ที่ seed ไว้ก่อนกติกาใหม่)
 * ค่าสุ่มใช้ seed คงที่ ทุกเครื่องที่รันบน DB ว่างจะได้ข้อมูลชุดเดียวกัน
 *
 * ต้องรัน `prisma db seed` ก่อน (ต้องมี user ทดสอบ, Config/โมเดล GT06N/GT06L
 * และ Config field definition จาก seed หลัก)
 */
const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days: number, hours = 0) =>
  new Date(NOW - days * DAY - hours * 60 * 60 * 1000);

let rndState = 42;
const rnd = () => {
  rndState = (rndState * 1103515245 + 12345) % 2147483648;
  return rndState / 2147483648;
};
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
const ip = () =>
  `10.20.${1 + Math.floor(rnd() * 8)}.${10 + Math.floor(rnd() * 200)}`;

type AuditRow = {
  userId: string;
  auditModule: string;
  action: string;
  createdAt: Date;
  ipAddress: string;
  metadata?: Record<string, unknown>;
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo.ts ห้ามรันบน production');
  }

  const users = Object.fromEntries(
    (await prisma.user.findMany({ select: { id: true, username: true } })).map(
      (u) => [u.username, u.id],
    ),
  );
  const need = [
    'config.test',
    'firmware.test',
    'qa.test',
    'operation.test',
    'operation2.test',
    'st.test',
    'ot.test',
    'admin.test',
  ];
  for (const n of need) {
    if (!users[n]) {
      throw new Error(`ไม่พบ user ${n} ต้องรัน prisma db seed ก่อน`);
    }
  }
  const U = {
    ce: users['config.test'],
    fe: users['firmware.test'],
    qa: users['qa.test'],
    op: users['operation.test'],
    op2: users['operation2.test'],
    st: users['st.test'],
    ot: users['ot.test'],
    admin: users['admin.test'],
  };

  const audit: AuditRow[] = [];
  const log = (
    userId: string,
    auditModule: string,
    action: string,
    at: Date,
    metadata?: Record<string, unknown>,
  ) =>
    audit.push({
      userId,
      auditModule,
      action,
      createdAt: at,
      ipAddress: ip(),
      metadata,
    });

  // ---------------- Device models ----------------
  const modelDefs: Prisma.DeviceModelCreateInput[] = [
    {
      name: 'GT08-4G',
      manufacturer: 'DTC Hardware',
      supportedProtocols: ['TCP', 'UDP'],
      warrantyMonths: 24,
      notes: 'รุ่นหลักปี 2026 รองรับ 4G',
    },
    {
      name: 'VT300',
      manufacturer: 'DTC Hardware',
      supportedProtocols: ['TCP'],
      warrantyMonths: 18,
      notes: 'รุ่นสำหรับรถบรรทุก มี CAN bus',
    },
    {
      name: 'LT100',
      manufacturer: 'DTC Hardware',
      supportedProtocols: ['TCP'],
      warrantyMonths: 12,
      status: 'discontinued',
      endOfSupportDate: new Date('2027-06-30'),
      notes: 'เลิกผลิตแล้ว เครื่องเดิมยังใช้งานได้',
    },
  ];
  for (const m of modelDefs) {
    const existed = await prisma.deviceModel.findUnique({
      where: { name: m.name },
    });
    if (!existed) {
      await prisma.deviceModel.create({ data: m });
      log(U.admin, 'device-model', 'create', ago(28), { name: m.name });
    }
  }
  const models = Object.fromEntries(
    (await prisma.deviceModel.findMany()).map((m) => [m.name, m]),
  );
  for (const name of ['GT06N', 'GT06L']) {
    if (!models[name]) {
      throw new Error(`ไม่พบโมเดล ${name} ต้องรัน prisma db seed ก่อน`);
    }
  }

  // field ที่โมเดลใหม่รองรับ เพื่อให้หน้าสร้าง Config แสดง field ได้
  const coreFields = [
    'APN',
    'SERVER_HOST',
    'SERVER_PORT',
    'REPORT_INTERVAL_MOVING',
    'REPORT_INTERVAL_IDLE',
    'SLEEP_MODE',
    'GNSS_MODE',
    'TRANSPORT_PROTOCOL',
    'LOW_BATTERY_THRESHOLD',
    'SOS_NUMBER_1',
    'CAN_BUS_ENABLED',
  ];
  const defs = await prisma.configFieldDefinition.findMany({
    where: { fieldName: { in: coreFields } },
  });
  for (const [deviceModel, protocol] of [
    ['GT08-4G', 'TCP'],
    ['GT08-4G', 'UDP'],
    ['VT300', 'TCP'],
    ['LT100', 'TCP'],
  ]) {
    for (const d of defs) {
      await prisma.configFieldDefinitionModelSupport.upsert({
        where: {
          fieldDefinitionId_deviceModel_protocol: {
            fieldDefinitionId: d.id,
            deviceModel,
            protocol,
          },
        },
        update: {},
        create: { fieldDefinitionId: d.id, deviceModel, protocol },
      });
    }
  }

  // ---------------- Customers ----------------
  const customerDefs = [
    {
      companyName: 'สยามขนส่ง จำกัด',
      contactName: 'คุณสมชาย ใจดี',
      phone: '02-555-0101',
      priorityTier: 'A',
    },
    {
      companyName: 'เชียงใหม่โลจิสติกส์',
      contactName: 'คุณวรรณา ศรีสุข',
      phone: '053-555-0102',
      priorityTier: 'B',
    },
    {
      companyName: 'รถเย็นไทย จำกัด',
      contactName: 'คุณประเสริฐ มั่นคง',
      phone: '02-555-0103',
      priorityTier: 'A',
    },
    {
      companyName: 'ภูเก็ตทัวร์แอนด์ทรานสปอร์ต',
      contactName: 'คุณอรุณี ทะเลงาม',
      phone: '076-555-0104',
      priorityTier: 'C',
    },
    {
      companyName: 'อีสานคาร์โก้',
      contactName: 'คุณบุญมี แสนดี',
      phone: '043-555-0105',
      priorityTier: 'B',
    },
  ];
  for (const c of customerDefs) {
    await prisma.customer.upsert({
      where: { companyName: c.companyName },
      update: {},
      create: c,
    });
  }
  const customers = Object.fromEntries(
    (await prisma.customer.findMany()).map((c) => [c.companyName, c]),
  );
  const custNames = customerDefs.map((c) => c.companyName);

  // ---------------- Firmware ----------------
  const fwDefs: {
    version: string;
    compat: string[];
    approval: 'approved' | 'rejected' | 'pending_review';
    up: Date;
  }[] = [
    {
      version: '2.4.2',
      // รวม GT08-4G เพราะ 2.4.2 เป็นเป้า Rollback ของ Rollout 2.5.0 บนเครื่อง
      // GT08-4G และเป็น Firmware ที่ช่างขอ Override ถอยกลับ (DEV-0126) ถ้าไม่
      // รองรับ API จริงจะปฏิเสธด้วย assertFirmwareInstallable (รีวิว B บน #304)
      compat: ['GT06N', 'GT06L', 'GT08-4G'],
      approval: 'approved',
      up: ago(26),
    },
    {
      version: '2.5.0',
      compat: ['GT06N', 'GT06L', 'GT08-4G'],
      approval: 'approved',
      up: ago(14),
    },
    { version: '1.2.0', compat: ['VT300'], approval: 'approved', up: ago(20) },
    { version: '2.3.9', compat: ['GT06N'], approval: 'rejected', up: ago(29) },
    {
      version: '3.0.0-beta',
      compat: ['GT08-4G'],
      approval: 'pending_review',
      up: ago(2),
    },
  ];
  const fw: Record<string, { id: string }> = {};
  for (const f of fwDefs) {
    let row = await prisma.firmware.findFirst({
      where: { version: f.version },
    });
    if (!row) {
      row = await prisma.firmware.create({
        data: {
          version: f.version,
          deviceModelCompatibility: f.compat,
          uploadStatus: 'stored',
          objectKey: `firmware/demo-${f.version}/firmware.bin`,
          originalFilename: `fw_${f.version}.bin`,
          fileSizeBytes: 900000 + Math.floor(rnd() * 600000),
          uploadedBy: U.fe,
          uploadedAt: f.up,
          approvalStatus: f.approval,
          approvedBy: f.approval === 'pending_review' ? null : U.qa,
        },
      });
      log(U.fe, 'firmware', 'upload', f.up, { version: f.version });
      if (f.approval !== 'pending_review') {
        log(
          U.qa,
          'firmware',
          f.approval === 'approved' ? 'approve' : 'reject',
          new Date(f.up.getTime() + DAY),
          { version: f.version },
        );
      }
    }
    // แถวตัวอย่างที่ seed ไว้ก่อนแก้ compat: ปรับให้ตรง (เฉพาะแถวที่ผูกกับ
    // objectKey ของสคริปต์นี้ ไม่แตะ Firmware ที่ผู้ใช้อัปโหลดเอง)
    if (
      row.objectKey.startsWith('firmware/demo-') &&
      [...row.deviceModelCompatibility].sort().join(',') !==
        [...f.compat].sort().join(',')
    ) {
      row = await prisma.firmware.update({
        where: { id: row.id },
        data: { deviceModelCompatibility: f.compat },
      });
    }
    fw[f.version] = row;
  }

  // ---------------- Devices ----------------
  // 40 เครื่อง DEV-0101 ถึง DEV-0140 · index 36 ขึ้นไปยังไม่ติดตั้ง
  const deviceModelPlan = [
    ...Array<string>(14).fill('GT06N'),
    ...Array<string>(8).fill('GT06L'),
    ...Array<string>(10).fill('GT08-4G'),
    ...Array<string>(6).fill('VT300'),
    ...Array<string>(2).fill('LT100'),
  ];
  const fwFor: Record<string, string | null> = {
    GT06N: '2.4.2',
    GT06L: '2.4.2',
    'GT08-4G': '2.5.0',
    VT300: '1.2.0',
    LT100: null,
  };
  type DemoDevice = {
    deviceId: string;
    modelName: string;
    status: 'installed' | 'registered';
  };
  const devices: DemoDevice[] = [];
  let backfilled = 0;
  for (let i = 0; i < deviceModelPlan.length; i++) {
    const deviceId = `DEV-${String(101 + i).padStart(4, '0')}`;
    const modelName = deviceModelPlan[i];
    const status: DemoDevice['status'] = i >= 36 ? 'registered' : 'installed';
    const reg = ago(30 - (i % 20));
    const fwVersion = fwFor[modelName];
    const identity = {
      imei: `86${digits(13)}`,
      serialNumber: `SN${modelName.replace(/[^A-Z0-9]/g, '')}${digits(6)}`,
      blackboxId: `71${digits(8)}`,
    };
    const existing = await prisma.device.findUnique({ where: { deviceId } });
    if (!existing) {
      await prisma.device.create({
        data: {
          deviceId,
          simNumber: `08${digits(8)}`,
          deviceModel: modelName,
          protocol: modelName === 'GT08-4G' && i % 3 === 0 ? 'UDP' : 'TCP',
          ...identity,
          // ทุก 5 เครื่องมี 1 เครื่องเป็นรุ่นพิเศษ ที่เหลือเป็นรุ่นมาตรฐาน
          hardwareRevisionCode: i % 5 === 4 ? 'R2-SPECIAL' : null,
          status,
          registeredAt: reg,
          installedAt:
            status === 'installed' ? new Date(reg.getTime() + 2 * DAY) : null,
          customerId: customers[custNames[i % custNames.length]].id,
          modelId: models[modelName].id,
          partitionAFirmwareId:
            status === 'installed' && fwVersion ? fw[fwVersion].id : null,
        },
      });
      log(U.admin, 'device', 'register', reg, { deviceId });
    } else if (
      !existing.imei ||
      !existing.serialNumber ||
      !existing.blackboxId
    ) {
      // เติมเฉพาะช่องที่ยังว่าง ไม่ทับค่าที่มีอยู่แล้ว
      await prisma.device.update({
        where: { deviceId },
        data: {
          imei: existing.imei ?? identity.imei,
          serialNumber: existing.serialNumber ?? identity.serialNumber,
          blackboxId: existing.blackboxId ?? identity.blackboxId,
        },
      });
      backfilled += 1;
    }
    devices.push({ deviceId, modelName, status });
  }
  const installed = (modelName: string) =>
    devices.filter(
      (d) => d.status === 'installed' && d.modelName === modelName,
    );
  const byId = (deviceId: string) => {
    const d = devices.find((x) => x.deviceId === deviceId);
    if (!d) throw new Error(`ไม่พบ ${deviceId}`);
    return d;
  };

  // ---------------- Configs ----------------
  const baseFields = (model: string) => ({
    APN: 'internet',
    SERVER_HOST: 'config.dtc.co.th',
    SERVER_PORT: 909,
    REPORT_INTERVAL_MOVING: 30,
    REPORT_INTERVAL_IDLE: 300,
    SLEEP_MODE: 'MOTION',
    GNSS_MODE: model === 'GT08-4G' ? 'GPS_BEIDOU' : 'GPS',
  });
  const cfgDefs: {
    name: string;
    model: string;
    protocol: string;
    status: 'draft' | 'testing' | 'approved' | 'rejected' | 'synced';
    days: number;
    description: string;
    extra?: Record<string, unknown>;
    approver?: 'op' | 'op2';
    suggest?: boolean;
  }[] = [
    {
      name: 'GT08-4G/TCP มาตรฐาน',
      model: 'GT08-4G',
      protocol: 'TCP',
      status: 'synced',
      days: 22,
      approver: 'op2',
      description: 'ค่าตั้งต้นสำหรับเครื่อง GT08-4G ทุกคัน',
    },
    {
      name: 'VT300/TCP รถบรรทุก',
      model: 'VT300',
      protocol: 'TCP',
      status: 'synced',
      days: 21,
      approver: 'op',
      description: 'เปิดอ่านข้อมูล CAN bus สำหรับรถบรรทุก',
      extra: { CAN_BUS_ENABLED: true },
    },
    {
      name: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      model: 'GT06N',
      protocol: 'TCP',
      status: 'approved',
      days: 12,
      approver: 'op2',
      description:
        'รายงานตำแหน่งทุก 10 วินาที ลูกค้ารถเย็นต้องการติดตามละเอียด',
      extra: { REPORT_INTERVAL_MOVING: 10 },
    },
    {
      name: 'GT08-4G/UDP ประหยัดแบต',
      model: 'GT08-4G',
      protocol: 'UDP',
      status: 'approved',
      days: 10,
      approver: 'op2',
      description: 'ใช้ sleep mode แบบ deep และรายงานห่างขึ้นตอนรถจอด',
      extra: { SLEEP_MODE: 'DEEP', REPORT_INTERVAL_IDLE: 900 },
    },
    {
      name: 'GT06N/TCP ลดรอบรายงานกลางคืน',
      model: 'GT06N',
      protocol: 'TCP',
      status: 'approved',
      days: 4,
      approver: 'op',
      description: 'ลดการส่งข้อมูลตอนรถจอดเพื่อประหยัดค่าเน็ต',
      extra: { REPORT_INTERVAL_IDLE: 600 },
    },
    {
      name: 'GT06L/TCP เพิ่มปุ่ม SOS',
      model: 'GT06L',
      protocol: 'TCP',
      status: 'testing',
      days: 3,
      description: 'เพิ่มเบอร์โทรฉุกเฉินสำหรับปุ่ม SOS',
      extra: { SOS_NUMBER_1: '0812345678' },
      suggest: true,
    },
    {
      name: 'VT300/TCP เปิด CAN bus + ตัดน้ำมัน',
      model: 'VT300',
      protocol: 'TCP',
      status: 'draft',
      days: 1,
      description: 'เปิด CAN bus และแจ้งเตือนเมื่อแบตต่ำกว่า 20%',
      extra: { CAN_BUS_ENABLED: true, LOW_BATTERY_THRESHOLD: 20 },
    },
    {
      name: 'GT06N/TCP ทดลอง APN ใหม่',
      model: 'GT06N',
      protocol: 'TCP',
      status: 'draft',
      days: 1,
      description: 'ลองใช้ APN ของ True สำหรับซิม IoT',
      extra: { APN: 'iot.true' },
    },
    {
      name: 'GT08-4G/TCP สำหรับลูกค้าทัวร์',
      model: 'GT08-4G',
      protocol: 'TCP',
      status: 'draft',
      days: 0,
      description: 'รายงานทุก 15 วินาทีสำหรับรถทัวร์',
      extra: { REPORT_INTERVAL_MOVING: 15 },
    },
    {
      name: 'GT06L/TCP พอร์ตสำรอง',
      model: 'GT06L',
      protocol: 'TCP',
      status: 'rejected',
      days: 8,
      approver: 'op2',
      description: 'ทดลองย้ายไปพอร์ตสำรอง 9999',
      extra: { SERVER_PORT: 9999 },
    },
  ];
  const cfg: Record<string, { id: string }> = {};
  for (const c of cfgDefs) {
    let row = await prisma.config.findUnique({ where: { name: c.name } });
    const created = ago(c.days, 5);
    if (!row) {
      const approverId = c.approver ? U[c.approver] : null;
      const fields = { ...baseFields(c.model), ...(c.extra ?? {}) };
      row = await prisma.config.create({
        data: {
          name: c.name,
          deviceModel: c.model,
          protocol: c.protocol,
          status: c.status,
          description: c.description,
          fields,
          createdBy: U.ce,
          approvedBy: c.status === 'rejected' ? null : approverId,
          suggestedApproverId: c.suggest ? U.op : null,
          createdAt: created,
          updatedAt: created,
        },
      });
      log(U.ce, 'config', 'create', created, { name: c.name });
      if (c.status !== 'draft') {
        log(
          U.ce,
          'config',
          'decide',
          new Date(created.getTime() + 3 * 3600e3),
          {
            name: c.name,
            result: 'pass',
          },
        );
      }
      if ((c.status === 'approved' || c.status === 'synced') && approverId) {
        const approvedAt = new Date(created.getTime() + DAY);
        await prisma.configVersion.create({
          data: {
            configId: row.id,
            versionNumber: 1,
            fields,
            deviceModel: c.model,
            protocol: c.protocol,
            approvedBy: approverId,
            approvedAt,
          },
        });
        log(approverId, 'config', 'approve', approvedAt, { name: c.name });
      }
      if (c.status === 'rejected' && approverId) {
        log(approverId, 'config', 'reject', new Date(created.getTime() + DAY), {
          name: c.name,
          reason: 'พอร์ตไม่ตรงกับ server จริง',
        });
      }
    }
    cfg[c.name] = row;
  }

  // ---------------- Campaigns + rollouts ----------------
  async function campaign(
    name: string,
    description: string,
    deviceIds: string[],
    createdDays: number,
  ) {
    const found = await prisma.campaign.findFirst({ where: { name } });
    if (found) return null;
    const c = await prisma.campaign.create({
      data: {
        name,
        description,
        createdBy: U.op,
        createdAt: ago(createdDays),
        updatedAt: ago(createdDays),
      },
    });
    await prisma.campaignTarget.createMany({
      data: deviceIds.map((deviceId) => ({ campaignId: c.id, deviceId })),
    });
    log(U.op, 'campaign', 'create', ago(createdDays), { name });
    return c;
  }

  type TargetResult = 'success' | 'failed' | 'pending';
  async function rollout(
    c: { id: string; name: string },
    opts: {
      payloadType: 'Config' | 'Firmware';
      configId?: string;
      firmwareId?: string;
      status:
        | 'pending_approval'
        | 'approved'
        | 'rejected'
        | 'active'
        | 'paused'
        | 'completed';
      deviceIds: string[];
      results: TargetResult[];
      days: number;
      isRollback?: boolean;
      rollbackOfId?: string;
      /** ค่าเฉพาะเครื่องของ Rollout (docs/17) — deviceId -> fields */
      deviceValues?: Record<string, Record<string, unknown>>;
      deviceValuesReason?: string;
    },
  ) {
    const { status, days, results, deviceIds } = opts;
    const decided = status !== 'pending_approval';
    const released = ['active', 'paused', 'completed'].includes(status);
    const r = await prisma.campaignRollout.create({
      data: {
        campaignId: c.id,
        payloadType: opts.payloadType,
        configId: opts.configId ?? null,
        firmwareId: opts.firmwareId ?? null,
        status,
        isRollback: opts.isRollback ?? false,
        rollbackOfId: opts.rollbackOfId ?? null,
        targetCount: deviceIds.length,
        successCount: results.filter((x) => x === 'success').length,
        failureCount: results.filter((x) => x === 'failed').length,
        createdBy: U.op,
        approvedBy: decided && status !== 'rejected' ? U.op2 : null,
        approvedAt: decided && status !== 'rejected' ? ago(days, -2) : null,
        activeWindowStartedAt: released ? ago(days, -3) : null,
        deviceValuesReason: opts.deviceValuesReason ?? null,
        createdAt: ago(days),
        updatedAt: ago(Math.max(days - 1, 0)),
      },
    });
    const failReasons = [
      'timeout ระหว่างดาวน์โหลด',
      'checksum ไม่ตรง',
      'เครื่องรีบูตซ้ำหลังติดตั้ง',
    ];
    await prisma.campaignRolloutTarget.createMany({
      data: deviceIds.map((deviceId, i) => ({
        rolloutId: r.id,
        deviceId,
        status: results[i] ?? 'pending',
        resultDetail:
          results[i] === 'failed' ? failReasons[i % failReasons.length] : null,
        ...(opts.deviceValues?.[deviceId]
          ? {
              proposedFields: opts.deviceValues[
                deviceId
              ] as Prisma.InputJsonObject,
            }
          : {}),
      })),
    });
    log(
      U.op,
      'campaign',
      opts.isRollback ? 'rollback' : 'create-rollout',
      ago(days),
      {
        campaign: c.name,
        payloadType: opts.payloadType,
      },
    );
    if (decided) {
      log(
        U.op2,
        'campaign',
        status === 'rejected' ? 'reject' : 'approve',
        ago(days, -2),
        {
          campaign: c.name,
        },
      );
    }
    if (released) {
      log(U.op, 'campaign', 'release', ago(days, -3), { campaign: c.name });
    }
    return r;
  }

  const ids = (list: DemoDevice[]) => list.map((d) => d.deviceId);
  {
    const list = ids(installed('GT06N').slice(0, 9));
    const c = await campaign(
      'สยามขนส่ง อัปเดต Config รอบเดือนตุลาคม',
      'อัปเดตรอบรายงานให้ตรงกับสัญญาใหม่',
      list,
      9,
    );
    if (c) {
      await rollout(c, {
        payloadType: 'Config',
        configId: cfg['GT06N/TCP รายงานถี่ (รถเย็น)'].id,
        status: 'active',
        deviceIds: list,
        results: [...Array<TargetResult>(6).fill('success'), 'failed'],
        days: 6,
      });
    }
  }
  {
    const list = ids(installed('GT08-4G'));
    const c = await campaign(
      'เชียงใหม่โลจิสติกส์ อัปเกรด Firmware 2.5.0',
      'อัปเกรด Firmware แก้ปัญหา GPS drift',
      list,
      8,
    );
    if (c) {
      const paused = await rollout(c, {
        payloadType: 'Firmware',
        firmwareId: fw['2.5.0'].id,
        status: 'paused',
        deviceIds: list,
        results: [
          'success',
          'success',
          'failed',
          'success',
          'failed',
          'failed',
          'success',
          'failed',
        ],
        days: 5,
      });
      await rollout(c, {
        payloadType: 'Firmware',
        firmwareId: fw['2.4.2'].id,
        status: 'completed',
        deviceIds: list.slice(0, 4),
        results: Array<TargetResult>(4).fill('success'),
        days: 3,
        isRollback: true,
        rollbackOfId: paused.id,
      });
    }
  }
  {
    const list = ids(installed('GT06N').slice(9));
    const c = await campaign(
      'รถเย็นไทย ลดรอบรายงานช่วงกลางคืน',
      'ประหยัด data ช่วงรถจอด',
      list,
      2,
    );
    if (c) {
      // ตัวอย่างค่าเฉพาะเครื่อง (docs/17): 2 เครื่องมีค่าที่เสนอไว้ตอนสร้าง
      // Rollout (ยังไม่มีผลจนกว่าปล่อย) และเครื่องที่ 3 มี "ค่าพิเศษเดิม"
      // ที่ช่างขอไว้แล้วอนุมัติ ให้หน้าสร้าง Rollout รอบถัดไปมีของให้ยืนยัน
      await rollout(c, {
        payloadType: 'Config',
        configId: cfg['GT06N/TCP ลดรอบรายงานกลางคืน'].id,
        status: 'pending_approval',
        deviceIds: list,
        results: [],
        days: 1,
        deviceValues: {
          [list[0]]: { REPORT_INTERVAL_IDLE: 900 },
          [list[1]]: { REPORT_INTERVAL_IDLE: 1200 },
        },
        deviceValuesReason: 'รถสองคันนี้จอดนานกว่ารถคันอื่นในกลุ่ม',
      });
      const holder = list[2];
      if (holder) {
        const latest = await prisma.deviceConfigOverride.findFirst({
          where: { deviceId: holder },
          orderBy: { versionNumber: 'desc' },
        });
        await prisma.deviceConfigOverride.create({
          data: {
            deviceId: holder,
            configId: cfg['GT06N/TCP รายงานถี่ (รถเย็น)'].id,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            fields: { REPORT_INTERVAL_IDLE: 1800 },
            reason: 'ลูกค้าขอให้รถคันนี้รายงานห่างกว่าปกติ',
            status: 'approved',
            overriddenBy: U.st,
            overriddenAt: ago(12),
            decidedBy: U.op,
            decidedAt: ago(11),
          },
        });
      }
    }
  }
  {
    const list = ids(installed('GT06L'));
    const c = await campaign(
      'ภูเก็ตทัวร์ อัปเดตเครื่อง GT06L ทั้งหมด',
      'อัปเดต Firmware ก่อนไฮซีซั่น แล้วตามด้วย Config มาตรฐาน',
      list,
      16,
    );
    if (c) {
      await rollout(c, {
        payloadType: 'Firmware',
        firmwareId: fw['2.4.2'].id,
        status: 'completed',
        deviceIds: list,
        results: Array<TargetResult>(list.length).fill('success'),
        days: 15,
      });
      const gt06lCfg = await prisma.config.findUnique({
        where: { name: 'GT06L/TCP มาตรฐาน' },
      });
      if (gt06lCfg) {
        await rollout(c, {
          payloadType: 'Config',
          configId: gt06lCfg.id,
          status: 'approved',
          deviceIds: list,
          results: [],
          days: 1,
        });
      }
    }
  }
  {
    const list = ids(installed('VT300'));
    const c = await campaign(
      'อีสานคาร์โก้ รถบรรทุก VT300',
      'ตั้งค่า CAN bus ทั้งกลุ่ม',
      list,
      20,
    );
    if (c) {
      await rollout(c, {
        payloadType: 'Config',
        configId: cfg['VT300/TCP รถบรรทุก'].id,
        status: 'completed',
        deviceIds: list,
        results: Array<TargetResult>(list.length).fill('success'),
        days: 18,
      });
      await rollout(c, {
        payloadType: 'Firmware',
        firmwareId: fw['1.2.0'].id,
        status: 'rejected',
        deviceIds: list,
        results: [],
        days: 4,
      });
    }
  }

  // ---------------- Incidents (รายงานจากหน้างาน) ----------------
  const incidentDefs: {
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    status: 'open' | 'resolved' | 'dismissed';
    deviceId: string;
    by: 'st' | 'ot';
    days: number;
    reviewNote?: string;
  }[] = [
    {
      title: 'GPS ไม่จับสัญญาณในลานจอดใต้ดิน',
      description:
        'ลูกค้าแจ้งว่าตำแหน่งหายทุกครั้งที่รถเข้าลานจอดใต้ดินของห้าง ออกมาแล้วกลับมาปกติ',
      severity: 'medium',
      status: 'open',
      deviceId: 'DEV-0101',
      by: 'st',
      days: 0.3,
    },
    {
      title: 'เครื่องรีบูตเองทุก 10 นาที',
      description: 'ไฟสถานะดับแล้วติดใหม่เป็นรอบๆ หลังอัปเดต Firmware เมื่อวาน',
      severity: 'high',
      status: 'open',
      deviceId: 'DEV-0124',
      by: 'ot',
      days: 0.8,
    },
    {
      title: 'ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน',
      description: 'ทดสอบกดปุ่ม SOS 3 ครั้ง ไม่มีแจ้งเตือนเข้าศูนย์เลย',
      severity: 'critical',
      status: 'open',
      deviceId: 'DEV-0103',
      by: 'st',
      days: 1.5,
    },
    {
      title: 'สายไฟ ACC หลวม',
      description: 'สถานะติดเครื่องไม่ตรงกับความจริง ตรวจแล้วเจอสาย ACC หลวม',
      severity: 'low',
      status: 'resolved',
      deviceId: 'DEV-0104',
      by: 'st',
      days: 4,
      reviewNote: 'ช่างเข้าไปขันสายใหม่แล้ว ใช้งานปกติ',
    },
    {
      title: 'แจ้งซ้ำ: เครื่องรีบูต',
      description: 'เครื่องเดิมที่แจ้งไปแล้ว ยังรีบูตอยู่',
      severity: 'medium',
      status: 'dismissed',
      deviceId: 'DEV-0124',
      by: 'ot',
      days: 0.7,
      reviewNote: 'ซ้ำกับรายการที่แจ้งไว้ก่อนหน้า',
    },
  ];
  for (const r of incidentDefs) {
    const found = await prisma.incident.findFirst({
      where: { title: r.title, deviceId: r.deviceId },
    });
    if (found) continue;
    byId(r.deviceId);
    await prisma.incident.create({
      data: {
        title: r.title,
        description: r.description,
        severity: r.severity,
        status: r.status,
        source: 'field-report',
        reportedBy: U[r.by],
        deviceId: r.deviceId,
        createdAt: ago(r.days),
        reviewedBy: r.reviewNote ? U.op : null,
        reviewedAt: r.reviewNote ? ago(r.days - 0.2) : null,
        reviewNote: r.reviewNote ?? null,
      },
    });
    log(U[r.by], 'incident', 'report', ago(r.days), { deviceId: r.deviceId });
    if (r.reviewNote) {
      log(U.op, 'incident', 'decide', ago(r.days - 0.2), { outcome: r.status });
    }
  }

  // ซ่อมแถว Task ที่ seed ไว้ด้วยสคริปต์รุ่นแรก (Config คนละโปรโตคอลกับเครื่อง
  // และ DEV-0124 ไม่มีงาน completed ที่ผูก Config ตรงกับคำขอ Override) ให้ตรง
  // กับข้อมูลชุดใหม่ ใช้เงื่อนไขเจาะจงเฉพาะแถวตัวอย่าง รันซ้ำได้ ไม่แตะงานที่
  // ผู้ใช้สร้างเอง ต้องรันก่อนสร้าง Task ตัวอย่างด้านล่าง ไม่งั้นแถวที่ย้าย
  // เครื่องแล้วจะถูกสร้างซ้ำอีกชุด
  const udpConfig = cfg['GT08-4G/UDP ประหยัดแบต'];
  await prisma.task.updateMany({
    where: {
      title: 'ติดตั้ง Config ประหยัดแบต',
      deviceId: 'DEV-0124',
      configId: udpConfig.id,
    },
    data: { deviceId: 'DEV-0125' },
  });
  await prisma.task.updateMany({
    where: {
      title: 'ติดตั้ง Config มาตรฐาน GT08-4G',
      deviceId: 'DEV-0124',
      status: 'in_progress',
    },
    data: {
      status: 'completed',
      description: 'เครื่องใหม่ ติดตั้ง Config มาตรฐานเรียบร้อยแล้ว',
    },
  });

  // ---------------- Tasks ----------------
  const taskDefs: {
    title: string;
    description: string;
    who: 'st' | 'ot';
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    deviceId: string;
    configName?: string;
    dueInDays: number;
    createdDays: number;
  }[] = [
    {
      title: 'ติดตั้ง Config รายงานถี่ ให้รถเย็น',
      description: 'นัดลูกค้าที่ลานจอดรถเย็น ช่วงเช้าก่อนรถออก',
      who: 'st',
      status: 'pending',
      deviceId: 'DEV-0101',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      dueInDays: 1,
      createdDays: 5,
    },
    {
      title: 'ติดตั้ง Config CAN bus รถบรรทุก',
      description: 'ต้องเสียบสาย CAN ก่อนส่ง Config',
      who: 'st',
      status: 'in_progress',
      deviceId: 'DEV-0134',
      configName: 'VT300/TCP รถบรรทุก',
      dueInDays: 0,
      createdDays: 4,
    },
    {
      title: 'ยืนยันติดตั้ง Config รายงานถี่',
      description: 'ติดตั้งเสร็จ ตรวจรอบรายงานตำแหน่งแล้ว',
      who: 'st',
      status: 'completed',
      deviceId: 'DEV-0105',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      dueInDays: -5,
      createdDays: 7,
    },
    {
      title: 'ยืนยันติดตั้ง Config รายงานถี่',
      description: 'ติดตั้งเสร็จ ตรวจรอบรายงานตำแหน่งแล้ว',
      who: 'st',
      status: 'completed',
      deviceId: 'DEV-0106',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      dueInDays: -5,
      createdDays: 7,
    },
    {
      title: 'ยืนยันติดตั้ง Config รายงานถี่',
      description: 'ติดตั้งเสร็จ ตรวจรอบรายงานตำแหน่งแล้ว',
      who: 'st',
      status: 'completed',
      deviceId: 'DEV-0107',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      dueInDays: -5,
      createdDays: 7,
    },
    {
      title: 'ยืนยันติดตั้ง Config รายงานถี่',
      description: 'ติดตั้งเสร็จ ตรวจรอบรายงานตำแหน่งแล้ว',
      who: 'st',
      status: 'completed',
      deviceId: 'DEV-0108',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      dueInDays: -5,
      createdDays: 7,
    },
    {
      title: 'ตรวจสัญญาณ GPS ลานจอดใต้ดิน',
      description: 'ลูกค้าแจ้งว่าตำแหน่งหายในลานจอดใต้ดิน',
      who: 'st',
      status: 'pending',
      deviceId: 'DEV-0107',
      dueInDays: 2,
      createdDays: 3,
    },
    {
      title: 'เปลี่ยนซิมการ์ด (ซิมหมดอายุ)',
      description: 'ซิมเดิมหมดอายุสิ้นเดือนนี้ เอาซิมใหม่ไปด้วย',
      who: 'ot',
      status: 'pending',
      deviceId: 'DEV-0110',
      dueInDays: 3,
      createdDays: 2,
    },
    {
      title: 'ติดตั้ง Config มาตรฐาน GT08-4G',
      description: 'เครื่องใหม่ ติดตั้ง Config มาตรฐานเรียบร้อยแล้ว',
      who: 'ot',
      status: 'completed',
      deviceId: 'DEV-0124',
      configName: 'GT08-4G/TCP มาตรฐาน',
      dueInDays: -2,
      createdDays: 5,
    },
    {
      title: 'ตรวจเช็คปุ่ม SOS',
      description: 'กดแล้วไม่มีแจ้งเตือนเข้าศูนย์',
      who: 'st',
      status: 'pending',
      deviceId: 'DEV-0116',
      dueInDays: 1,
      createdDays: 4,
    },
    {
      title: 'ติดตั้งอุปกรณ์ใหม่ รถคันที่ 12',
      description: 'ติดตั้งพร้อมเดินสายไฟใหม่',
      who: 'ot',
      status: 'completed',
      deviceId: 'DEV-0119',
      dueInDays: -2,
      createdDays: 3,
    },
    {
      title: 'ติดตั้ง Config ประหยัดแบต',
      description: 'รถจอดนาน แบตหมดบ่อย',
      who: 'st',
      status: 'completed',
      // DEV-0125 ใช้ UDP ส่วน DEV-0124 ใช้ TCP (assertConfigAssignable ของ API
      // จริงต้องให้ Config ตรงโปรโตคอลของเครื่อง)
      deviceId: 'DEV-0125',
      configName: 'GT08-4G/UDP ประหยัดแบต',
      dueInDays: -3,
      createdDays: 2,
    },
    {
      title: 'ตรวจสายไฟ ACC',
      description: 'สถานะติดเครื่องไม่ตรง',
      who: 'st',
      status: 'completed',
      deviceId: 'DEV-0125',
      dueInDays: -4,
      createdDays: 5,
    },
    {
      title: 'ย้ายอุปกรณ์ไปรถคันใหม่',
      description: 'ลูกค้ายกเลิก ขายรถคันเดิมไม่ทัน',
      who: 'ot',
      status: 'cancelled',
      deviceId: 'DEV-0128',
      dueInDays: -1,
      createdDays: 4,
    },
  ];
  for (const t of taskDefs) {
    const found = await prisma.task.findFirst({
      where: { title: t.title, deviceId: t.deviceId },
    });
    if (found) continue;
    byId(t.deviceId);
    const createdAt = ago(t.createdDays);
    await prisma.task.create({
      data: {
        title: t.title,
        description: t.description,
        assignedTo: U[t.who],
        deviceId: t.deviceId,
        configId: t.configName ? cfg[t.configName].id : null,
        status: t.status,
        dueDate: ago(-t.dueInDays),
        createdAt,
      },
    });
    log(U.op, 'task', 'create', createdAt, { title: t.title });
    if (t.status !== 'pending') {
      log(U[t.who], 'task', 'update', ago(Math.max(0, t.createdDays - 2)), {
        status: t.status,
      });
    }
  }

  // ---------------- Overrides ----------------
  const configOverrideDefs: {
    deviceId: string;
    configName: string;
    fields: Record<string, unknown>;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    days: number;
  }[] = [
    {
      deviceId: 'DEV-0105',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      fields: { APN: 'internet.dtac' },
      reason: 'ลูกค้าใช้ซิมค่ายอื่น ต้องเปลี่ยน APN',
      status: 'pending',
      days: 0.2,
    },
    {
      deviceId: 'DEV-0106',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      fields: { APN: 'iot.ais' },
      reason: 'ซิม IoT ของลูกค้าเอง',
      status: 'pending',
      days: 0.5,
    },
    {
      deviceId: 'DEV-0124',
      configName: 'GT08-4G/TCP มาตรฐาน',
      fields: { APN: 'internet.true' },
      reason: 'สัญญาณค่ายเดิมไม่ดีในพื้นที่',
      status: 'pending',
      days: 1.1,
    },
    {
      deviceId: 'DEV-0107',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      fields: { APN: 'internet.dtac' },
      reason: 'เปลี่ยนค่ายซิม',
      status: 'approved',
      days: 3,
    },
    {
      deviceId: 'DEV-0108',
      configName: 'GT06N/TCP รายงานถี่ (รถเย็น)',
      fields: { APN: 'test.apn' },
      reason: 'ทดลองค่า APN',
      status: 'rejected',
      days: 4,
    },
  ];
  for (const o of configOverrideDefs) {
    // หาด้วยเหตุผลอย่างเดียว (ข้อความเฉพาะของข้อมูลตัวอย่าง) DB ที่เคย seed
    // รุ่นก่อนอาจผูกคำขอนี้ไว้กับเครื่องอื่น ไม่ต้องสร้างซ้ำ
    const found = await prisma.deviceConfigOverride.findFirst({
      where: { reason: o.reason },
    });
    if (found) continue;
    byId(o.deviceId);
    const last = await prisma.deviceConfigOverride.findFirst({
      where: { deviceId: o.deviceId },
      orderBy: { versionNumber: 'desc' },
    });
    const decided = o.status !== 'pending';
    await prisma.deviceConfigOverride.create({
      data: {
        deviceId: o.deviceId,
        configId: cfg[o.configName].id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        fields: o.fields as Prisma.InputJsonValue,
        reason: o.reason,
        status: o.status,
        overriddenBy: U.st,
        overriddenAt: ago(o.days),
        decidedBy: decided ? U.op : null,
        decidedAt: decided ? ago(o.days - 0.3) : null,
        rejectReason: o.status === 'rejected' ? 'ค่า APN ไม่ถูกต้อง' : null,
      },
    });
    log(U.st, 'device', 'device-config-override-request', ago(o.days), {
      deviceId: o.deviceId,
    });
    if (decided) {
      log(
        U.op,
        'device',
        `device-config-override-${o.status === 'approved' ? 'approve' : 'reject'}`,
        ago(o.days - 0.3),
        { deviceId: o.deviceId },
      );
    }
  }

  const firmwareOverrideDefs: {
    deviceId: string;
    version: string;
    reason: string;
    status: 'pending' | 'approved';
    days: number;
  }[] = [
    {
      deviceId: 'DEV-0109',
      version: '2.5.0',
      reason: 'เครื่องมีปัญหา GPS drift ต้องการ 2.5.0 ก่อนรอบ Campaign',
      status: 'pending',
      days: 0.4,
    },
    {
      deviceId: 'DEV-0126',
      version: '2.4.2',
      reason: 'ขอถอยกลับ 2.4.2 เพราะ 2.5.0 รีบูตซ้ำ',
      status: 'pending',
      days: 0.9,
    },
    {
      deviceId: 'DEV-0110',
      version: '2.5.0',
      reason: 'ลูกค้าเร่งให้อัปเดต',
      status: 'approved',
      days: 2,
    },
  ];
  for (const o of firmwareOverrideDefs) {
    const found = await prisma.deviceFirmwareOverride.findFirst({
      where: { reason: o.reason },
    });
    if (found) continue;
    byId(o.deviceId);
    const last = await prisma.deviceFirmwareOverride.findFirst({
      where: { deviceId: o.deviceId },
      orderBy: { versionNumber: 'desc' },
    });
    const approved = o.status === 'approved';
    await prisma.deviceFirmwareOverride.create({
      data: {
        deviceId: o.deviceId,
        firmwareId: fw[o.version].id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        reason: o.reason,
        status: o.status,
        overriddenBy: U.st,
        overriddenAt: ago(o.days),
        decidedBy: approved ? U.op : null,
        decidedAt: approved ? ago(o.days - 0.3) : null,
      },
    });
    log(U.st, 'device', 'device-firmware-override-request', ago(o.days), {
      deviceId: o.deviceId,
    });
    if (approved) {
      log(
        U.op,
        'device',
        'device-firmware-override-approve',
        ago(o.days - 0.3),
        {
          deviceId: o.deviceId,
        },
      );
    }
  }

  // ประวัติ apply-config ของเครื่องที่ติดตั้งแล้ว ให้หน้า Audit Log มีข้อมูล
  devices
    .filter((d) => d.status === 'installed')
    .slice(0, 15)
    .forEach((d, i) =>
      log(i % 2 ? U.st : U.ot, 'device', 'apply-config', ago(10 - i * 0.6), {
        deviceId: d.deviceId,
      }),
    );

  // Audit Log เขียนครั้งเดียวต่อ DB (เครื่องหมาย metadata.demo = true)
  const auditDone = await prisma.auditLog.findFirst({
    where: { metadata: { path: ['demo'], equals: true } },
  });
  if (!auditDone) {
    await prisma.auditLog.createMany({
      data: audit.map((a) => ({
        ...a,
        metadata: {
          ...(a.metadata ?? {}),
          demo: true,
        },
      })),
    });
  }

  console.log(
    [
      'seed-demo เสร็จ',
      `อุปกรณ์ตัวอย่าง ${devices.length} เครื่อง (เติม IMEI/Serial/Blackbox ID ให้เครื่องเดิม ${backfilled} เครื่อง)`,
      `Audit Log ${auditDone ? 'มีอยู่แล้ว ข้าม' : `${audit.length} รายการ`}`,
    ].join('\n'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
