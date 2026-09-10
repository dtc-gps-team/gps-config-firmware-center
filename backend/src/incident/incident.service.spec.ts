import { Logger } from '@nestjs/common';
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
  /** EventEmitter จริง — เทส wiring ของ onModuleInit ครบเส้น */
  let queue: ConfigSyncWriterQueue;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    incidentCreate = jest.fn().mockResolvedValue({ id: 'inc-1' });
    queue = new EventEmitter() as unknown as ConfigSyncWriterQueue;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentService,
        {
          provide: PrismaService,
          useValue: { incident: { create: incidentCreate } },
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
});
