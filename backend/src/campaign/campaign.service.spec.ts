import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } from './field-apply-system-campaign';

function makeP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

type CampaignDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
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
  sourceIncidentId: null,
  autoRetry: true,
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
  let campaignTarget: {
    createMany: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };
  let campaignRollout: { count: jest.Mock };
  let queryRaw: jest.Mock;
  let device: { findMany: jest.Mock };
  let incident: { findUnique: jest.Mock };
  let auditLog: { create: jest.Mock };

  beforeEach(async () => {
    campaign = {
      create: jest.fn().mockResolvedValue(sampleCampaign),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(sampleCampaign),
    };
    campaignTarget = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    campaignRollout = { count: jest.fn().mockResolvedValue(0) };
    // ล็อกแถวกลุ่ม (FOR UPDATE) - default เจอกลุ่ม
    queryRaw = jest.fn().mockResolvedValue([{ id: 'campaign-1' }]);
    device = {
      findMany: jest
        .fn()
        .mockResolvedValue([installedDeviceA, installedDeviceB]),
    };
    incident = { findUnique: jest.fn() };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };

    const prismaMock = {
      campaign,
      campaignTarget,
      campaignRollout,
      device,
      incident,
      auditLog,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ campaign, campaignTarget, campaignRollout, $queryRaw: queryRaw }),
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

    it('ตั้งชื่อกลุ่มเป็นชื่อสงวนของ Campaign ระบบ -> 400 ไม่สร้าง', async () => {
      await expect(
        service.create(
          { ...baseDto(), name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME },
          operation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(campaign.create).not.toHaveBeenCalled();
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

    describe('sourceIncidentId (issue #236 — promote field report เป็น Campaign)', () => {
      it('ไม่พบ Incident -> NotFoundException', async () => {
        incident.findUnique.mockResolvedValue(null);

        await expect(
          service.create(
            { ...baseDto(), sourceIncidentId: 'inc-1' },
            operation,
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('Incident ยังไม่ถูก promote (status ไม่ใช่ investigating) -> ConflictException', async () => {
        incident.findUnique.mockResolvedValue({
          id: 'inc-1',
          status: 'open',
        });

        await expect(
          service.create(
            { ...baseDto(), sourceIncidentId: 'inc-1' },
            operation,
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('Incident investigating -> สร้าง Campaign พร้อม sourceIncidentId', async () => {
        incident.findUnique.mockResolvedValue({
          id: 'inc-1',
          status: 'investigating',
        });

        await service.create(
          { ...baseDto(), sourceIncidentId: 'inc-1' },
          operation,
        );

        expect(campaign.create).toHaveBeenCalledWith({
          data: {
            name: 'กลุ่มทดสอบ',
            description: undefined,
            createdBy: operation.id,
            sourceIncidentId: 'inc-1',
          },
        });
      });

      it('race condition — incident ถูก promote เป็น Campaign อื่นไปแล้วพร้อมกัน (P2002) -> ConflictException', async () => {
        incident.findUnique.mockResolvedValue({
          id: 'inc-1',
          status: 'investigating',
        });
        campaign.create.mockRejectedValue(makeP2002());

        await expect(
          service.create(
            { ...baseDto(), sourceIncidentId: 'inc-1' },
            operation,
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('error อื่นที่ไม่ใช่ P2002 -> โยนต่อตรงๆ', async () => {
        incident.findUnique.mockResolvedValue({
          id: 'inc-1',
          status: 'investigating',
        });
        campaign.create.mockRejectedValue(new Error('db down'));

        await expect(
          service.create(
            { ...baseDto(), sourceIncidentId: 'inc-1' },
            operation,
          ),
        ).rejects.toThrow('db down');
      });
    });
  });

  describe('findAll', () => {
    it('คืนทั้งหมด เรียงตาม createdAt desc', async () => {
      campaign.findMany.mockResolvedValue([sampleCampaign]);

      const result = await service.findAll();

      expect(result).toEqual([sampleCampaign]);
      expect(campaign.findMany).toHaveBeenCalledWith({
        where: { name: { not: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('ซ่อน Campaign ระบบของคำขอส่ง Config จากหน้างาน (docs/25 §3.2/Q2) — ไม่ query ด้วยชื่อว่าง/ผิด', async () => {
      campaign.findMany.mockResolvedValue([]);

      await service.findAll();

      const calls = campaign.findMany.mock.calls as unknown[][];
      const call = calls[0][0] as {
        where: { name: { not: string } };
      };
      expect(call.where.name.not).toBe(FIELD_APPLY_SYSTEM_CAMPAIGN_NAME);
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

  describe('update', () => {
    beforeEach(() => {
      campaign.findUnique.mockResolvedValue(sampleCampaign);
      campaign.update.mockResolvedValue({
        ...sampleCampaign,
        name: 'ชื่อใหม่',
      });
    });

    it('แก้ชื่อ -> update แล้วเขียน AuditLog update พร้อม metadata', async () => {
      const result = await service.update(
        sampleCampaign.id,
        { name: 'ชื่อใหม่' },
        operation,
      );

      expect(result.name).toBe('ชื่อใหม่');
      expect(campaign.update).toHaveBeenCalledWith({
        where: { id: sampleCampaign.id },
        data: { name: 'ชื่อใหม่', description: undefined },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'update',
          metadata: { campaignId: sampleCampaign.id, campaignName: 'ชื่อใหม่' },
        },
      });
    });

    it('เปลี่ยนชื่อเป็นชื่อสงวนของ Campaign ระบบ -> 400 ไม่แก้ (review B บน #424)', async () => {
      await expect(
        service.update(
          sampleCampaign.id,
          { name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME },
          operation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(campaign.update).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง name และ description เลย -> 400', async () => {
      await expect(
        service.update(sampleCampaign.id, {}, operation),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(campaign.update).not.toHaveBeenCalled();
    });

    it('ไม่พบกลุ่ม -> 404', async () => {
      campaign.findUnique.mockResolvedValue(null);
      await expect(
        service.update('x', { name: 'a' }, operation),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Campaign ระบบของคำขอหน้างาน -> 404 แก้ไม่ได้', async () => {
      campaign.findUnique.mockResolvedValue({
        ...sampleCampaign,
        name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
      });
      await expect(
        service.update(sampleCampaign.id, { name: 'a' }, operation),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(campaign.update).not.toHaveBeenCalled();
    });

    it('แก้ชื่อได้แม้มี Rollout ค้าง (ไม่กระทบรอบที่รันอยู่)', async () => {
      campaignRollout.count.mockResolvedValue(1);
      await expect(
        service.update(sampleCampaign.id, { name: 'ชื่อใหม่' }, operation),
      ).resolves.toBeDefined();
    });
  });

  describe('addTargets', () => {
    const addDto = { targets: [{ deviceId: installedDeviceA.deviceId }] };

    beforeEach(() => {
      campaign.findUnique.mockResolvedValue(sampleCampaign);
      campaignTarget.findMany.mockResolvedValue([]);
      device.findMany.mockResolvedValue([installedDeviceA]);
    });

    it('เพิ่มเครื่อง installed ที่ยังไม่อยู่ในกลุ่ม -> createMany + AuditLog add_targets', async () => {
      await service.addTargets(sampleCampaign.id, addDto, operation);

      expect(campaignTarget.createMany).toHaveBeenCalledWith({
        data: [
          {
            campaignId: sampleCampaign.id,
            deviceId: installedDeviceA.deviceId,
          },
        ],
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'add_targets',
          metadata: {
            campaignId: sampleCampaign.id,
            campaignName: sampleCampaign.name,
            deviceIds: [installedDeviceA.deviceId],
          },
        },
      });
    });

    it('มี Rollout ค้าง -> 409 ไม่เพิ่ม', async () => {
      campaignRollout.count.mockResolvedValue(1);
      await expect(
        service.addTargets(sampleCampaign.id, addDto, operation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(campaignTarget.createMany).not.toHaveBeenCalled();
    });

    it('เครื่องอยู่ในกลุ่มแล้ว -> 409', async () => {
      campaignTarget.findMany.mockResolvedValue([
        { deviceId: installedDeviceA.deviceId },
      ]);
      await expect(
        service.addTargets(sampleCampaign.id, addDto, operation),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('เครื่องที่ยังไม่ installed -> 409', async () => {
      device.findMany.mockResolvedValue([
        { ...installedDeviceA, status: 'registered' },
      ]);
      await expect(
        service.addTargets(sampleCampaign.id, addDto, operation),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('deviceId ซ้ำกันในคำขอ -> 400', async () => {
      await expect(
        service.addTargets(
          sampleCampaign.id,
          {
            targets: [
              { deviceId: installedDeviceA.deviceId },
              { deviceId: installedDeviceA.deviceId },
            ],
          },
          operation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('createMany ชน unique (race) -> 409', async () => {
      campaignTarget.createMany.mockRejectedValue(makeP2002());
      await expect(
        service.addTargets(sampleCampaign.id, addDto, operation),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('removeTarget', () => {
    const member = {
      id: 'target-1',
      campaignId: sampleCampaign.id,
      deviceId: installedDeviceA.deviceId,
    };

    beforeEach(() => {
      campaign.findUnique.mockResolvedValue(sampleCampaign);
      campaignTarget.findUnique.mockResolvedValue(member);
      campaignTarget.count.mockResolvedValue(2);
    });

    it('เอาเครื่องออก -> delete + AuditLog remove_target', async () => {
      await service.removeTarget(
        sampleCampaign.id,
        installedDeviceA.deviceId,
        operation,
      );

      expect(campaignTarget.delete).toHaveBeenCalledWith({
        where: { id: member.id },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'remove_target',
          metadata: {
            campaignId: sampleCampaign.id,
            campaignName: sampleCampaign.name,
            deviceIds: [installedDeviceA.deviceId],
          },
        },
      });
    });

    it('มี Rollout ค้าง -> 409', async () => {
      campaignRollout.count.mockResolvedValue(1);
      await expect(
        service.removeTarget(
          sampleCampaign.id,
          installedDeviceA.deviceId,
          operation,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(campaignTarget.delete).not.toHaveBeenCalled();
    });

    it('เครื่องไม่ได้อยู่ในกลุ่ม -> 404', async () => {
      campaignTarget.findUnique.mockResolvedValue(null);
      await expect(
        service.removeTarget(sampleCampaign.id, 'DEV-9999', operation),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('เป็นเครื่องสุดท้ายของกลุ่ม -> 409 ให้ลบกลุ่มแทน', async () => {
      campaignTarget.count.mockResolvedValue(1);
      await expect(
        service.removeTarget(
          sampleCampaign.id,
          installedDeviceA.deviceId,
          operation,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(campaignTarget.delete).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      campaign.findUnique.mockResolvedValue(sampleCampaign);
    });

    it('ไม่มี Rollout ค้าง -> ลบกลุ่ม + AuditLog delete เก็บชื่อกลุ่ม', async () => {
      await service.remove(sampleCampaign.id, operation);

      expect(campaign.delete).toHaveBeenCalledWith({
        where: { id: sampleCampaign.id },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'campaign',
          action: 'delete',
          metadata: {
            campaignId: sampleCampaign.id,
            campaignName: sampleCampaign.name,
          },
        },
      });
    });

    it('มี Rollout ค้าง (pending_approval/approved/active/paused) -> 409 ไม่ลบ', async () => {
      campaignRollout.count.mockResolvedValue(2);
      await expect(
        service.remove(sampleCampaign.id, operation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(campaign.delete).not.toHaveBeenCalled();
      expect(campaignRollout.count).toHaveBeenCalledWith({
        where: {
          campaignId: sampleCampaign.id,
          status: { in: ['pending_approval', 'approved', 'active', 'paused'] },
        },
      });
    });

    it('ล็อกแถวกลุ่ม (FOR UPDATE) เป็นคำสั่งแรกใน transaction ก่อนตรวจ Rollout ค้างและลบ (กัน race กับการสร้าง Rollout)', async () => {
      const order: string[] = [];
      queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        order.push(`lock:${strings.join('?').includes('FOR UPDATE')}`);
        return Promise.resolve([{ id: sampleCampaign.id }]);
      });
      campaignRollout.count.mockImplementation(() => {
        order.push('count');
        return Promise.resolve(0);
      });
      campaign.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve(sampleCampaign);
      });

      await service.remove(sampleCampaign.id, operation);

      expect(order).toEqual(['lock:true', 'count', 'delete']);
    });

    it('กลุ่มหายไประหว่างรอล็อก (ถูกลบพร้อมกัน) -> 404 ไม่ลบซ้ำ', async () => {
      queryRaw.mockResolvedValue([]);

      await expect(
        service.remove(sampleCampaign.id, operation),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(campaign.delete).not.toHaveBeenCalled();
    });

    it('Campaign ระบบของคำขอหน้างาน -> 404 ลบไม่ได้', async () => {
      campaign.findUnique.mockResolvedValue({
        ...sampleCampaign,
        name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
      });
      await expect(
        service.remove(sampleCampaign.id, operation),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(campaign.delete).not.toHaveBeenCalled();
    });

    it('ไม่พบกลุ่ม -> 404', async () => {
      campaign.findUnique.mockResolvedValue(null);
      await expect(service.remove('x', operation)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
