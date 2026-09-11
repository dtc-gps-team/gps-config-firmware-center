import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: { user: { findMany } } },
      ],
    }).compile();

    service = module.get(UserService);
  });

  it('ไม่ส่ง role -> findMany where { isActive: true } เท่านั้น + orderBy fullName', async () => {
    await service.list({});

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, role: undefined },
      select: { id: true, fullName: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
  });

  it('ส่ง role -> filter role.code', async () => {
    await service.list({ role: 'Operation' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, role: { code: 'Operation' } },
      }),
    );
  });

  it('map เป็น UserSummary (id + fullName + role code)', async () => {
    findMany.mockResolvedValue([
      { id: 'u1', fullName: 'สมหญิง', role: { code: 'Operation' } },
      { id: 'u2', fullName: 'สมชาย', role: { code: 'Operation' } },
    ]);

    const result = await service.list({ role: 'Operation' });

    expect(result).toEqual([
      { id: 'u1', fullName: 'สมหญิง', role: 'Operation' },
      { id: 'u2', fullName: 'สมชาย', role: 'Operation' },
    ]);
  });
});
