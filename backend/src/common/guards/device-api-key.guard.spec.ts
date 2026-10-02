import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { DeviceApiKeyGuard, AuthenticatedDevice } from './device-api-key.guard';

type DeviceFindUniqueMock = { findUnique: jest.Mock };

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
    deviceModel = { findUnique: jest.fn() };
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
});
