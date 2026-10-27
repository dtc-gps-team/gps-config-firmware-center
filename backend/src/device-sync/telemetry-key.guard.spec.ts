import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  TELEMETRY_UNAUTHORIZED_MESSAGE,
  TelemetryKeyGuard,
} from './telemetry-key.guard';
import { TelemetrySettings } from './telemetry-settings';

const CENTRAL_KEY = 'central-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OWN_KEY = 'own-key-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const sha = (v: string) => createHash('sha256').update(v).digest();
const shaHex = (v: string) => sha(v).toString('hex');

function context(params: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params }) }),
  } as unknown as ExecutionContext;
}

function settings(centralKeyHash: Buffer | null): TelemetrySettings {
  return {
    centralKeyHash,
    retentionDays: 30,
    perDeviceLimit: 60,
    perIpLimit: 300,
  };
}

describe('TelemetryKeyGuard (docs/23 §7.3)', () => {
  let findUnique: jest.Mock;

  function guard(central: Buffer | null = sha(CENTRAL_KEY)) {
    return new TelemetryKeyGuard(
      { device: { findUnique } } as unknown as PrismaService,
      settings(central),
    );
  }

  beforeEach(() => {
    findUnique = jest.fn();
  });

  async function expect401(
    g: TelemetryKeyGuard,
    params: Record<string, string>,
  ) {
    await expect(g.canActivate(context(params))).rejects.toThrow(
      new UnauthorizedException(TELEMETRY_UNAUTHORIZED_MESSAGE),
    );
  }

  it('key กลางถูก + เครื่องไม่มี key ของตัวเอง -> ผ่าน · อ่านแค่ status/telemetryKeyHash', async () => {
    findUnique.mockResolvedValue({
      status: 'installed',
      telemetryKeyHash: null,
    });

    await expect(
      guard().canActivate(context({ deviceId: 'BOX-0001', key: CENTRAL_KEY })),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { deviceId: 'BOX-0001' },
      select: { status: true, telemetryKeyHash: true },
    });
  });

  it('เครื่องสถานะ registered (ยังไม่ติดตั้ง) -> ผ่าน (Q5)', async () => {
    findUnique.mockResolvedValue({
      status: 'registered',
      telemetryKeyHash: null,
    });

    await expect(
      guard().canActivate(context({ deviceId: 'BOX-0001', key: CENTRAL_KEY })),
    ).resolves.toBe(true);
  });

  it('key ผิด -> 401', async () => {
    findUnique.mockResolvedValue({
      status: 'installed',
      telemetryKeyHash: null,
    });
    await expect401(guard(), { deviceId: 'BOX-0001', key: 'wrong' });
  });

  it('ไม่มีเครื่องนี้ -> 401 ข้อความเดียวกับ key ผิด', async () => {
    findUnique.mockResolvedValue(null);
    await expect401(guard(), { deviceId: 'NOPE', key: CENTRAL_KEY });
  });

  it('เครื่อง decommissioned -> 401 แม้ key ถูก', async () => {
    findUnique.mockResolvedValue({
      status: 'decommissioned',
      telemetryKeyHash: null,
    });
    await expect401(guard(), { deviceId: 'BOX-0001', key: CENTRAL_KEY });
  });

  it('เครื่องตั้ง key ของตัวเอง -> key ของเครื่องผ่าน, key กลางไม่ผ่าน', async () => {
    findUnique.mockResolvedValue({
      status: 'installed',
      telemetryKeyHash: shaHex(OWN_KEY),
    });

    await expect(
      guard().canActivate(context({ deviceId: 'BOX-0001', key: OWN_KEY })),
    ).resolves.toBe(true);
    await expect401(guard(), { deviceId: 'BOX-0001', key: CENTRAL_KEY });
  });

  it('telemetryKeyHash ในฐานข้อมูลผิดรูปแบบ -> ไม่ถอยไปใช้ key กลาง', async () => {
    findUnique.mockResolvedValue({
      status: 'installed',
      telemetryKeyHash: 'xyz',
    });
    await expect401(guard(), { deviceId: 'BOX-0001', key: CENTRAL_KEY });
  });

  it('ไม่ได้ตั้ง key กลาง -> เครื่องที่ไม่มี key ของตัวเองถูกปฏิเสธทั้งหมด (fail closed)', async () => {
    findUnique.mockResolvedValue({
      status: 'installed',
      telemetryKeyHash: null,
    });
    await expect401(guard(null), { deviceId: 'BOX-0001', key: CENTRAL_KEY });
    await expect401(guard(null), { deviceId: 'BOX-0001', key: '' });
  });
});
