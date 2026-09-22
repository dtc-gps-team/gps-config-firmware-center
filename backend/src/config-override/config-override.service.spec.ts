import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from '@prisma/client';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, ConfigOverrideService } from './config-override.service';

const st: ActingUser = { id: 'st-1', role: 'ST' };

const baseConfig: Config = {
  id: 'cfg-1',
  name: 'Ambulance Standard',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  description: null,
  status: 'approved',
  fields: { APN1: 'internet', MTYP: 'auto' },
  createdBy: 'ce-1',
  approvedBy: 'op-1',
  suggestedApproverId: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('ConfigOverrideService', () => {
  let service: ConfigOverrideService;
  let configFindFirst: jest.Mock;
  let validateOverridableFields: jest.Mock;
  let configVersionCount: jest.Mock;
  let configVersionCreate: jest.Mock;
  let configUpdate: jest.Mock;
  let auditLogCreate: jest.Mock;

  beforeEach(async () => {
    configFindFirst = jest.fn();
    validateOverridableFields = jest.fn().mockResolvedValue(undefined);
    configVersionCount = jest.fn().mockResolvedValue(0);
    configVersionCreate = jest.fn().mockResolvedValue({});
    configUpdate = jest.fn();
    auditLogCreate = jest.fn().mockResolvedValue({});

    const tx = {
      configVersion: { count: configVersionCount, create: configVersionCreate },
      config: { update: configUpdate },
      auditLog: { create: auditLogCreate },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigOverrideService,
        {
          provide: PrismaService,
          useValue: {
            config: { findFirst: configFindFirst },
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
          },
        },
        {
          provide: ConfigDefinitionService,
          useValue: { validateOverridableFields },
        },
      ],
    }).compile();

    service = module.get(ConfigOverrideService);
  });

  it('override สำเร็จ: merge fields, สร้าง ConfigVersion ใหม่, เขียน AuditLog', async () => {
    configFindFirst.mockResolvedValue(baseConfig);
    configUpdate.mockResolvedValue({
      ...baseConfig,
      fields: { APN1: 'internet-new', MTYP: 'auto' },
    });

    const result = await service.override(
      'cfg-1',
      {
        fields: { APN1: 'internet-new' },
        reason: 'ลูกค้าขอเปลี่ยน APN หน้างาน',
      },
      st,
    );

    expect(configFindFirst).toHaveBeenCalledWith({
      where: { id: 'cfg-1', deletedAt: null },
    });
    expect(validateOverridableFields).toHaveBeenCalledWith('GT06N', 'TCP', {
      APN1: 'internet-new',
    });
    expect(configVersionCreate).toHaveBeenCalledWith({
      data: {
        configId: 'cfg-1',
        versionNumber: 1,
        fields: { APN1: 'internet-new', MTYP: 'auto' },
        deviceModel: 'GT06N',
        protocol: 'TCP',
        approvedBy: 'st-1',
        reason: 'ลูกค้าขอเปลี่ยน APN หน้างาน',
      },
    });
    expect(configUpdate).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: { fields: { APN1: 'internet-new', MTYP: 'auto' } },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { userId: 'st-1', auditModule: 'config', action: 'override' },
    });
    expect(result.fields).toEqual({ APN1: 'internet-new', MTYP: 'auto' });
  });

  it('ไม่พบ Config (หรือถูก soft-delete ไปแล้ว) -> NotFoundException', async () => {
    configFindFirst.mockResolvedValue(null);

    await expect(
      service.override('missing', { fields: {}, reason: 'x' }, st),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(validateOverridableFields).not.toHaveBeenCalled();
  });

  it.each(['draft', 'testing', 'rejected'] as const)(
    'สถานะ %s ไม่รองรับ override -> ConflictException',
    async (status) => {
      configFindFirst.mockResolvedValue({ ...baseConfig, status });

      await expect(
        service.override('cfg-1', { fields: { APN1: 'x' }, reason: 'x' }, st),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(validateOverridableFields).not.toHaveBeenCalled();
    },
  );

  it.each(['approved', 'synced'] as const)(
    'สถานะ %s override ได้',
    async (status) => {
      configFindFirst.mockResolvedValue({ ...baseConfig, status });
      configUpdate.mockResolvedValue({ ...baseConfig, status });

      await expect(
        service.override('cfg-1', { fields: { APN1: 'x' }, reason: 'x' }, st),
      ).resolves.toBeDefined();
    },
  );

  it('field ไม่ผ่าน validateOverridableFields -> โยน BadRequestException ต่อตรงๆ ไม่แตะ DB', async () => {
    configFindFirst.mockResolvedValue(baseConfig);
    validateOverridableFields.mockRejectedValue(
      new BadRequestException('field ไม่อนุญาตให้ override'),
    );

    await expect(
      service.override('cfg-1', { fields: { MTYP: 'x' }, reason: 'x' }, st),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(configVersionCreate).not.toHaveBeenCalled();
    expect(configUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('versionNumber นับต่อจาก ConfigVersion ที่มีอยู่แล้ว', async () => {
    configFindFirst.mockResolvedValue(baseConfig);
    configVersionCount.mockResolvedValue(3);
    configUpdate.mockResolvedValue(baseConfig);

    await service.override('cfg-1', { fields: { APN1: 'x' }, reason: 'x' }, st);

    const call = configVersionCreate.mock.calls[0] as [
      { data: { versionNumber: number } },
    ];
    expect(call[0].data.versionNumber).toBe(4);
  });
});
