import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignPayloadType, CampaignRollout } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser } from './campaign.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';
import { FIRMWARE_ROLLBACK_EXECUTOR } from './firmware-rollback-executor';

const operation: ActingUser = { id: 'op-1', role: 'Operation' };
const campaignId = 'campaign-1';

const sampleCampaign = {
  id: campaignId,
  name: 'กลุ่มทดสอบ',
  description: null,
  createdBy: operation.id,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const approvedConfig = {
  id: 'cfg-1',
  name: 'ชุดตั้งค่า GT06N',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'approved' as const,
};

const installedDeviceA = {
  deviceId: 'DEV-0001',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed' as const,
};

const installedDeviceB = {
  deviceId: 'DEV-0002',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed' as const,
};

const groupTargets = [
  { id: 't-1', campaignId, deviceId: installedDeviceA.deviceId },
  { id: 't-2', campaignId, deviceId: installedDeviceB.deviceId },
];

const storedFirmware = {
  id: 'fw-1',
  version: '1.2.3',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored' as const,
  approvalStatus: 'approved' as const,
};

const sampleRollout: CampaignRollout = {
  id: 'rollout-1',
  campaignId,
  payloadType: CampaignPayloadType.Config,
  configId: approvedConfig.id,
  firmwareId: null,
  status: 'pending_approval',
  targetCount: 2,
  successCount: 0,
  failureCount: 0,
  createdBy: operation.id,
  approvedBy: null,
  approvedAt: null,
  isRollback: false,
  rollbackOfId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function baseDto(): CreateCampaignRolloutDto {
  return {
    payloadType: CampaignPayloadType.Config,
    configId: approvedConfig.id,
  };
}

function firmwareDto(): CreateCampaignRolloutDto {
  return {
    payloadType: CampaignPayloadType.Firmware,
    firmwareId: storedFirmware.id,
  };
}

describe('CampaignRolloutService', () => {
  let service: CampaignRolloutService;
  let campaign: { findUnique: jest.Mock };
  let campaignTarget: { findMany: jest.Mock };
  let campaignRollout: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let campaignRolloutTarget: {
    createMany: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let config: { findUnique: jest.Mock };
  let firmware: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock; update: jest.Mock };
  let auditLog: { create: jest.Mock };
  let firmwareRollbackExecutor: { switchPartition: jest.Mock };

  beforeEach(async () => {
    campaign = { findUnique: jest.fn().mockResolvedValue(sampleCampaign) };
    campaignTarget = { findMany: jest.fn().mockResolvedValue(groupTargets) };
    campaignRollout = {
      create: jest.fn().mockResolvedValue(sampleRollout),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null), // ไม่มี rollout ค้างอยู่ (default)
      update: jest.fn(),
      count: jest.fn(),
    };
    campaignRolloutTarget = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn(),
    };
    config = { findUnique: jest.fn().mockResolvedValue(approvedConfig) };
    firmware = { findUnique: jest.fn().mockResolvedValue(storedFirmware) };
    device = {
      findMany: jest
        .fn()
        .mockResolvedValue([installedDeviceA, installedDeviceB]),
      update: jest.fn(),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    firmwareRollbackExecutor = { switchPartition: jest.fn() };

    const prismaMock = {
      campaign,
      campaignTarget,
      campaignRollout,
      campaignRolloutTarget,
      config,
      firmware,
      device,
      auditLog,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ campaignRollout, campaignRolloutTarget }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignRolloutService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: FIRMWARE_ROLLBACK_EXECUTOR,
          useValue: firmwareRollbackExecutor,
        },
      ],
    }).compile();

    service = module.get(CampaignRolloutService);
  });

  describe('create', () => {
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Rollout+CampaignRolloutTarget[] จากสมาชิกกลุ่มทั้งหมด', async () => {
      const result = await service.create(campaignId, baseDto(), operation);

      expect(result).toEqual(sampleRollout);
      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: {
          campaignId,
          payloadType: CampaignPayloadType.Config,
          configId: approvedConfig.id,
          firmwareId: null,
          status: 'pending_approval',
          targetCount: 2,
          createdBy: operation.id,
        },
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          { rolloutId: sampleRollout.id, deviceId: installedDeviceA.deviceId },
          { rolloutId: sampleRollout.id, deviceId: installedDeviceB.deviceId },
        ],
      });
    });

    it('ไม่พบ Campaign -> NotFoundException', async () => {
      campaign.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing-id', baseDto(), operation),
      ).rejects.toThrow(NotFoundException);
    });

    it('กลุ่มนี้มี Rollout pending_approval ค้างอยู่ -> ConflictException', async () => {
      campaignRollout.findFirst.mockResolvedValue(sampleRollout);

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('กลุ่มนี้มี Rollout active ค้างอยู่ -> ConflictException', async () => {
      campaignRollout.findFirst.mockResolvedValue({
        ...sampleRollout,
        status: 'active',
      });

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('excludeDeviceIds เอาเครื่องออก 1 เครื่อง -> Rollout เหลือแค่เครื่องที่ไม่ได้ถูก exclude', async () => {
      const dto = {
        ...baseDto(),
        excludeDeviceIds: [installedDeviceB.deviceId],
      };

      await service.create(campaignId, dto, operation);

      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: {
          campaignId,
          payloadType: CampaignPayloadType.Config,
          configId: approvedConfig.id,
          firmwareId: null,
          status: 'pending_approval',
          targetCount: 1,
          createdBy: operation.id,
        },
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          { rolloutId: sampleRollout.id, deviceId: installedDeviceA.deviceId },
        ],
      });
    });

    it('excludeDeviceIds มีเครื่องที่ไม่ได้อยู่ในกลุ่ม -> BadRequestException', async () => {
      const dto = { ...baseDto(), excludeDeviceIds: ['DEV-9999'] };

      await expect(service.create(campaignId, dto, operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('excludeDeviceIds เอาออกหมดทุกเครื่อง -> BadRequestException', async () => {
      const dto = {
        ...baseDto(),
        excludeDeviceIds: [
          installedDeviceA.deviceId,
          installedDeviceB.deviceId,
        ],
      };

      await expect(service.create(campaignId, dto, operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('เขียน AuditLog action create หลังสร้างสำเร็จ', async () => {
      await service.create(campaignId, baseDto(), operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'create',
        },
      });
    });

    it('ไม่พบ Config -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(NotFoundException);
    });

    it('Config สถานะยังไม่อนุมัติ (draft) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'draft',
      });

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('Device deviceModel/protocol ไม่ตรงกับ Config -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, deviceModel: 'GT06E' },
      ]);

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('Device ยังไม่ installed -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, status: 'registered' },
      ]);

      await expect(
        service.create(campaignId, baseDto(), operation),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('create — payloadType Firmware', () => {
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Rollout ด้วย firmwareId (configId เป็น null)', async () => {
      const result = await service.create(campaignId, firmwareDto(), operation);

      expect(result).toEqual(sampleRollout);
      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: {
          campaignId,
          payloadType: CampaignPayloadType.Firmware,
          configId: null,
          firmwareId: storedFirmware.id,
          status: 'pending_approval',
          targetCount: 2,
          createdBy: operation.id,
        },
      });
      expect(config.findUnique).not.toHaveBeenCalled();
    });

    it('ไม่ระบุ firmwareId -> BadRequestException', async () => {
      const dto = { ...firmwareDto(), firmwareId: undefined };

      await expect(service.create(campaignId, dto, operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Firmware uploadStatus ไม่ใช่ stored -> ConflictException', async () => {
      firmware.findUnique.mockResolvedValue({
        ...storedFirmware,
        uploadStatus: 'pending',
      });

      await expect(
        service.create(campaignId, firmwareDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('Firmware approvalStatus ไม่ใช่ approved -> ConflictException', async () => {
      firmware.findUnique.mockResolvedValue({
        ...storedFirmware,
        approvalStatus: 'pending_review',
      });

      await expect(
        service.create(campaignId, firmwareDto(), operation),
      ).rejects.toThrow(ConflictException);
    });

    it('Device deviceModel ไม่อยู่ใน deviceModelCompatibility ของ Firmware -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, deviceModel: 'GT06E' },
      ]);

      await expect(
        service.create(campaignId, firmwareDto(), operation),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approve', () => {
    const pendingRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'pending_approval',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    it('pending_approval + ผู้อนุมัติไม่ใช่ผู้สร้าง -> active พร้อม approvedBy/approvedAt', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);
      campaignRollout.update.mockResolvedValue({
        ...pendingRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const result = await service.approve(pendingRollout.id, otherOperation);

      expect(result.status).toBe('active');
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: pendingRollout.id },
        data: expect.objectContaining({
          status: 'active',
          approvedBy: otherOperation.id,
        }) as Partial<CampaignRollout>,
      });
    });

    it('สถานะไม่ใช่ pending_approval -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...sampleRollout,
        status: 'active',
      });

      await expect(
        service.approve(sampleRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
    });

    it('ผู้อนุมัติเป็นผู้สร้าง Rollout เอง -> ForbiddenException (Separation of Duty)', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);

      await expect(
        service.approve(pendingRollout.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Firmware Rollback (isRollback=true) -> อนุมัติแล้วสั่งสลับพาร์ทิชันทันที ไม่รอช่างยืนยัน (Dual Partition mock)', async () => {
      const firmwareRollback: CampaignRollout = {
        ...pendingRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: 'fw-old',
        isRollback: true,
        rollbackOfId: 'rollout-bad',
        targetCount: 1,
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollback);
      campaignRollout.update
        .mockResolvedValueOnce({
          ...firmwareRollback,
          status: 'active',
          approvedBy: otherOperation.id,
        })
        .mockResolvedValueOnce({
          ...firmwareRollback,
          status: 'completed',
          successCount: 1,
          failureCount: 0,
        });
      campaignRolloutTarget.findMany.mockResolvedValue([
        { id: 'rt-1', rolloutId: firmwareRollback.id, deviceId: 'DEV-0001' },
      ]);
      device.findMany.mockResolvedValue([
        {
          ...installedDeviceA,
          activePartition: 'B',
          partitionAFirmwareId: 'fw-old',
          partitionBFirmwareId: 'fw-bad',
        },
      ]);
      firmwareRollbackExecutor.switchPartition.mockResolvedValue({
        switched: true,
        details: ['สลับสำเร็จ (mock)'],
        switchedAt: '2026-01-02T00:00:00.000Z',
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1) // success
        .mockResolvedValueOnce(0); // failed

      const result = await service.approve(firmwareRollback.id, otherOperation);

      expect(firmwareRollbackExecutor.switchPartition).toHaveBeenCalledWith({
        deviceId: 'DEV-0001',
        activePartition: 'B',
        inactivePartitionFirmwareId: 'fw-old',
        targetFirmwareId: 'fw-old',
      });
      expect(campaignRolloutTarget.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { status: 'success', resultDetail: 'สลับสำเร็จ (mock)' },
      });
      expect(device.update).toHaveBeenCalledWith({
        where: { deviceId: 'DEV-0001' },
        data: { activePartition: 'A' },
      });
      expect(result.status).toBe('completed');
    });

    it('Firmware Rollback แต่ของเก่าไม่อยู่บนพาร์ทิชันที่ไม่ active แล้ว -> target เป็น failed', async () => {
      const firmwareRollback: CampaignRollout = {
        ...pendingRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: 'fw-old',
        isRollback: true,
        rollbackOfId: 'rollout-bad',
        targetCount: 1,
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollback);
      campaignRollout.update
        .mockResolvedValueOnce({ ...firmwareRollback, status: 'active' })
        .mockResolvedValueOnce({
          ...firmwareRollback,
          status: 'completed',
          successCount: 0,
          failureCount: 1,
        });
      campaignRolloutTarget.findMany.mockResolvedValue([
        { id: 'rt-1', rolloutId: firmwareRollback.id, deviceId: 'DEV-0001' },
      ]);
      device.findMany.mockResolvedValue([
        {
          ...installedDeviceA,
          activePartition: 'B',
          partitionAFirmwareId: null,
          partitionBFirmwareId: 'fw-bad',
        },
      ]);
      firmwareRollbackExecutor.switchPartition.mockResolvedValue({
        switched: false,
        details: ['ของเก่าไม่อยู่แล้ว (mock)'],
        switchedAt: '2026-01-02T00:00:00.000Z',
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      const result = await service.approve(firmwareRollback.id, otherOperation);

      expect(device.update).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { status: 'failed', resultDetail: 'ของเก่าไม่อยู่แล้ว (mock)' },
      });
      expect(result.status).toBe('completed');
    });
  });

  describe('reject', () => {
    const pendingRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'pending_approval',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    it('pending_approval + ผู้ปฏิเสธไม่ใช่ผู้สร้าง -> rejected ไม่ตั้ง approvedBy', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);
      campaignRollout.update.mockResolvedValue({
        ...pendingRollout,
        status: 'rejected',
      });

      const result = await service.reject(pendingRollout.id, otherOperation);

      expect(result.status).toBe('rejected');
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: pendingRollout.id },
        data: { status: 'rejected' },
      });
    });

    it('ผู้ปฏิเสธเป็นผู้สร้าง Rollout เอง -> ForbiddenException', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);

      await expect(
        service.reject(pendingRollout.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resume', () => {
    it('paused -> active', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      campaignRollout.update.mockResolvedValue({
        ...pausedRollout,
        status: 'active',
      });

      const result = await service.resume(pausedRollout.id, operation);

      expect(result.status).toBe('active');
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: pausedRollout.id },
        data: { status: 'active' },
      });
    });

    it('ผู้สร้าง Rollout เองก็ resume ได้ (ไม่เช็ค Separation of Duty)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
        createdBy: operation.id,
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      campaignRollout.update.mockResolvedValue({
        ...pausedRollout,
        status: 'active',
      });

      await expect(
        service.resume(pausedRollout.id, operation),
      ).resolves.toMatchObject({ status: 'active' });
    });

    it('สถานะปัจจุบันไม่ใช่ paused -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...sampleRollout,
        status: 'active',
      });

      await expect(service.resume(sampleRollout.id, operation)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('rollback', () => {
    const badRollout: CampaignRollout = {
      ...sampleRollout,
      id: 'rollout-bad',
      status: 'active',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const previousRollout: CampaignRollout = {
      ...sampleRollout,
      id: 'rollout-prev',
      status: 'completed',
      configId: 'cfg-old',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const successTargets = [
      {
        id: 't-1',
        rolloutId: badRollout.id,
        deviceId: installedDeviceA.deviceId,
        status: 'success',
      },
      {
        id: 't-2',
        rolloutId: badRollout.id,
        deviceId: installedDeviceB.deviceId,
        status: 'success',
      },
    ];

    beforeEach(() => {
      campaignRollout.findUnique.mockResolvedValue(badRollout);
      campaignRollout.findFirst.mockResolvedValue(previousRollout);
      campaignRolloutTarget.findMany.mockResolvedValue(successTargets);
      campaignRollout.create.mockResolvedValue({
        ...previousRollout,
        id: 'rollout-new',
        status: 'pending_approval',
        isRollback: true,
        rollbackOfId: badRollout.id,
        targetCount: 2,
        createdBy: operation.id,
      });
    });

    it('สำเร็จ -> สร้าง Rollout ใหม่จาก payload ของรอบก่อนหน้าที่ completed ล่าสุด (payloadType เดียวกัน)', async () => {
      const result = await service.rollback(
        campaignId,
        badRollout.id,
        {},
        operation,
      );

      expect(campaignRollout.findFirst).toHaveBeenCalledWith({
        where: {
          campaignId,
          id: { not: badRollout.id },
          createdAt: { lt: badRollout.createdAt },
          status: 'completed',
          payloadType: badRollout.payloadType,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: {
          campaignId,
          payloadType: previousRollout.payloadType,
          configId: previousRollout.configId,
          firmwareId: previousRollout.firmwareId,
          status: 'pending_approval',
          targetCount: 2,
          createdBy: operation.id,
          isRollback: true,
          rollbackOfId: badRollout.id,
        },
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          { rolloutId: 'rollout-new', deviceId: installedDeviceA.deviceId },
          { rolloutId: 'rollout-new', deviceId: installedDeviceB.deviceId },
        ],
      });
      expect(result.isRollback).toBe(true);
    });

    it('excludeDeviceIds เอาเครื่องออก 1 เครื่อง -> targetCount เหลือ 1', async () => {
      await service.rollback(
        campaignId,
        badRollout.id,
        { excludeDeviceIds: [installedDeviceB.deviceId] },
        operation,
      );

      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: {
          campaignId,
          payloadType: previousRollout.payloadType,
          configId: previousRollout.configId,
          firmwareId: previousRollout.firmwareId,
          status: 'pending_approval',
          targetCount: 1,
          createdBy: operation.id,
          isRollback: true,
          rollbackOfId: badRollout.id,
        },
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          { rolloutId: 'rollout-new', deviceId: installedDeviceA.deviceId },
        ],
      });
    });

    it('Rollout เป้าหมายอยู่คนละ Campaign -> NotFoundException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        campaignId: 'other-campaign',
      });

      await expect(
        service.rollback(campaignId, badRollout.id, {}, operation),
      ).rejects.toThrow(NotFoundException);
    });

    it('สถานะยังไม่เคยส่ง payload จริง (pending_approval) -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        status: 'pending_approval',
      });

      await expect(
        service.rollback(campaignId, badRollout.id, {}, operation),
      ).rejects.toThrow(ConflictException);
    });

    it('ไม่มีรอบก่อนหน้าที่ completed ของ payloadType เดียวกัน -> BadRequestException', async () => {
      campaignRollout.findFirst.mockResolvedValue(null);

      await expect(
        service.rollback(campaignId, badRollout.id, {}, operation),
      ).rejects.toThrow(BadRequestException);
    });

    it('excludeDeviceIds มีเครื่องที่ไม่ได้อยู่ในรายการที่ได้รับ payload สำเร็จ -> BadRequestException', async () => {
      await expect(
        service.rollback(
          campaignId,
          badRollout.id,
          { excludeDeviceIds: ['DEV-9999'] },
          operation,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('excludeDeviceIds เอาออกหมดทุกเครื่อง -> BadRequestException', async () => {
      await expect(
        service.rollback(
          campaignId,
          badRollout.id,
          {
            excludeDeviceIds: [
              installedDeviceA.deviceId,
              installedDeviceB.deviceId,
            ],
          },
          operation,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('เขียน AuditLog action rollback หลังสร้างสำเร็จ', async () => {
      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'rollback',
        },
      });
    });
  });

  describe('findAll / findOne / findTargets', () => {
    it('findAll -> รายการ rollout ของกลุ่ม เรียง createdAt desc', async () => {
      campaignRollout.findMany.mockResolvedValue([sampleRollout]);

      const result = await service.findAll(campaignId);

      expect(result).toEqual([sampleRollout]);
      expect(campaignRollout.findMany).toHaveBeenCalledWith({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('findOne เจอ -> คืน rollout', async () => {
      campaignRollout.findUnique.mockResolvedValue(sampleRollout);

      const result = await service.findOne(sampleRollout.id);

      expect(result).toEqual(sampleRollout);
    });

    it('findOne ไม่เจอ -> NotFoundException', async () => {
      campaignRollout.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllAcrossCampaigns', () => {
    it('ไม่ระบุ status -> where.status เป็น undefined (คืนทุกสถานะ) เรียง createdAt desc', async () => {
      campaignRollout.findMany.mockResolvedValue([sampleRollout]);

      const result = await service.findAllAcrossCampaigns();

      expect(result).toEqual([sampleRollout]);
      expect(campaignRollout.findMany).toHaveBeenCalledWith({
        where: { status: undefined },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('ระบุ status -> filter ตามนั้น (ใช้กับ Approval Center ?status=pending_approval)', async () => {
      campaignRollout.findMany.mockResolvedValue([sampleRollout]);

      await service.findAllAcrossCampaigns('pending_approval');

      expect(campaignRollout.findMany).toHaveBeenCalledWith({
        where: { status: 'pending_approval' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('recordTargetResult', () => {
    const activeRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'active',
    };
    const pendingTarget = {
      id: 'rt-1',
      rolloutId: activeRollout.id,
      deviceId: installedDeviceA.deviceId,
      status: 'pending' as const,
      resultDetail: null,
    };

    it('เจอ rollout active + target pending ที่ตรงกัน -> อัปเดตผล + คำนวณ count ใหม่ (ยังไม่ครบ -> ไม่เปลี่ยนสถานะ)', async () => {
      campaignRollout.findFirst.mockResolvedValue(activeRollout);
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1) // success
        .mockResolvedValueOnce(0) // failed
        .mockResolvedValueOnce(1); // pending (ยังเหลือ DEV-0002)

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(campaignRolloutTarget.update).toHaveBeenCalledWith({
        where: { id: pendingTarget.id },
        data: { status: 'success', resultDetail: 'ok' },
      });
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: activeRollout.id },
        data: { successCount: 1, failureCount: 0, status: 'active' },
      });
    });

    it('ครบทุกเครื่องแล้ว (pending เหลือ 0) -> ปิด rollout เป็น completed', async () => {
      campaignRollout.findFirst.mockResolvedValue(activeRollout);
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: activeRollout.id },
        data: { successCount: 1, failureCount: 1, status: 'completed' },
      });
    });

    it('ไม่มี rollout active ที่ตรงกัน -> ไม่ทำอะไรเลย (never-throw)', async () => {
      campaignRollout.findFirst.mockResolvedValue(null);

      await expect(
        service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: 'other-cfg' },
          true,
          'ok',
        ),
      ).resolves.toBeUndefined();
      expect(campaignRolloutTarget.findFirst).not.toHaveBeenCalled();
    });

    it('ไม่มี target pending ที่ตรงกับ deviceId -> ไม่ทำอะไรเลย', async () => {
      campaignRollout.findFirst.mockResolvedValue(activeRollout);
      campaignRolloutTarget.findFirst.mockResolvedValue(null);

      await service.recordTargetResult(
        'DEV-NOT-IN-ROLLOUT',
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(campaignRolloutTarget.update).not.toHaveBeenCalled();
    });

    it('DB error ระหว่างอัปเดต -> ไม่ throw (never-throw)', async () => {
      campaignRollout.findFirst.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
        ),
      ).resolves.toBeUndefined();
    });

    it('failure rate เกิน 5% ระหว่างยังมี pending เหลือ (rollout ยัง active) -> Auto Pause', async () => {
      campaignRollout.findFirst.mockResolvedValue(activeRollout);
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0) // success
        .mockResolvedValueOnce(1) // failed -> failureRate 1/2 = 0.5 > 5%
        .mockResolvedValueOnce(1); // pending (ยังเหลือ DEV-0002)

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: activeRollout.id },
        data: { successCount: 0, failureCount: 1, status: 'paused' },
      });
    });

    it('rollout ที่ paused อยู่แล้ว -> ไม่เช็ค auto-pause ซ้ำ (คงสถานะ paused ต่อไป)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
      };
      campaignRollout.findFirst.mockResolvedValue(pausedRollout);
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: pausedRollout.id },
        data: { successCount: 0, failureCount: 1, status: 'paused' },
      });
    });
  });
});
