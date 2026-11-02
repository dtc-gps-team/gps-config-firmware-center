import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { FirmwareModule } from '../../src/firmware/firmware.module';
import { FirmwareStorageService } from '../../src/firmware/firmware-storage.service';
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
 * ลบ Firmware พร้อมกับสร้าง Rollout ที่ใช้ Firmware นั้น (review B บน #426): ผลต้องสอดคล้อง
 * เสมอ ไม่เกิด Rollout ที่อ้าง Firmware ที่ไฟล์ถูกลบ · Postgres จริงผ่าน HTTP (ล็อกแถว
 * Firmware ฝั่งลบ FOR UPDATE / ฝั่งสร้าง FOR SHARE) · storage เป็น stub ไม่แตะ MinIO
 */
describe('DELETE /firmware/:id พร้อมกับ POST /campaigns/:id/rollouts (race — integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  const storageStub = {
    uploadObject: jest.fn().mockResolvedValue(undefined),
    downloadObject: jest.fn().mockResolvedValue(Buffer.from('fw')),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        FirmwareModule,
        CampaignModule,
      ],
    })
      .overrideProvider(FirmwareStorageService)
      .useValue(storageStub)
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
    storageStub.deleteObject.mockClear();
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

  it('ผลสอดคล้องกันเสมอ: สร้าง Rollout สำเร็จ (201) -> ลบต้อง 409 และ Firmware+ไฟล์ยังอยู่ · ลบสำเร็จ (204) -> สร้างต้อง 404/409 และไม่มี Rollout อ้างถึง', async () => {
    const fe = await makeUser(prisma, { role: 'FirmwareEngineer' });
    const op = await makeUser(prisma, { role: 'Operation' });
    await grant('FirmwareEngineer', 'firmware', ActionType.Update);
    await grant('Operation', 'campaign', ActionType.Create);
    const feToken = tokenFor(fe.id, 'FirmwareEngineer');
    const opToken = tokenFor(op.id, 'Operation');
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');

    for (let round = 0; round < 5; round++) {
      storageStub.deleteObject.mockClear();
      const firmware = await prisma.firmware.create({
        data: {
          version: `1.0.${round}`,
          deviceModelCompatibility: ['GT06N'],
          uploadStatus: 'stored',
          approvalStatus: 'approved',
          objectKey: `firmware/${randomUUID()}/fw.bin`,
          originalFilename: 'fw.bin',
          fileSizeBytes: 10,
          uploadedBy: fe.id,
        },
      });
      const device = await prisma.device.create({
        data: {
          deviceId: `DEV-${randomUUID().slice(0, 8)}`,
          simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          modelId: model.id,
        },
      });
      const campaign = await prisma.campaign.create({
        data: { name: `กลุ่ม-${round}-${randomUUID()}`, createdBy: op.id },
      });
      await prisma.campaignTarget.create({
        data: { campaignId: campaign.id, deviceId: device.deviceId },
      });

      const [deleted, created] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/api/v1/firmware/${firmware.id}`)
          .set('Authorization', `Bearer ${feToken}`),
        request(app.getHttpServer())
          .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
          .set('Authorization', `Bearer ${opToken}`)
          .send({ payloadType: 'Firmware', firmwareId: firmware.id }),
      ]);

      const after = await prisma.firmware.findUniqueOrThrow({
        where: { id: firmware.id },
      });
      const referencing = await prisma.campaignRollout.count({
        where: { firmwareId: firmware.id },
      });

      if (created.status === 201) {
        expect(deleted.status).toBe(409);
        expect(after.deletedAt).toBeNull();
        expect(referencing).toBe(1);
        expect(storageStub.deleteObject).not.toHaveBeenCalled();
      } else {
        expect(deleted.status).toBe(204);
        expect([404, 409]).toContain(created.status);
        expect(after.deletedAt).not.toBeNull();
        expect(referencing).toBe(0);
        expect(storageStub.deleteObject).toHaveBeenCalledTimes(1);
      }
    }
  });
});
