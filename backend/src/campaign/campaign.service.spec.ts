import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign, CampaignPayloadType } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
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

const activeTech1 = { id: 'tech-1', isActive: true };
const activeTech2 = { id: 'tech-2', isActive: true };

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
      { deviceId: installedDeviceA.deviceId, assignedTo: activeTech1.id },
      { deviceId: installedDeviceB.deviceId, assignedTo: activeTech2.id },
    ],
  };
}

describe('CampaignService', () => {
  let service: CampaignService;
  let campaign: CampaignDelegateMock;
  let campaignTarget: { createMany: jest.Mock };
  let task: { createManyAndReturn: jest.Mock };
  let config: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock };
  let user: { findMany: jest.Mock };
  let auditLog: { create: jest.Mock };
  let notification: { send: jest.Mock };

  const createdTasks = [
    {
      id: 'task-1',
      title: 'แคมเปญ "แคมเปญทดสอบ" — ติดตั้ง Config "ชุดตั้งค่า GT06N"',
      assignedTo: activeTech1.id,
    },
    {
      id: 'task-2',
      title: 'แคมเปญ "แคมเปญทดสอบ" — ติดตั้ง Config "ชุดตั้งค่า GT06N"',
      assignedTo: activeTech2.id,
    },
  ];

  beforeEach(async () => {
    campaign = {
      create: jest.fn().mockResolvedValue(sampleCampaign),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    };
    campaignTarget = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    task = {
      createManyAndReturn: jest.fn().mockResolvedValue(createdTasks),
    };
    config = { findUnique: jest.fn().mockResolvedValue(approvedConfig) };
    device = {
      findMany: jest
        .fn()
        .mockResolvedValue([installedDeviceA, installedDeviceB]),
    };
    user = {
      findMany: jest.fn().mockResolvedValue([activeTech1, activeTech2]),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    notification = { send: jest.fn().mockResolvedValue(undefined) };

    const prismaMock = {
      campaign,
      campaignTarget,
      task,
      config,
      device,
      user,
      auditLog,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ campaign, campaignTarget, task }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationService, useValue: notification },
      ],
    }).compile();

    service = module.get(CampaignService);
  });

  describe('create', () => {
    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> สร้าง Campaign+CampaignTarget[]+Task[] ใน transaction เดียว', async () => {
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
      expect(task.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            assignedTo: activeTech1.id,
            deviceId: installedDeviceA.deviceId,
            configId: approvedConfig.id,
            campaignId: sampleCampaign.id,
          }),
          expect.objectContaining({
            assignedTo: activeTech2.id,
            deviceId: installedDeviceB.deviceId,
            configId: approvedConfig.id,
            campaignId: sampleCampaign.id,
          }),
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

    it('แจ้งเตือน task_assigned ให้ผู้รับผิดชอบทุกเป้าหมาย', async () => {
      await service.create(baseDto(), operation);

      expect(notification.send).toHaveBeenCalledTimes(2);
      expect(notification.send).toHaveBeenCalledWith({
        userId: activeTech1.id,
        type: 'task_assigned',
        payload: { taskId: 'task-1', title: createdTasks[0].title },
      });
      expect(notification.send).toHaveBeenCalledWith({
        userId: activeTech2.id,
        type: 'task_assigned',
        payload: { taskId: 'task-2', title: createdTasks[1].title },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> create() ยังสำเร็จปกติ (never-throw)', async () => {
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(service.create(baseDto(), operation)).resolves.toEqual(
        sampleCampaign,
      );
    });

    it('แจ้งเตือนล้มเหลว -> create() ยังสำเร็จปกติ (never-throw)', async () => {
      notification.send.mockRejectedValue(new Error('FCM ล่ม'));

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
        { deviceId: installedDeviceA.deviceId, assignedTo: activeTech1.id },
        { deviceId: installedDeviceA.deviceId, assignedTo: activeTech2.id },
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

    it('assignedTo ไม่พบ user -> BadRequestException', async () => {
      user.findMany.mockResolvedValue([activeTech1]); // ขาด tech-2

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('assignedTo เป็น user ที่ถูกปิดใช้งาน -> BadRequestException', async () => {
      user.findMany.mockResolvedValue([
        activeTech1,
        { ...activeTech2, isActive: false },
      ]);

      await expect(service.create(baseDto(), operation)).rejects.toThrow(
        BadRequestException,
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
