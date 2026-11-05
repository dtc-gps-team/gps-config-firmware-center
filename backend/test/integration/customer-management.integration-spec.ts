import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { CustomerModule } from '../../src/customer/customer.module';
import { DeviceModule } from '../../src/device/device.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  getOrCreateRole,
  makeUser,
  resetDb,
  RoleCode,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * จัดการลูกค้า (มติ A 2026-11-05) ผ่าน HTTP + Postgres จริง: สิทธิ์ Admin/SuperAdmin, เพิ่ม/แก้/ปิดใช้งาน/ลบ,
 * ชื่อห้ามซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่, AuditLog เก็บชื่อบริษัท (snapshot) ไม่เก็บข้อมูลติดต่อ และ race ระหว่าง
 * ลบ/ปิดใช้งานลูกค้ากับการลงทะเบียนอุปกรณ์ที่ผูกลูกค้านั้น (ล็อกแถว Customer — `customer-lock.ts`)
 */
describe('Customer management (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CustomerModule,
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
    // RolePermission ไม่ถูก resetDb แตะ (ดู setup.ts)
    await prisma.rolePermission.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource: string,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  /** Admin ที่มีสิทธิ์ customer ครบ + ลงทะเบียนอุปกรณ์ได้ (เหมือน seed) */
  async function adminToken(): Promise<{ id: string; token: string }> {
    const admin = await makeUser(prisma, { role: 'Admin' });
    await grant('Admin', ActionType.Read, 'customer');
    await grant('Admin', ActionType.Create, 'customer');
    await grant('Admin', ActionType.Update, 'customer');
    await grant('Admin', ActionType.Create, 'device-registration');
    return { id: admin.id, token: tokenFor(admin.id, 'Admin') };
  }

  async function seedDevice(customerId: string | null, deviceId = 'DEV-C1') {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    return prisma.device.create({
      data: {
        deviceId,
        simNumber: `SIM-${deviceId}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        modelId: model.id,
        customerId,
      },
    });
  }

  async function registerBody(customerId: string, deviceId = 'REG-1') {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    return {
      deviceId,
      simNumber: `SIM-${deviceId}`,
      imei: `IMEI-${deviceId}`,
      serialNumber: `SN-${deviceId}`,
      blackboxId: `BB-${deviceId}`,
      modelId: model.id,
      protocol: 'TCP',
      customerId,
    };
  }

  describe('สิทธิ์', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .send({ companyName: 'X' })
        .expect(401);
    });

    it('role ที่ไม่มี grant customer (Operation) -> 403 ทั้ง managed/POST/PATCH/DELETE', async () => {
      const op = await makeUser(prisma, { role: 'Operation' });
      const token = tokenFor(op.id, 'Operation');
      const c = await prisma.customer.create({ data: { companyName: 'A' } });
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .get('/api/v1/customers/managed')
        .set(auth)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth)
        .send({ companyName: 'B' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set(auth)
        .send({ isActive: false })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${c.id}`)
        .set(auth)
        .expect(403);
    });

    it('SuperAdmin ผ่านด้วย bypass กลาง แม้ไม่มี grant', async () => {
      const su = await makeUser(prisma, { role: 'SuperAdmin' });
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenFor(su.id, 'SuperAdmin')}`)
        .send({ companyName: 'โดย SuperAdmin' })
        .expect(201);
    });

    it('ข้อมูลติดต่อเต็มอยู่หลังสิทธิ์ · GET /customers (ย่อ) ยังเปิดให้ทุก role และคืนแค่ id/ชื่อ/สถานะ', async () => {
      const c = await prisma.customer.create({
        data: {
          companyName: 'Metro',
          email: 'secret@example.com',
          phone: '0800000000',
        },
      });
      const st = await makeUser(prisma, { role: 'ST' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
        .expect(200);

      expect(res.body).toEqual([
        { id: c.id, companyName: 'Metro', isActive: true },
      ]);
    });
  });

  describe('เพิ่ม', () => {
    it('201 คืนข้อมูลเต็ม + deviceCount 0 · ตัดช่องว่างหัวท้าย · ช่องไม่บังคับที่เป็นช่องว่าง = ไม่กรอก', async () => {
      const { token } = await adminToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          companyName: '  ABC Logistics  ',
          contactName: '   ',
          email: 'ops@abc.example',
          phone: ' 0812345678 ',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        companyName: 'ABC Logistics',
        contactName: null,
        email: 'ops@abc.example',
        phone: '0812345678',
        priorityTier: null,
        isActive: true,
        deviceCount: 0,
      });
    });

    it('ไม่ส่งชื่อ / ชื่อช่องว่างล้วน / email ผิดรูปแบบ -> 400', async () => {
      const { token } = await adminToken();
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth)
        .send({ companyName: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth)
        .send({ companyName: 'X', email: 'ไม่ใช่อีเมล' })
        .expect(400);
    });

    it('ชื่อซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย -> 409', async () => {
      const { token } = await adminToken();
      await prisma.customer.create({ data: { companyName: 'ABC Logistics' } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyName: '  abc LOGISTICS ' })
        .expect(409);

      expect((res.body as { message: string }).message).toContain(
        'ABC Logistics',
      );
      expect(await prisma.customer.count()).toBe(1);
    });

    it('ชื่อซ้ำกับลูกค้าที่ปิดใช้งานอยู่ -> 409 บอกให้เปิดใช้งานลูกค้าเดิมแทน', async () => {
      const { token } = await adminToken();
      await prisma.customer.create({
        data: { companyName: 'Old Co', isActive: false },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyName: 'old co' })
        .expect(409);

      expect((res.body as { message: string }).message).toContain(
        'เปิดใช้งานลูกค้าเดิม',
      );
    });

    it('สร้างชื่อเดียวกันต่างตัวพิมพ์พร้อมกัน -> สำเร็จตัวเดียว อีกตัว 409 (advisory lock)', async () => {
      const { token } = await adminToken();

      for (let round = 0; round < 6; round++) {
        const [a, b] = await Promise.all([
          request(app.getHttpServer())
            .post('/api/v1/customers')
            .set('Authorization', `Bearer ${token}`)
            .send({ companyName: `Race ${round}` }),
          request(app.getHttpServer())
            .post('/api/v1/customers')
            .set('Authorization', `Bearer ${token}`)
            .send({ companyName: `race ${round}` }),
        ]);
        expect([a.status, b.status].sort()).toEqual([201, 409]);
      }
      expect(await prisma.customer.count()).toBe(6);
    });
  });

  describe('แก้ไข / ปิดใช้งาน', () => {
    it('เปลี่ยนชื่อได้ เครื่องที่ผูกอยู่ตามชื่อใหม่ (ผูกด้วย id) · ล้างช่องไม่บังคับด้วยค่าว่าง', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({
        data: { companyName: 'Old Name', phone: '0800000000' },
      });
      await seedDevice(c.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ companyName: 'New Name', phone: '' })
        .expect(200);

      expect(res.body).toMatchObject({
        companyName: 'New Name',
        phone: null,
        deviceCount: 1,
      });
      const device = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'DEV-C1' },
        include: { customer: true },
      });
      expect(device.customer?.companyName).toBe('New Name');
    });

    it('เปลี่ยนเป็นชื่อซ้ำลูกค้าอื่น -> 409 · เปลี่ยนตัวพิมพ์ของชื่อตัวเอง -> ผ่าน', async () => {
      const { token } = await adminToken();
      const a = await prisma.customer.create({
        data: { companyName: 'Alpha' },
      });
      await prisma.customer.create({ data: { companyName: 'Beta' } });
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${a.id}`)
        .set(auth)
        .send({ companyName: 'BETA' })
        .expect(409);
      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${a.id}`)
        .set(auth)
        .send({ companyName: 'ALPHA' })
        .expect(200);
    });

    it('ปิดใช้งานได้แม้มีเครื่องผูกอยู่ · เครื่องเดิมยังผูกลูกค้า · เปิดใช้งานกลับได้ · AuditLog แยก deactivate/activate', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'Co' } });
      await seedDevice(c.id);
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set(auth)
        .send({ isActive: false })
        .expect(200);
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'DEV-C1' },
          })
        ).customerId,
      ).toBe(c.id);

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set(auth)
        .send({ isActive: true })
        .expect(200);

      const actions = (
        await prisma.auditLog.findMany({
          where: { auditModule: 'customer' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((l) => l.action);
      expect(actions).toEqual(['deactivate', 'activate']);
    });

    it('GET /customers?activeOnly=true ตัดลูกค้าที่ปิดใช้งานออก · ไม่ส่ง = เห็นทุกคน', async () => {
      const { token } = await adminToken();
      await prisma.customer.create({ data: { companyName: 'On' } });
      await prisma.customer.create({
        data: { companyName: 'Off', isActive: false },
      });
      const auth = { Authorization: `Bearer ${token}` };

      const active = await request(app.getHttpServer())
        .get('/api/v1/customers?activeOnly=true')
        .set(auth)
        .expect(200);
      const all = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(auth)
        .expect(200);

      expect(
        (active.body as { companyName: string }[]).map((c) => c.companyName),
      ).toEqual(['On']);
      expect(
        (all.body as { companyName: string }[]).map((c) => c.companyName),
      ).toEqual(['Off', 'On']);
    });

    it('ไม่ส่ง field ใด -> 400 · id ไม่มีอยู่ -> 404 · ส่ง field แปลกปลอม -> 400', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'Co' } });
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set(auth)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/v1/customers/00000000-0000-4000-8000-000000000001')
        .set(auth)
        .send({ isActive: false })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${c.id}`)
        .set(auth)
        .send({ id: 'x' })
        .expect(400);
    });
  });

  describe('ลบ', () => {
    it('ไม่มีเครื่องผูก -> 204 ลบจริง และ AuditLog เก็บชื่อบริษัท (snapshot) ไม่เก็บอีเมล/เบอร์', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({
        data: {
          companyName: 'Gone Co',
          email: 'secret@example.com',
          phone: '0899999999',
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${c.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(await prisma.customer.count()).toBe(0);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { auditModule: 'customer', action: 'delete' },
      });
      expect(log.metadata).toEqual({
        customerId: c.id,
        companyName: 'Gone Co',
      });
      expect(JSON.stringify(log.metadata)).not.toContain('secret@example.com');
    });

    it('มีเครื่องผูกอยู่ (รวมเครื่องที่ปลดระวางแล้ว) -> 409 บอกจำนวน+ตัวอย่างเครื่อง ไม่ลบ ไม่ปลดลูกค้าออกจากเครื่อง', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'Busy' } });
      await seedDevice(c.id, 'DEV-A');
      const retired = await seedDevice(c.id, 'DEV-B');
      await prisma.device.update({
        where: { id: retired.id },
        data: { status: 'decommissioned' },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/customers/${c.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      const message = (res.body as { message: string }).message;
      expect(message).toContain('2 เครื่อง');
      expect(message).toContain('DEV-A');
      expect(message).toContain('ปิดใช้งาน');
      expect(await prisma.customer.count()).toBe(1);
      expect(await prisma.device.count({ where: { customerId: c.id } })).toBe(
        2,
      );
    });

    it('id ไม่มีอยู่ -> 404', async () => {
      const { token } = await adminToken();
      await request(app.getHttpServer())
        .delete('/api/v1/customers/00000000-0000-4000-8000-000000000001')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('ลงทะเบียนอุปกรณ์ผูกลูกค้า', () => {
    it('ลูกค้าปิดใช้งาน -> 409 ไม่สร้างเครื่อง', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({
        data: { companyName: 'Off', isActive: false },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send(await registerBody(c.id))
        .expect(409);

      expect((res.body as { message: string }).message).toContain('ปิดใช้งาน');
      expect(await prisma.device.count()).toBe(0);
    });

    it('ลูกค้าใช้งานอยู่ -> 201 ผูกลูกค้า', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'On' } });

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send(await registerBody(c.id))
        .expect(201);

      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'REG-1' },
          })
        ).customerId,
      ).toBe(c.id);
    });
  });

  /**
   * Race แบบ deterministic (ถือล็อกไว้ใน transaction ด้วยมือ + gate) — กันผลผ่านเพราะบังเอิญเรียงคิวถูก:
   * จำลองสถานะ "อีกฝั่งกำลังทำงานอยู่" แล้วยืนยันว่าอีกฝั่งต้องรอ (ยังไม่จบใน 500ms) แล้วค่อยปล่อย
   */
  describe('race: ลบ/ปิดใช้งานลูกค้า กับ การลงทะเบียนอุปกรณ์', () => {
    const settled = async (p: Promise<unknown>, ms = 500): Promise<boolean> =>
      Promise.race([
        p.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ]);

    it('ลงทะเบียนอุปกรณ์กำลังผูกลูกค้า (ถือ FOR SHARE) -> ลบลูกค้าต้องรอ แล้วเห็นเครื่องใหม่ -> 409 ไม่ปลดลูกค้าออกจากเครื่อง', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'R1' } });
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => (held = resolve));

      const registering = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${c.id} FOR SHARE`;
          held();
          await gate;
          await tx.device.create({
            data: {
              deviceId: 'RACE-DEV',
              simNumber: 'SIM-RACE',
              deviceModel: 'GT06N',
              protocol: 'TCP',
              modelId: model.id,
              customerId: c.id,
            },
          });
        },
        { timeout: 15000 },
      );
      await heldPromise;

      const deleting = request(app.getHttpServer())
        .delete(`/api/v1/customers/${c.id}`)
        .set('Authorization', `Bearer ${token}`)
        .then((r) => r);
      expect(await settled(deleting)).toBe(false); // ต้องรอ ไม่ใช่ลบทะลุ

      release();
      await registering;
      const res = await deleting;

      expect(res.status).toBe(409);
      expect(await prisma.customer.count()).toBe(1);
      expect(
        (
          await prisma.device.findUniqueOrThrow({
            where: { deviceId: 'RACE-DEV' },
          })
        ).customerId,
      ).toBe(c.id);
    });

    it('ลบลูกค้ากำลังทำงาน (ถือ FOR UPDATE) -> ลงทะเบียนอุปกรณ์ผูกลูกค้านั้นต้องรอ แล้วไม่สำเร็จ (ไม่เกิดเครื่องที่ผูกลูกค้าที่ถูกลบ)', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'R2' } });
      const body = await registerBody(c.id, 'RACE-REG');

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => (held = resolve));

      const deleting = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${c.id} FOR UPDATE`;
          held();
          await gate;
          await tx.customer.delete({ where: { id: c.id } });
        },
        { timeout: 15000 },
      );
      await heldPromise;

      const registering = request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .then((r) => r);
      expect(await settled(registering)).toBe(false);

      release();
      await deleting;
      const res = await registering;

      expect(res.status).toBe(404);
      expect(
        await prisma.device.count({ where: { deviceId: 'RACE-REG' } }),
      ).toBe(0);
    });

    it('ปิดใช้งานกำลังทำงาน (ถือ FOR UPDATE) -> ลงทะเบียนอุปกรณ์ต้องรอ แล้วเห็นว่าปิดใช้งานแล้ว -> 409', async () => {
      const { token } = await adminToken();
      const c = await prisma.customer.create({ data: { companyName: 'R3' } });
      const body = await registerBody(c.id, 'RACE-OFF');

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => (held = resolve));

      const deactivating = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${c.id} FOR UPDATE`;
          held();
          await gate;
          await tx.customer.update({
            where: { id: c.id },
            data: { isActive: false },
          });
        },
        { timeout: 15000 },
      );
      await heldPromise;

      const registering = request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .then((r) => r);
      expect(await settled(registering)).toBe(false);

      release();
      await deactivating;
      const res = await registering;

      expect(res.status).toBe(409);
      expect(
        await prisma.device.count({ where: { deviceId: 'RACE-OFF' } }),
      ).toBe(0);
    });
  });
});
