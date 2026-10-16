import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  it('ต่อฐานข้อมูลได้ -> ok', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('ต่อฐานข้อมูลไม่ได้ -> 503 ตอบแค่ error ไม่ส่งข้อความของ error ออกไป', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused at 10.0.0.5'));

    let thrown: unknown;
    try {
      await controller.check();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    const response = (thrown as ServiceUnavailableException).getResponse();
    expect(response).toEqual({ status: 'error', database: 'error' });
    expect(JSON.stringify(response)).not.toContain('10.0.0.5');
  });
});
