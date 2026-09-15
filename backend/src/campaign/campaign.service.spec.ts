import {
  BadRequestException,
  ConflictException,
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

const sampleCampaign: Campaign = {
  id: 'campaign-1',
  name: 'แคมเปญทดสอบ',
  description: null,
  payloadType: CampaignPayloadType.Config,
  configId: approvedConfig.id,
  firmwareId: null,
  status: 'active',
  targetCount: 2,
  successCount: 0,
  failureCount: 0,
  createdBy: operation.id,
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

describe('CampaignService', () => {
  let service: CampaignService;
  let campaign: CampaignDelegateMock;
  let campaignTarget: { createMany: jest.Mock };
  let config: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock };
  let auditLog: { create: jest.Mock };

  beforeEach(async () => {
    campaign = {
      create: jest.fn().mockResolvedValue(sampleCampaign),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    };
    campaignTarget = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    config = { findUnique: jest.fn().mockResolvedValue(approvedConfig) };
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
          status: 'active',
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

    it('payloadType Firmware -> BadRequestException ยังไม่รองรับ (ไม่มี firmware module)', async () => {
      const dto = { ...baseDto(), payloadType: CampaignPayloadType.Firmware };

      await expect(service.create(dto, operation)).rejects.toThrow(
        BadRequestException,
      );
      expect(config.findUnique).not.toHaveBeenCalled();
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
