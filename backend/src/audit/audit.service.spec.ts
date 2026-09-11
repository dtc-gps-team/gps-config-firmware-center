import { Test, TestingModule } from '@nestjs/testing';
import { AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

const entry: AuditLog = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: 'sw-1',
  auditModule: 'config',
  action: 'create',
  ipAddress: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AuditService', () => {
  let service: AuditService;
  let auditLog: { findMany: jest.Mock };

  beforeEach(async () => {
    auditLog = { findMany: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: { auditLog } },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  describe('findAll', () => {
    it('ไม่มี filter -> where ว่าง (ทุก field undefined) เรียงตาม createdAt desc', async () => {
      auditLog.findMany.mockResolvedValue([entry]);

      const result = await service.findAll({});

      expect(result).toEqual([entry]);
      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: undefined, auditModule: undefined, action: undefined },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('มี userId/auditModule/action -> ส่งต่อ Prisma ตรงๆ', async () => {
      auditLog.findMany.mockResolvedValue([]);

      await service.findAll({
        userId: 'sw-1',
        auditModule: 'config',
        action: 'create',
      });

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'sw-1', auditModule: 'config', action: 'create' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
