import { Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigSyncFailure } from '../config-sync-writer/config-sync-writer-queue.service';
import { ConfigSyncWriterQueue } from '../config-sync-writer/config-sync-writer-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { INCIDENT_SOURCE } from './incident-metadata';
import { IncidentService } from './incident.service';

const failure: ConfigSyncFailure = {
  configId: '11111111-1111-1111-1111-111111111111',
  versionNumber: 4,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  attempts: 3,
  lastError: 'connection refused',
};

describe('IncidentService', () => {
  let service: IncidentService;
  let incidentCreate: jest.Mock;
  let incidentFindMany: jest.Mock;
  let incidentFindUnique: jest.Mock;
  /** EventEmitter จริง — เทส wiring ของ onModuleInit ครบเส้น */
  let queue: ConfigSyncWriterQueue;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    incidentCreate = jest.fn().mockResolvedValue({ id: 'inc-1' });
    incidentFindMany = jest.fn().mockResolvedValue([]);
    incidentFindUnique = jest.fn().mockResolvedValue(null);
    queue = new EventEmitter() as unknown as ConfigSyncWriterQueue;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentService,
        {
          provide: PrismaService,
          useValue: {
            incident: {
              create: incidentCreate,
              findMany: incidentFindMany,
              findUnique: incidentFindUnique,
            },
          },
        },
        { provide: ConfigSyncWriterQueue, useValue: queue },
      ],
    }).compile();

    service = module.get(IncidentService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('createFromSyncFailure -> สร้าง Incident ตาม shape (source + relatedConfigId + metadata)', async () => {
    await service.createFromSyncFailure(failure);

    expect(incidentCreate).toHaveBeenCalledTimes(1);
    expect(incidentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        severity: 'high',
        status: 'open',
        relatedConfigId: failure.configId,
        source: INCIDENT_SOURCE.configSyncWriter,
        title: expect.stringContaining('v4') as string,
        description: expect.stringContaining('connection refused') as string,
        // metadata = เฉพาะส่วนที่ไม่มี column จริง (ไม่ซ้ำ configId)
        metadata: {
          versionNumber: 4,
          attempts: 3,
          lastError: 'connection refused',
        },
      }) as unknown,
    });
  });

  it('createFromSyncFailure -> prisma พัง ก็ไม่ throw (never-throws)', async () => {
    incidentCreate.mockRejectedValue(new Error('db down'));

    await expect(
      service.createFromSyncFailure(failure),
    ).resolves.toBeUndefined();
  });

  it("onModuleInit -> emit 'sync-failed' บน queue แล้วสร้าง Incident", async () => {
    service.onModuleInit();
    const spy = jest.spyOn(service, 'createFromSyncFailure');

    queue.emit('sync-failed', failure);
    // ปล่อยให้ microtask ของ listener ทำงาน
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith(failure);
  });

  it('listener ที่ผูกไว้ ไม่ทำให้ emit บน queue throw แม้ createFromSyncFailure จะ reject ข้างใน', async () => {
    service.onModuleInit();
    incidentCreate.mockRejectedValue(new Error('db down'));

    expect(() => queue.emit('sync-failed', failure)).not.toThrow();
    await Promise.resolve();
  });

  describe('findAllIncidents (read-only endpoint)', () => {
    it('ไม่ส่ง filter -> findMany where ว่าง (undefined ทุกตัว) + orderBy createdAt desc', async () => {
      await service.findAllIncidents({});

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          status: undefined,
          relatedConfigId: undefined,
          relatedFirmwareId: undefined,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filter status อย่างเดียว', async () => {
      await service.findAllIncidents({ status: 'open' });

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          status: 'open',
          relatedConfigId: undefined,
          relatedFirmwareId: undefined,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filter relatedConfigId + relatedFirmwareId พร้อมกัน', async () => {
      await service.findAllIncidents({
        relatedConfigId: 'cfg-1',
        relatedFirmwareId: 'fw-1',
      });

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          status: undefined,
          relatedConfigId: 'cfg-1',
          relatedFirmwareId: 'fw-1',
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('คืนผลจาก prisma ตรงๆ', async () => {
      const rows = [{ id: 'inc-1' }, { id: 'inc-2' }];
      incidentFindMany.mockResolvedValue(rows);

      await expect(service.findAllIncidents({})).resolves.toBe(rows);
    });
  });

  describe('findIncidentById (read-only endpoint)', () => {
    it('พบ -> คืน record', async () => {
      const row = { id: 'inc-9', title: 'x' };
      incidentFindUnique.mockResolvedValue(row);

      await expect(service.findIncidentById('inc-9')).resolves.toBe(row);
      expect(incidentFindUnique).toHaveBeenCalledWith({
        where: { id: 'inc-9' },
      });
    });

    it('ไม่พบ -> NotFoundException', async () => {
      incidentFindUnique.mockResolvedValue(null);

      await expect(service.findIncidentById('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
