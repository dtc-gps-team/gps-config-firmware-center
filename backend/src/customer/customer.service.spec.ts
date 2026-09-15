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
    it('คืนรายชื่อลูกค้าแบบย่อ (id + companyName) เรียงตามชื่อบริษัท', async () => {
      const rows = [
        { id: 'cus-1', companyName: 'ABC Logistics' },
        { id: 'cus-2', companyName: 'Northern Fleet' },
      ];
      customer.findMany.mockResolvedValue(rows);

      const result = await service.findAll();

      expect(result).toEqual(rows);
      expect(customer.findMany).toHaveBeenCalledWith({
        select: { id: true, companyName: true },
        orderBy: { companyName: 'asc' },
      });
    });

    it('ไม่มีลูกค้าในระบบ -> คืน array ว่าง', async () => {
      customer.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });
});
