import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

type CampaignDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
};

const operation: ActingUser = { id: 'op-1', role: 'Operation' };

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
  name: 'กลุ่มทดสอบ',
  description: null,
  createdBy: operation.id,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function baseDto(): CreateCampaignDto {
  return {
    name: 'กลุ่มทดสอบ',
    targets: [
      { deviceId: installedDeviceA.deviceId },
      { deviceId: installedDeviceB.deviceId },
    ],
  };
}

describe('CampaignService', () => {
  let service: CampaignService;
  let campaign: CampaignDelegateMock;
  let campaignTarget: { createMany: jest.Mock; findMany: jest.Mock };
  let device: { findMany: jest.Mock };
  let auditLog: { create: jest.Mock };

  beforeEach(async () => {
    campaign = {
      create: jest.fn().mockResolvedValue(sampleCampaign),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    };
    campaignTarget = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn(),
    };
    device = {
      findMany: jest
        .fn()
        .mockResolvedValue([installedDeviceA, installedDeviceB]),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };

    const prismaMock = {
      campaign,
      campaignTarget,
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
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Campaign+CampaignTarget[] ใน transaction เดียว (ไม่มี payload/approval เกี่ยวข้อง)', async () => {
      const result = await service.create(baseDto(), operation);

      expect(result).toEqual(sampleCampaign);
      expect(campaign.create).toHaveBeenCalledWith({
        data: {
          name: 'กลุ่มทดสอบ',
          description: undefined,
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
  });

  describe('findAll', () => {
    it('คืนทั้งหมด เรียงตาม createdAt desc', async () => {
      campaign.findMany.mockResolvedValue([sampleCampaign]);

      const result = await service.findAll();

      expect(result).toEqual([sampleCampaign]);
      expect(campaign.findMany).toHaveBeenCalledWith({
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
        'ไม่พบ Campaign id missing-id',
      );
    });
  });

  describe('findTargets', () => {
    it('คืนสมาชิกกลุ่ม เรียงตาม createdAt asc', async () => {
      const target = {
        id: 'target-1',
        campaignId: sampleCampaign.id,
        deviceId: installedDeviceA.deviceId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      campaignTarget.findMany.mockResolvedValue([target]);

      const result = await service.findTargets(sampleCampaign.id);

      expect(result).toEqual([target]);
      expect(campaignTarget.findMany).toHaveBeenCalledWith({
        where: { campaignId: sampleCampaign.id },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
