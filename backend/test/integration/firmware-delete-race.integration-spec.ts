import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { DeviceSyncModule } from '../../src/device-sync/device-sync.module';
import { DeviceTelemetryService } from '../../src/device-sync/device-telemetry.service';
import { FirmwareModule } from '../../src/firmware/firmware.module';
import {
  lockFirmwareForDelete,
  lockFirmwaresByReportedVersion,
} from '../../src/firmware/firmware-lock';
import { FirmwareService } from '../../src/firmware/firmware.service';
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
  let firmwareService: FirmwareService;
  let telemetryService: DeviceTelemetryService;
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
        DeviceSyncModule,
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
    firmwareService = moduleFixture.get(FirmwareService);
    telemetryService = moduleFixture.get(DeviceTelemetryService);
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

  // review B บน #426 (รอบ 2): กล่องรายงานเวอร์ชันผ่าน telemetry พร้อมกับการลบ · จังหวะแทรกแคบเกินกว่า
  // Promise.all จะชนซ้ำได้เสมอ จึงถือล็อกค้างไว้เองแล้วดูว่าอีกฝั่ง "ต้องรอ" จริง (deterministic)
  describe('telemetry รายงานเวอร์ชัน vs ลบ Firmware (ล็อกค้างไว้เพื่อบังคับจังหวะ)', () => {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function seedFirmwareAndDevice(version: string) {
      const fe = await makeUser(prisma, { role: 'FirmwareEngineer' });
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const firmware = await prisma.firmware.create({
        data: {
          version,
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
      return { fe, firmware, device };
    }

    it('ผู้ลบถือล็อกอยู่ -> telemetry ที่รายงานเวอร์ชันนั้นต้องรอจนผู้ลบ commit (ไม่แทรกผ่านล็อก) แล้วค่อยบันทึกรายงาน', async () => {
      const { firmware, device } = await seedFirmwareAndDevice('9.1.0');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const deleter = prisma.$transaction(
        async (tx) => {
          await lockFirmwareForDelete(tx, firmware.id);
          await gate;
          await tx.firmware.update({
            where: { id: firmware.id },
            data: { deletedAt: new Date() },
          });
        },
        { timeout: 20000 },
      );
      await sleep(300);

      let reportSettled = false;
      const reporting = telemetryService
        .report(device.deviceId, {
          latitude: 13.7,
          longitude: 100.5,
          fix: true,
          location_source: 'gps',
          timestamp: new Date().toISOString(),
          firmware_version: '9.1.0',
        })
        .then(() => {
          reportSettled = true;
        });
      await sleep(500);
      // ถ้า telemetry ไม่ล็อก Firmware มันจะเสร็จไปแล้วระหว่างที่ผู้ลบถือล็อก
      expect(reportSettled).toBe(false);

      release();
      await deleter;
      await reporting;
      const reported = await prisma.device.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(reported.reportedFirmwareVersion).toBe('9.1.0');
    });

    it('telemetry กำลังเขียนรายงานเวอร์ชัน (ยังไม่ commit) -> การลบต้องรอ แล้วเห็นรายงานนั้นและปฏิเสธ 409 ไม่ลบไฟล์', async () => {
      const { fe, firmware, device } = await seedFirmwareAndDevice('9.2.0');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const reporter = prisma.$transaction(
        async (tx) => {
          await lockFirmwaresByReportedVersion(tx, '9.2.0');
          await tx.device.update({
            where: { id: device.id },
            data: { reportedFirmwareVersion: '9.2.0' },
          });
          await gate;
        },
        { timeout: 20000 },
      );
      await sleep(300);

      let removeSettled = false;
      const removing = firmwareService
        .remove(firmware.id, { id: fe.id, role: 'FirmwareEngineer' })
        .then(
          () => 'removed' as const,
          (err: unknown) => err,
        )
        .finally(() => {
          removeSettled = true;
        });
      await sleep(500);
      expect(removeSettled).toBe(false);

      release();
      await reporter;
      const outcome = await removing;
      expect(outcome).toBeInstanceOf(ConflictException);
      expect(storageStub.deleteObject).not.toHaveBeenCalled();
      const after = await prisma.firmware.findUniqueOrThrow({
        where: { id: firmware.id },
      });
      expect(after.deletedAt).toBeNull();
    });
  });
});
