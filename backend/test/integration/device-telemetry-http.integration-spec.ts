import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceSyncModule } from '../../src/device-sync/device-sync.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

const CENTRAL_KEY = randomBytes(32).toString('base64url');
const PER_DEVICE_LIMIT = 5;
const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex');

/** payload จริงของกล่อง (`dataLoop()` ใน features.h) ตอนยังไม่มี fix */
const noFixTelemetry = (deviceId: string) => ({
  device_id: deviceId,
  latitude: 13.686,
  longitude: 100.609,
  speed_kmh: null,
  location_source: 'default',
  fix: false,
  satellites: 0,
  firmware_version: '1.2.0',
  timestamp: '',
});

/**
 * `POST /device-sync/:deviceId/telemetry/:key` (docs/23 §4) ผ่าน HTTP จริง +
 * Postgres จริง — key กลางจาก env, guard + limiter + ValidationPipe แบบเดียวกับ
 * `main.ts` (forbidNonWhitelisted) เพื่อยืนยันว่า payload จริงของกล่องไม่โดน 400
 */
describe('DeviceTelemetryController (integration — real postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const previousEnv = {
    key: process.env.TELEMETRY_INGEST_KEY_SHA256,
    perDevice: process.env.TELEMETRY_RATE_LIMIT_PER_DEVICE,
    perIp: process.env.TELEMETRY_RATE_LIMIT_PER_IP,
  };

  beforeAll(async () => {
    process.env.TELEMETRY_INGEST_KEY_SHA256 = sha256Hex(CENTRAL_KEY);
    process.env.TELEMETRY_RATE_LIMIT_PER_DEVICE = String(PER_DEVICE_LIMIT);
    // ทุกคำขอในเทสมาจาก IP เดียว — ตั้งสูงพอไม่ให้ชนกันข้ามเทส
    process.env.TELEMETRY_RATE_LIMIT_PER_IP = '10000';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        DeviceSyncModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('TELEMETRY_INGEST_KEY_SHA256', previousEnv.key);
    restore('TELEMETRY_RATE_LIMIT_PER_DEVICE', previousEnv.perDevice);
    restore('TELEMETRY_RATE_LIMIT_PER_IP', previousEnv.perIp);
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** deviceId ใหม่ทุกเทส — ตัวนับ rate limit ต่อเครื่องไม่ปนกันข้ามเทส */
  async function seedDevice(
    overrides: Partial<{
      status: 'registered' | 'installed' | 'decommissioned';
      telemetryKeyHash: string;
    }> = {},
  ) {
    const model = await getOrCreateDeviceModel(prisma, 'ESP32-DEVKIT-V1');
    return prisma.device.create({
      data: {
        deviceId: `BOX-${randomUUID().slice(0, 8)}`,
        simNumber: `NO-SIM-${randomUUID().slice(0, 8)}`,
        deviceModel: model.name,
        protocol: 'HTTP',
        status: overrides.status ?? 'installed',
        modelId: model.id,
        telemetryKeyHash: overrides.telemetryKeyHash ?? null,
      },
    });
  }

  const post = (deviceId: string, key: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/device-sync/${deviceId}/telemetry/${key}`)
      .send(body);

  it('telemetry ไม่มี fix (timestamp ว่าง, speed null) -> 200 + บันทึก + firmware_version ลง Device', async () => {
    const device = await seedDevice({ status: 'registered' });

    const res = await post(
      device.deviceId,
      CENTRAL_KEY,
      noFixTelemetry(device.deviceId),
    ).expect(200);
    expect(res.body).toEqual({ accepted: true });

    const rows = await prisma.deviceTelemetry.findMany({
      where: { deviceId: device.deviceId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fix: false,
      speedKmh: null,
      locationSource: 'default',
      satellites: 0,
      simulated: false,
    });
    expect(rows[0].recordedAt).toEqual(rows[0].receivedAt);

    const after = await prisma.device.findUniqueOrThrow({
      where: { deviceId: device.deviceId },
    });
    expect(after.reportedFirmwareVersion).toBe('1.2.0');
    expect(after.reportedFirmwareAt).not.toBeNull();
    // telemetry ไม่เปลี่ยนสถานะเครื่อง และไม่เขียน lastSeenAt (§7.3, §10.2)
    expect(after.status).toBe('registered');
    expect(after.lastSeenAt).toBeNull();
  });

  it('event ทั้ง 3 ชนิดลง DeviceEvent', async () => {
    const device = await seedDevice();
    const base = {
      device_id: device.deviceId,
      latitude: 13.7563,
      longitude: 100.5018,
      timestamp: '2026-10-27T03:00:07Z',
    };

    await post(device.deviceId, CENTRAL_KEY, {
      ...base,
      event_type: 'OVERSPEED',
      speed_kmh: 95.2,
      speed_limit_kmh: 80,
      simulated: true,
    }).expect(200);
    for (const type of ['GEOFENCE_EXIT', 'GEOFENCE_ENTER']) {
      await post(device.deviceId, CENTRAL_KEY, {
        ...base,
        event_type: type,
        distance_m: 812,
        radius_m: 500,
      }).expect(200);
    }

    const events = await prisma.deviceEvent.findMany({
      where: { deviceId: device.deviceId },
      orderBy: { receivedAt: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'OVERSPEED',
      'GEOFENCE_EXIT',
      'GEOFENCE_ENTER',
    ]);
    expect(events[0]).toMatchObject({ speedLimitKmh: 80, simulated: true });
    expect(events[1]).toMatchObject({ distanceM: 812, radiusM: 500 });
    expect(await prisma.deviceTelemetry.count()).toBe(0);
  });

  it('401 ข้อความเดียวกัน: key ผิด / ไม่มีเครื่อง / decommissioned / key กลางกับเครื่องที่มี key ของตัวเอง', async () => {
    const active = await seedDevice();
    const retired = await seedDevice({ status: 'decommissioned' });
    const ownKey = randomBytes(32).toString('base64url');
    const own = await seedDevice({ telemetryKeyHash: sha256Hex(ownKey) });

    const responses = await Promise.all([
      post(active.deviceId, 'wrong-key', noFixTelemetry(active.deviceId)),
      post('BOX-NOPE', CENTRAL_KEY, noFixTelemetry('BOX-NOPE')),
      post(retired.deviceId, CENTRAL_KEY, noFixTelemetry(retired.deviceId)),
      post(own.deviceId, CENTRAL_KEY, noFixTelemetry(own.deviceId)),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
    expect(
      new Set(responses.map((r) => (r.body as { message: string }).message))
        .size,
    ).toBe(1);
    expect(await prisma.deviceTelemetry.count()).toBe(0);

    // key ของเครื่องเองใช้ได้
    await post(own.deviceId, ownKey, noFixTelemetry(own.deviceId)).expect(200);
  });

  it('400: field ที่กล่องไม่ส่ง / device_id ใน body ไม่ตรง path', async () => {
    const device = await seedDevice();

    await post(device.deviceId, CENTRAL_KEY, {
      ...noFixTelemetry(device.deviceId),
      heading: 90,
    }).expect(400);
    await post(
      device.deviceId,
      CENTRAL_KEY,
      noFixTelemetry('BOX-OTHER'),
    ).expect(400);
    expect(await prisma.deviceTelemetry.count()).toBe(0);
  });

  it('ไม่มี key ต่อท้าย path -> 404 ตาม routing ปกติ', async () => {
    const device = await seedDevice();
    await request(app.getHttpServer())
      .post(`/api/v1/device-sync/${device.deviceId}/telemetry`)
      .send(noFixTelemetry(device.deviceId))
      .expect(404);
  });

  it('เกิน rate limit ต่อเครื่อง -> 429 (ทำงานก่อนตรวจ key)', async () => {
    const device = await seedDevice();
    for (let i = 0; i < PER_DEVICE_LIMIT; i++) {
      await post(
        device.deviceId,
        'wrong-key',
        noFixTelemetry(device.deviceId),
      ).expect(401);
    }
    await post(
      device.deviceId,
      CENTRAL_KEY,
      noFixTelemetry(device.deviceId),
    ).expect(429);
  });
});
