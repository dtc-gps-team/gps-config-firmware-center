import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

type NotificationDelegateMock = {
  create: jest.Mock;
  update: jest.Mock;
};

type DeviceTokenDelegateMock = {
  upsert: jest.Mock;
  deleteMany: jest.Mock;
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
  deviceToken: DeviceTokenDelegateMock = {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
): Promise<NotificationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      { provide: PrismaService, useValue: { notification, deviceToken } },
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
  let deviceToken: DeviceTokenDelegateMock;

  beforeEach(() => {
    notification = { create: jest.fn(), update: jest.fn() };
    deviceToken = { upsert: jest.fn(), deleteMany: jest.fn() };
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

  describe('registerDeviceToken', () => {
    it('upsert ตาม token — สร้างใหม่ถ้ายังไม่มี, ทับ userId/platform ถ้ามีแล้ว', async () => {
      const row = {
        id: 'dt-1',
        userId: 'user-1',
        token: 'fcm-abc',
        platform: 'android',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      deviceToken.upsert.mockResolvedValue(row);
      const service = await buildService('mock', notification, deviceToken);

      const result = await service.registerDeviceToken(
        'user-1',
        'fcm-abc',
        'android',
      );

      expect(result).toEqual(row);
      expect(deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-abc' },
        create: { userId: 'user-1', token: 'fcm-abc', platform: 'android' },
        update: { userId: 'user-1', platform: 'android' },
      });
    });
  });

  describe('removeDeviceToken', () => {
    it('ลบ token ของตัวเองสำเร็จ (count > 0)', async () => {
      deviceToken.deleteMany.mockResolvedValue({ count: 1 });
      const service = await buildService('mock', notification, deviceToken);

      await expect(
        service.removeDeviceToken('user-1', 'fcm-abc'),
      ).resolves.toBeUndefined();
      expect(deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'fcm-abc', userId: 'user-1' },
      });
    });

    it('IDOR: ลบ token ของคนอื่น (count === 0) → NotFoundException', async () => {
      deviceToken.deleteMany.mockResolvedValue({ count: 0 });
      const service = await buildService('mock', notification, deviceToken);

      await expect(
        service.removeDeviceToken('attacker', 'someone-elses-token'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
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
