import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  lockDeviceForChange,
  lockDeviceForUse,
} from '../../src/device/device-lock';
import { DeviceModule } from '../../src/device/device.module';
import { TaskService } from '../../src/task/task.service';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// อ่าน body ของ response แบบไม่ต้อง cast ทีละจุด (ค่าที่อ่านเป็น any ใช้กับ expect ได้ตรงๆ)

const b = (res: request.Response) => res.body as Record<string, any>;

/**
 * แก้ไข / ปลดระวาง / เปิดใช้กลับ ของอุปกรณ์ (มติ A 2026-11-05) · HTTP + Postgres จริง
 * race: ผู้ปลดระวางล็อกเครื่อง FOR UPDATE แล้วตรวจงานค้างซ้ำ · ผู้สร้างงานล็อก FOR SHARE (`device-lock.ts`)
 * — ทดสอบด้วย "ถือล็อกค้างใน transaction ด้วยมือ" ไม่ใช่ยิงพร้อมกันแล้วหวังว่าชนกัน
 */
describe('Device lifecycle — PATCH / decommission / reactivate (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  let adminToken: string;
  let otToken: string;
  let adminId: string;
  let otId: string;

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
    const ot = await makeUser(prisma, { role: 'OT' });
    adminId = admin.id;
    otId = ot.id;
    const role = await getOrCreateRole(prisma, 'Admin');
    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        resource: 'device-registration',
        action: ActionType.Update,
      },
    });
    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        resource: 'devices',
        action: ActionType.Read,
      },
    });
    adminToken = jwtService.sign({ sub: admin.id, role: 'Admin' });
    otToken = jwtService.sign({ sub: ot.id, role: 'OT' });
  });

  async function seedDevice(
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
        status: 'installed',
        apiKeyHash: 'hash-original',
        telemetryKeyHash: 'tele-original',
        ...over,
      },
    });
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const patch = (deviceId: string, body: object, token = adminToken) =>
    request(app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}`)
      .set(auth(token))
      .send(body);
  const decommission = (deviceId: string, body: object, token = adminToken) =>
    request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/decommission`)
      .set(auth(token))
      .send(body);
  const reactivate = (
    deviceId: string,
    body: object = {},
    token = adminToken,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/reactivate`)
      .set(auth(token))
      .send(body);

  describe('สิทธิ์', () => {
    it('ไม่มี token -> 401 · Role ที่ไม่มีสิทธิ์ (OT) -> 403 ทั้งสามเส้นทาง', async () => {
      await seedDevice('DEV-1');
      // สร้างคำขอทีละอัน (supertest เปิดพอร์ตต่อคำขอ สร้างหลายอันค้างไว้พร้อมกันจะชนกัน)
      const noToken = [
        () =>
          request(app.getHttpServer()).patch('/api/v1/devices/DEV-1').send({}),
        () =>
          request(app.getHttpServer())
            .post('/api/v1/devices/DEV-1/decommission')
            .send({ reason: 'x' }),
        () =>
          request(app.getHttpServer())
            .post('/api/v1/devices/DEV-1/reactivate')
            .send({}),
      ];
      for (const call of noToken) {
        expect((await call()).status).toBe(401);
      }
      expect((await patch('DEV-1', { simNumber: 'N' }, otToken)).status).toBe(
        403,
      );
      expect(
        (await decommission('DEV-1', { reason: 'x' }, otToken)).status,
      ).toBe(403);
      expect((await reactivate('DEV-1', {}, otToken)).status).toBe(403);
    });
  });

  describe('PATCH แก้ไขข้อมูล', () => {
    it('แก้ SIM / hardware revision ได้ และเขียน AuditLog เฉพาะชื่อ field ที่เปลี่ยน (ไม่มีค่า)', async () => {
      await seedDevice('DEV-1');
      const res = await patch('DEV-1', {
        simNumber: 'SIM-NEW',
        hardwareRevisionCode: 'RevB',
      });
      expect(res.status).toBe(200);
      expect(b(res).simNumber).toBe('SIM-NEW');
      expect(b(res).hardwareRevisionCode).toBe('RevB');
      expect(b(res).apiKeyHash).toBeUndefined();

      const logs = await prisma.auditLog.findMany({
        where: { action: 'update' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual({
        deviceId: 'DEV-1',
        changedFields: ['simNumber', 'hardwareRevisionCode'],
      });
    });

    it('ส่งค่าเดิม -> ไม่เขียน AuditLog · ส่ง hardwareRevisionCode ว่าง -> ล้างค่า', async () => {
      await seedDevice('DEV-1', { hardwareRevisionCode: 'RevA' });
      const same = await patch('DEV-1', { simNumber: 'SIM-DEV-1' });
      expect(same.status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: 'update' } })).toBe(
        0,
      );

      const cleared = await patch('DEV-1', { hardwareRevisionCode: '  ' });
      expect(b(cleared).hardwareRevisionCode).toBeNull();
    });

    it('แก้ Device ID / โมเดล / โปรโตคอลไม่ได้ (400) · ไม่พบเครื่อง 404', async () => {
      await seedDevice('DEV-1');
      for (const body of [
        { deviceId: 'OTHER' },
        { protocol: 'UDP' },
        { modelId: '11111111-1111-1111-1111-111111111111' },
      ]) {
        expect((await patch('DEV-1', body)).status).toBe(400);
      }
      expect((await patch('NOPE', { simNumber: 'N' })).status).toBe(404);
    });

    it('IMEI ซ้ำกับเครื่องอื่น (แม้ปลดระวางแล้ว) -> 409 · ส่ง IMEI ของตัวเองเดิมได้ · เครื่องอื่นไม่ถูกแก้', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2', { status: 'decommissioned' });

      const dup = await patch('DEV-1', { imei: 'imei-dev-2 ' });
      expect(dup.status).toBe(409);
      expect(b(dup).message).toContain('IMEI');
      expect(b(dup).message).toContain('DEV-2');
      expect(b(dup).message).toContain('ปลดระวางแล้ว');
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'DEV-1' },
          })
        ).imei,
      ).toBe('IMEI-DEV-1');

      const ownSame = await patch('DEV-1', { imei: 'IMEI-DEV-1' });
      expect(ownSame.status).toBe(200);
    });

    it('SIM ซ้ำกับเครื่องที่ใช้งานอยู่ -> 409 · แต่ซ้ำกับเครื่องที่ปลดระวางแล้วได้', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2');
      await seedDevice('DEV-3', {
        status: 'decommissioned',
        simNumber: 'SIM-OLD',
      });

      const dup = await patch('DEV-1', { simNumber: 'SIM-DEV-2' });
      expect(dup.status).toBe(409);
      expect(b(dup).message).toContain('SIM');

      const reuse = await patch('DEV-1', { simNumber: 'SIM-OLD' });
      expect(reuse.status).toBe(200);
    });

    it('เปลี่ยนลูกค้า: ต้องเป็นลูกค้าที่ใช้งานอยู่ (ปิดใช้งาน 409 · ไม่พบ 404)', async () => {
      await seedDevice('DEV-1');
      const active = await prisma.customer.create({
        data: { companyName: 'Acme', isActive: true },
      });
      const inactive = await prisma.customer.create({
        data: { companyName: 'Zeta', isActive: false },
      });

      const ok = await patch('DEV-1', { customerId: active.id });
      expect(ok.status).toBe(200);
      expect(b(ok).customer).toEqual({ id: active.id, companyName: 'Acme' });

      expect((await patch('DEV-1', { customerId: inactive.id })).status).toBe(
        409,
      );
      expect(
        (
          await patch('DEV-1', {
            customerId: '8f14e45f-ceea-4672-9d0e-1c5a3f7d2b11',
          })
        ).status,
      ).toBe(404);
    });

    it('เครื่องที่ปลดระวางแล้ว -> แก้ไม่ได้ (409)', async () => {
      await seedDevice('DEV-1', { status: 'decommissioned' });
      const res = await patch('DEV-1', { simNumber: 'N' });
      expect(res.status).toBe(409);
      expect(b(res).message).toContain('ปลดระวางแล้ว');
    });
  });

  describe('POST decommission', () => {
    it('ปลดระวาง: สถานะ + เวลา + เหตุผล, ล้าง API key กับ key telemetry, ประวัติอยู่ครบ, AuditLog มีเหตุผล', async () => {
      await seedDevice('DEV-1', { lastSeenAt: new Date() });
      const res = await decommission('DEV-1', { reason: '  รถถูกขายแล้ว ' });

      expect(res.status).toBe(200);
      expect(b(res).status).toBe('decommissioned');
      expect(b(res).decommissionReason).toBe('รถถูกขายแล้ว');
      expect(b(res).decommissionedAt).toBeTruthy();

      const row = await prisma.$queryRaw<
        { apiKeyHash: string | null; telemetryKeyHash: string | null }[]
      >`SELECT "apiKeyHash", "telemetryKeyHash" FROM "Device" WHERE "deviceId" = 'DEV-1'`;
      expect(row[0].apiKeyHash).toBeNull();
      expect(row[0].telemetryKeyHash).toBeNull();

      const logs = await prisma.auditLog.findMany({
        where: { action: 'decommission' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual({
        deviceId: 'DEV-1',
        reason: 'รถถูกขายแล้ว',
      });
    });

    it('เหตุผลบังคับ (ว่าง/ช่องว่างล้วน 400) · ปลดซ้ำ 409 · ไม่พบ 404', async () => {
      await seedDevice('DEV-1');
      expect((await decommission('DEV-1', {})).status).toBe(400);
      expect((await decommission('DEV-1', { reason: '   ' })).status).toBe(400);
      expect((await decommission('NOPE', { reason: 'x' })).status).toBe(404);

      expect((await decommission('DEV-1', { reason: 'x' })).status).toBe(200);
      expect((await decommission('DEV-1', { reason: 'x' })).status).toBe(409);
    });

    it('มีงาน (Task) ที่ยังไม่จบ -> 409 บอกจำนวน เครื่องไม่เปลี่ยนสถานะ · งานจบแล้ว (completed) ไม่บล็อก', async () => {
      await seedDevice('DEV-1');
      await prisma.task.create({
        data: { title: 'ติดตั้ง', assignedTo: otId, deviceId: 'DEV-1' },
      });
      await prisma.task.create({
        data: {
          title: 'เสร็จแล้ว',
          assignedTo: otId,
          deviceId: 'DEV-1',
          status: 'completed',
        },
      });

      const blocked = await decommission('DEV-1', { reason: 'x' });
      expect(blocked.status).toBe(409);
      expect(b(blocked).message).toContain('งาน (Task) ที่ยังไม่จบ 1 รายการ');
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'DEV-1' },
          })
        ).status,
      ).toBe('installed');

      await prisma.task.updateMany({
        where: { deviceId: 'DEV-1' },
        data: { status: 'cancelled' },
      });
      expect((await decommission('DEV-1', { reason: 'x' })).status).toBe(200);
    });

    it('รายการเครื่อง: ซ่อนเครื่องที่ปลดระวางเป็นค่าเริ่มต้น · includeDecommissioned=true หรือ status=decommissioned เห็น', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2');
      await decommission('DEV-2', { reason: 'x' });

      const ids = (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set(auth(adminToken))
          .then((r) =>
            (r.body as { deviceId: string }[]).map((d) => d.deviceId),
          );

      expect(await ids('/api/v1/devices')).toEqual(['DEV-1']);
      expect(await ids('/api/v1/devices?includeDecommissioned=true')).toEqual([
        'DEV-1',
        'DEV-2',
      ]);
      expect(await ids('/api/v1/devices?status=decommissioned')).toEqual([
        'DEV-2',
      ]);
    });

    it('race: ผู้สร้างงานถือล็อกเครื่อง (FOR SHARE) -> ปลดระวางต้องรอ แล้วเห็นงานที่เพิ่งสร้างและตอบ 409', async () => {
      await seedDevice('DEV-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let created!: () => void;
      const taskCreated = new Promise<void>((r) => (created = r));

      const creator = prisma.$transaction(async (tx) => {
        await lockDeviceForUse(tx, 'DEV-1');
        await tx.task.create({
          data: { title: 'งานใหม่', assignedTo: otId, deviceId: 'DEV-1' },
        });
        created();
        await gate;
      });
      await taskCreated;

      let settled = false;
      const decommissionCall = decommission('DEV-1', { reason: 'x' }).then(
        (r) => {
          settled = true;
          return r;
        },
      );
      await sleep(500);
      expect(settled).toBe(false); // ยังรอล็อก ไม่ใช่ผ่านเพราะเรียงคิวบังเอิญ

      release();
      await creator;
      const res = await decommissionCall;
      expect(res.status).toBe(409);
      expect(b(res).message).toContain('งาน (Task) ที่ยังไม่จบ 1 รายการ');
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'DEV-1' },
          })
        ).status,
      ).toBe('installed');
    });

    it('race: ผู้ปลดระวางถือล็อกเครื่อง (FOR UPDATE) -> ผู้สร้างงานต้องรอ แล้วถูกปฏิเสธ (ไม่มีงานค้างใต้เครื่องที่ปลดระวางแล้ว)', async () => {
      await seedDevice('DEV-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const holding = new Promise<void>((r) => (locked = r));

      const decommissioner = prisma.$transaction(async (tx) => {
        await lockDeviceForChange(tx, 'DEV-1');
        locked();
        await gate;
        // เปลี่ยนสถานะหลังปล่อย gate (ไม่ใช่ก่อน) เพื่อให้ผู้สร้างงานรอเพราะ "ล็อก" จริง ไม่ใช่เพราะ UPDATE ล็อกแถวเอง
        await tx.device.update({
          where: { deviceId: 'DEV-1' },
          data: { status: 'decommissioned' },
        });
      });
      await holding;

      let settled = false;
      const creatorCall = prisma
        .$transaction(async (tx) => {
          await lockDeviceForUse(tx, 'DEV-1');
          await tx.task.create({
            data: { title: 'งานใหม่', assignedTo: otId, deviceId: 'DEV-1' },
          });
        })
        .then(
          () => 'created',
          (e: Error) => e.message,
        )
        .finally(() => (settled = true));
      await sleep(500);
      expect(settled).toBe(false);

      release();
      await decommissioner;
      expect(await creatorCall).toContain('ปลดระวางแล้ว');
      expect(await prisma.task.count({ where: { deviceId: 'DEV-1' } })).toBe(0);
    });
  });

  describe('POST rotate-key กับเครื่องที่ปลดระวางแล้ว', () => {
    const rotate = (deviceId: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/devices/${deviceId}/rotate-key`)
        .set(auth(adminToken))
        .send({});
    const hash = async (deviceId: string) =>
      (
        await prisma.$queryRaw<{ apiKeyHash: string | null }[]>`
          SELECT "apiKeyHash" FROM "Device" WHERE "deviceId" = ${deviceId}`
      )[0].apiKeyHash;

    it('ปลดระวางแล้ว -> 409 และ key ยังเป็นค่าว่าง (กล่องไม่กลับมาคุยกับระบบโดยไม่ผ่านการเปิดใช้งานกลับ) · เครื่องที่ใช้งานอยู่ออก key ได้ปกติ', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2');
      await decommission('DEV-1', { reason: 'x' });
      expect(await hash('DEV-1')).toBeNull();

      const blocked = await rotate('DEV-1');
      expect(blocked.status).toBe(409);
      expect(b(blocked).message).toContain('เปิดใช้งานเครื่องกลับก่อน');
      expect(await hash('DEV-1')).toBeNull();

      const ok = await rotate('DEV-2');
      expect(ok.status).toBe(200);
      expect(b(ok).apiKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('race: ผู้ปลดระวางถือล็อกเครื่อง (FOR UPDATE) -> ออก key รอ แล้วถูกปฏิเสธ ไม่เขียน key ทับที่ถูกล้าง', async () => {
      await seedDevice('DEV-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const holding = new Promise<void>((r) => (locked = r));

      const decommissioner = prisma.$transaction(async (tx) => {
        await lockDeviceForChange(tx, 'DEV-1');
        locked();
        await gate;
        await tx.device.update({
          where: { deviceId: 'DEV-1' },
          data: {
            status: 'decommissioned',
            apiKeyHash: null,
            telemetryKeyHash: null,
          },
        });
      });
      await holding;

      let settled = false;
      const rotateCall = rotate('DEV-1').then((r) => {
        settled = true;
        return r;
      });
      await sleep(500);
      expect(settled).toBe(false); // ยังรอล็อก ไม่ใช่ผ่านเพราะเรียงคิวบังเอิญ

      release();
      await decommissioner;
      const res = await rotateCall;
      expect(res.status).toBe(409);
      expect(await hash('DEV-1')).toBeNull();
    });
  });

  describe('Task create/update กับเครื่องที่ปลดระวาง (รีวิว B บน #452)', () => {
    const operation = () => ({ id: adminId, role: 'Operation' });
    const taskDto = (deviceId: string) => ({
      title: 'งานใหม่',
      assignedTo: otId,
      deviceId,
    });

    it('สร้างงานให้เครื่องที่ปลดระวางแล้ว -> 409 ไม่มีงานค้าง · เครื่องที่ใช้งานอยู่สร้างได้', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2');
      await decommission('DEV-1', { reason: 'x' });
      const tasks = app.get(TaskService, { strict: false });

      await expect(tasks.create(taskDto('DEV-1'), operation())).rejects.toThrow(
        /ปลดระวางแล้ว/,
      );
      expect(await prisma.task.count({ where: { deviceId: 'DEV-1' } })).toBe(0);

      const ok = await tasks.create(taskDto('DEV-2'), operation());
      expect(ok.deviceId).toBe('DEV-2');
    });

    it('ย้ายงานไปผูกเครื่องที่ปลดระวางแล้ว -> 409 · แก้งานเดิมของเครื่องที่ปลดระวางโดยไม่เปลี่ยนเครื่องยังทำได้', async () => {
      await seedDevice('DEV-1');
      await seedDevice('DEV-2');
      const tasks = app.get(TaskService, { strict: false });
      const onDev2 = await tasks.create(taskDto('DEV-2'), operation());
      const onDev1 = await tasks.create(taskDto('DEV-1'), operation());
      await prisma.task.update({
        where: { id: onDev1.id },
        data: { status: 'cancelled' },
      });
      await decommission('DEV-1', { reason: 'x' });

      await expect(
        tasks.update(onDev2.id, { deviceId: 'DEV-1' }, operation()),
      ).rejects.toThrow(/ปลดระวางแล้ว/);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: onDev2.id } }))
          .deviceId,
      ).toBe('DEV-2');

      const renamed = await tasks.update(
        onDev1.id,
        { title: 'แก้ชื่อ' },
        operation(),
      );
      expect(renamed.title).toBe('แก้ชื่อ');
    });

    it('race: ผู้ปลดระวางถือล็อกเครื่อง (FOR UPDATE) -> สร้างงานต้องรอ แล้วถูกปฏิเสธ ไม่มีงานค้างกับเครื่องที่ปลดระวาง', async () => {
      await seedDevice('DEV-1');
      const tasks = app.get(TaskService, { strict: false });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const holding = new Promise<void>((r) => (locked = r));

      const decommissioner = prisma.$transaction(async (tx) => {
        await lockDeviceForChange(tx, 'DEV-1');
        locked();
        await gate;
        await tx.device.update({
          where: { deviceId: 'DEV-1' },
          data: { status: 'decommissioned' },
        });
      });
      await holding;

      let settled = false;
      const createCall = tasks
        .create(taskDto('DEV-1'), operation())
        .then(
          () => 'created',
          (e: Error) => e.message,
        )
        .finally(() => (settled = true));
      await sleep(500);
      expect(settled).toBe(false); // ยังรอล็อก ไม่ใช่ผ่านเพราะเรียงคิวบังเอิญ

      release();
      await decommissioner;
      expect(await createCall).toContain('ปลดระวางแล้ว');
      expect(await prisma.task.count({ where: { deviceId: 'DEV-1' } })).toBe(0);
    });
  });

  describe('POST reactivate', () => {
    it('เปิดใช้กลับ: กลับเป็น registered + API key ใหม่ (แสดงครั้งเดียว ตรงกับ hash) + ล้างเวลา/เหตุผล/เวลาติดตั้งรอบก่อน + AuditLog', async () => {
      await seedDevice('DEV-1', { installedAt: new Date() });
      await decommission('DEV-1', { reason: 'x' });

      const res = await reactivate('DEV-1');
      expect(res.status).toBe(200);
      expect(b(res).status).toBe('registered');
      expect(b(res).installedAt).toBeNull(); // ต้องยืนยันติดตั้งใหม่
      expect(b(res).decommissionedAt).toBeNull();
      expect(b(res).decommissionReason).toBeNull();
      expect(b(res).apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(b(res).apiKeyHash).toBeUndefined();

      const row = await prisma.$queryRaw<{ apiKeyHash: string | null }[]>`
        SELECT "apiKeyHash" FROM "Device" WHERE "deviceId" = 'DEV-1'`;
      expect(row[0].apiKeyHash).toBeTruthy();
      expect(row[0].apiKeyHash).not.toBe(b(res).apiKey); // เก็บเป็น hash ไม่ใช่ค่าจริง
      expect(
        await prisma.auditLog.count({ where: { action: 'reactivate' } }),
      ).toBe(1);
    });

    it('เครื่องที่ไม่ได้ปลดระวาง -> 409 · ไม่พบ -> 404', async () => {
      await seedDevice('DEV-1');
      expect((await reactivate('DEV-1')).status).toBe(409);
      expect((await reactivate('NOPE')).status).toBe(404);
    });

    it('SIM เดิมถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว -> 409 บอกให้ส่ง SIM ใหม่ · ส่ง simNumber ใหม่แล้วผ่าน และเครื่องยังปลดระวางอยู่เมื่อล้มเหลว', async () => {
      await seedDevice('DEV-1');
      await decommission('DEV-1', { reason: 'x' });
      await seedDevice('DEV-2', { simNumber: 'SIM-DEV-1' }); // เอา SIM ที่ปลดปล่อยแล้วไปใช้

      const blocked = await reactivate('DEV-1');
      expect(blocked.status).toBe(409);
      expect(b(blocked).message).toContain('simNumber');
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'DEV-1' },
          })
        ).status,
      ).toBe('decommissioned');

      const ok = await reactivate('DEV-1', { simNumber: 'SIM-FRESH' });
      expect(ok.status).toBe(200);
      expect(b(ok).simNumber).toBe('SIM-FRESH');
    });

    it('เครื่องที่เปิดใช้กลับแล้วแก้ไขข้อมูลได้อีก และเลขประจำตัวเดิมยังเป็นของเครื่องนี้ (เครื่องอื่นใช้ IMEI เดิมไม่ได้)', async () => {
      await seedDevice('DEV-1');
      await decommission('DEV-1', { reason: 'x' });
      await reactivate('DEV-1');
      await seedDevice('DEV-2');

      expect((await patch('DEV-1', { simNumber: 'SIM-X' })).status).toBe(200);
      const dup = await patch('DEV-2', { imei: 'IMEI-DEV-1' });
      expect(dup.status).toBe(409);
    });
  });

  it('AuditLog ของทุก action ไม่มีผู้ใช้อื่นนอกจากผู้กระทำ', async () => {
    await seedDevice('DEV-1');
    await patch('DEV-1', { simNumber: 'N' });
    await decommission('DEV-1', { reason: 'x' });
    const logs = await prisma.auditLog.findMany();
    expect(logs.length).toBe(2);
    expect(new Set(logs.map((l) => l.userId))).toEqual(new Set([adminId]));
  });
});
