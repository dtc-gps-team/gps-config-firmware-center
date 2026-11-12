import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigModule } from '../../src/config/config.module';
import { DeviceModelModule } from '../../src/device-model/device-model.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateRole,
  makeUser,
  resetDb,
  RoleCode,
  TEST_DATABASE_URL,
  getOrCreateDeviceModel,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * ลบรุ่นอุปกรณ์ (มติ A 2026-11-05: "เลิกผลิต" เป็นปุ่มหลัก ลบจริงเฉพาะที่ไม่มีอะไรอ้างอิง) ผ่าน HTTP +
 * Postgres จริง: สิทธิ์, ตัวบล็อกแต่ละชนิด (อุปกรณ์/Config/Firmware/พารามิเตอร์ รวมที่ปลดระวาง/ลบแล้ว),
 * AuditLog snapshot และ race ระหว่างลบรุ่นกับสร้าง Config ที่อ้างรุ่นนั้น (ล็อกแถว DeviceModel)
 */
describe('DELETE /device-models/:id (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        DeviceModelModule,
        ConfigModule,
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
    await prisma.configFieldDefinition.deleteMany();
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

  async function adminToken(): Promise<string> {
    const admin = await makeUser(prisma, { role: 'Admin' });
    await grant('Admin', ActionType.Update, 'device-model');
    return tokenFor(admin.id, 'Admin');
  }

  function newModel(name = 'DM-DEL') {
    return prisma.deviceModel.create({
      data: { name, supportedProtocols: ['TCP'] },
    });
  }

  async function ownerId(): Promise<string> {
    return (await makeUser(prisma, { role: 'ConfigEngineer' })).id;
  }

  describe('สิทธิ์', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      const m = await newModel();
      await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .expect(401);
    });

    it('role ที่ไม่มี grant device-model.Update (Operation) -> 403 ไม่ลบ', async () => {
      const m = await newModel();
      const op = await makeUser(prisma, { role: 'Operation' });

      await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${tokenFor(op.id, 'Operation')}`)
        .expect(403);
      expect(await prisma.deviceModel.count()).toBe(1);
    });

    it('SuperAdmin ผ่านด้วย bypass กลาง แม้ไม่มี grant', async () => {
      const m = await newModel();
      const su = await makeUser(prisma, { role: 'SuperAdmin' });

      await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${tokenFor(su.id, 'SuperAdmin')}`)
        .expect(204);
    });
  });

  describe('ลบ', () => {
    it('ไม่มีอะไรอ้างอิง -> 204 ลบจริง + AuditLog เก็บชื่อรุ่น (snapshot)', async () => {
      const token = await adminToken();
      const m = await newModel('GT-TYPO');

      await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(await prisma.deviceModel.count()).toBe(0);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { auditModule: 'device-model', action: 'delete' },
      });
      expect(log.metadata).toEqual({
        deviceModelId: m.id,
        modelName: 'GT-TYPO',
      });
    });

    it('id ไม่มีอยู่ -> 404', async () => {
      const token = await adminToken();
      await request(app.getHttpServer())
        .delete('/api/v1/device-models/00000000-0000-4000-8000-000000000001')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('มีอุปกรณ์อ้างอิง (รวมที่ปลดระวางแล้ว) -> 409 บอกจำนวน ชี้ไปทาง "เลิกผลิต" ไม่ลบ', async () => {
      const token = await adminToken();
      const m = await newModel();
      for (const [i, status] of (
        ['installed', 'decommissioned'] as const
      ).entries()) {
        await prisma.device.create({
          data: {
            deviceId: `DEV-${i}`,
            simNumber: `SIM-${i}`,
            deviceModel: m.name,
            protocol: 'TCP',
            modelId: m.id,
            status,
          },
        });
      }

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      const message = (res.body as { message: string }).message;
      expect(message).toContain('อุปกรณ์ 2 เครื่อง');
      expect(message).toContain('เลิกผลิต');
      expect(await prisma.deviceModel.count()).toBe(1);
    });

    it('มี Config อ้างอิงชื่อรุ่น (รวมที่ลบแบบ soft delete แล้ว) -> 409 แยกจำนวนที่ลบแล้ว', async () => {
      const token = await adminToken();
      const m = await newModel();
      const by = await ownerId();
      await prisma.config.create({
        data: {
          name: 'c1',
          modelId: (await getOrCreateDeviceModel(prisma, m.name)).id,
          protocol: 'TCP',
          fields: {},
          createdBy: by,
        },
      });
      await prisma.config.create({
        data: {
          name: 'c2',
          modelId: (await getOrCreateDeviceModel(prisma, m.name)).id,
          protocol: 'TCP',
          fields: {},
          createdBy: by,
          deletedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect((res.body as { message: string }).message).toContain(
        'Config 2 ตัว (ลบแล้ว 1)',
      );
    });

    it('มี Firmware / พารามิเตอร์อ้างอิงชื่อรุ่น -> 409 บอกครบทุกชนิดที่อ้างอยู่ในข้อความเดียว', async () => {
      const token = await adminToken();
      const m = await newModel();
      const by = await ownerId();
      await prisma.firmware.create({
        data: {
          version: '1.0.0',
          deviceModelCompatibility: [m.name],
          objectKey: 'k',
          originalFilename: 'f.bin',
          fileSizeBytes: 1,
          uploadedBy: by,
        },
      });
      await prisma.configFieldDefinition.create({
        data: {
          fieldName: 'P1',
          dataType: 'string',
          allowedValues: [],
          required: false,
          supportedModels: {
            create: [{ deviceModel: m.name, protocol: 'TCP' }],
          },
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      const message = (res.body as { message: string }).message;
      expect(message).toContain('Firmware 1 ตัว');
      expect(message).toContain('พารามิเตอร์ 1 รายการ');
      expect(await prisma.deviceModel.count()).toBe(1);
    });

    it('รุ่นอื่นที่ไม่มีอะไรอ้างอิงลบได้แม้รุ่นข้างเคียงถูกอ้างอยู่ (นับเฉพาะชื่อของรุ่นนั้น)', async () => {
      const token = await adminToken();
      const used = await newModel('USED');
      const spare = await newModel('SPARE');
      await prisma.config.create({
        data: {
          name: 'c1',
          modelId: (await getOrCreateDeviceModel(prisma, used.name)).id,
          protocol: 'TCP',
          fields: {},
          createdBy: await ownerId(),
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/device-models/${spare.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      expect(await prisma.deviceModel.count()).toBe(1);
    });
  });

  /**
   * Race แบบ deterministic (ถือล็อกใน transaction ด้วยมือ + gate): ยืนยันว่าอีกฝั่งต้องรอ (ยังไม่จบใน 500ms)
   * แล้วค่อยปล่อย — กันผลผ่านเพราะบังเอิญเรียงคิวถูก
   */
  describe('race: ลบรุ่น กับ สร้าง Config ที่อ้างรุ่นนั้น', () => {
    const settled = (p: Promise<unknown>, ms = 500): Promise<boolean> =>
      Promise.race([
        p.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ]);

    async function seedField(): Promise<void> {
      await prisma.configFieldDefinition.create({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: false,
          appliesToAllModels: true,
        },
      });
    }

    it('สร้าง Config กำลังทำงาน (ถือ FOR SHARE) -> ลบรุ่นต้องรอ แล้วเห็น Config ใหม่ -> 409 ไม่ลบ', async () => {
      const token = await adminToken();
      const m = await newModel('DM-RACE');
      const by = await ownerId();

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => (held = resolve));

      const creating = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "DeviceModel" WHERE name = ${m.name} FOR SHARE`;
          held();
          await gate;
          await tx.config.create({
            data: {
              name: 'race-cfg',
              modelId: (await getOrCreateDeviceModel(prisma, m.name)).id,
              protocol: 'TCP',
              fields: {},
              createdBy: by,
            },
          });
        },
        { timeout: 15000 },
      );
      await heldPromise;

      const deleting = request(app.getHttpServer())
        .delete(`/api/v1/device-models/${m.id}`)
        .set('Authorization', `Bearer ${token}`)
        .then((r) => r);
      expect(await settled(deleting)).toBe(false);

      release();
      await creating;
      const res = await deleting;

      expect(res.status).toBe(409);
      expect(await prisma.deviceModel.count()).toBe(1);
    });

    it('ลบรุ่นกำลังทำงาน (ถือ FOR UPDATE) -> สร้าง Config ที่อ้างรุ่นนั้นต้องรอ แล้วไม่สำเร็จ (ไม่เกิด Config ที่อ้างรุ่นที่ถูกลบ)', async () => {
      await seedField();
      const m = await newModel('DM-RACE2');
      const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Create, 'config');

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => (held = resolve));

      const deleting = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "DeviceModel" WHERE id = ${m.id} FOR UPDATE`;
          held();
          await gate;
          await tx.deviceModel.delete({ where: { id: m.id } });
        },
        { timeout: 15000 },
      );
      await heldPromise;

      const creating = request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${tokenFor(ce.id, 'ConfigEngineer')}`)
        .send({
          name: 'cfg-after-delete',
          modelId: m.id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        })
        .then((r) => r);
      expect(await settled(creating)).toBe(false);

      release();
      await deleting;
      const res = await creating;

      expect(res.status).toBe(409);
      expect(await prisma.config.count({ where: { modelId: m.id } })).toBe(0);
    });
  });
});
