import { Test, TestingModule } from '@nestjs/testing';
import { AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

const entry: AuditLog = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: 'ce-1',
  auditModule: 'config',
  action: 'create',
  ipAddress: null,
  metadata: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AuditService', () => {
  let service: AuditService;
  let auditLog: { findMany: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    auditLog = { findMany: jest.fn(), count: jest.fn() };
    // $transaction แบบ array — mock ให้แค่ await ทุก promise ที่ส่งเข้ามา
    const $transaction = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: { auditLog, $transaction } },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  describe('findAll', () => {
    it('ไม่มี filter/page -> where ว่าง, หน้า 1 ขนาด 20 เรียงตาม createdAt desc + total จาก count', async () => {
      auditLog.findMany.mockResolvedValue([entry]);
      auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result).toEqual({
        items: [entry],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const where = {
        userId: undefined,
        auditModule: undefined,
        action: undefined,
      };
      expect(auditLog.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(auditLog.count).toHaveBeenCalledWith({ where });
    });

    it('page/pageSize -> skip = (page - 1) * pageSize, take = pageSize', async () => {
      auditLog.findMany.mockResolvedValue([]);
      auditLog.count.mockResolvedValue(120);

      const result = await service.findAll({ page: 3, pageSize: 50 });

      expect(result).toEqual({ items: [], total: 120, page: 3, pageSize: 50 });
      expect(auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 50 }),
      );
    });

    it('มี userId/auditModule -> ส่งต่อ Prisma ตรงๆ, action -> contains ไม่สนตัวพิมพ์เล็ก-ใหญ่', async () => {
      auditLog.findMany.mockResolvedValue([]);
      auditLog.count.mockResolvedValue(0);

      await service.findAll({
        userId: 'ce-1',
        auditModule: 'config',
        action: 'crea',
      });

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'ce-1',
          auditModule: 'config',
          action: { contains: 'crea', mode: 'insensitive' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
    });
  });
});
