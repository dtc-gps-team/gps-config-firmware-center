import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigSyncFailure } from '../config-sync-writer/config-sync-writer-queue.service';
import { ConfigSyncWriterQueue } from '../config-sync-writer/config-sync-writer-queue.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { INCIDENT_SOURCE } from './incident-metadata';
import { ActingUser, IncidentService } from './incident.service';

const failure: ConfigSyncFailure = {
  configId: '11111111-1111-1111-1111-111111111111',
  versionNumber: 4,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  attempts: 3,
  lastError: 'connection refused',
};

const st: ActingUser = { id: 'st-1', role: 'ST' };
const operation: ActingUser = { id: 'op-1', role: 'Operation' };
const auditor: ActingUser = { id: 'auditor-1', role: 'Auditor' };

describe('IncidentService', () => {
  let service: IncidentService;
  let incidentCreate: jest.Mock;
  let incidentFindMany: jest.Mock;
  let incidentFindUnique: jest.Mock;
  let incidentUpdateMany: jest.Mock;
  let deviceFindUnique: jest.Mock;
  let userFindMany: jest.Mock;
  let auditLogCreate: jest.Mock;
  let notificationSend: jest.Mock;
  /** EventEmitter จริง — เทส wiring ของ onModuleInit ครบเส้น */
  let queue: ConfigSyncWriterQueue;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    incidentCreate = jest.fn().mockResolvedValue({ id: 'inc-1' });
    incidentFindMany = jest.fn().mockResolvedValue([]);
    incidentFindUnique = jest.fn().mockResolvedValue(null);
    incidentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    deviceFindUnique = jest.fn().mockResolvedValue(null);
    userFindMany = jest.fn().mockResolvedValue([]);
    auditLogCreate = jest.fn().mockResolvedValue(undefined);
    notificationSend = jest.fn().mockResolvedValue(undefined);
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
              updateMany: incidentUpdateMany,
            },
            device: { findUnique: deviceFindUnique },
            user: { findMany: userFindMany },
            auditLog: { create: auditLogCreate },
          },
        },
        { provide: ConfigSyncWriterQueue, useValue: queue },
        { provide: NotificationService, useValue: { send: notificationSend } },
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
    it('ไม่ส่ง filter + Operation (unscoped role) -> scopeFilter ว่าง', async () => {
      await service.findAllIncidents({}, operation);

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              status: undefined,
              relatedConfigId: undefined,
              relatedFirmwareId: undefined,
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filter status อย่างเดียว', async () => {
      await service.findAllIncidents({ status: 'open' }, operation);

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              status: 'open',
              relatedConfigId: undefined,
              relatedFirmwareId: undefined,
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filter relatedConfigId + relatedFirmwareId พร้อมกัน', async () => {
      await service.findAllIncidents(
        { relatedConfigId: 'cfg-1', relatedFirmwareId: 'fw-1' },
        operation,
      );

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              status: undefined,
              relatedConfigId: 'cfg-1',
              relatedFirmwareId: 'fw-1',
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('คืนผลจาก prisma ตรงๆ', async () => {
      const rows = [{ id: 'inc-1' }, { id: 'inc-2' }];
      incidentFindMany.mockResolvedValue(rows);

      await expect(service.findAllIncidents({}, operation)).resolves.toBe(rows);
    });

    it('ST (self-scoped role) -> scopeFilter กรอง field report ของตัวเอง หรือ incident auto-detect (source != field-report)', async () => {
      await service.findAllIncidents({}, st);

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              OR: [{ source: { not: 'field-report' } }, { reportedBy: 'st-1' }],
            },
            {
              status: undefined,
              relatedConfigId: undefined,
              relatedFirmwareId: undefined,
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('Auditor (unscoped role) -> เห็นทุก field report เหมือน Operation', async () => {
      await service.findAllIncidents({}, auditor);

      expect(incidentFindMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              status: undefined,
              relatedConfigId: undefined,
              relatedFirmwareId: undefined,
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findIncidentById (read-only endpoint)', () => {
    it('พบ + Operation -> คืน record', async () => {
      const row = { id: 'inc-9', title: 'x', source: null, reportedBy: null };
      incidentFindUnique.mockResolvedValue(row);

      await expect(service.findIncidentById('inc-9', operation)).resolves.toBe(
        row,
      );
      expect(incidentFindUnique).toHaveBeenCalledWith({
        where: { id: 'inc-9' },
      });
    });

    it('ไม่พบ -> NotFoundException', async () => {
      incidentFindUnique.mockResolvedValue(null);

      await expect(service.findIncidentById('nope', operation)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('field report ของคนอื่น + ST -> NotFoundException (IDOR — 404 ไม่ใช่ 403)', async () => {
      incidentFindUnique.mockResolvedValue({
        id: 'inc-9',
        source: 'field-report',
        reportedBy: 'st-2',
      });

      await expect(service.findIncidentById('inc-9', st)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('field report ของตัวเอง + ST -> คืน record ปกติ', async () => {
      const row = {
        id: 'inc-9',
        source: 'field-report',
        reportedBy: 'st-1',
      };
      incidentFindUnique.mockResolvedValue(row);

      await expect(service.findIncidentById('inc-9', st)).resolves.toBe(row);
    });

    it('incident auto-detect เดิม (source != field-report) + ST -> เห็นได้ปกติแม้ reportedBy เป็น null', async () => {
      const row = {
        id: 'inc-9',
        source: INCIDENT_SOURCE.configSyncWriter,
        reportedBy: null,
      };
      incidentFindUnique.mockResolvedValue(row);

      await expect(service.findIncidentById('inc-9', st)).resolves.toBe(row);
    });
  });

  describe('createFieldReport (issue #236)', () => {
    const dto = {
      title: 'GPS หลุดสัญญาณบ่อย',
      description: 'หลุดทุก 10 นาที',
      severity: 'high' as const,
      deviceId: 'DTC-0001',
    };

    it('สร้าง field report ด้วย source/status/reportedBy ที่ถูกต้อง', async () => {
      incidentCreate.mockResolvedValue({
        id: 'inc-new',
        deviceId: 'DTC-0001',
      });

      await service.createFieldReport(dto, st);

      expect(incidentCreate).toHaveBeenCalledWith({
        data: {
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          deviceId: dto.deviceId,
          source: INCIDENT_SOURCE.fieldReport,
          reportedBy: st.id,
        },
      });
    });

    it('เขียน AuditLog action report', async () => {
      incidentCreate.mockResolvedValue({
        id: 'inc-new',
        deviceId: 'DTC-0001',
      });

      await service.createFieldReport(dto, st);

      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          userId: st.id,
          auditModule: 'incident',
          action: 'report',
          metadata: { incidentId: 'inc-new', deviceId: 'DTC-0001' },
        },
      });
    });

    it('แจ้งเตือน Operation ทุกคนที่ active (incident_report_pending)', async () => {
      incidentCreate.mockResolvedValue({
        id: 'inc-new',
        deviceId: 'DTC-0001',
        title: dto.title,
      });
      userFindMany.mockResolvedValue([{ id: 'op-1' }, { id: 'op-2' }]);

      await service.createFieldReport(dto, st);

      expect(userFindMany).toHaveBeenCalledWith({
        where: { role: { code: 'Operation' }, isActive: true },
        select: { id: true },
      });
      expect(notificationSend).toHaveBeenCalledTimes(2);
      expect(notificationSend).toHaveBeenCalledWith({
        userId: 'op-1',
        type: 'incident_report_pending',
        payload: {
          incidentId: 'inc-new',
          deviceId: 'DTC-0001',
          title: dto.title,
        },
      });
    });

    it('AuditLog/แจ้งเตือนล้มเหลว -> ยังสร้าง report สำเร็จปกติ (never-throw)', async () => {
      incidentCreate.mockResolvedValue({ id: 'inc-new', deviceId: null });
      auditLogCreate.mockRejectedValue(new Error('db down'));
      userFindMany.mockRejectedValue(new Error('db down'));

      await expect(service.createFieldReport(dto, st)).resolves.toMatchObject({
        id: 'inc-new',
      });
    });
  });

  describe('decide (issue #236)', () => {
    const openReport = {
      id: 'inc-1',
      source: INCIDENT_SOURCE.fieldReport,
      status: 'open',
      reportedBy: 'st-1',
      deviceId: 'DTC-0001',
    };

    it('ไม่พบ -> NotFoundException', async () => {
      incidentFindUnique.mockResolvedValue(null);

      await expect(
        service.decide('nope', { outcome: 'resolve', note: 'x' }, operation),
      ).rejects.toThrow(NotFoundException);
    });

    it('ไม่ใช่ field report (auto-detect เดิม) -> NotFoundException', async () => {
      incidentFindUnique.mockResolvedValue({
        id: 'inc-1',
        source: INCIDENT_SOURCE.configSyncWriter,
        status: 'open',
      });

      await expect(
        service.decide('inc-1', { outcome: 'resolve', note: 'x' }, operation),
      ).rejects.toThrow(NotFoundException);
    });

    it('ตัดสินใจไปแล้ว (ไม่ใช่ open) -> ConflictException', async () => {
      incidentFindUnique.mockResolvedValue({
        ...openReport,
        status: 'resolved',
      });

      await expect(
        service.decide('inc-1', { outcome: 'resolve', note: 'x' }, operation),
      ).rejects.toThrow(ConflictException);
    });

    it('race condition — updateMany count 0 -> ConflictException', async () => {
      incidentFindUnique.mockResolvedValue(openReport);
      incidentUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.decide('inc-1', { outcome: 'resolve', note: 'x' }, operation),
      ).rejects.toThrow(ConflictException);
    });

    it('outcome resolve -> status: resolved + แจ้ง incident_report_resolved', async () => {
      incidentFindUnique.mockResolvedValue(openReport);

      const result = await service.decide(
        'inc-1',
        { outcome: 'resolve', note: 'เปลี่ยนฮาร์ดแวร์แล้ว' },
        operation,
      );

      expect(result.status).toBe('resolved');
      expect(incidentUpdateMany).toHaveBeenCalledWith({
        where: { id: 'inc-1', status: 'open' },
        data: {
          status: 'resolved',
          reviewedBy: operation.id,
          reviewedAt: expect.any(Date) as Date,
          reviewNote: 'เปลี่ยนฮาร์ดแวร์แล้ว',
        },
      });
      expect(notificationSend).toHaveBeenCalledWith({
        userId: 'st-1',
        type: 'incident_report_resolved',
        payload: {
          incidentId: 'inc-1',
          deviceId: 'DTC-0001',
          reviewNote: 'เปลี่ยนฮาร์ดแวร์แล้ว',
        },
      });
      // ไม่ใช่ promote -> ไม่ query Device เลย
      expect(deviceFindUnique).not.toHaveBeenCalled();
      expect(result.device).toBeNull();
    });

    it('outcome dismiss -> status: dismissed + แจ้ง incident_report_dismissed', async () => {
      incidentFindUnique.mockResolvedValue(openReport);

      const result = await service.decide(
        'inc-1',
        { outcome: 'dismiss', note: 'ไม่ใช่ปัญหาจริง' },
        operation,
      );

      expect(result.status).toBe('dismissed');
      expect(notificationSend).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'incident_report_dismissed' }),
      );
    });

    it('outcome promote -> status: investigating + คืน device (deviceModel/protocol) + แจ้ง incident_report_promoted', async () => {
      incidentFindUnique.mockResolvedValue(openReport);
      deviceFindUnique.mockResolvedValue({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
      });

      const result = await service.decide(
        'inc-1',
        { outcome: 'promote', note: 'ต้องแก้ด้วย Campaign' },
        operation,
      );

      expect(result.status).toBe('investigating');
      expect(deviceFindUnique).toHaveBeenCalledWith({
        where: { deviceId: 'DTC-0001' },
        select: { deviceId: true, deviceModel: true, protocol: true },
      });
      expect(result.device).toEqual({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
      });
      expect(notificationSend).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'incident_report_promoted' }),
      );
    });

    it('outcome promote แต่ incident ไม่มี deviceId -> device เป็น null ไม่ throw', async () => {
      incidentFindUnique.mockResolvedValue({ ...openReport, deviceId: null });

      const result = await service.decide(
        'inc-1',
        { outcome: 'promote', note: 'x' },
        operation,
      );

      expect(deviceFindUnique).not.toHaveBeenCalled();
      expect(result.device).toBeNull();
    });

    it('เขียน AuditLog action decide พร้อม outcome', async () => {
      incidentFindUnique.mockResolvedValue(openReport);

      await service.decide(
        'inc-1',
        { outcome: 'resolve', note: 'x' },
        operation,
      );

      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          userId: operation.id,
          auditModule: 'incident',
          action: 'decide',
          metadata: { incidentId: 'inc-1', outcome: 'resolve' },
        },
      });
    });

    it('field report ที่ไม่มี reportedBy (ไม่น่าเกิดจริง แต่กันพัง) -> ไม่ส่ง notification ไม่ throw', async () => {
      incidentFindUnique.mockResolvedValue({
        ...openReport,
        reportedBy: null,
      });

      await expect(
        service.decide('inc-1', { outcome: 'resolve', note: 'x' }, operation),
      ).resolves.toBeDefined();
      expect(notificationSend).not.toHaveBeenCalled();
    });
  });
});
