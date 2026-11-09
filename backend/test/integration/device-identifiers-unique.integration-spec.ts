import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceModule } from '../../src/device/device.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  getOrCreateRole,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * IMEI / Serial Number / Blackbox ID ห้ามซ้ำกับเครื่องอื่น "ตลอดกาล" รวมเครื่องที่ปลดระวางแล้ว (มติ A
 * 2026-11-05) · ผ่าน HTTP + Postgres จริง · เทียบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย · เครื่องเดิมที่ค่า null
 * ไม่นับว่าซ้ำ · race ของการลงทะเบียนพร้อมกัน (advisory lock — `device-identifiers.ts`)
 */
describe('POST /devices — IMEI/Serial/Blackbox ID ห้ามซ้ำ (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        DeviceModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    jwtService = moduleFixture.get(JwtService);
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.rolePermission.deleteMany();
    const admin = await makeUser(prisma, { role: 'Admin' });
    const role = await getOrCreateRole(prisma, 'Admin');
    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        resource: 'device-registration',
        action: ActionType.Create,
      },
    });
    token = jwtService.sign({ sub: admin.id, role: 'Admin' });
  });

  async function body(
    deviceId: string,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    return {
      deviceId,
      simNumber: `SIM-${deviceId}`,
      imei: `IMEI-${deviceId}`,
      serialNumber: `SN-${deviceId}`,
      blackboxId: `BB-${deviceId}`,
      modelId: model.id,
      protocol: 'TCP',
      customerId: (
        await prisma.customer.create({
          data: { companyName: `Cus-${deviceId}-${Math.random()}` },
        })
      ).id,
      ...over,
    };
  }

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
  }

  async function seedExisting(
    deviceId: string,
    over: Record<string, unknown> = {},
  ) {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    return prisma.device.create({
      data: {
        deviceId,
        simNumber: `SIM-${deviceId}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        modelId: model.id,
        imei: `IMEI-${deviceId}`,
        serialNumber: `SN-${deviceId}`,
        blackboxId: `BB-${deviceId}`,
        ...over,
      },
    });
  }

  it.each([
    ['imei', 'IMEI'],
    ['serialNumber', 'Serial Number'],
    ['blackboxId', 'Blackbox ID'],
  ])(
    '%s ซ้ำกับเครื่องอื่น (ต่างตัวพิมพ์เล็ก/ใหญ่ + ช่องว่างหัวท้าย) -> 409 ขึ้นต้นด้วย "%s" บอกเครื่องที่ซ้ำ ไม่สร้างเครื่องใหม่',
    async (field, label) => {
      await seedExisting('DEV-OLD', { [field]: 'Abc-123' });

      const res = await register(
        await body('DEV-NEW', { [field]: '  aBC-123 ' }),
      ).expect(409);

      const message = (res.body as { message: string }).message;
      expect(message.startsWith(`${label} `)).toBe(true);
      expect(message).toContain('DEV-OLD');
      expect(await prisma.device.count()).toBe(1);
    },
  );

  it('ซ้ำกับเครื่องที่ปลดระวางแล้ว -> ยัง 409 และบอกว่าปลดระวางแล้ว', async () => {
    await seedExisting('DEV-RET', {
      imei: '860000000000001',
      status: 'decommissioned',
    });

    const res = await register(
      await body('DEV-NEW', { imei: '860000000000001' }),
    ).expect(409);

    expect((res.body as { message: string }).message).toMatch(
      /DEV-RET.*ปลดระวางแล้ว/,
    );
    expect(await prisma.device.count()).toBe(1);
  });

  it('เครื่องเดิมที่ค่าเป็น null ไม่นับว่าซ้ำ · เลขไม่ซ้ำ -> 201', async () => {
    await seedExisting('DEV-NULL', {
      imei: null,
      serialNumber: null,
      blackboxId: null,
    });

    await register(await body('DEV-A')).expect(201);
    await register(await body('DEV-B')).expect(201);

    expect(await prisma.device.count()).toBe(3);
  });

  it('deviceId ซ้ำ (ลงทะเบียนเครื่องเดิมซ้ำ) -> 409 ข้อความเรื่อง deviceId ไม่ใช่ IMEI', async () => {
    await register(await body('DEV-DUP')).expect(201);

    const res = await register(await body('DEV-DUP')).expect(409);

    const message = (res.body as { message: string }).message;
    expect(message).toContain('deviceId');
    expect(message.startsWith('IMEI')).toBe(false);
  });

  it('SIM ยังนับเฉพาะเครื่อง active เหมือนเดิม: ปลดระวางแล้วใช้ SIM เดิมลงทะเบียนเครื่องใหม่ได้', async () => {
    await seedExisting('DEV-RET', {
      simNumber: 'SIM-REUSE',
      status: 'decommissioned',
    });

    await register(await body('DEV-NEW', { simNumber: 'SIM-REUSE' })).expect(
      201,
    );
  });

  it('ลงทะเบียน IMEI เดียวกันพร้อมกัน 2 คำขอ -> สำเร็จตัวเดียว อีกตัว 409 (advisory lock)', async () => {
    for (let round = 0; round < 6; round++) {
      const imei = `RACE-IMEI-${round}`;
      const [a, b] = await Promise.all([
        register(await body(`RACE-A-${round}`, { imei })),
        register(await body(`RACE-B-${round}`, { imei })),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.device.count({ where: { imei } })).toBe(1);
    }
  });

  it('ระหว่างมีการลงทะเบียนอีกฝั่งถือล็อกเลขประจำตัวอยู่ -> คำขอนี้ต้องรอ (ไม่ผ่านทะลุ) แล้วเห็นเครื่องที่เพิ่งเพิ่ม -> 409', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => (held = resolve));
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');

    // จำลองการลงทะเบียนที่กำลังทำงาน: ถือ advisory lock แล้วเพิ่มเครื่องที่ IMEI นี้ ก่อน commit
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Device.identifiers'))`;
        held();
        await gate;
        await tx.device.create({
          data: {
            deviceId: 'HOLDER',
            simNumber: 'SIM-HOLDER',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            modelId: model.id,
            imei: 'HELD-IMEI',
          },
        });
      },
      { timeout: 15000 },
    );
    await heldPromise;

    const waiting = register(await body('WAITER', { imei: 'held-imei' })).then(
      (r) => r,
    );
    const settledEarly = await Promise.race([
      waiting.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(settledEarly).toBe(false);

    release();
    await holder;
    const res = await waiting;

    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain('HOLDER');
    expect(await prisma.device.count({ where: { deviceId: 'WAITER' } })).toBe(
      0,
    );
  });
});
