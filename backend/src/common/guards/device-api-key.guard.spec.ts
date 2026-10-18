import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DeviceApiKeyGuard,
  AuthenticatedDevice,
  LAST_SEEN_WRITE_INTERVAL_MS,
} from './device-api-key.guard';

type DeviceFindUniqueMock = { findUnique: jest.Mock; updateMany: jest.Mock };

function buildContext(options: {
  headers?: Record<string, string>;
  params?: Record<string, string>;
}): ExecutionContext {
  const request = {
    headers: options.headers ?? {},
    params: options.params ?? {},
  } as unknown as {
    headers: Record<string, string>;
    params: Record<string, string>;
    device?: AuthenticatedDevice;
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('DeviceApiKeyGuard', () => {
  let deviceModel: DeviceFindUniqueMock;
  let guard: DeviceApiKeyGuard;
  const rawKey = 'raw-device-api-key-value';
  let keyHash: string;

  beforeAll(async () => {
    keyHash = await bcrypt.hash(rawKey, 10);
  });

  beforeEach(() => {
    deviceModel = {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    guard = new DeviceApiKeyGuard({
      device: deviceModel,
    } as unknown as PrismaService);
  });

  it('ไม่มี header X-Device-Api-Key -> UnauthorizedException ไม่ query DB', async () => {
    const context = buildContext({ params: { deviceId: 'DTC-0001' } });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(deviceModel.findUnique).not.toHaveBeenCalled();
  });

  it('ไม่มี deviceId ใน path -> UnauthorizedException ไม่ query DB', async () => {
    const context = buildContext({
      headers: { 'x-device-api-key': rawKey },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(deviceModel.findUnique).not.toHaveBeenCalled();
  });

  it('ไม่พบ deviceId นี้ในระบบ -> UnauthorizedException', async () => {
    deviceModel.findUnique.mockResolvedValue(null);
    const context = buildContext({
      headers: { 'x-device-api-key': rawKey },
      params: { deviceId: 'NOPE' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(deviceModel.findUnique).toHaveBeenCalledWith({
      where: { deviceId: 'NOPE' },
      omit: { apiKeyHash: false },
    });
  });

  it('เครื่องยังไม่เคยลงทะเบียน (apiKeyHash เป็น null) -> UnauthorizedException', async () => {
    deviceModel.findUnique.mockResolvedValue({
      deviceId: 'DTC-0001',
      apiKeyHash: null,
    });
    const context = buildContext({
      headers: { 'x-device-api-key': rawKey },
      params: { deviceId: 'DTC-0001' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('key ไม่ตรงกับ hash ที่เก็บไว้ -> UnauthorizedException', async () => {
    deviceModel.findUnique.mockResolvedValue({
      deviceId: 'DTC-0001',
      apiKeyHash: keyHash,
    });
    const context = buildContext({
      headers: { 'x-device-api-key': 'wrong-key' },
      params: { deviceId: 'DTC-0001' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('key ตรงกับ hash -> ผ่าน แนบ req.device = { deviceId }', async () => {
    deviceModel.findUnique.mockResolvedValue({
      deviceId: 'DTC-0001',
      apiKeyHash: keyHash,
    });
    const request = {
      headers: { 'x-device-api-key': rawKey },
      params: { deviceId: 'DTC-0001' },
    } as unknown as {
      headers: Record<string, string>;
      params: Record<string, string>;
      device?: AuthenticatedDevice;
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.device).toEqual({ deviceId: 'DTC-0001' });
  });

  describe('Device.lastSeenAt (docs/19 §4.3)', () => {
    const validContext = () =>
      buildContext({
        headers: { 'x-device-api-key': rawKey },
        params: { deviceId: 'DTC-0001' },
      });

    beforeEach(() => {
      deviceModel.findUnique.mockResolvedValue({
        deviceId: 'DTC-0001',
        apiKeyHash: keyHash,
      });
    });

    it('key ถูก -> อัปเดต lastSeenAt เฉพาะเมื่อไม่เคยมี หรือเก่ากว่า 1 นาที (เงื่อนไขเดียวใน updateMany)', async () => {
      const before = Date.now();

      await guard.canActivate(validContext());

      expect(deviceModel.updateMany).toHaveBeenCalledTimes(1);
      const calls = deviceModel.updateMany.mock.calls as unknown[][];
      const args = calls[0][0] as {
        where: {
          deviceId: string;
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: Date } }];
        };
        data: { lastSeenAt: Date };
      };
      expect(args.where.deviceId).toBe('DTC-0001');
      expect(args.where.OR[0]).toEqual({ lastSeenAt: null });
      const threshold = args.where.OR[1].lastSeenAt.lt.getTime();
      expect(before - threshold).toBeGreaterThanOrEqual(
        LAST_SEEN_WRITE_INTERVAL_MS - 1000,
      );
      expect(before - threshold).toBeLessThanOrEqual(
        LAST_SEEN_WRITE_INTERVAL_MS + 5000,
      );
      expect(args.data.lastSeenAt).toBeInstanceOf(Date);
    });

    it('key ผิด -> ไม่นับว่าติดต่อมา ไม่อัปเดต lastSeenAt', async () => {
      const context = buildContext({
        headers: { 'x-device-api-key': 'wrong-key' },
        params: { deviceId: 'DTC-0001' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(deviceModel.updateMany).not.toHaveBeenCalled();
    });

    it('เขียน lastSeenAt ไม่สำเร็จ -> คำขอยังผ่าน (never-throw)', async () => {
      deviceModel.updateMany.mockRejectedValue(new Error('db down'));

      await expect(guard.canActivate(validContext())).resolves.toBe(true);
    });
  });
});
