import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerService } from './customer.service';

describe('CustomerService', () => {
  let service: CustomerService;
  let customer: { findMany: jest.Mock };

  beforeEach(async () => {
    customer = { findMany: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: { customer } },
      ],
    }).compile();

    service = module.get(CustomerService);
  });

  describe('findAll', () => {
    it('คืนรายชื่อลูกค้าแบบย่อ (id + companyName + isActive) เรียงตามชื่อบริษัท', async () => {
      const rows = [
        { id: 'cus-1', companyName: 'ABC Logistics', isActive: true },
        { id: 'cus-2', companyName: 'Northern Fleet', isActive: true },
      ];
      customer.findMany.mockResolvedValue(rows);

      const result = await service.findAll();

      expect(result).toEqual(rows);
      expect(customer.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { id: true, companyName: true, isActive: true },
        orderBy: { companyName: 'asc' },
      });
    });

    it('activeOnly -> กรองเฉพาะลูกค้าที่ใช้งานอยู่', async () => {
      customer.findMany.mockResolvedValue([]);

      await service.findAll({ activeOnly: true });

      expect(customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('ไม่มีลูกค้าในระบบ -> คืน array ว่าง', async () => {
      customer.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });
});
