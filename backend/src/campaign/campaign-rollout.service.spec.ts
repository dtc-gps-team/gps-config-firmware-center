import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CampaignPayloadType, CampaignRollout, Prisma } from '@prisma/client';
import { CentralDeviceService } from '../central-device/central-device.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser } from './campaign.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';
import { FIRMWARE_ROLLBACK_EXECUTOR } from './firmware-rollback-executor';
import {
  ROLLOUT_FAILED_EVENT,
  ROLLOUT_RESULT_UPDATED_EVENT,
  ROLLOUT_STATUS_CHANGED_EVENT,
  RolloutEvents,
  type RolloutFailedEvent,
  type RolloutResultUpdatedEvent,
  type RolloutStatusChangedEvent,
} from './rollout-events';
import {
  CONFIG_APPLIER,
  CONFIG_APPLY_MODE,
  ConfigApplyMode,
} from '../device/config-applier';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';

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
  activeWindowStartedAt: null,
  applyMode: null,
  pullTimeoutHours: null,
  applyTimeoutMinutes: null,
  isRollback: false,
  rollbackOfId: null,
  deviceValuesReason: null,
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
    findUniqueOrThrow: jest.Mock;
  };
  let config: { findUnique: jest.Mock };
  let firmware: { findUnique: jest.Mock };
  let device: { findMany: jest.Mock; update: jest.Mock };
  let deviceConfigOverride: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  let configFieldDefinition: { findMany: jest.Mock };
  let configDefinitionService: {
    validateOperationOverridableFields: jest.Mock;
    loadFieldDefinitions: jest.Mock;
  };
  let auditLog: { create: jest.Mock };
  let firmwareRollbackExecutor: { switchPartition: jest.Mock };
  let configApplier: { applyConfig: jest.Mock };
  // โหมดของ env ตอนปล่อย Rollout (docs/19 §3) — เทสที่ต้องการ `real` ตั้งก่อน
  // beforeEach ไม่ได้ จึงให้ provider อ่านจากตัวแปรนี้ตอนสร้าง service ใหม่
  let configApplyMode: ConfigApplyMode;
  let rolloutEvents: RolloutEvents;
  // ตัวส่ง Config ไป Server กลาง — null = ไม่ได้ต่อ (provider ถูก @Optional)
  let central: { pushConfig: jest.Mock } | null;

  async function buildService(): Promise<CampaignRolloutService> {
    const built = await Test.createTestingModule({
      providers: [
        CampaignRolloutService,
        { provide: PrismaService, useValue: prismaMockRef },
        {
          provide: FIRMWARE_ROLLBACK_EXECUTOR,
          useValue: firmwareRollbackExecutor,
        },
        { provide: CONFIG_APPLIER, useValue: configApplier },
        { provide: CONFIG_APPLY_MODE, useValue: configApplyMode },
        RolloutEvents,
        {
          provide: ConfigDefinitionService,
          useValue: configDefinitionService,
        },
        ...(central
          ? [{ provide: CentralDeviceService, useValue: central }]
          : []),
      ],
    }).compile();
    rolloutEvents = built.get(RolloutEvents);
    return built.get(CampaignRolloutService);
  }
  let prismaMockRef: unknown;

  beforeEach(async () => {
    configApplyMode = 'mock';
    central = null;
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
      findUniqueOrThrow: jest.fn(),
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
    deviceConfigOverride = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    };
    configFieldDefinition = { findMany: jest.fn().mockResolvedValue([]) };
    configDefinitionService = {
      validateOperationOverridableFields: jest.fn().mockResolvedValue([]),
      loadFieldDefinitions: jest.fn().mockResolvedValue([]),
    };
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
      cb({ campaignRollout, campaignRolloutTarget, deviceConfigOverride }),
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
      configFieldDefinition,
      auditLog,
      $transaction: transactionMock,
    };

    prismaMockRef = prismaMock;
    service = await buildService();
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
          // ไม่ส่งเวลารอมา -> null = ค่าเริ่มต้น (docs/19 §16)
          pullTimeoutHours: null,
          applyTimeoutMinutes: null,
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
          pullTimeoutHours: null,
          applyTimeoutMinutes: null,
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
          ipAddress: null,
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
          pullTimeoutHours: null,
          applyTimeoutMinutes: null,
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

    describe('applyMode central (ส่ง Config ไป Server กลาง)', () => {
      const activeFor = (r: CampaignRollout): CampaignRollout => ({
        ...r,
        status: 'active',
      });
      const pendingTarget = {
        id: 't-1',
        rolloutId: approvedRollout.id,
        deviceId: 'DEV-0001',
      };

      const centralFields = { 'gps.send_interval_sec': 20 };

      async function releaseInCentralMode() {
        configApplyMode = 'central';
        service = await buildService();
        campaignRollout.findUnique.mockResolvedValue(approvedRollout);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor({ ...approvedRollout, applyMode: 'central' }),
        );
        campaignRolloutTarget.findMany.mockResolvedValue([pendingTarget]);
        config.findUnique.mockResolvedValue({
          ...approvedConfig,
          fields: centralFields,
        });
        return service.release(approvedRollout.id, otherOperation);
      }

      it('บันทึก applyMode "central" สั่ง Server กลางแล้วเก็บรหัสคำสั่งไว้ที่ target (ยังไม่นับผล) โดยไม่ใช้ applier เดิม', async () => {
        central = {
          pushConfig: jest.fn().mockResolvedValue({
            kind: 'sent',
            commandId: 'CMD-10050',
            configVersion: 7,
          }),
        };

        await releaseInCentralMode();

        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: approvedRollout.id, status: 'approved' },
          data: expect.objectContaining({
            status: 'active',
            applyMode: 'central',
          }) as Partial<CampaignRollout>,
        });
        // ถามเฉพาะเครื่อง pending ที่ยังไม่เคยสั่ง Server กลาง
        expect(campaignRolloutTarget.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              rolloutId: approvedRollout.id,
              status: 'pending',
              centralCommandId: null,
            },
          }),
        );
        expect(central.pushConfig).toHaveBeenCalledWith(
          'DEV-0001',
          centralFields,
        );
        expect(campaignRolloutTarget.update).toHaveBeenCalledWith({
          where: { id: 't-1' },
          data: expect.objectContaining({
            centralCommandId: 'CMD-10050',
          }) as Record<string, unknown>,
        });
        expect(configApplier.applyConfig).not.toHaveBeenCalled();
        // ยังไม่ตัดสินผล: ผลจริงมาจาก poll
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
        // ลง AuditLog การนำ Config ไปใช้ พร้อมรหัสคำสั่ง (ไม่เก็บค่า)
        expect(auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'apply-config',
            metadata: expect.objectContaining({
              deviceId: 'DEV-0001',
              centralCommandId: 'CMD-10050',
            }) as Record<string, unknown>,
          }) as Record<string, unknown>,
        });
      });

      it.each([
        ['rejected', 'กล่อง DEV-0001 ยังไม่อยู่ในทะเบียนของ delivery-server'],
        ['unavailable', 'Server กลางไม่ตอบภายใน 5000 มิลลิวินาที'],
      ])(
        'ส่งไม่ได้ (%s) -> นับเป็นล้มเหลวทันทีพร้อมเหตุผล (เข้า Auto Pause ตามกฎเดิม) ไม่เก็บรหัสคำสั่ง',
        async (kind, reason) => {
          central = {
            pushConfig: jest.fn().mockResolvedValue({ kind, reason }),
          };
          configApplyMode = 'central';
          service = await buildService();
          const record = jest
            .spyOn(service, 'recordTargetResult')
            .mockResolvedValue(true);
          campaignRollout.findUnique.mockResolvedValue(approvedRollout);
          campaignRollout.findUniqueOrThrow.mockResolvedValue(
            activeFor({ ...approvedRollout, applyMode: 'central' }),
          );
          campaignRolloutTarget.findMany.mockResolvedValue([pendingTarget]);

          await service.release(approvedRollout.id, otherOperation);

          expect(record).toHaveBeenCalledWith(
            'DEV-0001',
            { configId: approvedConfig.id },
            false,
            reason,
            approvedRollout.id,
          );
          expect(campaignRolloutTarget.update).not.toHaveBeenCalled();
        },
      );

      it('ไม่ได้เปิดการเชื่อมต่อ Server กลาง (ไม่มี provider) -> นับเป็นล้มเหลวพร้อมเหตุผล ไม่ค้างเงียบ', async () => {
        central = null;
        configApplyMode = 'central';
        service = await buildService();
        const record = jest
          .spyOn(service, 'recordTargetResult')
          .mockResolvedValue(true);
        campaignRollout.findUnique.mockResolvedValue(approvedRollout);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor({ ...approvedRollout, applyMode: 'central' }),
        );
        campaignRolloutTarget.findMany.mockResolvedValue([pendingTarget]);

        await service.release(approvedRollout.id, otherOperation);

        expect(record).toHaveBeenCalledWith(
          'DEV-0001',
          { configId: approvedConfig.id },
          false,
          expect.stringContaining('CENTRAL_MODE'),
          approvedRollout.id,
        );
      });
    });

    describe('applyMode (docs/19 §3)', () => {
      const activeFor = (r: CampaignRollout): CampaignRollout => ({
        ...r,
        status: 'active',
      });

      it('โหมดระบบ mock -> บันทึก applyMode "mock" และ auto-apply ให้เครื่อง pending', async () => {
        configApplyMode = 'mock';
        service = await buildService();
        campaignRollout.findUnique.mockResolvedValue(approvedRollout);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor({ ...approvedRollout, applyMode: 'mock' }),
        );
        campaignRolloutTarget.findMany.mockResolvedValue([
          { id: 't-1', rolloutId: approvedRollout.id, deviceId: 'DEV-0001' },
        ]);
        campaignRolloutTarget.findFirst.mockResolvedValue(null);

        await service.release(approvedRollout.id, otherOperation);

        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: approvedRollout.id, status: 'approved' },
          data: expect.objectContaining({
            status: 'active',
            applyMode: 'mock',
          }) as Partial<CampaignRollout>,
        });
        expect(configApplier.applyConfig).toHaveBeenCalledTimes(1);
      });

      it('โหมดระบบ real -> บันทึก applyMode "real" และ **ไม่** apply ให้เอง ไม่แตะ target', async () => {
        configApplyMode = 'real';
        service = await buildService();
        campaignRollout.findUnique.mockResolvedValue(approvedRollout);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor({ ...approvedRollout, applyMode: 'real' }),
        );

        const result = await service.release(
          approvedRollout.id,
          otherOperation,
        );

        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: approvedRollout.id, status: 'approved' },
          data: expect.objectContaining({
            applyMode: 'real',
          }) as Partial<CampaignRollout>,
        });
        expect(result.status).toBe('active');
        expect(configApplier.applyConfig).not.toHaveBeenCalled();
        expect(campaignRolloutTarget.findMany).not.toHaveBeenCalled();
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      });

      it('Firmware payload เป็น mock เสมอแม้ระบบตั้ง real (ยังไม่มีเส้นทางให้อุปกรณ์ดึง Firmware)', async () => {
        configApplyMode = 'real';
        service = await buildService();
        const firmwareRollout: CampaignRollout = {
          ...approvedRollout,
          payloadType: CampaignPayloadType.Firmware,
          configId: null,
          firmwareId: 'fw-1',
        };
        campaignRollout.findUnique.mockResolvedValue(firmwareRollout);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor({ ...firmwareRollout, applyMode: 'mock' }),
        );

        await service.release(firmwareRollout.id, otherOperation);

        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: firmwareRollout.id, status: 'approved' },
          data: expect.objectContaining({
            applyMode: 'mock',
          }) as Partial<CampaignRollout>,
        });
      });

      it('Rollout ที่มี applyMode อยู่แล้ว (Rollback สืบทอดมา) -> คงค่าเดิม ไม่ใช้โหมดระบบ', async () => {
        configApplyMode = 'mock';
        service = await buildService();
        const inherited: CampaignRollout = {
          ...approvedRollout,
          applyMode: 'real',
          isRollback: true,
          rollbackOfId: 'rollout-bad',
        };
        campaignRollout.findUnique.mockResolvedValue(inherited);
        campaignRollout.findUniqueOrThrow.mockResolvedValue(
          activeFor(inherited),
        );

        await service.release(inherited.id, otherOperation);

        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: inherited.id, status: 'approved' },
          data: expect.objectContaining({
            applyMode: 'real',
          }) as Partial<CampaignRollout>,
        });
        expect(configApplier.applyConfig).not.toHaveBeenCalled();
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
          ipAddress: null,
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
          ipAddress: null,
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
          ipAddress: null,
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
          ipAddress: null,
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
          ipAddress: null,
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

    it('Rollout โหมด real: resume -> active แต่ไม่ apply ให้เอง เครื่องที่ค้างได้งานเองเมื่อมาดึง', async () => {
      const pausedReal: CampaignRollout = {
        ...sampleRollout,
        status: 'paused',
        applyMode: 'real',
      };
      campaignRollout.findUnique.mockResolvedValue(pausedReal);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...pausedReal,
        status: 'active',
      });

      const result = await service.resume(pausedReal.id, operation);

      expect(result.status).toBe('active');
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(campaignRolloutTarget.findMany).not.toHaveBeenCalled();
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
          ipAddress: null,
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
          ipAddress: null,
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
          // สืบทอดโหมดและเวลารอจากรอบต้นเรื่อง (null = ค่าเริ่มต้น/Rollout เก่า)
          applyMode: null,
          pullTimeoutHours: null,
          applyTimeoutMinutes: null,
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
          applyMode: null,
          pullTimeoutHours: null,
          applyTimeoutMinutes: null,
        },
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          { rolloutId: 'rollout-new', deviceId: installedDeviceA.deviceId },
        ],
      });
    });

    it('เลือกเครื่องที่ success หรือ ดึงงานแล้วแต่ยัง pending (pulledAt มีค่า) — ไม่รวมเครื่องที่ยังไม่ได้ดึง (docs/19 §3.1)', async () => {
      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRolloutTarget.findMany).toHaveBeenCalledWith({
        where: {
          rolloutId: badRollout.id,
          OR: [
            { status: 'success' },
            { status: 'pending', pulledAt: { not: null } },
          ],
        },
      });
    });

    it('Rollout ต้นเรื่องเป็น applyMode real -> Rollback สืบทอด real', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...badRollout,
        applyMode: 'real',
      });

      await service.rollback(campaignId, badRollout.id, {}, operation);

      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          applyMode: 'real',
        }) as Partial<CampaignRollout>,
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
          ipAddress: null,
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
      proposedFields: null,
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

    describe('rolloutId เป็นแค่คำใบ้จาก Mobile — fallbackToPayload (issue #268)', () => {
      const otherRolloutId = 'rollout-latest-other-config';
      const countsForSuccess = () =>
        campaignRolloutTarget.count
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0);

      it('rolloutId ไม่ตรงกับ payload (คนละรอบ/คนละ configId) + fallbackToPayload -> หาด้วย rolloutId ไม่เจอ แล้ว match ด้วย payload แทน ไม่ปล่อย target ค้าง pending', async () => {
        campaignRolloutTarget.findFirst
          .mockResolvedValueOnce(null) // scope ด้วย rolloutId ของรอบอื่น -> ไม่เจอ
          .mockResolvedValueOnce(pendingTarget); // fallback ด้วย payload -> เจอ
        countsForSuccess();

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          otherRolloutId,
          { fallbackToPayload: true },
        );

        expect(result).toBe(true);
        expect(campaignRolloutTarget.findFirst).toHaveBeenCalledTimes(2);
        // ครั้งแรก scope ด้วย rolloutId ที่ client ส่งมา
        expect(campaignRolloutTarget.findFirst).toHaveBeenNthCalledWith(1, {
          where: {
            deviceId: installedDeviceA.deviceId,
            status: 'pending',
            rolloutId: otherRolloutId,
            rollout: {
              status: { in: ['active', 'paused'] },
              configId: approvedConfig.id,
            },
          },
          include: { rollout: true },
        });
        // ครั้งที่สอง (fallback) ไม่มี rolloutId — match ด้วย payload เหมือนก่อน #264
        expect(campaignRolloutTarget.findFirst).toHaveBeenNthCalledWith(2, {
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
      });

      it('rolloutId ตรงกับ payload (เจอในการหาครั้งแรก) + fallbackToPayload -> ไม่ query ซ้ำ ใช้ตัวที่ระบุเท่านั้น (ไม่เสียผล #243)', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValueOnce(pendingTarget);
        countsForSuccess();

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          activeRollout.id,
          { fallbackToPayload: true },
        );

        expect(result).toBe(true);
        expect(campaignRolloutTarget.findFirst).toHaveBeenCalledTimes(1);
      });

      it.each(['central', 'real'] as const)(
        'target เป็นของ Rollout โหมด %s + fallbackToPayload (ปุ่มเดิมฝั่ง Mobile) -> ไม่บันทึกผลปลอมจาก mock ทับผลจริงที่กำลังรอ (docs/25 §5/§5.1, Q7)',
        async (applyMode) => {
          const centralRollout: CampaignRollout = {
            ...activeRollout,
            applyMode,
          };
          const centralTarget = {
            ...pendingTarget,
            rollout: centralRollout,
          };
          campaignRolloutTarget.findFirst.mockResolvedValueOnce(centralTarget);

          const result = await service.recordTargetResult(
            installedDeviceA.deviceId,
            { configId: approvedConfig.id },
            true,
            'ok',
            activeRollout.id,
            { fallbackToPayload: true },
          );

          expect(result).toBe(false);
          expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
        },
      );

      it('target เป็นของ Rollout โหมด central แต่เรียกแบบไม่เปิด fallbackToPayload (path autoApplyConfig/autoApplyFirmware เอง) -> บันทึกผลตามปกติ ไม่ถูกบล็อก', async () => {
        const centralRollout: CampaignRollout = {
          ...activeRollout,
          applyMode: 'central',
        };
        const centralTarget = { ...pendingTarget, rollout: centralRollout };
        campaignRolloutTarget.findFirst.mockResolvedValueOnce(centralTarget);
        countsForSuccess();

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          activeRollout.id,
        );

        expect(result).toBe(true);
        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          where: { id: centralTarget.id, status: 'pending' },
          data: { status: 'success', resultDetail: 'ok' },
        });
      });

      it('ไม่เปิด fallbackToPayload (path autoApply*/rollback ที่ส่ง rollout.id ของตัวเอง) -> หาด้วย rolloutId ไม่เจอก็คืน false ไม่ไปแย่ง target ของ rollout อื่น', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValueOnce(null);

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          otherRolloutId,
        );

        expect(result).toBe(false);
        expect(campaignRolloutTarget.findFirst).toHaveBeenCalledTimes(1);
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      });

      it('เปิด fallbackToPayload แต่ไม่ได้ส่ง rolloutId -> query ครั้งเดียวแบบเดิม (ไม่มีอะไรให้ fallback)', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValueOnce(null);

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          undefined,
          { fallbackToPayload: true },
        );

        expect(result).toBe(false);
        expect(campaignRolloutTarget.findFirst).toHaveBeenCalledTimes(1);
      });

      it('fallback ก็ไม่เจอ (ไม่มี target pending ที่ตรง payload เลย) -> คืน false ไม่ throw', async () => {
        campaignRolloutTarget.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);

        const result = await service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          true,
          'ok',
          otherRolloutId,
          { fallbackToPayload: true },
        );

        expect(result).toBe(false);
        expect(campaignRolloutTarget.findFirst).toHaveBeenCalledTimes(2);
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
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

  describe('event ของ Rollout (docs/19 §15) และเวลารอ (docs/19 §16)', () => {
    const activeRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'active',
      activeWindowStartedAt: new Date('2026-01-05T00:00:00.000Z'),
      targetCount: 10,
    };
    const pendingTarget = {
      id: 'rt-1',
      rolloutId: activeRollout.id,
      deviceId: installedDeviceA.deviceId,
      status: 'pending' as const,
      resultDetail: null,
      rollout: activeRollout,
    };
    let failedEvents: RolloutFailedEvent[];
    let statusEvents: RolloutStatusChangedEvent[];
    let updatedEvents: RolloutResultUpdatedEvent[];

    beforeEach(() => {
      failedEvents = [];
      statusEvents = [];
      updatedEvents = [];
      rolloutEvents.on(
        ROLLOUT_RESULT_UPDATED_EVENT,
        (e: RolloutResultUpdatedEvent) => updatedEvents.push(e),
      );
      rolloutEvents.on(ROLLOUT_FAILED_EVENT, (e: RolloutFailedEvent) =>
        failedEvents.push(e),
      );
      rolloutEvents.on(
        ROLLOUT_STATUS_CHANGED_EVENT,
        (e: RolloutStatusChangedEvent) => statusEvents.push(e),
      );
      // ข้อมูลที่อ่านหลัง commit เพื่อประกอบ event
      campaignRollout.findUnique.mockResolvedValue({
        ...activeRollout,
        campaign: { name: 'กลุ่มรถบรรทุก' },
      });
    });

    /** count ในทรานแซกชัน 4 ค่า (success, failed, pending, window) แล้วตามด้วย
     * 3 ค่าตอนประกอบ event (windowFailure, skipped, timeoutFailure) */
    function mockCounts(c: {
      success: number;
      failed: number;
      pending: number;
      window: number;
      eventWindow: number;
      skipped: number;
      timeout: number;
    }) {
      campaignRolloutTarget.count
        .mockResolvedValueOnce(c.success)
        .mockResolvedValueOnce(c.failed)
        .mockResolvedValueOnce(c.pending)
        .mockResolvedValueOnce(c.window)
        .mockResolvedValueOnce(c.eventWindow)
        .mockResolvedValueOnce(c.skipped)
        .mockResolvedValueOnce(c.timeout);
    }

    it('Auto Pause -> ส่ง rollout-failed kind auto-pause severity high พร้อมข้อมูลครบ', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 0,
        failed: 2,
        pending: 8,
        window: 2,
        eventWindow: 2,
        skipped: 0,
        timeout: 0,
      });
      // findMany ที่ใช้ประกอบ event (ครั้งเดียวในการเรียกนี้)
      campaignRolloutTarget.findMany.mockResolvedValue([
        { deviceId: 'DEV-0001', resultDetail: 'ค่า APN ใช้ไม่ได้' },
        { deviceId: 'DEV-0002', resultDetail: 'ค่า APN ใช้ไม่ได้' },
      ]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(failedEvents).toEqual([
        {
          rolloutId: activeRollout.id,
          campaignId: activeRollout.campaignId,
          campaignName: 'กลุ่มรถบรรทุก',
          configId: activeRollout.configId,
          firmwareId: activeRollout.firmwareId,
          kind: 'auto-pause',
          severity: 'high',
          failureCount: activeRollout.failureCount,
          skippedCount: 0,
          targetCount: 10,
          failedDeviceIds: ['DEV-0001', 'DEV-0002'],
          // ข้อความซ้ำถูกรวมเหลือรายการเดียว
          sampleErrors: ['ค่า APN ใช้ไม่ได้'],
        },
      ]);
      expect(statusEvents).toEqual([]);
    });

    it('จบแล้ว มีเครื่องล้มเกิน 5% -> completed-with-failures severity high', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 8,
        failed: 2,
        pending: 0,
        window: 2,
        eventWindow: 2,
        skipped: 0,
        timeout: 0,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([
        { deviceId: 'DEV-0002', resultDetail: 'ล้ม' },
      ]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        kind: 'completed-with-failures',
        severity: 'high',
      });
    });

    it('จบแล้ว ล้มไม่เกิน 5% (1 จาก 100) -> severity medium', async () => {
      campaignRollout.findUnique.mockResolvedValue({
        ...activeRollout,
        targetCount: 100,
        campaign: { name: 'กลุ่มใหญ่' },
      });
      campaignRolloutTarget.findFirst.mockResolvedValue({
        ...pendingTarget,
        rollout: { ...activeRollout, targetCount: 100 },
      });
      mockCounts({
        success: 99,
        failed: 1,
        pending: 0,
        window: 1,
        eventWindow: 1,
        skipped: 0,
        timeout: 0,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([
        { deviceId: 'DEV-0001', resultDetail: 'ล้ม' },
      ]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'fail',
      );

      expect(failedEvents[0]).toMatchObject({
        kind: 'completed-with-failures',
        severity: 'medium',
      });
    });

    it('มีเครื่อง "ดึงงานแล้วเงียบ" จนหมดเวลา -> severity critical (PDF §11.2)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 9,
        failed: 1,
        pending: 0,
        window: 1,
        eventWindow: 1,
        skipped: 0,
        timeout: 1,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([
        {
          deviceId: 'DEV-0001',
          resultDetail: 'ดึงงานแล้วไม่รายงานผลภายใน 30 นาที',
        },
      ]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        false,
        'ดึงงานแล้วไม่รายงานผลภายใน 30 นาที',
      );

      expect(failedEvents[0].severity).toBe('critical');
      // นับ timeout ด้วย startsWith ของข้อความมาตรฐาน
      expect(campaignRolloutTarget.count).toHaveBeenCalledWith({
        where: {
          rolloutId: activeRollout.id,
          status: 'failed',
          resultDetail: { startsWith: 'ดึงงานแล้วไม่รายงานผลภายใน' },
        },
      });
    });

    it('จบแล้ว ไม่มีเครื่องล้มในรอบนี้และไม่มีเครื่องถูกข้าม (Resume แล้วจบสะอาด) -> ส่ง completed-clean ไม่ส่ง rollout-failed', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 9,
        failed: 1, // ล้มสะสมจากรอบก่อน Resume
        pending: 0,
        window: 0,
        eventWindow: 0,
        skipped: 0,
        timeout: 0,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(failedEvents).toEqual([]);
      expect(statusEvents).toEqual([
        {
          rolloutId: activeRollout.id,
          campaignId: activeRollout.campaignId,
          action: 'completed-clean',
        },
      ]);
    });

    it('จบแล้ว มีแต่เครื่องที่ถูกข้ามเพราะออฟไลน์ -> completed-with-skipped severity low', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 9,
        failed: 0,
        pending: 0,
        window: 0,
        eventWindow: 0,
        skipped: 1,
        timeout: 0,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([]);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        kind: 'completed-with-skipped',
        severity: 'low',
        skippedCount: 1,
      });
    });

    it('ยังไม่ครบและไม่เข้า Auto Pause -> ไม่ส่ง event ใดๆ', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      campaignRolloutTarget.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(9)
        .mockResolvedValueOnce(0);

      await service.recordTargetResult(
        installedDeviceA.deviceId,
        { configId: approvedConfig.id },
        true,
        'ok',
      );

      expect(failedEvents).toEqual([]);
      expect(statusEvents).toEqual([]);
    });

    it('listener ที่ throw แบบ sync -> ไม่ทำให้การบันทึกผลล้ม', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(pendingTarget);
      mockCounts({
        success: 0,
        failed: 2,
        pending: 8,
        window: 2,
        eventWindow: 2,
        skipped: 0,
        timeout: 0,
      });
      campaignRolloutTarget.findMany.mockResolvedValue([]);
      rolloutEvents.on(ROLLOUT_FAILED_EVENT, () => {
        throw new Error('listener พัง');
      });

      await expect(
        service.recordTargetResult(
          installedDeviceA.deviceId,
          { configId: approvedConfig.id },
          false,
          'fail',
        ),
      ).resolves.toBe(true);
    });

    describe('markTargetSkippedOffline', () => {
      it('pending + ยังไม่เคยดึง -> skipped_offline (claim เงื่อนไขเดียว) ไม่แตะ failureCount', async () => {
        campaignRolloutTarget.findUniqueOrThrow.mockResolvedValue({
          id: 'rt-1',
          rolloutId: activeRollout.id,
        });
        campaignRolloutTarget.count.mockResolvedValueOnce(3); // ยังเหลือ pending

        const result = await service.markTargetSkippedOffline(
          'rt-1',
          'ข้าม: เครื่องออฟไลน์ ไม่มาดึงงานภายใน 72 ชั่วโมง',
        );

        expect(result).toBe(true);
        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          where: { id: 'rt-1', status: 'pending', pulledAt: null },
          data: {
            status: 'skipped_offline',
            resultDetail: 'ข้าม: เครื่องออฟไลน์ ไม่มาดึงงานภายใน 72 ชั่วโมง',
          },
        });
        expect(campaignRollout.updateMany).not.toHaveBeenCalled();
        expect(campaignRollout.update).not.toHaveBeenCalled();
        expect(failedEvents).toEqual([]);
      });

      it('เป็นเครื่องสุดท้ายที่ค้าง -> Rollout จบเป็น completed และส่ง event ผล', async () => {
        campaignRolloutTarget.findUniqueOrThrow.mockResolvedValue({
          id: 'rt-1',
          rolloutId: activeRollout.id,
        });
        campaignRolloutTarget.count
          .mockResolvedValueOnce(0) // pending ในทรานแซกชัน
          .mockResolvedValueOnce(0) // window failure (ตอนประกอบ event)
          .mockResolvedValueOnce(1) // skipped
          .mockResolvedValueOnce(0); // timeout
        campaignRolloutTarget.findMany.mockResolvedValue([]);

        const result = await service.markTargetSkippedOffline('rt-1', 'ข้าม');

        expect(result).toBe(true);
        expect(campaignRollout.updateMany).toHaveBeenCalledWith({
          where: { id: activeRollout.id, status: 'active' },
          data: { status: 'completed' },
        });
        expect(failedEvents[0]).toMatchObject({
          kind: 'completed-with-skipped',
          severity: 'low',
        });
      });

      it('claim ไม่ได้ (ถูกดึงงาน/มีผลไปแล้วพร้อมกัน) -> false ไม่ทำอะไรต่อ', async () => {
        campaignRolloutTarget.updateMany.mockResolvedValueOnce({ count: 0 });

        const result = await service.markTargetSkippedOffline('rt-1', 'ข้าม');

        expect(result).toBe(false);
        expect(campaignRolloutTarget.count).not.toHaveBeenCalled();
      });
    });

    describe('recordLateTargetResult', () => {
      const lateTarget = { id: 'rt-1', rolloutId: activeRollout.id };

      /** count ในทรานแซกชัน 3 ค่า (success, failed, pending) */
      function mockTxCounts(c: {
        success: number;
        failed: number;
        pending: number;
      }) {
        campaignRolloutTarget.findUniqueOrThrow.mockResolvedValue(lateTarget);
        campaignRolloutTarget.count
          .mockResolvedValueOnce(c.success)
          .mockResolvedValueOnce(c.failed)
          .mockResolvedValueOnce(c.pending);
      }

      /** ข้อมูลที่อ่านหลัง commit เพื่อประกอบ event (windowFailure, skipped,
       * timeoutFailure แล้วตามด้วยรายการที่ล้ม) */
      function mockEventData(e: {
        window: number;
        skipped: number;
        timeout: number;
        failed?: { deviceId: string; resultDetail: string | null }[];
      }) {
        campaignRolloutTarget.count
          .mockResolvedValueOnce(e.window)
          .mockResolvedValueOnce(e.skipped)
          .mockResolvedValueOnce(e.timeout);
        campaignRolloutTarget.findMany.mockResolvedValue(e.failed ?? []);
      }

      it('skipped_offline -> success พร้อมหมายเหตุล่าช้า นับตัวเลขใหม่', async () => {
        mockTxCounts({ success: 5, failed: 1, pending: 2 });
        campaignRollout.update.mockResolvedValue({
          ...activeRollout,
          status: 'active',
        });

        const result = await service.recordLateTargetResult(
          'rt-1',
          true,
          'ใช้ค่าแล้ว',
        );

        expect(result).toBe(true);
        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          where: { id: 'rt-1', status: 'skipped_offline' },
          data: {
            status: 'success',
            resultDetail: 'ผลล่าช้า: ใช้ค่าแล้ว',
          },
        });
        expect(campaignRollout.update).toHaveBeenCalledWith({
          where: { id: activeRollout.id },
          data: { successCount: 5, failureCount: 1 },
        });
      });

      it('Rollout ยัง active และยังมีเครื่องค้าง -> ไม่ส่ง event ใดๆ (ผลสุดท้ายตอนจบจะส่งเอง) และไม่อ่านข้อมูลประกอบ event', async () => {
        mockTxCounts({ success: 5, failed: 1, pending: 2 });
        campaignRollout.update.mockResolvedValue({
          ...activeRollout,
          status: 'active',
        });

        await service.recordLateTargetResult('rt-1', true, 'ใช้ค่าแล้ว');

        // รีวิว B บน #337: เดิมได้ rollout-failed 1 ตัวทั้งที่ Rollout ยังรันอยู่
        expect(failedEvents).toEqual([]);
        expect(updatedEvents).toEqual([]);
        expect(statusEvents).toEqual([]);
        // มีแค่ count ในทรานแซกชัน 3 ครั้ง ไม่มี query ประกอบ event
        expect(campaignRolloutTarget.count).toHaveBeenCalledTimes(3);
        expect(campaignRolloutTarget.findMany).not.toHaveBeenCalled();
      });

      it('Rollout จบ (completed) ไปแล้ว -> ส่ง rollout-result-updated อย่างเดียว ไม่ส่ง rollout-failed / status-changed', async () => {
        mockTxCounts({ success: 9, failed: 1, pending: 0 });
        // ปิดไม่ได้เพราะไม่ใช่ active แล้ว (เงื่อนไข status: 'active' ไม่ match)
        campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });
        campaignRollout.update.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
        });
        campaignRollout.findUnique.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
          failureCount: 1,
          campaign: { name: 'กลุ่มรถบรรทุก' },
        });
        mockEventData({
          window: 1,
          skipped: 0,
          timeout: 0,
          failed: [{ deviceId: 'DEV-9', resultDetail: 'ผลล่าช้า: ค่าผิด' }],
        });

        const result = await service.recordLateTargetResult(
          'rt-1',
          false,
          'ค่าผิด',
        );

        expect(result).toBe(true);
        expect(failedEvents).toEqual([]);
        expect(statusEvents).toEqual([]);
        expect(updatedEvents).toEqual([
          {
            rolloutId: activeRollout.id,
            campaignId: activeRollout.campaignId,
            campaignName: 'กลุ่มรถบรรทุก',
            // ล้ม 1 จาก 10 เครื่อง = 10% เกินเกณฑ์ Auto Pause จึงเป็น high
            severity: 'high',
            failureCount: 1,
            skippedCount: 0,
            targetCount: 10,
            failedDeviceIds: ['DEV-9'],
            sampleErrors: ['ผลล่าช้า: ค่าผิด'],
          },
        ]);
      });

      it('Rollout จบแล้วและผลล่าช้าทำให้ไม่มีเครื่องค้าง/ล้มเหลือ -> ยังส่ง rollout-result-updated (อัปเดตตัวเลข) ไม่ส่ง completed-clean', async () => {
        mockTxCounts({ success: 10, failed: 0, pending: 0 });
        campaignRollout.updateMany.mockResolvedValueOnce({ count: 0 });
        campaignRollout.update.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
        });
        campaignRollout.findUnique.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
          failureCount: 0,
          campaign: { name: 'กลุ่มรถบรรทุก' },
        });
        mockEventData({ window: 0, skipped: 0, timeout: 0 });

        await service.recordLateTargetResult('rt-1', true, 'ใช้ค่าแล้ว');

        expect(failedEvents).toEqual([]);
        // §15.4 แถวสุดท้าย: ไม่ปิด Incident เอง ให้ Operation ปิด
        expect(statusEvents).toEqual([]);
        expect(updatedEvents).toHaveLength(1);
        expect(updatedEvents[0]).toMatchObject({
          failureCount: 0,
          skippedCount: 0,
          severity: 'low',
        });
      });

      it('Rollout หยุด (paused) อยู่ -> ส่ง rollout-result-updated อย่างเดียว', async () => {
        mockTxCounts({ success: 4, failed: 3, pending: 3 });
        campaignRollout.update.mockResolvedValue({
          ...activeRollout,
          status: 'paused',
        });
        campaignRollout.findUnique.mockResolvedValue({
          ...activeRollout,
          status: 'paused',
          failureCount: 3,
          campaign: { name: 'กลุ่มรถบรรทุก' },
        });
        mockEventData({ window: 3, skipped: 1, timeout: 0 });

        await service.recordLateTargetResult('rt-1', true, 'ใช้ค่าแล้ว');

        expect(failedEvents).toEqual([]);
        expect(statusEvents).toEqual([]);
        expect(updatedEvents).toHaveLength(1);
        expect(updatedEvents[0]).toMatchObject({
          failureCount: 3,
          skippedCount: 1,
        });
      });

      it('ผลล่าช้าเป็นตัวสุดท้ายที่ปิด Rollout ที่ยัง active และมีเครื่องล้ม -> ส่ง rollout-failed 1 ตัว (การจบครั้งแรกจริง) ไม่ส่ง rollout-result-updated', async () => {
        mockTxCounts({ success: 8, failed: 2, pending: 0 });
        // updateMany ค่า default = {count: 1} -> ปิด Rollout ได้
        campaignRollout.findUnique.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
          failureCount: 2,
          campaign: { name: 'กลุ่มรถบรรทุก' },
        });
        mockEventData({
          window: 2,
          skipped: 0,
          timeout: 0,
          failed: [
            { deviceId: 'DEV-8', resultDetail: 'x' },
            { deviceId: 'DEV-9', resultDetail: 'y' },
          ],
        });

        await service.recordLateTargetResult('rt-1', false, 'ค่าผิด');

        expect(failedEvents).toHaveLength(1);
        expect(failedEvents[0]).toMatchObject({
          kind: 'completed-with-failures',
          failureCount: 2,
        });
        expect(updatedEvents).toEqual([]);
        expect(statusEvents).toEqual([]);
      });

      it('ผลล่าช้าเป็นตัวสุดท้ายที่ปิด Rollout ที่ยัง active และสะอาด -> ส่ง completed-clean', async () => {
        mockTxCounts({ success: 10, failed: 0, pending: 0 });
        campaignRollout.findUnique.mockResolvedValue({
          ...activeRollout,
          status: 'completed',
          failureCount: 0,
          campaign: { name: 'กลุ่มรถบรรทุก' },
        });
        mockEventData({ window: 0, skipped: 0, timeout: 0 });

        await service.recordLateTargetResult('rt-1', true, 'ใช้ค่าแล้ว');

        expect(failedEvents).toEqual([]);
        expect(updatedEvents).toEqual([]);
        expect(statusEvents).toEqual([
          {
            rolloutId: activeRollout.id,
            campaignId: activeRollout.campaignId,
            action: 'completed-clean',
          },
        ]);
      });

      it('ไม่ใช่ skipped_offline แล้ว -> false ไม่ส่ง event', async () => {
        campaignRolloutTarget.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(
          service.recordLateTargetResult('rt-1', true, 'x'),
        ).resolves.toBe(false);
        expect(failedEvents).toEqual([]);
        expect(updatedEvents).toEqual([]);
      });
    });

    it('resume -> ส่ง rollout-status-changed action resumed', async () => {
      const paused: CampaignRollout = { ...activeRollout, status: 'paused' };
      campaignRollout.findUnique.mockResolvedValue(paused);
      campaignRollout.findUniqueOrThrow.mockResolvedValue({
        ...paused,
        status: 'active',
        applyMode: 'real',
      });

      await service.resume(paused.id, operation);

      expect(statusEvents).toEqual([
        {
          rolloutId: paused.id,
          campaignId: paused.campaignId,
          action: 'resumed',
        },
      ]);
    });
  });

  describe('ค่าเฉพาะเครื่องตอนสร้าง Rollout (docs/17)', () => {
    const valuesDto = (
      deviceValues: CreateCampaignRolloutDto['deviceValues'],
    ): CreateCampaignRolloutDto => ({
      ...baseDto(),
      deviceValues,
      deviceValuesReason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
    });

    it('บันทึก proposedFields ต่อ target และเหตุผลที่ Rollout และ Audit เก็บแค่ชื่อ field ไม่เก็บค่า', async () => {
      await service.create(
        campaignId,
        valuesDto([{ deviceId: 'DEV-0001', fields: { SPEED_LIMIT: 180 } }]),
        operation,
      );

      expect(campaignRollout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceValuesReason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
        }) as Partial<CampaignRollout>,
      });
      expect(campaignRolloutTarget.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            deviceId: 'DEV-0001',
            proposedFields: { SPEED_LIMIT: 180 },
          }),
          { rolloutId: sampleRollout.id, deviceId: 'DEV-0002' },
        ],
      });
      const auditCalls = auditLog.create.mock.calls as {
        data: { metadata?: unknown };
      }[][];
      const audit = auditCalls[0][0];
      expect(audit.data.metadata).toEqual({
        deviceValues: [{ deviceId: 'DEV-0001', fieldNames: ['SPEED_LIMIT'] }],
      });
      expect(JSON.stringify(audit.data.metadata)).not.toContain('180');
    });

    it('ไม่ส่ง deviceValues: ไม่มี proposedFields และไม่ตั้ง deviceValuesReason', async () => {
      await service.create(campaignId, baseDto(), operation);

      const createCalls = campaignRollout.create.mock.calls as {
        data: Record<string, unknown>;
      }[][];
      const created = createCalls[0][0];
      expect(created.data).not.toHaveProperty('deviceValuesReason');
      expect(
        configDefinitionService.validateOperationOverridableFields,
      ).not.toHaveBeenCalled();
    });

    it('Rollout ของ Firmware ส่ง deviceValues ไม่ได้ (400)', async () => {
      await expect(
        service.create(
          campaignId,
          {
            ...firmwareDto(),
            deviceValues: [{ deviceId: 'DEV-0001', fields: { A: 1 } }],
            deviceValuesReason: 'x',
          },
          operation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(campaignRollout.create).not.toHaveBeenCalled();
    });

    it('deviceId ที่ไม่อยู่ใน Rollout (ถูกเอาออก) / ซ้ำ / ไม่มีค่า -> 400 พร้อมรายการ', async () => {
      await expect(
        service.create(
          campaignId,
          {
            ...valuesDto([
              { deviceId: 'DEV-0002', fields: { A: 1 } },
              { deviceId: 'DEV-0002', fields: { A: 2 } },
              { deviceId: 'DEV-0001', fields: {} },
              { deviceId: 'DEV-0001', fields: { A: 1 } },
            ]),
            excludeDeviceIds: ['DEV-0002'],
          },
          operation,
        ),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.stringContaining('DEV-0002: ไม่ได้อยู่ใน Rollout นี้'),
            expect.stringContaining('DEV-0001: ไม่มีค่าที่ต้องการตั้ง'),
          ]) as string[],
        },
      });
      expect(campaignRollout.create).not.toHaveBeenCalled();
    });

    it('เกิน 200 เครื่อง -> 400', async () => {
      const many = Array.from({ length: 201 }, (_, i) => ({
        deviceId: `DEV-${i}`,
        fields: { A: 1 },
      }));

      await expect(
        service.create(campaignId, valuesDto(many), operation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ตรวจหลายเครื่อง: โหลดคลัง Parameter ครั้งเดียว ไม่ query ต่อเครื่อง', async () => {
      await service.create(
        campaignId,
        valuesDto([
          { deviceId: 'DEV-0001', fields: { SPEED_LIMIT: 180 } },
          { deviceId: 'DEV-0002', fields: { SPEED_LIMIT: 150 } },
        ]),
        operation,
      );

      expect(
        configDefinitionService.loadFieldDefinitions,
      ).toHaveBeenCalledTimes(1);
      expect(
        configDefinitionService.validateOperationOverridableFields,
      ).toHaveBeenCalledTimes(2);
    });

    it('field ไม่ผ่านการตรวจเทียบคลัง Parameter -> 400 ต่อเครื่อง และไม่สร้าง Rollout', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        fields: { SPEED_LIMIT: 120 },
      });
      configDefinitionService.validateOperationOverridableFields.mockResolvedValue(
        ['field "SPEED_LIMIT" ต้องเป็นชนิดข้อมูล integer'],
      );

      await expect(
        service.create(
          campaignId,
          valuesDto([
            { deviceId: 'DEV-0001', fields: { SPEED_LIMIT: 'เร็ว' } },
          ]),
          operation,
        ),
      ).rejects.toMatchObject({
        response: {
          errors: ['DEV-0001: field "SPEED_LIMIT" ต้องเป็นชนิดข้อมูล integer'],
        },
      });
      expect(
        configDefinitionService.validateOperationOverridableFields,
      ).toHaveBeenCalledWith(
        'GT06N',
        'TCP',
        { SPEED_LIMIT: 'เร็ว' },
        // ชื่อ field ใน template ของ Config (config.fields) ส่งไปด้วย
        ['SPEED_LIMIT'],
        // คลัง Parameter ที่โหลดครั้งเดียวแล้วส่งต่อ
        [],
      );
      expect(campaignRollout.create).not.toHaveBeenCalled();
    });

    it('เครื่องที่มีคำขอ override ของช่างรออนุมัติ -> 409 ระบุเครื่อง และไม่สร้าง target', async () => {
      deviceConfigOverride.findMany.mockResolvedValue([
        { deviceId: 'DEV-0001' },
      ]);

      await expect(
        service.create(
          campaignId,
          valuesDto([{ deviceId: 'DEV-0001', fields: { SPEED_LIMIT: 180 } }]),
          operation,
        ),
      ).rejects.toThrow(/DEV-0001/);
      expect(campaignRolloutTarget.createMany).not.toHaveBeenCalled();
    });
  });

  describe('release: บันทึกค่าเฉพาะเครื่องเป็น DeviceConfigOverride (docs/17 ข้อ 3.3)', () => {
    const approvedAt = new Date('2026-01-02T00:00:00.000Z');
    const approvedRollout: CampaignRollout = {
      ...sampleRollout,
      status: 'approved',
      approvedBy: 'op-2',
      approvedAt,
      deviceValuesReason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
    };
    const otherOperation: ActingUser = { id: 'op-2', role: 'Operation' };

    beforeEach(() => {
      const active: CampaignRollout = { ...approvedRollout, status: 'active' };
      campaignRollout.findUnique.mockResolvedValue(approvedRollout);
      campaignRollout.findUniqueOrThrow.mockResolvedValue(active);
    });

    it('target ที่มี proposedFields -> สร้าง override approved รวมค่า approved เดิมของ (เครื่อง, Config นี้) และ versionNumber = ล่าสุด + 1', async () => {
      campaignRolloutTarget.findMany.mockResolvedValueOnce([
        {
          id: 'rt-1',
          rolloutId: approvedRollout.id,
          deviceId: 'DEV-0001',
          proposedFields: { SPEED_LIMIT: 180 },
        },
      ]);
      // ค่า approved เดิมของ (DEV-0001, cfg-1) แล้วเครื่องมี version ล่าสุด 4
      deviceConfigOverride.findFirst
        .mockResolvedValueOnce({
          fields: { APN: 'internet', SPEED_LIMIT: 120 },
        })
        .mockResolvedValueOnce({ versionNumber: 4 });

      await service.release(approvedRollout.id, otherOperation);

      expect(deviceConfigOverride.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'DEV-0001',
          configId: approvedConfig.id,
          versionNumber: 5,
          fields: { APN: 'internet', SPEED_LIMIT: 180 },
          reason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
          status: 'approved',
          overriddenBy: operation.id,
          overriddenAt: approvedRollout.createdAt,
          decidedBy: 'op-2',
          decidedAt: approvedAt,
        },
      });
      const calls = auditLog.create.mock.calls as {
        data: { action: string; metadata?: unknown };
      }[][];
      const releaseAudit = calls
        .map((call) => call[0])
        .find((arg) => arg.data.action === 'release');
      expect(releaseAudit?.data.metadata).toEqual({
        deviceValues: [{ deviceId: 'DEV-0001', fieldNames: ['SPEED_LIMIT'] }],
      });
    });

    it('ช่างขอ override (เครื่อง, Config นี้) หลังสร้าง Rollout -> release 409 ระบุเครื่อง ไม่สร้างแถว override (docs/17 §5)', async () => {
      campaignRolloutTarget.findMany.mockResolvedValueOnce([
        {
          id: 'rt-1',
          rolloutId: approvedRollout.id,
          deviceId: 'DEV-0001',
          proposedFields: { SPEED_LIMIT: 180 },
        },
        {
          id: 'rt-2',
          rolloutId: approvedRollout.id,
          deviceId: 'DEV-0002',
          proposedFields: { SPEED_LIMIT: 150 },
        },
      ]);
      deviceConfigOverride.findMany.mockResolvedValueOnce([
        { deviceId: 'DEV-0001' },
      ]);

      await expect(
        service.release(approvedRollout.id, otherOperation),
      ).rejects.toThrow(/DEV-0001/);
      expect(deviceConfigOverride.findMany).toHaveBeenCalledWith({
        where: {
          configId: approvedConfig.id,
          status: 'pending',
          deviceId: { in: ['DEV-0001', 'DEV-0002'] },
        },
        select: { deviceId: true },
      });
      expect(deviceConfigOverride.create).not.toHaveBeenCalled();
    });

    it('ไม่มี target ที่มีค่าเฉพาะเครื่อง -> ไม่สร้าง override', async () => {
      campaignRolloutTarget.findMany.mockResolvedValueOnce([]);

      await service.release(approvedRollout.id, otherOperation);

      expect(deviceConfigOverride.create).not.toHaveBeenCalled();
    });

    it('ชน unique ของ (deviceId, versionNumber) -> 409 ให้ลองใหม่', async () => {
      campaignRolloutTarget.findMany.mockResolvedValueOnce([
        {
          id: 'rt-1',
          rolloutId: approvedRollout.id,
          deviceId: 'DEV-0001',
          proposedFields: { SPEED_LIMIT: 180 },
        },
      ]);
      deviceConfigOverride.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.release(approvedRollout.id, otherOperation),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getDeviceValues (docs/17 ข้อ 3.5)', () => {
    beforeEach(() => {
      configFieldDefinition.findMany.mockResolvedValue([
        {
          fieldName: 'SPEED_LIMIT',
          supportedModels: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
        },
        {
          fieldName: 'ONLY_OTHER_MODEL',
          supportedModels: [{ deviceModel: 'VT300', protocol: 'TCP' }],
        },
      ]);
    });

    it('คืนค่าพิเศษเดิมที่ใช้ต่อได้ แยก field ที่ใช้ไม่ได้พร้อมเหตุผล และข้ามเครื่องที่ไม่มีอะไร', async () => {
      deviceConfigOverride.findMany
        // approved ล่าสุดต่อเครื่อง (เรียงจากใหม่ไปเก่า)
        .mockResolvedValueOnce([
          {
            deviceId: 'DEV-0001',
            configId: 'cfg-old',
            versionNumber: 3,
            overriddenBy: 'st-1',
            overriddenAt: new Date('2026-01-01T00:00:00.000Z'),
            fields: {
              SPEED_LIMIT: 180,
              ONLY_OTHER_MODEL: 1,
              GHOST_FIELD: 2,
            },
          },
          {
            deviceId: 'DEV-0001',
            configId: 'cfg-old',
            versionNumber: 1,
            overriddenBy: 'st-1',
            overriddenAt: new Date('2025-12-01T00:00:00.000Z'),
            fields: { SPEED_LIMIT: 100 },
          },
        ])
        // pending ของ (เครื่อง, Config นี้)
        .mockResolvedValueOnce([{ deviceId: 'DEV-0002' }]);

      const items = await service.getDeviceValues(
        campaignId,
        approvedConfig.id,
      );

      expect(items).toEqual([
        {
          deviceId: 'DEV-0001',
          hasPendingRequest: false,
          previous: {
            fields: { SPEED_LIMIT: 180 },
            dropped: [
              {
                fieldName: 'ONLY_OTHER_MODEL',
                reason: 'ไม่รองรับโมเดล/โปรโตคอลของ Config นี้',
              },
              {
                fieldName: 'GHOST_FIELD',
                reason: 'ไม่มีนิยามในคลัง Parameter',
              },
            ],
            fromConfigId: 'cfg-old',
            overriddenBy: 'st-1',
            overriddenAt: new Date('2026-01-01T00:00:00.000Z'),
            versionNumber: 3,
          },
        },
        { deviceId: 'DEV-0002', hasPendingRequest: true, previous: null },
      ]);
    });

    it('field นอกชุดของรุ่นแต่อยู่ใน template ของ Config นี้ -> ใช้ต่อได้ ไม่ถูกทิ้ง', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        fields: { SPEED_LIMIT: 120, ONLY_OTHER_MODEL: 5 },
      });
      deviceConfigOverride.findMany
        .mockResolvedValueOnce([
          {
            deviceId: 'DEV-0001',
            configId: 'cfg-old',
            versionNumber: 1,
            overriddenBy: 'st-1',
            overriddenAt: new Date('2026-01-01T00:00:00.000Z'),
            fields: { ONLY_OTHER_MODEL: 9, GHOST_FIELD: 2 },
          },
        ])
        .mockResolvedValueOnce([]);

      const items = await service.getDeviceValues(
        campaignId,
        approvedConfig.id,
      );

      expect(items[0].previous?.fields).toEqual({ ONLY_OTHER_MODEL: 9 });
      // ไม่มีนิยามในคลังยังถูกทิ้งเสมอ แม้ชื่อบังเอิญอยู่ใน template
      expect(items[0].previous?.dropped.map((d) => d.fieldName)).toEqual([
        'GHOST_FIELD',
      ]);
    });

    it('เครื่องที่ยังไม่ installed ไม่อยู่ในผลลัพธ์ (create() เอาเข้า Rollout ไม่ได้)', async () => {
      device.findMany.mockResolvedValue([
        { ...installedDeviceA, status: 'registered' },
      ]);

      const items = await service.getDeviceValues(
        campaignId,
        approvedConfig.id,
      );

      expect(items).toEqual([]);
    });

    it('เครื่องที่โมเดล/โปรโตคอลไม่ตรงกับ Config ไม่อยู่ในผลลัพธ์', async () => {
      device.findMany.mockResolvedValue([
        { ...installedDeviceA, deviceModel: 'VT300' },
      ]);

      const items = await service.getDeviceValues(
        campaignId,
        approvedConfig.id,
      );

      expect(items).toEqual([]);
    });

    it('ไม่พบ Campaign หรือ Config -> 404', async () => {
      campaign.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getDeviceValues(campaignId, approvedConfig.id),
      ).rejects.toBeInstanceOf(NotFoundException);

      config.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getDeviceValues(campaignId, approvedConfig.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findTargets: mask ค่า sensitive ของ proposedFields ตาม role', () => {
    const targets = [
      {
        id: 'rt-1',
        rolloutId: sampleRollout.id,
        deviceId: 'DEV-0001',
        proposedFields: { SPEED_LIMIT: 180, COMMAND_PASSWORD: 'secret' },
      },
      {
        id: 'rt-2',
        rolloutId: sampleRollout.id,
        deviceId: 'DEV-0002',
        proposedFields: null,
      },
    ];

    beforeEach(() => {
      campaignRolloutTarget.findMany.mockResolvedValue(targets);
      configFieldDefinition.findMany.mockResolvedValue([
        { fieldName: 'COMMAND_PASSWORD' },
      ]);
    });

    it('Operation เห็นค่าจริง', async () => {
      const result = await service.findTargets(sampleRollout.id, operation);

      expect(result[0].proposedFields).toEqual({
        SPEED_LIMIT: 180,
        COMMAND_PASSWORD: 'secret',
      });
    });

    it('role อื่นเห็น sensitive เป็น mask ส่วนที่ไม่ sensitive และ null คงเดิม', async () => {
      const result = await service.findTargets(sampleRollout.id, {
        id: 'au-1',
        role: 'Auditor',
      });

      expect(result[0].proposedFields).toEqual({
        SPEED_LIMIT: 180,
        COMMAND_PASSWORD: '********',
      });
      expect(result[1].proposedFields).toBeNull();
    });
  });
});
