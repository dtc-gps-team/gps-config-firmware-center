import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignPayloadType, CampaignRollout, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser } from './campaign.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';
import { FIRMWARE_ROLLBACK_EXECUTOR } from './firmware-rollback-executor';
import { CONFIG_APPLIER } from '../device/config-applier';

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
  deletedAt: null as Date | null,
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
  let transactionMock: jest.Mock;
  let campaign: { findUnique: jest.Mock };
  let campaignTarget: { findMany: jest.Mock };
  let campaignRollout: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  let campaignRolloutTarget: {
    createMany: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  let config: { findUnique: jest.Mock };
  let firmware: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock; update: jest.Mock };
  let deviceConfigOverride: { findFirst: jest.Mock };
  let auditLog: { create: jest.Mock };
  let firmwareRollbackExecutor: { switchPartition: jest.Mock };
  let configApplier: { applyConfig: jest.Mock };

  beforeEach(async () => {
    campaign = { findUnique: jest.fn().mockResolvedValue(sampleCampaign) };
    campaignTarget = { findMany: jest.fn().mockResolvedValue(groupTargets) };
    campaignRollout = {
      create: jest.fn().mockResolvedValue(sampleRollout),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null), // ไม่มี rollout ค้างอยู่ (default)
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), // ชนะการแข่ง (default)
      count: jest.fn(),
    };
    campaignRolloutTarget = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      // #235 review รอบ 4 ข้อ 2 — recordTargetResult() claim target ผ่าน
      // updateMany({where:{id,status:'pending'}}) แทน update() เปล่าๆ แล้ว
      // default ชนะการ claim เสมอ (count:1) เทสที่ต้องการจำลอง race (แพ้
      // การ claim) ค่อย mockResolvedValueOnce({count:0}) เฉพาะเทสนั้น
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    // ไม่มี per-device override ที่ approved ค้างอยู่ (default) — เทสที่
    // ต้องการ override ค่อยตั้ง mockResolvedValueOnce เฉพาะเทสนั้น
    deviceConfigOverride = { findFirst: jest.fn().mockResolvedValue(null) };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    firmwareRollbackExecutor = { switchPartition: jest.fn() };
    configApplier = {
      applyConfig: jest.fn().mockResolvedValue({
        applied: true,
        details: ['ส่ง Config แล้ว (mock)'],
        appliedAt: '2026-01-02T00:00:00.000Z',
      }),
    };

    transactionMock = jest.fn((cb: (tx: unknown) => unknown) =>
      cb({ campaignRollout, campaignRolloutTarget }),
    );
    const prismaMock = {
      campaign,
      campaignTarget,
      campaignRollout,
      campaignRolloutTarget,
      config,
      firmware,
      device,
      deviceConfigOverride,
      auditLog,
      $transaction: transactionMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignRolloutService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: FIRMWARE_ROLLBACK_EXECUTOR,
          useValue: firmwareRollbackExecutor,
        },
        { provide: CONFIG_APPLIER, useValue: configApplier },
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

    it('เช็ค rollout ค้างอยู่ + สร้าง rollout อยู่ใน $transaction เดียวกัน ด้วย isolationLevel Serializable (กัน race condition — review B บน PR #224)', async () => {
      await service.create(campaignId, baseDto(), operation);

      expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
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

    it('pending_approval + ผู้อนุมัติไม่ใช่ผู้สร้าง -> approved พร้อม approvedBy/approvedAt (ไม่แตะอุปกรณ์เลย)', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...pendingRollout,
        status: 'approved',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const result = await service.approve(pendingRollout.id, otherOperation);

      expect(result.status).toBe('approved');
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: pendingRollout.id, status: 'pending_approval' },
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: otherOperation.id,
        }) as Partial<CampaignRollout>,
      });
      // แยก "อนุมัติ" ออกจาก "ปล่อยเข้าอุปกรณ์" แล้ว — approve() ต้องไม่
      // เรียก auto-apply/แตะอุปกรณ์ใดๆ เลย (ย้ายไปอยู่ที่ release() ทั้งหมด)
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
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

    it('race condition — มีคนอื่นตัดสินใจ Rollout นี้ไปแล้วระหว่างที่ทรานแซกชันกำลังจะ update (updateMany count 0) -> ConflictException (409), ไม่ throw P2025', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);
      campaignRollout.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approve(pendingRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
      expect(campaignRollout.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    const approvedRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'approved',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    it('approved -> active แล้วสั่ง auto-apply ต่อทันที (ไม่มี target ค้าง)', async () => {
      const activeRollout: CampaignRollout = {
        ...approvedRollout,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(approvedRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany ใน release()
        .mockResolvedValueOnce(activeRollout); // return สุดท้ายจาก autoApplyConfig (ไม่มี target pending)

      const result = await service.release(approvedRollout.id, otherOperation);

      expect(result.status).toBe('active');
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: approvedRollout.id, status: 'approved' },
        data: expect.objectContaining({
          status: 'active',
        }) as Partial<CampaignRollout>,
      });
    });

    it('ผู้อนุมัติเดิมเป็นคนกด release เองก็ได้ (ไม่เช็ค Separation of Duty)', async () => {
      const selfApproved: CampaignRollout = {
        ...approvedRollout,
        approvedBy: otherOperation.id,
      };
      const activeRollout: CampaignRollout = {
        ...selfApproved,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(selfApproved);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);

      await expect(
        service.release(selfApproved.id, otherOperation),
      ).resolves.toMatchObject({ status: 'active' });
    });

    it('สถานะปัจจุบันไม่ใช่ approved -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...sampleRollout,
        status: 'pending_approval',
      });
      campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.release(sampleRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
    });

    it('กด release ซ้ำพร้อมกัน (retry/double-click) -> คำขอที่สองได้ ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue(approvedRollout);
      campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.release(approvedRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('Firmware Rollback (isRollback=true) -> ปล่อยแล้วสั่งสลับพาร์ทิชันทันที ไม่รอช่างยืนยัน (Dual Partition mock)', async () => {
      const firmwareRollback: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: 'fw-old',
        isRollback: true,
        rollbackOfId: 'rollout-bad',
        targetCount: 1,
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollback);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...firmwareRollback,
        status: 'active',
        approvedBy: otherOperation.id,
      });
      campaignRollout.update.mockResolvedValueOnce({
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

      const result = await service.release(firmwareRollback.id, otherOperation);

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
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: 'fw-old',
        isRollback: true,
        rollbackOfId: 'rollout-bad',
        targetCount: 1,
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollback);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...firmwareRollback,
        status: 'active',
      });
      campaignRollout.update.mockResolvedValueOnce({
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

      const result = await service.release(firmwareRollback.id, otherOperation);

      expect(device.update).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { status: 'failed', resultDetail: 'ของเก่าไม่อยู่แล้ว (mock)' },
      });
      expect(result.status).toBe('completed');
    });

    it('Rollout Config ปกติ -> auto-apply ให้ทุกเครื่องทันทีตอน active ไม่ต้องรอช่างกด apply-config (มติ 2026-09-29 — PULL model)', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany ใน release()
        .mockResolvedValueOnce(activeRollout) // เช็คสถานะก่อนแตะเครื่อง 1
        .mockResolvedValueOnce(activeRollout) // เช็คสถานะก่อนแตะเครื่อง 2
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 2,
          failureCount: 0,
        }); // return สุดท้ายหลัง loop จบ

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst
        .mockResolvedValueOnce({ ...pendingTargets[0], rollout: activeRollout })
        .mockResolvedValueOnce({
          ...pendingTargets[1],
          rollout: activeRollout,
        });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1) // หลังเครื่อง 1: success 1, failed 0, pending 1
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0); // หลังเครื่อง 2: success 2, failed 0, pending 0
      device.findMany.mockResolvedValue([installedDeviceA, installedDeviceB]);

      const result = await service.release(twoDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).toHaveBeenCalledTimes(2);
      expect(configApplier.applyConfig).toHaveBeenNthCalledWith(1, {
        deviceId: 'DEV-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        // approvedConfig.fields เป็น undefined ในเทสนี้ — mergeApprovedOverride
        // spread เข้า object ใหม่เสมอ (ไม่มี override ค้างอยู่ -> {})
        fields: {},
      });
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: { status: 'success', resultDetail: 'ส่ง Config แล้ว (mock)' },
      });
      expect(result.status).toBe('completed');
      expect(result.successCount).toBe(2);
      // #235 review comment ข้อ 2 — AuditLog รายเครื่อง ไม่ใช่แค่ audit ของ
      // release() รอบเดียว ต้องเห็นร่องรอยว่าเครื่องไหนถูก apply-config บ้าง
      expect(auditLog.create).toHaveBeenCalledTimes(3); // 1 ของ release() + 2 ต่อเครื่อง
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: otherOperation.id,
          auditModule: 'campaign',
          action: 'apply-config',
          metadata: {
            deviceId: 'DEV-0001',
            configId: approvedConfig.id,
            fieldNames: [],
          },
        },
      });
    });

    it('มี DeviceConfigOverride approved ของเครื่องนั้น -> merge ทับ base fields ก่อนส่งเข้า applier (#235 review comment ข้อ 1)', async () => {
      const oneDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...oneDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(oneDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
          failureCount: 0,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: oneDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([installedDeviceA]);
      deviceConfigOverride.findFirst.mockResolvedValueOnce({
        id: 'override-1',
        deviceId: 'DEV-0001',
        configId: approvedConfig.id,
        fields: { APN: 'override-internet' },
        status: 'approved',
      });

      await service.release(oneDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).toHaveBeenCalledWith({
        deviceId: 'DEV-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'override-internet' },
      });
    });

    it('autoApplyConfig ส่ง rollout.id เข้า recordTargetResult() ด้วยเสมอ (#235 review รอบ 4 ข้อ 1 — end-to-end ผ่าน release())', async () => {
      const oneDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...oneDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(oneDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
          failureCount: 0,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: oneDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([installedDeviceA]);

      await service.release(oneDeviceRollout.id, otherOperation);

      expect(campaignRolloutTarget.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rolloutId: oneDeviceRollout.id,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
    });

    it('claim target แพ้ race กลางลูป -> ไม่ log audit ซ้ำสำหรับเครื่องนั้น แต่เครื่องถัดไปยัง apply ต่อได้ปกติ (#235 review รอบ 4 ข้อ 2 — end-to-end ผ่าน release())', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 1
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 2
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
          failureCount: 0,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst
        .mockResolvedValueOnce({ ...pendingTargets[0], rollout: activeRollout })
        .mockResolvedValueOnce({
          ...pendingTargets[1],
          rollout: activeRollout,
        });
      // เครื่อง 1 แพ้ race (มีคำขออื่น claim target นี้ไปแล้ว) — เครื่อง 2
      // claim สำเร็จตามปกติ (default mock count:1 จาก beforeEach)
      campaignRolloutTarget.updateMany.mockResolvedValueOnce({ count: 0 });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([installedDeviceA, installedDeviceB]);

      await service.release(twoDeviceRollout.id, otherOperation);

      // เครื่อง 1 แพ้ race -> ไม่ log audit ของ apply-config สำหรับ DEV-0001
      expect(auditLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'apply-config',
            metadata: expect.objectContaining({
              deviceId: 'DEV-0001',
            }) as Record<string, unknown>,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
      // เครื่อง 2 ยัง apply + log audit ตามปกติ ไม่ได้หยุดทั้ง loop เพราะ
      // เครื่อง 1 แพ้ race
      expect(configApplier.applyConfig).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'DEV-0002' }) as Record<
          string,
          unknown
        >,
      );
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'apply-config',
            metadata: expect.objectContaining({
              deviceId: 'DEV-0002',
            }) as Record<string, unknown>,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
    });

    it('Config ถูกลบไปแล้ว (soft-delete) ระหว่างรอปล่อย -> fail ทุกเครื่องที่ pending พร้อมเหตุผล ไม่เรียก applier เลย (#235 review รอบ 3 ข้อ 3)', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany ใน release()
        .mockResolvedValueOnce(activeRollout); // return สุดท้าย (ไม่มีการเช็คสถานะต่อเครื่องเพราะ fail ทั้งหมดตั้งแต่ต้นทาง)
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date('2026-01-03T00:00:00.000Z'),
      });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst
        .mockResolvedValueOnce({ ...pendingTargets[0], rollout: activeRollout })
        .mockResolvedValueOnce({
          ...pendingTargets[1],
          rollout: activeRollout,
        });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2);

      await service.release(twoDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining('ถูกลบไปแล้ว') as string,
        },
      });
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-2', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining('ถูกลบไปแล้ว') as string,
        },
      });
    });

    it('Config สถานะไม่ใช่ approved/synced อีกต่อไป (เช่น rejected) ระหว่างรอปล่อย -> fail ทุกเครื่องเช่นกัน', async () => {
      const oneDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...oneDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(oneDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'rejected' as const,
      });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: oneDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await service.release(oneDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining('rejected') as string,
        },
      });
    });

    it('Config หายไปเลย (ไม่พบ id เลย, แทบไม่เกิดจริง) -> fail ทุกเครื่องที่ pending พร้อม audit row แทนที่จะค้าง active เงียบๆ (#235 review รอบ 4 ข้อ 4/5)', async () => {
      const oneDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...oneDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(oneDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);
      config.findUnique.mockResolvedValue(null); // ไม่พบ Config เลย

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: oneDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await service.release(oneDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining(approvedConfig.id) as string,
        },
      });
      // #235 review รอบ 4 ข้อ 5 — branch นี้ต้องมี audit row ด้วย ไม่ใช่แค่
      // recordTargetResult เฉยๆ (ก่อนแก้ ไม่มี audit เลยสำหรับ branch นี้)
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: otherOperation.id,
          auditModule: 'campaign',
          action: 'apply-config',
          metadata: {
            deviceId: 'DEV-0001',
            configId: approvedConfig.id,
            fieldNames: [],
          },
        },
      });
    });

    it('เครื่องหนึ่งถูก decommission ไประหว่างรอปล่อย -> fail เฉพาะเครื่องนั้น ข้ามไป apply เครื่องถัดไปได้ตามปกติ (#235 review รอบ 3 ข้อ 3)', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 1
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 2
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
          failureCount: 1,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst
        .mockResolvedValueOnce({ ...pendingTargets[0], rollout: activeRollout })
        .mockResolvedValueOnce({
          ...pendingTargets[1],
          rollout: activeRollout,
        });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      // DEV-0001 ถูก decommission ไปแล้ว (status ไม่ใช่ installed อีกต่อไป)
      device.findMany.mockResolvedValue([
        { ...installedDeviceA, status: 'decommissioned' as const },
        installedDeviceB,
      ]);

      await service.release(twoDeviceRollout.id, otherOperation);

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining('installed') as string,
        },
      });
      // เครื่อง 2 ยัง apply ตามปกติ ไม่ได้หยุดทั้ง loop เพราะเครื่อง 1 มีปัญหา
      expect(configApplier.applyConfig).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'DEV-0002' }) as Record<
          string,
          unknown
        >,
      );
    });

    it('configApplier.applyConfig() throw กลางเครื่อง -> จับไว้ นับเครื่องนั้นเป็น failed ไม่ throw ทั้ง request (#235 review รอบ 2, ข้อ 3)', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      const pausedRollout: CampaignRollout = {
        ...activeRollout,
        status: 'paused',
        successCount: 0,
        failureCount: 1,
      };
      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 1
        .mockResolvedValueOnce(pausedRollout) // เช็คก่อนเครื่อง 2 -> หยุด (Auto Pause จาก failure เครื่อง 1)
        .mockResolvedValueOnce(pausedRollout); // return สุดท้าย

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0) // success
        .mockResolvedValueOnce(1) // failed -> failureRate 1/2 = 0.5 > 5%
        .mockResolvedValueOnce(1); // pending เหลือ 1
      configApplier.applyConfig.mockRejectedValueOnce(
        new Error('ConfigApplier จริงล่ม (mock เทสจำลอง network error)'),
      );
      device.findMany.mockResolvedValue([installedDeviceA, installedDeviceB]);

      // ต้องไม่ throw ออกมาจาก release() เลย แม้ applyConfig() throw กลางลูป
      const result = await service.release(twoDeviceRollout.id, otherOperation);

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining(
            'ConfigApplier จริงล่ม',
          ) as string,
        },
      });
      // เครื่องที่ 2 ไม่ถูกแตะเลย เพราะ Auto Pause หยุดก่อน (เหมือนกรณี
      // applied:false ปกติ — error ที่ throw ไม่ได้ทำให้ loop ทำงานผิดไปจากเดิม)
      expect(configApplier.applyConfig).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('paused');
    });

    it('Auto Pause ยังทำงานได้แม้ auto-apply หลายเครื่องในคำเรียกเดียว -> หยุดก่อนแตะเครื่องที่เหลือ', async () => {
      const twoDeviceRollout: CampaignRollout = {
        ...approvedRollout,
        targetCount: 2,
      };
      const activeRollout: CampaignRollout = {
        ...twoDeviceRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      const pausedRollout: CampaignRollout = {
        ...activeRollout,
        status: 'paused',
        successCount: 0,
        failureCount: 1,
      };

      campaignRollout.findUnique.mockResolvedValue(twoDeviceRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany
        .mockResolvedValueOnce(activeRollout) // เช็คก่อนเครื่อง 1 (ยัง active)
        .mockResolvedValueOnce(pausedRollout) // เช็คก่อนเครื่อง 2 -> ไม่ active แล้ว หยุด loop
        .mockResolvedValueOnce(pausedRollout); // return สุดท้ายหลัง loop จบ

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
        {
          id: 'rt-2',
          rolloutId: twoDeviceRollout.id,
          deviceId: 'DEV-0002',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0) // success
        .mockResolvedValueOnce(1) // failed -> failureRate 1/2 = 0.5 > 5%
        .mockResolvedValueOnce(1); // pending เหลือ 1 (DEV-0002 ยังไม่โดนแตะ)
      configApplier.applyConfig.mockResolvedValueOnce({
        applied: false,
        details: ['field ผิดพลาด (mock)'],
        appliedAt: '2026-01-02T00:00:00.000Z',
      });
      device.findMany.mockResolvedValue([installedDeviceA, installedDeviceB]);

      const result = await service.release(twoDeviceRollout.id, otherOperation);

      expect(configApplier.applyConfig).toHaveBeenCalledTimes(1); // ไม่แตะ DEV-0002 เลย
      expect(configApplier.applyConfig).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'DEV-0001' }) as Record<
          string,
          unknown
        >,
      );
      expect(result.status).toBe('paused');
    });

    it('Rollout Firmware ปกติ (ไม่ใช่ Rollback) -> auto-apply + Dual Partition bookkeeping ทันทีตอน active', async () => {
      const firmwareRollout: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: storedFirmware.id,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...firmwareRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
          failureCount: 0,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: firmwareRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([
        {
          ...installedDeviceA,
          activePartition: 'A',
          partitionAFirmwareId: null,
          partitionBFirmwareId: null,
        },
      ]);

      const result = await service.release(firmwareRollout.id, otherOperation);

      expect(device.update).toHaveBeenCalledWith({
        where: { deviceId: 'DEV-0001' },
        data: { activePartition: 'B', partitionBFirmwareId: storedFirmware.id },
      });
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'success',
          resultDetail: expect.stringContaining(
            storedFirmware.version,
          ) as string,
        },
      });
      expect(result.status).toBe('completed');
      // #235 review comment ข้อ 2 — AuditLog รายเครื่อง mirror
      // confirmFirmwareInstall() ของ DeviceService
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: otherOperation.id,
          auditModule: 'campaign',
          action: 'confirm-firmware-install',
          metadata: {
            deviceId: 'DEV-0001',
            firmwareId: storedFirmware.id,
            firmwareVersion: storedFirmware.version,
          },
        },
      });
    });

    it('Firmware auto-apply เขียน Dual Partition bookkeeping ไม่สำเร็จ -> นับเป็น failed ไม่ใช่ success เงียบๆ (#235 review comment ข้อ 4)', async () => {
      const firmwareRollout: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: storedFirmware.id,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...firmwareRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'paused',
          successCount: 0,
          failureCount: 1,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: firmwareRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([
        {
          ...installedDeviceA,
          activePartition: 'A',
          partitionAFirmwareId: null,
          partitionBFirmwareId: null,
        },
      ]);
      device.update.mockRejectedValueOnce(new Error('DB timeout (mock)'));

      const result = await service.release(firmwareRollout.id, otherOperation);

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail:
            'เขียน Dual Partition bookkeeping ไม่สำเร็จ — ไม่นับว่าติดตั้งสำเร็จ',
        },
      });
      // ต้อง log AuditLog ไว้ด้วยแม้ partition write ล้มเหลว — เห็นร่องรอยว่า
      // auto-apply เคยพยายามแตะเครื่องนี้
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: otherOperation.id,
          auditModule: 'campaign',
          action: 'confirm-firmware-install',
          metadata: {
            deviceId: 'DEV-0001',
            firmwareId: storedFirmware.id,
            firmwareVersion: storedFirmware.version,
          },
        },
      });
      expect(result.status).toBe('paused');
    });

    it('Firmware ถูกถอนอนุมัติคุณภาพไประหว่างรอปล่อย -> fail ทุกเครื่องที่ pending ไม่เขียน partition เลย (#235 review รอบ 3 ข้อ 4)', async () => {
      const firmwareRollout: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: storedFirmware.id,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...firmwareRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);
      firmware.findUnique.mockResolvedValue({
        ...storedFirmware,
        approvalStatus: 'rejected' as const,
      });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: firmwareRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await service.release(firmwareRollout.id, otherOperation);

      expect(device.update).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining('rejected') as string,
        },
      });
    });

    it('Firmware หายไปเลย (ไม่พบ id เลย, แทบไม่เกิดจริง) -> fail ทุกเครื่องที่ pending พร้อม audit row (#235 review รอบ 4 ข้อ 4/5)', async () => {
      const firmwareRollout: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: storedFirmware.id,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...firmwareRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);
      firmware.findUnique.mockResolvedValue(null); // ไม่พบ Firmware เลย

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: firmwareRollout.id,
          deviceId: 'DEV-0001',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await service.release(firmwareRollout.id, otherOperation);

      expect(device.update).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining(storedFirmware.id) as string,
        },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: otherOperation.id,
          auditModule: 'campaign',
          action: 'confirm-firmware-install',
          metadata: {
            deviceId: 'DEV-0001',
            firmwareId: storedFirmware.id,
          },
        },
      });
    });

    it('อุปกรณ์รุ่นไม่ตรงกับ deviceModelCompatibility ของ Firmware -> fail เฉพาะเครื่องนั้น (#235 review รอบ 3 ข้อ 4)', async () => {
      const firmwareRollout: CampaignRollout = {
        ...approvedRollout,
        payloadType: CampaignPayloadType.Firmware,
        configId: null,
        firmwareId: storedFirmware.id,
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...firmwareRollout,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 0,
          failureCount: 1,
        });

      const pendingTargets = [
        {
          id: 'rt-1',
          rolloutId: firmwareRollout.id,
          deviceId: 'DEV-0003',
          status: 'pending',
        },
      ];
      campaignRolloutTarget.findMany.mockResolvedValue(pendingTargets);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTargets[0],
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      // storedFirmware.deviceModelCompatibility = ['GT06N'] เท่านั้น
      device.findMany.mockResolvedValue([
        { ...installedDeviceB, deviceId: 'DEV-0003', deviceModel: 'GT06L' },
      ]);

      await service.release(firmwareRollout.id, otherOperation);

      expect(device.update).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: expect.stringContaining(
            'ไม่รองรับรุ่นอุปกรณ์',
          ) as string,
        },
      });
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
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...pendingRollout,
        status: 'rejected',
      });

      const result = await service.reject(pendingRollout.id, otherOperation);

      expect(result.status).toBe('rejected');
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: {
          id: pendingRollout.id,
          status: { in: ['pending_approval', 'approved'] },
        },
        data: { status: 'rejected' },
      });
    });

    // #250 review comment B — approved ที่ยังไม่ปล่อยเข้าอุปกรณ์ต้องมีทางถอย
    // ได้ก่อนแตะอุปกรณ์จริง ไม่งั้นทางเดียวที่หลุดออกจากสถานะนี้คือกด release
    // จริงแล้วค่อย rollback ซึ่งขัดเจตนาหลักของการแยกอนุมัติ/ปล่อย
    it('approved (อนุมัติไปแล้วแต่ยังไม่ปล่อย) + ผู้ปฏิเสธไม่ใช่ผู้สร้าง -> rejected ได้เช่นกัน', async () => {
      const approvedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'approved',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(approvedRollout);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...approvedRollout,
        status: 'rejected',
      });

      const result = await service.reject(approvedRollout.id, otherOperation);

      expect(result.status).toBe('rejected');
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: {
          id: approvedRollout.id,
          status: { in: ['pending_approval', 'approved'] },
        },
        data: { status: 'rejected' },
      });
    });

    it('สถานะไม่ใช่ pending_approval หรือ approved (เช่น active) -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...sampleRollout,
        status: 'active',
      });
      campaignRollout.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reject(sampleRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
    });

    it('ผู้ปฏิเสธเป็นผู้สร้าง Rollout เอง -> ForbiddenException', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);

      await expect(
        service.reject(pendingRollout.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ผู้สร้าง Rollout เอง พยายามปฏิเสธรอบที่ตัวเองสร้างหลังถูกอนุมัติแล้ว -> ForbiddenException เหมือนกัน (SoD ไม่เปลี่ยนตามสถานะ)', async () => {
      const approvedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'approved',
        approvedBy: 'op-2',
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      campaignRollout.findUnique.mockResolvedValue(approvedRollout);

      await expect(
        service.reject(approvedRollout.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });

    it('race condition — มีคนอื่นตัดสินใจ Rollout นี้ไปแล้วพร้อมกัน (updateMany count 0) -> ConflictException (409)', async () => {
      campaignRollout.findUnique.mockResolvedValue(pendingRollout);
      campaignRollout.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reject(pendingRollout.id, otherOperation),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resume', () => {
    it('paused -> active', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
      };
      const activeRollout: CampaignRollout = {
        ...pausedRollout,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      // #235 review รอบ 3 ข้อ 2 — resume() ใช้ updateMany+transaction แบบ
      // เดียวกับ approve() แล้ว (mock default updateMany คืน {count:1} ชนะ
      // การแข่งอยู่แล้วจาก beforeEach) ผลลัพธ์มาจาก findUniqueOrThrow แทน
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany ใน resume()
        .mockResolvedValueOnce(activeRollout); // return สุดท้ายจาก autoApplyConfig (ไม่มี target pending)

      const result = await service.resume(pausedRollout.id, operation);

      expect(result.status).toBe('active');
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: pausedRollout.id, status: 'paused' },
        data: expect.objectContaining({
          status: 'active',
        }) as Partial<CampaignRollout>,
      });
    });

    it('ผู้สร้าง Rollout เองก็ resume ได้ (ไม่เช็ค Separation of Duty)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
        createdBy: operation.id,
      };
      const activeRollout: CampaignRollout = {
        ...pausedRollout,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout);

      await expect(
        service.resume(pausedRollout.id, operation),
      ).resolves.toMatchObject({ status: 'active' });
    });

    it('มี target pending ค้างอยู่ -> เรียก auto-apply ต่อทันที (#235 review รอบ 2)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
        targetCount: 1,
      };
      const activeRollout: CampaignRollout = {
        ...pausedRollout,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout) // หลัง updateMany ใน resume()
        .mockResolvedValueOnce(activeRollout) // เช็คสถานะก่อนแตะเครื่อง 1
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
        }); // return สุดท้ายหลัง loop จบ

      const pendingTarget = {
        id: 'rt-1',
        rolloutId: pausedRollout.id,
        deviceId: 'DEV-0001',
        status: 'pending',
      };
      campaignRolloutTarget.findMany.mockResolvedValue([pendingTarget]);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTarget,
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0); // windowFailureCount (#235 review รอบ 3 ข้อ 1)
      device.findMany.mockResolvedValue([installedDeviceA]);

      const result = await service.resume(pausedRollout.id, operation);

      expect(configApplier.applyConfig).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'DEV-0001' }) as Record<
          string,
          unknown
        >,
      );
      expect(result.status).toBe('completed');
    });

    it('สถานะปัจจุบันไม่ใช่ paused -> ConflictException', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...sampleRollout,
        status: 'active',
      });
      // #235 review รอบ 3 ข้อ 2 — ไม่ใช่ paused จริง where ของ updateMany ไม่
      // match แถวไหนเลย (count 0) แทนที่จะเช็คนอก transaction เหมือนเดิม
      campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.resume(sampleRollout.id, operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Operation คนละคนกับผู้ approve เดิมเป็นคนกด resume -> audit row ของเครื่องที่ apply ต่อ ระบุชื่อคนกด resume จริง ไม่ใช่ผู้ approve เดิม (#235 review รอบ 4 ข้อ 3)', async () => {
      const originalApprover: ActingUser = { id: 'op-1', role: 'Operation' };
      const resumingOperator: ActingUser = { id: 'op-3', role: 'Operation' };
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
        targetCount: 1,
        approvedBy: originalApprover.id, // คนละคนกับ resumingOperator ที่จะกด resume
      };
      const activeRollout: CampaignRollout = {
        ...pausedRollout,
        status: 'active',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      campaignRollout.findUniqueOrThrow
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce(activeRollout)
        .mockResolvedValueOnce({
          ...activeRollout,
          status: 'completed',
          successCount: 1,
        });

      const pendingTarget = {
        id: 'rt-1',
        rolloutId: pausedRollout.id,
        deviceId: 'DEV-0001',
        status: 'pending',
      };
      campaignRolloutTarget.findMany.mockResolvedValue([pendingTarget]);
      campaignRolloutTarget.findFirst.mockResolvedValueOnce({
        ...pendingTarget,
        rollout: activeRollout,
      });
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      device.findMany.mockResolvedValue([installedDeviceA]);

      await service.resume(pausedRollout.id, resumingOperator);

      // audit ของ resume() เอง (ไม่เปลี่ยนพฤติกรรม — ระบุคนกด resume อยู่แล้ว)
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: resumingOperator.id,
          auditModule: 'campaign',
          action: 'resume',
        },
      });
      // audit ของ apply-config รายเครื่องที่ auto-apply ทำต่อ — ต้องระบุ
      // resumingOperator (คนกด resume จริง) ไม่ใช่ originalApprover (คนที่
      // approve รอบแรกไปนานแล้ว)
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: resumingOperator.id,
          auditModule: 'campaign',
          action: 'apply-config',
          metadata: {
            deviceId: 'DEV-0001',
            configId: approvedConfig.id,
            fieldNames: [],
          },
        },
      });
      expect(auditLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: originalApprover.id,
            action: 'apply-config',
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
    });

    it('กด resume ซ้ำพร้อมกัน (retry/double-click) -> คำขอที่สองได้ ConflictException (#235 review รอบ 3 ข้อ 2)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedRollout);
      // คำขอแรกชนะ (count 1) คำขอที่สองมาทีหลังตอน status ไม่ใช่ paused แล้ว
      campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.resume(pausedRollout.id, operation)).rejects.toThrow(
        ConflictException,
      );
      // ไม่ควรเรียก auto-apply เลยถ้า updateMany ไม่ชนะการแข่ง
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
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

    // #238 review B รอบ 2 ข้อ 2 — เดิม rollback() ไม่ cancel รอบเก่าที่ยัง
    // active/paused เลย ทำให้ค้างเป็น 2 รอบ active พร้อมกัน + การ์ด "Rollout
    // หยุดชั่วคราว" นับรอบเก่าไม่เลิก
    it('รอบเดิม status active -> cancel รอบเดิมใน transaction เดียวกับสร้างรอบใหม่', async () => {
      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: badRollout.id, status: 'active' },
        data: { status: 'cancelled' },
      });
    });

    it('รอบเดิม status paused -> cancel รอบเดิมด้วยเหมือนกัน', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        status: 'paused',
      });

      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: badRollout.id, status: 'paused' },
        data: { status: 'cancelled' },
      });
    });

    it('cancel รอบเดิม -> target ที่ยัง pending ถูก fail พร้อมเหตุผลและบวก failureCount', async () => {
      campaignRolloutTarget.updateMany.mockResolvedValue({ count: 3 });

      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { rolloutId: badRollout.id, status: 'pending' },
        data: {
          status: 'failed',
          resultDetail: 'rollout cancelled by rollback',
        },
      });
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: badRollout.id },
        data: { failureCount: { increment: 3 } },
      });
    });

    it('รอบเดิม completed -> ไม่ fail target', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        status: 'completed',
      });

      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
    });

    it('หลัง rollback แล้ว resume() กับรอบเดิม (cancelled) -> ConflictException ไม่กลับมา active', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        status: 'cancelled',
      });
      campaignRollout.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resume(badRollout.id, operation)).rejects.toThrow(
        ConflictException,
      );
      expect(campaignRollout.updateMany).toHaveBeenCalledWith({
        where: { id: badRollout.id, status: 'paused' },
        data: expect.objectContaining({
          status: 'active',
        }) as Partial<CampaignRollout>,
      });
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('รอบเดิม status completed -> ไม่ต้อง cancel (จบแล้วจริง ไม่มีอะไรค้าง)', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        status: 'completed',
      });

      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRollout.updateMany).not.toHaveBeenCalled();
    });

    it('แข่งกับคำขออื่นที่เปลี่ยนสถานะรอบเดิมไปแล้ว (count:0) -> ConflictException ไม่สร้างรอบใหม่', async () => {
      campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.rollback(campaignId, badRollout.id, {}, operation),
      ).rejects.toThrow(ConflictException);
      expect(campaignRollout.create).not.toHaveBeenCalled();
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
    const otherActiveRollout: CampaignRollout = {
      ...sampleRollout,
      id: 'rollout-other-group',
      status: 'active',
    };
    const pendingTarget = {
      id: 'rt-1',
      rolloutId: activeRollout.id,
      deviceId: installedDeviceA.deviceId,
      status: 'pending' as const,
      resultDetail: null,
      rollout: activeRollout,
    };

    it('เจอ target pending ที่เป็นสมาชิกของ rollout active ที่ payload ตรงกัน -> อัปเดตผล + คำนวณ count ใหม่ (ยังไม่ครบ -> ไม่เปลี่ยนสถานะ)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1) // success
        .mockResolvedValueOnce(0) // failed
        .mockResolvedValueOnce(1) // pending (ยังเหลือ DEV-0002)
        .mockResolvedValueOnce(0); // windowFailureCount (#235 review รอบ 3 ข้อ 1)

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      // query ต้องกรองผ่าน membership จริง (deviceId + status pending +
      // rollout active/paused + configId ตรงกัน) ไม่ใช่แค่ configId เฉยๆ —
      // รวม paused ด้วย (Auto Pause #28) เครื่องที่ช่างกำลังทำอยู่ตอน
      // auto-pause เพิ่งเกิดยังต้องบันทึกผลได้
      expect(campaignRolloutTarget.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: installedDeviceA.deviceId,
          status: 'pending',
          rollout: {
            status: { in: ['active', 'paused'] },
            configId: approvedConfig.id,
          },
        },
        include: { rollout: true },
      });
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: pendingTarget.id, status: 'pending' },
        data: { status: 'success', resultDetail: 'ok' },
      });
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: activeRollout.id },
        data: { successCount: 1, failureCount: 0, status: 'active' },
      });
    });

    it('ส่ง rolloutId เข้ามา -> query findFirst กรองด้วย rolloutId ตรงๆ ด้วย ตัดความกำกวมข้าม rollout (#235 review รอบ 4 ข้อ 1)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
        activeRollout.id, // rolloutId ใหม่ — จาก autoApplyConfig/autoApplyFirmware
      );

      expect(campaignRolloutTarget.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: installedDeviceA.deviceId,
          status: 'pending',
          rolloutId: activeRollout.id,
          rollout: {
            status: { in: ['active', 'paused'] },
            configId: approvedConfig.id,
          },
        },
        include: { rollout: true },
      });
    });

    it('ไม่ส่ง rolloutId (path เดิมจาก Mobile) -> query findFirst ไม่มี rolloutId ในเงื่อนไข เหมือนเดิมทุกประการ', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      // ไม่มี rolloutId ปนอยู่ใน where เลย (query เดิมทุกประการ, ไม่ใช่แค่ไม่
      // เท่ากับ undefined — key ต้องไม่ถูกใส่เข้าไปเลย)
      expect(campaignRolloutTarget.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: installedDeviceA.deviceId,
          status: 'pending',
          rollout: {
            status: { in: ['active', 'paused'] },
            configId: approvedConfig.id,
          },
        },
        include: { rollout: true },
      });
    });

    it('claim target ไม่สำเร็จ (มีคำขออื่น claim ไปก่อนแล้วระหว่างที่เรากำลังประมวลผล, race) -> คืน false ไม่ recompute count/pause ซ้ำ (#235 review รอบ 4 ข้อ 2)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      // แพ้ race — target ถูกคำขออื่น claim (status ไม่ใช่ pending แล้ว) ไปก่อน
      campaignRolloutTarget.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(result).toBe(false);
      // ไม่ควร recompute count หรือ trigger pause/complete ซ้ำ — คำขอที่ชนะ
      // การ claim ไปแล้วจะเป็นคนจัดการส่วนนี้เอง
      expect(campaignRolloutTarget.count).not.toHaveBeenCalled();
      expect(campaignRollout.update).not.toHaveBeenCalled();
    });

    it('ครบทุกเครื่องแล้ว (pending เหลือ 0) -> ปิด rollout เป็น completed', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1); // windowFailureCount (#235 review รอบ 3 ข้อ 1)

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

    it('2 กลุ่มต่างกันมี rollout active ใช้ configId เดียวกันพร้อมกัน — เครื่องเป็นสมาชิกของ rollout ตัวที่สองเท่านั้น -> ต้องอัปเดต rollout ตัวที่สอง (สมาชิกจริง) ไม่ใช่ตัวแรกที่เจอ', async () => {
      // query membership คืน target ที่ผูกกับ otherActiveRollout ตรงๆ (Prisma
      // เป็นคนกรองด้วย where.rollout ให้แล้ว — ในการใช้งานจริง ถ้าเครื่องไม่ได้
      // เป็นสมาชิกของ rollout แรก จะไม่ได้ target ของ rollout แรกกลับมาเลย)
      const targetOfSecondGroup = {
        ...pendingTarget,
        rolloutId: otherActiveRollout.id,
        rollout: otherActiveRollout,
      };
      campaignRolloutTarget.findFirst.mockResolvedValue(targetOfSecondGroup);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0); // windowFailureCount (#235 review รอบ 3 ข้อ 1)

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: targetOfSecondGroup.id, status: 'pending' },
        data: { status: 'success', resultDetail: 'ok' },
      });
      // ต้องคำนวณ/ปิดรอบของ otherActiveRollout (กลุ่มที่เครื่องเป็นสมาชิกจริง)
      // ไม่ใช่ activeRollout (กลุ่มแรกที่ไม่เกี่ยวข้อง)
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: otherActiveRollout.id },
        data: { successCount: 1, failureCount: 0, status: 'completed' },
      });
    });

    it('ไม่มี target pending ที่เป็นสมาชิกจริงของ rollout active/paused ที่ payload ตรงกัน -> ไม่ทำอะไรเลย (never-throw, log warning)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(null);

      await expect(
        service.recordTargetResult(
          'DEV-NOT-IN-ROLLOUT',
          { configId: approvedConfig.id },
          true,
          'ok',
        ),
      ).resolves.toBe(false);

      expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      expect(campaignRollout.update).not.toHaveBeenCalled();
    });

    it('DB error ระหว่างอัปเดต -> ไม่ throw (never-throw)', async () => {
      campaignRolloutTarget.findFirst.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
        ),
      ).resolves.toBe(false);
    });

    it('failure rate เกิน 5% ระหว่างยังมี pending เหลือ (rollout ยัง active) -> Auto Pause', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0) // success
        .mockResolvedValueOnce(1) // failed -> failureRate 1/2 = 0.5 > 5%
        .mockResolvedValueOnce(1) // pending (ยังเหลือ DEV-0002)
        // windowFailureCount (#235 review รอบ 3 ข้อ 1) — activeRollout ไม่มี
        // activeWindowStartedAt (fixture เดิมไม่ได้ตั้งไว้) เข้า fallback
        // branch คิวรีเดียวกับ failureCount ด้านบน ค่าจึงต้องเท่ากัน (1)
        .mockResolvedValueOnce(1);

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

    it('มี activeWindowStartedAt (resume แล้ว) -> คำนวณ failure rate เฉพาะ target ที่ updatedAt ใหม่กว่าหน้าต่างนี้เท่านั้น (#235 review รอบ 3 ข้อ 1)', async () => {
      const resumedRollout: CampaignRollout = {
        ...activeRollout,
        // สมมติ resume() เพิ่งเกิดเมื่อครู่ — failure ก่อนหน้านี้ (ที่เคยทำให้
        // pause รอบก่อน) ไม่ควรถูกนับรวมในรอบใหม่นี้อีก
        activeWindowStartedAt: new Date('2026-01-05T00:00:00.000Z'),
      };
      const targetOfResumedRollout = {
        ...pendingTarget,
        rollout: resumedRollout,
      };
      campaignRolloutTarget.findFirst.mockResolvedValue(targetOfResumedRollout);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1) // success สะสม
        .mockResolvedValueOnce(3) // failed สะสมทั้งประวัติ (สูงจากรอบก่อน pause)
        .mockResolvedValueOnce(1) // pending เหลือ
        // windowFailureCount รอบปัจจุบัน (ตั้งแต่ resume) — เครื่องนี้เพิ่ง
        // fail ไปแค่ตัวเดียวในรอบนี้ ไม่ใช่ 3 เหมือนค่าสะสม
        .mockResolvedValueOnce(1);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      // count call ตัวที่ 4 (windowFailureCount) ต้องกรอง updatedAt ด้วย
      // activeWindowStartedAt ต่างจาก 3 ตัวแรกที่นับสะสมทั้งหมด
      expect(campaignRolloutTarget.count).toHaveBeenNthCalledWith(4, {
        where: {
          rolloutId: resumedRollout.id,
          status: 'failed',
          updatedAt: { gte: resumedRollout.activeWindowStartedAt },
        },
      });
      // failureRate ที่ใช้ตัดสินใจ pause คือ windowFailureCount/targetCount
      // = 1/2 = 0.5 > 5% -> ยัง pause อยู่ (เคสนี้จงใจให้ยัง fail ในรอบใหม่
      // ด้วย) แต่ failureCount ที่โชว์ผู้ใช้ยังเป็นค่าสะสมจริง (3) ไม่ใช่ 1
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: resumedRollout.id },
        data: { successCount: 1, failureCount: 3, status: 'paused' },
      });
    });

    it('มี activeWindowStartedAt แต่ยังไม่มี failure ใหม่ในรอบนี้เลย -> ไม่ pause ซ้ำ แม้ failureCount สะสมจะสูง (แก้บั๊กหลัก #235 review รอบ 3 ข้อ 1)', async () => {
      const resumedRollout: CampaignRollout = {
        ...activeRollout,
        activeWindowStartedAt: new Date('2026-01-05T00:00:00.000Z'),
      };
      const targetOfResumedRollout = {
        ...pendingTarget,
        rollout: resumedRollout,
      };
      campaignRolloutTarget.findFirst.mockResolvedValue(targetOfResumedRollout);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(2) // success สะสม (รวมเครื่องที่เพิ่งสำเร็จ)
        .mockResolvedValueOnce(3) // failed สะสมทั้งประวัติ — สูงมาก (จากรอบก่อน pause)
        .mockResolvedValueOnce(0) // pending เหลือ 0 -> ครบแล้ว
        // windowFailureCount รอบปัจจุบัน = 0 (เครื่องเดียวที่ทำในรอบนี้สำเร็จ
        // ไม่ใช่ fail) — เดิมก่อนแก้ ใช้ failureCount สะสม (3) มาคำนวณ rate
        // จะ pause ซ้ำทันที ทั้งที่รอบนี้ไม่มีอะไรผิดพลาดเลย
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      // pendingCount = 0 -> completed ชนะเสมอไม่ว่า failure rate เท่าไหร่
      // (ไม่ใช่ตัวอย่างที่ดีที่สุดของ "ไม่ pause ซ้ำ" เพราะ completed ชนะอยู่
      // แล้ว — ดูเทสถัดไปสำหรับเคส pending > 0 ที่ต้องพึ่ง windowFailureCount
      // จริงๆ)
      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: resumedRollout.id },
        data: { successCount: 2, failureCount: 3, status: 'completed' },
      });
    });

    it('มี activeWindowStartedAt, ยัง pending เหลือ, ไม่มี failure ใหม่ในรอบนี้ -> ไม่ pause ซ้ำแม้ failureCount สะสมสูง', async () => {
      const resumedRollout: CampaignRollout = {
        ...activeRollout,
        targetCount: 4,
        activeWindowStartedAt: new Date('2026-01-05T00:00:00.000Z'),
      };
      const targetOfResumedRollout = {
        ...pendingTarget,
        rollout: resumedRollout,
      };
      campaignRolloutTarget.findFirst.mockResolvedValue(targetOfResumedRollout);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(2) // success สะสม
        .mockResolvedValueOnce(1) // failed สะสม (เคยทำให้ pause รอบก่อน)
        .mockResolvedValueOnce(1) // pending ยังเหลืออีก 1
        // windowFailureCount รอบนี้ = 0 — เครื่องที่เพิ่งทำสำเร็จ ไม่มี fail
        // ใหม่เลยตั้งแต่ resume — ถ้าใช้ failureCount สะสม (1) จะได้ rate
        // 1/4 = 25% > 5% pause ซ้ำทันที ทั้งที่รอบนี้ไปได้สวย
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(campaignRollout.update).toHaveBeenCalledWith({
        where: { id: resumedRollout.id },
        data: { successCount: 2, failureCount: 1, status: 'active' },
      });
    });

    it('rollout ที่ paused อยู่แล้ว -> ไม่เช็ค auto-pause ซ้ำ (คงสถานะ paused ต่อไป)', async () => {
      const pausedRollout: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
      };
      const targetOfPausedRollout = {
        ...pendingTarget,
        rolloutId: pausedRollout.id,
        rollout: pausedRollout,
      };
      campaignRolloutTarget.findFirst.mockResolvedValue(targetOfPausedRollout);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1); // windowFailureCount (#235 review รอบ 3 ข้อ 1) — ไม่มีผลเพราะ rollout.status !== 'active' ทำให้ shouldAutoPause เป็น false อยู่แล้ว

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
