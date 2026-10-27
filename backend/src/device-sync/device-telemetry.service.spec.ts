import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeviceTelemetryService,
  parseDeviceTimestamp,
  REPORTED_FIRMWARE_WRITE_INTERVAL_MS,
  RETENTION_BATCH_SIZE,
} from './device-telemetry.service';
import { DeviceDataReportDto } from './dto/device-data-report.dto';
import { resolveTelemetrySettings } from './telemetry-settings';

/** payload จริงของกล่อง (`dataLoop()` ใน features.h) ตอนยังไม่มี fix */
const noFixTelemetry = {
  device_id: 'BOX-0001',
  latitude: 13.686,
  longitude: 100.609,
  speed_kmh: null,
  location_source: 'default',
  fix: false,
  satellites: 0,
  firmware_version: '1.2.0',
  timestamp: '',
};

const fixTelemetry = {
  ...noFixTelemetry,
  latitude: 13.7563,
  longitude: 100.5018,
  speed_kmh: 42.5,
  location_source: 'gps',
  fix: true,
  satellites: 9,
  timestamp: '2026-10-27T03:00:05Z',
};

/** `sendEvent("OVERSPEED", e)` — ไม่มี fix/location_source/firmware_version */
const overspeedEvent = {
  speed_kmh: 95.2,
  speed_limit_kmh: 80.0,
  latitude: 13.7563,
  longitude: 100.5018,
  device_id: 'BOX-0001',
  event_type: 'OVERSPEED',
  timestamp: '2026-10-27T03:00:07Z',
  simulated: true,
};

const geofenceEvent = {
  distance_m: 812,
  radius_m: 500,
  latitude: 13.7563,
  longitude: 100.5018,
  device_id: 'BOX-0001',
  event_type: 'GEOFENCE_EXIT',
  timestamp: '',
};

/** `data` ที่ service ส่งให้ `create()` ครั้งแรก */
interface CreatedRow {
  data: Record<string, unknown> & {
    receivedAt: Date;
    recordedAt?: Date;
    occurredAt?: Date;
  };
}
const createdData = (mock: jest.Mock) =>
  (mock.mock.calls as [CreatedRow][])[0][0].data;

/** `updateMany()` args ครั้งที่ [index] */
interface UpdateManyArgs {
  where: unknown;
  data: { reportedFirmwareAt: Date };
}
const updateManyArgs = (mock: jest.Mock, index: number) =>
  (mock.mock.calls as [UpdateManyArgs][])[index][0];

/** ตัด field ออกจาก payload ตัวอย่าง */
function without(body: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => !keys.includes(k)),
  );
}

function validate(body: object): string[] {
  const dto = plainToInstance(DeviceDataReportDto, body);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);
}

describe('DeviceDataReportDto (docs/23 §4/§5)', () => {
  it.each([
    ['telemetry ไม่มี fix', noFixTelemetry],
    ['telemetry มี fix', fixTelemetry],
    ['telemetry โหมดจำลอง', { ...fixTelemetry, simulated: true }],
    ['event OVERSPEED', overspeedEvent],
    ['event GEOFENCE_EXIT', geofenceEvent],
    [
      'event GEOFENCE_ENTER',
      { ...geofenceEvent, event_type: 'GEOFENCE_ENTER' },
    ],
  ])('payload จริงของกล่อง (%s) ผ่าน', (_, body) => {
    expect(validate(body)).toEqual([]);
  });

  it('field ที่กล่องไม่ส่ง -> 400 (forbidNonWhitelisted)', () => {
    expect(validate({ ...fixTelemetry, heading: 90 })).toContain('heading');
  });

  it('telemetry ต้องมี fix + location_source · event ไม่ต้อง', () => {
    expect(validate(without(fixTelemetry, 'fix', 'location_source'))).toEqual(
      expect.arrayContaining(['fix', 'location_source']),
    );
  });

  it('event_type ไม่รู้จัก / พิกัดผิด -> ไม่ผ่าน', () => {
    expect(validate({ ...overspeedEvent, event_type: 'CRASH' })).toContain(
      'event_type',
    );
    expect(validate({ ...fixTelemetry, latitude: 123 })).toContain('latitude');
  });
});

describe('parseDeviceTimestamp', () => {
  it('ISO 8601 -> Date · ว่าง/อ่านไม่ได้ -> null', () => {
    expect(parseDeviceTimestamp('2026-10-27T03:00:05Z')?.toISOString()).toBe(
      '2026-10-27T03:00:05.000Z',
    );
    expect(parseDeviceTimestamp('')).toBeNull();
    expect(parseDeviceTimestamp('not-a-date')).toBeNull();
  });
});

describe('DeviceTelemetryService', () => {
  let prisma: {
    deviceTelemetry: {
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    deviceEvent: {
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    device: { updateMany: jest.Mock };
  };
  let service: DeviceTelemetryService;

  beforeEach(() => {
    const table = () => ({
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    });
    prisma = {
      deviceTelemetry: table(),
      deviceEvent: table(),
      device: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new DeviceTelemetryService(prisma as unknown as PrismaService);
  });

  const dto = (body: object) => plainToInstance(DeviceDataReportDto, body);

  describe('report', () => {
    it('telemetry ไม่มี fix: timestamp ว่าง -> recordedAt = receivedAt, speed null', async () => {
      await expect(
        service.report('BOX-0001', dto(noFixTelemetry)),
      ).resolves.toEqual({
        accepted: true,
      });

      const data = createdData(prisma.deviceTelemetry.create);
      expect(data).toEqual({
        deviceId: 'BOX-0001',
        latitude: 13.686,
        longitude: 100.609,
        speedKmh: null,
        fix: false,
        locationSource: 'default',
        satellites: 0,
        simulated: false,
        recordedAt: data.receivedAt,
        receivedAt: expect.any(Date) as Date,
      });
      expect(prisma.deviceEvent.create).not.toHaveBeenCalled();
    });

    it('telemetry มี fix: ใช้เวลาของกล่องเป็น recordedAt', async () => {
      await service.report('BOX-0001', dto(fixTelemetry));

      const data = createdData(prisma.deviceTelemetry.create);
      expect(data.recordedAt?.toISOString()).toBe('2026-10-27T03:00:05.000Z');
      expect(data.speedKmh).toBe(42.5);
      expect(data.locationSource).toBe('gps');
    });

    it('event -> DeviceEvent (ไม่ลง DeviceTelemetry) พร้อม simulated', async () => {
      await service.report('BOX-0001', dto(overspeedEvent));

      expect(prisma.deviceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'BOX-0001',
          eventType: 'OVERSPEED',
          speedKmh: 95.2,
          speedLimitKmh: 80,
          distanceM: null,
          radiusM: null,
          simulated: true,
          occurredAt: new Date('2026-10-27T03:00:07Z'),
        }) as Record<string, unknown>,
      });
      expect(prisma.deviceTelemetry.create).not.toHaveBeenCalled();
      // event ไม่มี firmware_version -> ไม่แตะ Device
      expect(prisma.device.updateMany).not.toHaveBeenCalled();
    });

    it('geofence ไม่มี timestamp -> occurredAt = receivedAt', async () => {
      await service.report('BOX-0001', dto(geofenceEvent));

      const data = createdData(prisma.deviceEvent.create);
      expect(data.distanceM).toBe(812);
      expect(data.radiusM).toBe(500);
      expect(data.occurredAt).toBe(data.receivedAt);
    });

    it('device_id ใน body ไม่ตรง path -> 400 ไม่บันทึก', async () => {
      await expect(
        service.report('BOX-0002', dto(fixTelemetry)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.deviceTelemetry.create).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง device_id ใน body -> ใช้ path', async () => {
      await service.report('BOX-0001', dto(without(fixTelemetry, 'device_id')));
      expect(prisma.deviceTelemetry.create).toHaveBeenCalled();
    });
  });

  describe('firmware_version (§6)', () => {
    it('ค่าเปลี่ยน -> เขียนเวอร์ชัน + เวลา ครั้งเดียว', async () => {
      await service.report('BOX-0001', dto(fixTelemetry));

      expect(prisma.device.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.device.updateMany).toHaveBeenCalledWith({
        where: {
          deviceId: 'BOX-0001',
          OR: [
            { reportedFirmwareVersion: null },
            { reportedFirmwareVersion: { not: '1.2.0' } },
          ],
        },
        data: {
          reportedFirmwareVersion: '1.2.0',
          reportedFirmwareAt: expect.any(Date) as Date,
        },
      });
    });

    it('ค่าเดิม -> เลื่อนเวลาเฉพาะเมื่อเก่ากว่า 1 นาที', async () => {
      prisma.device.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
      await service.report('BOX-0001', dto(fixTelemetry));

      const second = updateManyArgs(prisma.device.updateMany, 1);
      const now = second.data.reportedFirmwareAt;
      expect(second.where).toEqual({
        deviceId: 'BOX-0001',
        reportedFirmwareVersion: '1.2.0',
        OR: [
          { reportedFirmwareAt: null },
          {
            reportedFirmwareAt: {
              lt: new Date(now.getTime() - REPORTED_FIRMWARE_WRITE_INTERVAL_MS),
            },
          },
        ],
      });
    });

    it('เขียน Device ไม่สำเร็จ -> telemetry ยังตอบ accepted (never-throw)', async () => {
      prisma.device.updateMany.mockRejectedValue(new Error('db down'));
      await expect(
        service.report('BOX-0001', dto(fixTelemetry)),
      ).resolves.toEqual({
        accepted: true,
      });
    });
  });

  describe('purgeExpired (§3.3)', () => {
    it('ลบทีละชุดตาม receivedAt จนหมด ทั้งสองตาราง', async () => {
      const ids = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
      prisma.deviceTelemetry.findMany
        .mockResolvedValueOnce(ids(RETENTION_BATCH_SIZE))
        .mockResolvedValueOnce(ids(5));
      prisma.deviceTelemetry.deleteMany
        .mockResolvedValueOnce({ count: RETENTION_BATCH_SIZE })
        .mockResolvedValueOnce({ count: 5 });
      prisma.deviceEvent.findMany.mockResolvedValueOnce(ids(2));
      prisma.deviceEvent.deleteMany.mockResolvedValueOnce({ count: 2 });

      const now = new Date('2026-10-31T00:00:00Z');
      await expect(service.purgeExpired(30, now)).resolves.toBe(
        RETENTION_BATCH_SIZE + 5 + 2,
      );

      expect(prisma.deviceTelemetry.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.deviceTelemetry.findMany).toHaveBeenCalledWith({
        where: { receivedAt: { lt: new Date('2026-10-01T00:00:00Z') } },
        select: { id: true },
        take: RETENTION_BATCH_SIZE,
      });
      expect(prisma.deviceEvent.findMany).toHaveBeenCalledTimes(1);
    });

    it('ไม่มีข้อมูลเก่า -> 0 ไม่เรียก deleteMany', async () => {
      await expect(service.purgeExpired(30)).resolves.toBe(0);
      expect(prisma.deviceTelemetry.deleteMany).not.toHaveBeenCalled();
      expect(prisma.deviceEvent.deleteMany).not.toHaveBeenCalled();
    });
  });
});

describe('resolveTelemetrySettings', () => {
  const hex = 'a'.repeat(64);

  it('ค่าเริ่มต้น 30 วัน / 60 / 300 · ไม่ตั้ง key กลาง -> null + เตือน', () => {
    const warn = jest.fn();
    expect(resolveTelemetrySettings(() => undefined, { warn })).toEqual({
      centralKeyHash: null,
      retentionDays: 30,
      perDeviceLimit: 60,
      perIpLimit: 300,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('อ่านค่าจาก env · key กลางเป็น Buffer 32 byte', () => {
    const env: Record<string, string> = {
      TELEMETRY_INGEST_KEY_SHA256: hex,
      TELEMETRY_RETENTION_DAYS: '7',
      TELEMETRY_RATE_LIMIT_PER_DEVICE: '10',
      TELEMETRY_RATE_LIMIT_PER_IP: '20',
    };
    const warn = jest.fn();
    const s = resolveTelemetrySettings((k) => env[k], { warn });
    expect(s.centralKeyHash).toEqual(Buffer.from(hex, 'hex'));
    expect(s).toMatchObject({
      retentionDays: 7,
      perDeviceLimit: 10,
      perIpLimit: 20,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('ค่าผิดรูปแบบ -> ใช้ค่าเริ่มต้น/ปฏิเสธ key กลาง + เตือน ไม่ log ค่า key', () => {
    const env: Record<string, string> = {
      TELEMETRY_INGEST_KEY_SHA256: 'raw-key-not-hash',
      TELEMETRY_RETENTION_DAYS: '0',
      TELEMETRY_RATE_LIMIT_PER_DEVICE: '1.5',
    };
    const warn = jest.fn();
    const s = resolveTelemetrySettings((k) => env[k], { warn });
    expect(s).toMatchObject({
      centralKeyHash: null,
      retentionDays: 30,
      perDeviceLimit: 60,
    });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('raw-key-not-hash');
  });
});
