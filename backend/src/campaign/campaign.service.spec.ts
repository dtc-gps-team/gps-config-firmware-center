import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign, CampaignPayloadType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

type CampaignDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
};

const operation: ActingUser = { id: 'op-1', role: 'Operation' };

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

const storedFirmware = {
  id: 'fw-1',
  version: '1.2.3',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored' as const,
  approvalStatus: 'approved' as const,
};

const sampleCampaign: Campaign = {
  id: 'campaign-1',
  name: 'แคมเปญทดสอบ',
  description: null,
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function baseDto(): CreateCampaignDto {
  return {
    name: 'แคมเปญทดสอบ',
    payloadType: CampaignPayloadType.Config,
    configId: approvedConfig.id,
    targets: [
      { deviceId: installedDeviceA.deviceId },
      { deviceId: installedDeviceB.deviceId },
    ],
  };
}

function firmwareDto(): CreateCampaignDto {
  return {
    name: 'แคมเปญอัปเดตเฟิร์มแวร์ทดสอบ',
    payloadType: CampaignPayloadType.Firmware,
    firmwareId: storedFirmware.id,
    targets: [
      { deviceId: installedDeviceA.deviceId },
      { deviceId: installedDeviceB.deviceId },
    ],
  };
}

describe('CampaignService', () => {
  let service: CampaignService;
  let campaign: CampaignDelegateMock;
  let campaignTarget: { createMany: jest.Mock };
  let config: { findUnique: jest.Mock };
  let firmware: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock };
  let auditLog: { create: jest.Mock };

  beforeEach(async () => {
    campaign = {
      create: jest.fn().mockResolvedValue(sampleCampaign),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    campaignTarget = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    config = { findUnique: jest.fn().mockResolvedValue(approvedConfig) };
    firmware = { findUnique: jest.fn().mockResolvedValue(storedFirmware) };
    device = {
      findMany: jest
        .fn()
        .mockResolvedValue([installedDeviceA, installedDeviceB]),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };

    const prismaMock = {
      campaign,
      campaignTarget,
      config,
      firmware,
      device,
      auditLog,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ campaign, campaignTarget }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(CampaignService);
  });

  describe('create', () => {
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Campaign+CampaignTarget[] ใน transaction เดียว (ไม่สร้าง Task — Campaign ไม่มอบหมายงานให้ช่างหน้างาน)', async () => {
      const result = await service.create(baseDto(), operation);

      expect(result).toEqual(sampleCampaign);
      expect(campaign.create).toHaveBeenCalledWith({
        data: {
          name: 'แคมเปญทดสอบ',
          description: undefined,
          payloadType: CampaignPayloadType.Config,
          configId: approvedConfig.id,
          firmwareId: null,
          status: 'pending_approval',
          targetCount: 2,
          createdBy: operation.id,
        },
      });
      expect(campaignTarget.createMany).toHaveBeenCalledWith({
        data: [
          {
            campaignId: sampleCampaign.id,
            deviceId: installedDeviceA.deviceId,
          },
          {
            campaignId: sampleCampaign.id,
            deviceId: installedDeviceB.deviceId,
          },
        ],
      });
    });

    it('เขียน AuditLog action create หลังสร้างสำเร็จ', async () => {
      await service.create(baseDto(), operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'create',
        },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> create() ยังสำเร็จปกติ (never-throw)', async () => {
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(service.create(baseDto(), operation)).resolves.toEqual(
        sampleCampaign,
      );
    });

    it('มี deviceId ซ้ำกันในรายการเป้าหมาย -> BadRequestException', async () => {
      const dto = baseDto();
      dto.targets = [
        { deviceId: installedDeviceA.deviceId },
        { deviceId: installedDeviceA.deviceId },
      ];

      await expect(service.create(dto, operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ไม่พบ Config -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Config สถานะยังไม่อนุมัติ (draft) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'draft',
      });

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ไม่พบ Device สำหรับ deviceId เป้าหมาย -> ConflictException', async () => {
      device.findMany.mockResolvedValue([installedDeviceA]); // ขาด DEV-0002

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Device ยังไม่ installed -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, status: 'registered' },
      ]);

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Device deviceModel/protocol ไม่ตรงกับ Config -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, deviceModel: 'GT06E' },
      ]);

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('create — payloadType Firmware', () => {
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Campaign ด้วย firmwareId (configId เป็น null)', async () => {
      const result = await service.create(firmwareDto(), operation);

      expect(result).toEqual(sampleCampaign);
      expect(firmware.findUnique).toHaveBeenCalledWith({
        where: { id: storedFirmware.id },
      });
      expect(campaign.create).toHaveBeenCalledWith({
        data: {
          name: 'แคมเปญอัปเดตเฟิร์มแวร์ทดสอบ',
          description: undefined,
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

      await expect(service.create(dto, operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ไม่พบ Firmware -> NotFoundException', async () => {
      firmware.findUnique.mockResolvedValue(null);

      await expect(service.create(firmwareDto(), operation)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Firmware uploadStatus ไม่ใช่ stored (เช่น pending) -> ConflictException', async () => {
      firmware.findUnique.mockResolvedValue({
        ...storedFirmware,
        uploadStatus: 'pending',
      });

      await expect(service.create(firmwareDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Firmware approvalStatus ไม่ใช่ approved (เช่น pending_review) -> ConflictException', async () => {
      firmware.findUnique.mockResolvedValue({
        ...storedFirmware,
        approvalStatus: 'pending_review',
      });

      await expect(service.create(firmwareDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Device deviceModel ไม่อยู่ใน deviceModelCompatibility ของ Firmware -> ConflictException', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, deviceModel: 'GT06E' },
      ]);

      await expect(service.create(firmwareDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Device ยังไม่ installed -> ConflictException (เช็คร่วมกับ Config เหมือนกัน)', async () => {
      device.findMany.mockResolvedValue([
        installedDeviceA,
        { ...installedDeviceB, status: 'registered' },
      ]);

      await expect(service.create(firmwareDto(), operation)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('approve', () => {
    const pendingCampaign: Campaign = {
      ...sampleCampaign,
      status: 'pending_approval',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    it('pending_approval + ผู้อนุมัติไม่ใช่ผู้สร้าง -> active พร้อม approvedBy/approvedAt', async () => {
      campaign.findUnique.mockResolvedValue(pendingCampaign);
      campaign.update.mockResolvedValue({
        ...pendingCampaign,
        status: 'active',
        approvedBy: otherOperation.id,
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const result = await service.approve(pendingCampaign.id, otherOperation);

      expect(result.status).toBe('active');
      expect(campaign.update).toHaveBeenCalledWith({
        where: { id: pendingCampaign.id },
        data: expect.objectContaining({
          status: 'active',
          approvedBy: otherOperation.id,
        }) as Partial<Campaign>,
      });
    });

    it('สถานะไม่ใช่ pending_approval -> ConflictException', async () => {
      campaign.findUnique.mockResolvedValue({
        ...sampleCampaign,
        status: 'active',
      });

      await expect(
        service.approve(sampleCampaign.id, otherOperation),
      ).rejects.toThrow(ConflictException);
    });

    it('ผู้อนุมัติเป็นผู้สร้าง Campaign เอง -> ForbiddenException (Separation of Duty)', async () => {
      campaign.findUnique.mockResolvedValue(pendingCampaign);

      await expect(
        service.approve(pendingCampaign.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reject', () => {
    const pendingCampaign: Campaign = {
      ...sampleCampaign,
      status: 'pending_approval',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    it('pending_approval + ผู้ปฏิเสธไม่ใช่ผู้สร้าง -> rejected ไม่ตั้ง approvedBy', async () => {
      campaign.findUnique.mockResolvedValue(pendingCampaign);
      campaign.update.mockResolvedValue({
        ...pendingCampaign,
        status: 'rejected',
      });

      const result = await service.reject(pendingCampaign.id, otherOperation);

      expect(result.status).toBe('rejected');
      expect(campaign.update).toHaveBeenCalledWith({
        where: { id: pendingCampaign.id },
        data: { status: 'rejected' },
      });
    });

    it('ผู้ปฏิเสธเป็นผู้สร้าง Campaign เอง -> ForbiddenException', async () => {
      campaign.findUnique.mockResolvedValue(pendingCampaign);

      await expect(
        service.reject(pendingCampaign.id, operation),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('ไม่ระบุ status -> คืนทั้งหมด เรียงตาม createdAt desc', async () => {
      campaign.findMany.mockResolvedValue([sampleCampaign]);

      const result = await service.findAll({});

      expect(result).toEqual([sampleCampaign]);
      expect(campaign.findMany).toHaveBeenCalledWith({
        where: { status: undefined },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('ระบุ status -> filter ตามนั้น', async () => {
      campaign.findMany.mockResolvedValue([sampleCampaign]);

      await service.findAll({ status: 'active' });

      expect(campaign.findMany).toHaveBeenCalledWith({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('เจอ -> คืน Campaign', async () => {
      campaign.findUnique.mockResolvedValue(sampleCampaign);

      const result = await service.findOne(sampleCampaign.id);

      expect(result).toEqual(sampleCampaign);
    });

    it('ไม่เจอ -> NotFoundException', async () => {
      campaign.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
