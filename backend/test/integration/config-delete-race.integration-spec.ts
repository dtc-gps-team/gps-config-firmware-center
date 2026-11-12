import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { ConfigModule } from '../../src/config/config.module';
import { NotificationService } from '../../src/notification/notification.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { TaskModule } from '../../src/task/task.module';
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
 * ลบ Config พร้อมกับสร้าง reference ที่ชี้ Config เดียวกัน (review B บน #425 - TOCTOU):
 * ผลต้องสอดคล้องกันเสมอ ไม่เกิดแถวที่อ้าง Config ที่ถูกลบไปแล้ว · ยิงจริงผ่าน HTTP + Postgres
 * (ล็อกแถว Config ฝั่งลบ FOR UPDATE / ฝั่งสร้าง FOR SHARE)
 */
describe('DELETE /config/:id พร้อมกับการสร้าง reference (race — integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigModule,
        TaskModule,
        CampaignModule,
      ],
    })
      .overrideProvider(NotificationService)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
      .compile();

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
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    resource: string,
    action: ActionType,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  async function seedApprovedConfig(createdBy: string) {
    return prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        status: 'approved',
        fields: { APN: 'internet' },
        createdBy,
      },
    });
  }

  async function seedInstalledDevice() {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    return prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'installed',
        modelId: model.id,
      },
    });
  }

  it('ลบ Config พร้อมกับสร้าง Task ที่ผูก Config นั้น -> ถ้าสร้าง Task สำเร็จ (201) การลบต้อง 409 และ Config ไม่ถูกลบ · ถ้าลบสำเร็จ (204) การสร้าง Task ต้องไม่สำเร็จและไม่มี Task อ้างถึง', async () => {
    const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
    const op = await makeUser(prisma, { role: 'Operation' });
    const technician = await makeUser(prisma, { role: 'ST' });
    await grant('ConfigEngineer', 'config', ActionType.Update);
    await grant('Operation', 'tasks', ActionType.Create);
    const ceToken = tokenFor(ce.id, 'ConfigEngineer');
    const opToken = tokenFor(op.id, 'Operation');

    for (let round = 0; round < 8; round++) {
      const config = await seedApprovedConfig(ce.id);
      const device = await seedInstalledDevice();

      const [deleted, created] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/api/v1/config/${config.id}`)
          .set('Authorization', `Bearer ${ceToken}`),
        request(app.getHttpServer())
          .post('/api/v1/tasks')
          .set('Authorization', `Bearer ${opToken}`)
          .send({
            title: `ติดตั้ง ${round}`,
            assignedTo: technician.id,
            deviceId: device.deviceId,
            configId: config.id,
          }),
      ]);

      const after = await prisma.config.findUniqueOrThrow({
        where: { id: config.id },
      });
      const referencing = await prisma.task.count({
        where: { configId: config.id },
      });

      if (created.status === 201) {
        expect(deleted.status).toBe(409);
        expect(after.deletedAt).toBeNull();
        expect(referencing).toBe(1);
      } else {
        expect(deleted.status).toBe(204);
        expect([404, 409]).toContain(created.status);
        expect(after.deletedAt).not.toBeNull();
        expect(referencing).toBe(0);
      }
    }
  });

  it('ลบ Config พร้อมกับสร้าง Rollout ที่ใช้ Config นั้น -> ผลสอดคล้องกันเสมอ ไม่เกิด Rollout ที่อ้าง Config ที่ถูกลบ', async () => {
    const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
    const op = await makeUser(prisma, { role: 'Operation' });
    await grant('ConfigEngineer', 'config', ActionType.Update);
    await grant('Operation', 'campaign', ActionType.Create);
    const ceToken = tokenFor(ce.id, 'ConfigEngineer');
    const opToken = tokenFor(op.id, 'Operation');

    for (let round = 0; round < 8; round++) {
      const config = await seedApprovedConfig(ce.id);
      const device = await seedInstalledDevice();
      const campaign = await prisma.campaign.create({
        data: { name: `กลุ่ม-${round}-${randomUUID()}`, createdBy: op.id },
      });
      await prisma.campaignTarget.create({
        data: { campaignId: campaign.id, deviceId: device.deviceId },
      });

      const [deleted, created] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/api/v1/config/${config.id}`)
          .set('Authorization', `Bearer ${ceToken}`),
        request(app.getHttpServer())
          .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
          .set('Authorization', `Bearer ${opToken}`)
          .send({ payloadType: 'Config', configId: config.id }),
      ]);

      const after = await prisma.config.findUniqueOrThrow({
        where: { id: config.id },
      });
      const referencing = await prisma.campaignRollout.count({
        where: { configId: config.id },
      });

      if (created.status === 201) {
        expect(deleted.status).toBe(409);
        expect(after.deletedAt).toBeNull();
        expect(referencing).toBe(1);
      } else {
        expect(deleted.status).toBe(204);
        expect([404, 409]).toContain(created.status);
        expect(after.deletedAt).not.toBeNull();
        expect(referencing).toBe(0);
      }
    }
  });
});
