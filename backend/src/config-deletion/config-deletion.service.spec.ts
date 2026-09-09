import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, ConfigDeletionRequest } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActingUser,
  ConfigDeletionService,
  INACTIVITY_DAYS,
  REJECT_COOLDOWN_DAYS,
} from './config-deletion.service';

/** shape ของ where clause ที่ sweep() ส่งให้ prisma.config.findMany (เกณฑ์ §2) */
type SweepWhere = {
  status: { in: string[] };
  deletedAt: null;
  updatedAt: { lt: Date };
  tasks: { none: Record<string, unknown> };
  campaigns: { none: Record<string, unknown> };
  incidents: { none: Record<string, unknown> };
  deletionRequests: {
    none: { OR: { status: string; reviewedAt?: { gte: Date } }[] };
  };
};

type ConfigDelegateMock = {
  findMany: jest.Mock<Promise<Config[]>, [{ where: SweepWhere }]>;
  update: jest.Mock;
};
type RequestDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
};
type UserDelegateMock = { findMany: jest.Mock };
type AuditLogDelegateMock = { create: jest.Mock };

const staleConfig: Config = {
  id: 'cfg-1',
  name: 'ชุดค้างเก่า',
  description: null,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'draft',
  fields: {},
  createdBy: 'sw-1',
  approvedBy: null,
  deletedAt: null,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
};

const pendingRequest: ConfigDeletionRequest = {
  id: 'req-1',
  configId: 'cfg-1',
  reason: 'เข้าเกณฑ์',
  status: 'pending',
  detectedAt: new Date('2026-06-01T00:00:00.000Z'),
  reviewedBy: null,
  reviewedAt: null,
  decisionNote: null,
};

const superAdmin: ActingUser = { id: 'sa-1', role: 'SuperAdmin' };
const sw: ActingUser = { id: 'sw-1', role: 'SW' };

function makeP2025(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Record not found.', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

describe('ConfigDeletionService', () => {
  let service: ConfigDeletionService;
  let config: ConfigDelegateMock;
  let request: RequestDelegateMock;
  let user: UserDelegateMock;
  let auditLog: AuditLogDelegateMock;
  let notificationService: { send: jest.Mock };

  beforeEach(async () => {
    config = {
      findMany: jest
        .fn<Promise<Config[]>, [{ where: SweepWhere }]>()
        .mockResolvedValue([]),
      update: jest.fn(),
    };
    request = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    user = { findMany: jest.fn().mockResolvedValue([]) };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    notificationService = { send: jest.fn().mockResolvedValue(undefined) };

    const prismaMock = {
      config,
      configDeletionRequest: request,
      user,
      auditLog,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ config, configDeletionRequest: request, auditLog }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigDeletionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get(ConfigDeletionService);
  });

  describe('sweep', () => {
    it('query เกณฑ์ §2 ครบทั้ง 7 ข้อใน where clause เดียว', async () => {
      const before = Date.now();
      await service.sweep();
      const after = Date.now();

      expect(config.findMany).toHaveBeenCalledTimes(1);
      const { where } = config.findMany.mock.calls[0][0];
      expect(where.status).toEqual({ in: ['draft', 'rejected'] });
      expect(where.deletedAt).toBeNull();
      expect(where.tasks).toEqual({ none: {} });
      expect(where.campaigns).toEqual({ none: {} });
      expect(where.incidents).toEqual({ none: {} });

      // updatedAt < now - 90d
      const inactiveCutoff = where.updatedAt.lt.getTime();
      expect(inactiveCutoff).toBeGreaterThanOrEqual(
        before - INACTIVITY_DAYS * 86_400_000 - 5_000,
      );
      expect(inactiveCutoff).toBeLessThanOrEqual(
        after - INACTIVITY_DAYS * 86_400_000 + 5_000,
      );

      // §2.6 + §2.7 รวมใน none.OR: ไม่มี pending + ไม่มี rejected ใน cooldown
      const orClauses = where.deletionRequests.none.OR;
      expect(orClauses).toContainEqual({ status: 'pending' });
      const cooldownClause = orClauses.find((c) => c.status === 'rejected');
      expect(cooldownClause?.reviewedAt?.gte.getTime()).toBeGreaterThanOrEqual(
        before - REJECT_COOLDOWN_DAYS * 86_400_000 - 5_000,
      );
    });

    it('แต่ละ candidate -> สร้างคำขอ pending + แจ้ง SuperAdmin ทุกคน + แจ้งผู้สร้าง', async () => {
      config.findMany.mockResolvedValue([staleConfig]);
      request.create.mockResolvedValue(pendingRequest);
      user.findMany.mockResolvedValue([{ id: 'sa-1' }, { id: 'sa-2' }]);

      const created = await service.sweep();

      expect(created).toEqual([pendingRequest]);
      expect(request.create).toHaveBeenCalledWith({
        data: {
          configId: 'cfg-1',
          reason: expect.stringContaining(String(INACTIVITY_DAYS)) as string,
        },
      });
      // SuperAdmin query: role.code = SuperAdmin + isActive
      expect(user.findMany).toHaveBeenCalledWith({
        where: { role: { code: 'SuperAdmin' }, isActive: true },
        select: { id: true },
      });
      // 2 SuperAdmin + 1 creator = 3 ครั้ง
      expect(notificationService.send).toHaveBeenCalledTimes(3);
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sa-1',
          type: 'config_deletion_pending',
        }),
      );
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sw-1',
          type: 'config_deletion_grace',
        }),
      );
    });

    it('ไม่มี candidate -> ไม่สร้างคำขอ / ไม่ยิง notification', async () => {
      config.findMany.mockResolvedValue([]);
      const created = await service.sweep();
      expect(created).toEqual([]);
      expect(request.create).not.toHaveBeenCalled();
      expect(notificationService.send).not.toHaveBeenCalled();
    });

    it('notificationService.send ล้มเหลว -> sweep ไม่ throw (คำขอยังถูกสร้าง)', async () => {
      config.findMany.mockResolvedValue([staleConfig]);
      request.create.mockResolvedValue(pendingRequest);
      user.findMany.mockResolvedValue([{ id: 'sa-1' }]);
      notificationService.send.mockRejectedValue(new Error('fcm ล่ม'));

      const created = await service.sweep();

      expect(created).toEqual([pendingRequest]);
      expect(request.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findRequests', () => {
    it('ไม่ส่ง status -> default pending', async () => {
      request.findMany.mockResolvedValue([]);
      await service.findRequests({});
      expect(request.findMany).toHaveBeenCalledWith({
        where: { status: 'pending' },
        include: { config: true },
        orderBy: { detectedAt: 'asc' },
      });
    });

    it('ส่ง status มา -> ใช้ค่านั้น', async () => {
      request.findMany.mockResolvedValue([]);
      await service.findRequests({ status: 'approved' });
      expect(request.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'approved' } }),
      );
    });
  });

  describe('approve', () => {
    it('คำขอไม่ pending -> ConflictException (409)', async () => {
      request.findUnique.mockResolvedValue({
        ...pendingRequest,
        status: 'approved',
      });
      await expect(service.approve('req-1', superAdmin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ไม่พบคำขอ -> NotFoundException (404)', async () => {
      request.findUnique.mockResolvedValue(null);
      await expect(service.approve('nope', superAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('pending -> request approved + soft-delete Config + AuditLog', async () => {
      request.findUnique.mockResolvedValue(pendingRequest);
      request.update.mockResolvedValue({
        ...pendingRequest,
        status: 'approved',
      });
      config.update.mockResolvedValue(staleConfig);

      await service.approve('req-1', superAdmin);

      expect(request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: 'approved',
          reviewedBy: 'sa-1',
          reviewedAt: expect.any(Date) as Date,
        },
      });
      expect(config.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sa-1',
          auditModule: 'config-deletion',
          action: 'approve',
        },
      });
    });

    it('P2025 ระหว่าง transaction -> NotFoundException ไม่ใช่ 500', async () => {
      request.findUnique.mockResolvedValue(pendingRequest);
      request.update.mockRejectedValue(makeP2025());
      await expect(service.approve('req-1', superAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('คำขอไม่ pending -> ConflictException (409)', async () => {
      request.findUnique.mockResolvedValue({
        ...pendingRequest,
        status: 'rejected',
      });
      await expect(
        service.reject('req-1', 'ยังใช้อยู่', superAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('pending -> rejected + decisionNote + AuditLog · ไม่แตะ Config', async () => {
      request.findUnique.mockResolvedValue(pendingRequest);
      request.update.mockResolvedValue({
        ...pendingRequest,
        status: 'rejected',
      });

      await service.reject('req-1', 'ยังต้องใช้ชุดนี้', superAdmin);

      expect(request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: 'rejected',
          reviewedBy: 'sa-1',
          reviewedAt: expect.any(Date) as Date,
          decisionNote: 'ยังต้องใช้ชุดนี้',
        },
      });
      expect(config.update).not.toHaveBeenCalled();
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sa-1',
          auditModule: 'config-deletion',
          action: 'reject',
        },
      });
    });
  });

  describe('keep', () => {
    it('ไม่มีคำขอ pending ของ config นี้ -> NotFoundException (404)', async () => {
      request.findFirst.mockResolvedValue(null);
      await expect(service.keep('cfg-1', sw)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('มีคำขอ pending -> cancelled + reset นาฬิกา (แตะ Config.updatedAt) + AuditLog', async () => {
      request.findFirst.mockResolvedValue(pendingRequest);
      request.update.mockResolvedValue({
        ...pendingRequest,
        status: 'cancelled',
      });
      config.update.mockResolvedValue(staleConfig);

      await service.keep('cfg-1', sw);

      expect(request.findFirst).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', status: 'pending' },
      });
      expect(request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'cancelled' },
      });
      // reset นาฬิกา 90 วัน — §3
      expect(config.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { updatedAt: expect.any(Date) as Date },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sw-1',
          auditModule: 'config-deletion',
          action: 'keep',
        },
      });
    });
  });
});
