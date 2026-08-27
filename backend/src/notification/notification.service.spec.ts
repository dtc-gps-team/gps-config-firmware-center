import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

type NotificationDelegateMock = {
  create: jest.Mock;
  update: jest.Mock;
};

const sampleNotification: Notification = {
  id: '22222222-2222-2222-2222-222222222222',
  userId: 'user-1',
  type: 'task_assigned',
  payload: { taskId: 'abc' },
  read: false,
  sentAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function buildService(
  mode: string | undefined,
  notification: NotificationDelegateMock,
): Promise<NotificationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      { provide: PrismaService, useValue: { notification } },
      {
        provide: ConfigService,
        useValue: {
          get: (_key: string, def?: string) => mode ?? def,
        },
      },
    ],
  }).compile();

  return module.get(NotificationService);
}

describe('NotificationService', () => {
  let notification: NotificationDelegateMock;

  beforeEach(() => {
    notification = { create: jest.fn(), update: jest.fn() };
  });

  it('ค่าเริ่มต้นเป็นโหมด mock', async () => {
    const service = await buildService(undefined, notification);
    expect(service.getMode()).toBe('mock');
  });

  it('mode mock: สร้าง record แล้วคืนค่า ไม่ throw', async () => {
    notification.create.mockResolvedValue(sampleNotification);
    const service = await buildService('mock', notification);

    const result = await service.send({
      userId: 'user-1',
      type: 'task_assigned',
      payload: { taskId: 'abc' },
    });

    expect(result).toEqual(sampleNotification);
    expect(notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'task_assigned',
        payload: { taskId: 'abc' },
      },
    });
  });

  it('mode mock: payload ว่าง default เป็น {}', async () => {
    notification.create.mockResolvedValue(sampleNotification);
    const service = await buildService('mock', notification);

    await service.send({ userId: 'user-1', type: 'incident_alert' });

    expect(notification.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', type: 'incident_alert', payload: {} },
    });
  });

  it('mode fcm: ยังไม่รองรับ ต้อง throw (แต่ record ถูกสร้างแล้ว)', async () => {
    notification.create.mockResolvedValue(sampleNotification);
    const service = await buildService('fcm', notification);

    await expect(
      service.send({ userId: 'user-1', type: 'task_assigned' }),
    ).rejects.toThrow('NOTIFICATION_MODE=fcm');
    expect(notification.create).toHaveBeenCalled();
  });

  it('markSent: บันทึกเวลา sentAt', async () => {
    let arg: { where: { id: string }; data: { sentAt: Date } } | undefined;
    notification.update.mockImplementation(
      (input: { where: { id: string }; data: { sentAt: Date } }) => {
        arg = input;
        return Promise.resolve({
          ...sampleNotification,
          sentAt: input.data.sentAt,
        });
      },
    );
    const service = await buildService('mock', notification);

    await service.markSent(sampleNotification.id);

    expect(arg?.where).toEqual({ id: sampleNotification.id });
    expect(arg?.data.sentAt).toBeInstanceOf(Date);
  });
});
