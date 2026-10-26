import { NotFoundException } from '@nestjs/common';
import { DeviceHistoryService } from './device-history.service';

const DEVICE_ID = 'DEV-0101';

const d = (iso: string) => new Date(iso);

// ค่าเริ่มต้นของเทสเดิมทั้งหมด (ก่อนแก้ #371) — Operation เห็นทุกอย่างเสมอ
// (`UNSCOPED_TASK_ROLES` + `canReadAll` ของ override) จึงพฤติกรรมเดิมไม่เปลี่ยน
// เทสสิทธิ์ของ role อื่นแยกไว้ที่ describe('กรองตามสิทธิ์ของ actor') ด้านล่าง
const operationActor = { id: 'op-actor', role: 'Operation', ipAddress: null };

describe('DeviceHistoryService', () => {
  let service: DeviceHistoryService;
  let prisma: {
    campaignRolloutTarget: { findMany: jest.Mock; findFirst: jest.Mock };
    deviceConfigOverride: { findMany: jest.Mock };
    deviceFirmwareOverride: { findMany: jest.Mock; findFirst: jest.Mock };
    task: { findMany: jest.Mock };
    incident: { findMany: jest.Mock };
    config: { findMany: jest.Mock };
    configVersion: { findMany: jest.Mock };
    firmware: { findMany: jest.Mock; findUnique: jest.Mock };
    campaign: { findMany: jest.Mock };
  };
  let deviceService: {
    findByDeviceId: jest.Mock;
    findCurrentConfigOrNull: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      campaignRolloutTarget: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      deviceConfigOverride: { findMany: jest.fn().mockResolvedValue([]) },
      deviceFirmwareOverride: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      incident: { findMany: jest.fn().mockResolvedValue([]) },
      config: { findMany: jest.fn().mockResolvedValue([]) },
      configVersion: { findMany: jest.fn().mockResolvedValue([]) },
      firmware: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
    };
    deviceService = {
      findByDeviceId: jest.fn().mockResolvedValue({
        deviceId: DEVICE_ID,
        registeredAt: d('2026-09-01T00:00:00.000Z'),
        installedAt: d('2026-09-03T00:00:00.000Z'),
      }),
      findCurrentConfigOrNull: jest.fn().mockResolvedValue(null),
    };
    service = new DeviceHistoryService(prisma as never, deviceService as never);
  });

  const rolloutTarget = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    deviceId: DEVICE_ID,
    status: 'success',
    resultDetail: null,
    updatedAt: d('2026-10-10T00:00:00.000Z'),
    rollout: {
      id: 'r1',
      campaignId: 'camp-1',
      payloadType: 'Config',
      configId: 'cfg-1',
      firmwareId: null,
      isRollback: false,
      createdAt: d('2026-10-09T00:00:00.000Z'),
      approvedAt: d('2026-10-09T01:00:00.000Z'),
    },
    ...over,
  });

  it('เครื่องไม่พบ -> ส่ง 404 ต่อ และไม่ query อะไรเพิ่ม', async () => {
    deviceService.findByDeviceId.mockRejectedValue(new NotFoundException());

    await expect(
      service.getHistory('nope', {}, operationActor),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.campaignRolloutTarget.findMany).not.toHaveBeenCalled();
  });

  it('รวมทุกแหล่งเป็นเส้นเวลาเดียว ใหม่ไปเก่า และเติมชื่อแคมเปญ/Config/Firmware แบบ batch', async () => {
    prisma.campaignRolloutTarget.findMany.mockResolvedValue([
      rolloutTarget(),
      rolloutTarget({
        id: 't2',
        status: 'failed',
        resultDetail: 'checksum ไม่ตรง',
        updatedAt: d('2026-10-12T00:00:00.000Z'),
        rollout: {
          id: 'r2',
          campaignId: 'camp-2',
          payloadType: 'Firmware',
          configId: null,
          firmwareId: 'fw-1',
          isRollback: true,
          createdAt: d('2026-10-11T00:00:00.000Z'),
          approvedAt: null,
        },
      }),
    ]);
    prisma.deviceConfigOverride.findMany.mockResolvedValue([
      {
        id: 'o1',
        configId: 'cfg-1',
        status: 'approved',
        reason: 'รถจอดนาน',
        overriddenBy: 'st-1',
        overriddenAt: d('2026-10-11T05:00:00.000Z'),
        decidedBy: 'op-1',
        decidedAt: d('2026-10-11T06:00:00.000Z'),
        rejectReason: null,
      },
    ]);
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'ติดตั้ง Config',
        description: null,
        status: 'completed',
        assignedTo: 'st-1',
        configId: 'cfg-1',
        campaignId: null,
        updatedAt: d('2026-10-09T12:00:00.000Z'),
      },
    ]);
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'inc-1',
        title: 'เครื่องรีบูต',
        description: 'รีบูตทุก 10 นาที',
        status: 'open',
        severity: 'high',
        reportedBy: 'ot-1',
        relatedConfigId: null,
        relatedFirmwareId: null,
        createdAt: d('2026-10-13T00:00:00.000Z'),
      },
    ]);
    prisma.config.findMany.mockResolvedValue([
      { id: 'cfg-1', name: 'GT06N/TCP รายงานถี่' },
    ]);
    prisma.configVersion.findMany.mockResolvedValue([
      {
        configId: 'cfg-1',
        versionNumber: 1,
        approvedAt: d('2026-10-01T00:00:00.000Z'),
      },
      {
        configId: 'cfg-1',
        versionNumber: 2,
        approvedAt: d('2026-10-09T00:30:00.000Z'),
      },
      {
        configId: 'cfg-1',
        versionNumber: 3,
        approvedAt: d('2026-10-20T00:00:00.000Z'),
      },
    ]);
    prisma.firmware.findMany.mockResolvedValue([
      { id: 'fw-1', version: '2.5.0' },
    ]);
    prisma.campaign.findMany.mockResolvedValue([
      { id: 'camp-1', name: 'สยามขนส่ง' },
      { id: 'camp-2', name: 'เชียงใหม่โลจิสติกส์' },
    ]);

    const result = await service.getHistory(DEVICE_ID, {}, operationActor);

    expect(result.items.map((i) => i.id)).toEqual([
      'incident:inc-1',
      'rollout:t2',
      'config-override:o1',
      'rollout:t1',
      'task:task-1',
      'lifecycle:DEV-0101:installed',
      'lifecycle:DEV-0101:registered',
    ]);
    expect(result.nextCursor).toBeNull();

    const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
    // Rollout Config: ชื่อแคมเปญ + Config + เวอร์ชันที่อนุมัติล่าสุดก่อนเวลาอนุมัติ Rollout (v2 ไม่ใช่ v3)
    expect(byId['rollout:t1']).toMatchObject({
      type: 'rollout',
      status: 'success',
      title: 'สยามขนส่ง',
      payloadType: 'Config',
      isRollback: false,
      config: { id: 'cfg-1', name: 'GT06N/TCP รายงานถี่', versionNumber: 2 },
      firmware: null,
      refs: { campaignId: 'camp-1', rolloutId: 'r1' },
    });
    // Rollout Firmware ที่เป็น Rollback และล้มเหลว
    expect(byId['rollout:t2']).toMatchObject({
      status: 'failed',
      detail: 'checksum ไม่ตรง',
      payloadType: 'Firmware',
      isRollback: true,
      config: null,
      firmware: { id: 'fw-1', version: '2.5.0' },
      title: 'เชียงใหม่โลจิสติกส์',
    });
    // คำขอแก้ค่าเฉพาะเครื่อง: ผู้ขอ เหตุผล และการตัดสินใจ
    expect(byId['config-override:o1']).toMatchObject({
      status: 'approved',
      detail: 'รถจอดนาน',
      actorId: 'st-1',
      decision: {
        byId: 'op-1',
        at: '2026-10-11T06:00:00.000Z',
        note: null,
      },
      refs: { overrideId: 'o1' },
    });
    expect(byId['task:task-1']).toMatchObject({
      title: 'ติดตั้ง Config',
      status: 'completed',
      actorId: 'st-1',
      config: { name: 'GT06N/TCP รายงานถี่' },
    });
    expect(byId['incident:inc-1']).toMatchObject({
      severity: 'high',
      actorId: 'ot-1',
      refs: { incidentId: 'inc-1' },
    });

    // ดึงชื่อแบบ batch ครั้งเดียวต่อชนิด ไม่ใช่ทีละรายการ
    expect(prisma.config.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.firmware.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.campaign.findMany).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี installedAt: ไม่มีรายการ "ติดตั้ง"', async () => {
    deviceService.findByDeviceId.mockResolvedValue({
      deviceId: DEVICE_ID,
      registeredAt: d('2026-09-01T00:00:00.000Z'),
      installedAt: null,
    });

    const result = await service.getHistory(DEVICE_ID, {}, operationActor);

    expect(result.items.map((i) => i.id)).toEqual([
      'lifecycle:DEV-0101:registered',
    ]);
  });

  it('คำขอแก้ค่าที่ถูกปฏิเสธ: ใส่เหตุผลที่ปฏิเสธใน decision.note', async () => {
    prisma.deviceConfigOverride.findMany.mockResolvedValue([
      {
        id: 'o2',
        configId: 'cfg-1',
        status: 'rejected',
        reason: 'ขอเพิ่มรอบรายงาน',
        overriddenBy: 'st-1',
        overriddenAt: d('2026-10-11T05:00:00.000Z'),
        decidedBy: 'op-1',
        decidedAt: d('2026-10-11T06:00:00.000Z'),
        rejectReason: 'เกินเพดานข้อมูลของลูกค้า',
      },
    ]);

    const result = await service.getHistory(
      DEVICE_ID,
      { types: ['config-override'] },
      operationActor,
    );

    expect(result.items[0].decision?.note).toBe('เกินเพดานข้อมูลของลูกค้า');
  });

  it('คำขอที่ยังไม่ตัดสินใจ: decision เป็น null', async () => {
    prisma.deviceConfigOverride.findMany.mockResolvedValue([
      {
        id: 'o3',
        configId: 'cfg-1',
        status: 'pending',
        reason: 'x',
        overriddenBy: 'st-1',
        overriddenAt: d('2026-10-11T05:00:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        rejectReason: null,
      },
    ]);

    const result = await service.getHistory(
      DEVICE_ID,
      { types: ['config-override'] },
      operationActor,
    );

    expect(result.items[0].decision).toBeNull();
  });

  describe('กรองชนิด (types)', () => {
    it('ระบุชนิดเดียว: query เฉพาะแหล่งนั้น ไม่แตะตารางอื่น', async () => {
      await service.getHistory(DEVICE_ID, { types: ['task'] }, operationActor);

      expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.campaignRolloutTarget.findMany).not.toHaveBeenCalled();
      expect(prisma.deviceConfigOverride.findMany).not.toHaveBeenCalled();
      expect(prisma.deviceFirmwareOverride.findMany).not.toHaveBeenCalled();
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
    });

    it('ไม่ระบุ: ทุกแหล่ง', async () => {
      await service.getHistory(DEVICE_ID, {}, operationActor);

      expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.campaignRolloutTarget.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.deviceConfigOverride.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.deviceFirmwareOverride.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.incident.findMany).toHaveBeenCalledTimes(1);
    });

    it('ไม่รวม lifecycle เมื่อไม่ได้ขอ', async () => {
      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'] },
        operationActor,
      );

      expect(result.items).toEqual([]);
    });
  });

  it('Incident: ค้นทั้งที่แจ้งกับเครื่องนี้และ Incident จาก Rollout ที่เครื่องนี้อยู่ในรายชื่อเครื่องที่ล้ม', async () => {
    await service.getHistory(
      DEVICE_ID,
      { types: ['incident'] },
      operationActor,
    );

    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { deviceId: DEVICE_ID },
                {
                  source: 'rollout-failure',
                  metadata: {
                    path: ['failedDeviceIds'],
                    array_contains: DEVICE_ID,
                  },
                },
              ],
            },
            {},
          ],
        },
      }),
    );
  });

  describe('แบ่งหน้าด้วย cursor', () => {
    const tasks = (n: number, at = '2026-10-10T00:00:00.000Z') =>
      Array.from({ length: n }, (_, i) => ({
        id: `task-${String(i).padStart(2, '0')}`,
        title: `งาน ${i}`,
        description: null,
        status: 'completed',
        assignedTo: 'st-1',
        configId: null,
        campaignId: null,
        updatedAt: new Date(new Date(at).getTime() - i * 1000),
      }));

    it('เกิน limit: คืนแค่ limit รายการ พร้อม nextCursor ของรายการสุดท้าย', async () => {
      prisma.task.findMany.mockResolvedValue(tasks(5));

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'], limit: 3 },
        operationActor,
      );

      expect(result.items.map((i) => i.id)).toEqual([
        'task:task-00',
        'task:task-01',
        'task:task-02',
      ]);
      expect(result.nextCursor).toBe('2026-10-09T23:59:58.000Z_task:task-02');
    });

    it('พอดี limit: ไม่มี nextCursor', async () => {
      prisma.task.findMany.mockResolvedValue(tasks(3));

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'], limit: 3 },
        operationActor,
      );

      expect(result.items).toHaveLength(3);
      expect(result.nextCursor).toBeNull();
    });

    it('หน้าถัดไป: query แต่ละแหล่งด้วยเวลา <= cursor แล้วตัดรายการที่อยู่ก่อน/เท่า cursor ออก', async () => {
      // DB คืนรายการที่เวลา <= cursor รวมตัวที่เป็น cursor เอง (task-02) ด้วย
      prisma.task.findMany.mockResolvedValue(tasks(5).slice(2));

      const result = await service.getHistory(
        DEVICE_ID,
        {
          types: ['task'],
          limit: 3,
          before: '2026-10-09T23:59:58.000Z_task:task-02',
        },
        operationActor,
      );

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deviceId: DEVICE_ID,
            updatedAt: { lte: new Date('2026-10-09T23:59:58.000Z') },
          },
        }),
      );
      expect(result.items.map((i) => i.id)).toEqual([
        'task:task-03',
        'task:task-04',
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('เวลาเท่ากันหลายรายการ: ใช้ id เป็น tie-break ไม่ข้ามและไม่ซ้ำข้ามหน้า', async () => {
      const sameTime = ['a', 'b', 'c'].map((k) => ({
        id: k,
        title: k,
        description: null,
        status: 'completed',
        assignedTo: 'st-1',
        configId: null,
        campaignId: null,
        updatedAt: d('2026-10-10T00:00:00.000Z'),
      }));
      prisma.task.findMany.mockResolvedValue(sameTime);

      const first = await service.getHistory(
        DEVICE_ID,
        { types: ['task'], limit: 2 },
        operationActor,
      );
      expect(first.items.map((i) => i.id)).toEqual(['task:c', 'task:b']);

      const second = await service.getHistory(
        DEVICE_ID,
        { types: ['task'], limit: 2, before: first.nextCursor! },
        operationActor,
      );
      expect(second.items.map((i) => i.id)).toEqual(['task:a']);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('สรุป (summary)', () => {
    it('ยังไม่มี Config/Firmware ที่ใช้อยู่: เป็น null ทั้งคู่ ไม่ 404', async () => {
      const result = await service.getHistory(DEVICE_ID, {}, operationActor);

      expect(result.summary).toEqual({
        currentConfig: null,
        currentFirmware: null,
      });
    });

    it('Config ปัจจุบันมาจาก DeviceService', async () => {
      deviceService.findCurrentConfigOrNull.mockResolvedValue({
        id: 'cfg-9',
        name: 'GT08-4G/TCP มาตรฐาน',
      });

      const result = await service.getHistory(DEVICE_ID, {}, operationActor);

      expect(result.summary.currentConfig).toEqual({
        id: 'cfg-9',
        name: 'GT08-4G/TCP มาตรฐาน',
      });
    });

    it('Firmware ปัจจุบัน: เลือกอันที่ใหม่กว่าระหว่างเป้าหมาย Rollout ที่สำเร็จ กับคำขอที่ช่างยืนยันติดตั้ง', async () => {
      prisma.campaignRolloutTarget.findFirst.mockResolvedValue({
        updatedAt: d('2026-10-05T00:00:00.000Z'),
        rollout: { firmwareId: 'fw-old' },
      });
      prisma.deviceFirmwareOverride.findFirst.mockResolvedValue({
        consumedAt: d('2026-10-08T00:00:00.000Z'),
        firmwareId: 'fw-new',
      });
      prisma.firmware.findUnique.mockResolvedValue({
        id: 'fw-new',
        version: '2.6.0',
      });

      const result = await service.getHistory(DEVICE_ID, {}, operationActor);

      expect(prisma.firmware.findUnique).toHaveBeenCalledWith({
        where: { id: 'fw-new' },
        select: { id: true, version: true },
      });
      expect(result.summary.currentFirmware).toEqual({
        id: 'fw-new',
        version: '2.6.0',
      });
    });

    it('Rollout ใหม่กว่าคำขอ: ใช้ firmware ของ Rollout (รวมกรณี Rollback กลับรุ่นเก่า)', async () => {
      prisma.campaignRolloutTarget.findFirst.mockResolvedValue({
        updatedAt: d('2026-10-09T00:00:00.000Z'),
        rollout: { firmwareId: 'fw-rollback' },
      });
      prisma.deviceFirmwareOverride.findFirst.mockResolvedValue({
        consumedAt: d('2026-10-08T00:00:00.000Z'),
        firmwareId: 'fw-new',
      });
      prisma.firmware.findUnique.mockResolvedValue({
        id: 'fw-rollback',
        version: '2.4.2',
      });

      const result = await service.getHistory(DEVICE_ID, {}, operationActor);

      expect(result.summary.currentFirmware?.version).toBe('2.4.2');
    });
  });

  it('Config ที่ไม่พบในฐานข้อมูลแล้ว (ถูกลบ): config เป็น null ไม่พัง', async () => {
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'ติดตั้ง Config',
        description: null,
        status: 'completed',
        assignedTo: 'st-1',
        configId: 'cfg-gone',
        campaignId: null,
        updatedAt: d('2026-10-09T12:00:00.000Z'),
      },
    ]);

    const result = await service.getHistory(
      DEVICE_ID,
      { types: ['task'] },
      operationActor,
    );

    expect(result.items[0].config).toBeNull();
  });

  // รีวิว B บน #371: endpoint นี้เช็คสิทธิ์แค่ `devices:Read` (ให้ทุก role)
  // แต่ข้างในรวมข้อมูลจากตารางที่มีสิทธิ์เข้มกว่า (`tasks:Read` ของ ST/OT
  // scope แค่งานของตัวเอง, `device-config-override:Read`/
  // `device-firmware-override:Read` ให้ Operation เท่านั้น) — ก่อนแก้ทุก role
  // เห็นทุกงาน/ทุกคำขอ override ของเครื่องนั้นไม่ว่าใครเป็นคนทำ
  describe('กรองตามสิทธิ์ของ actor (รีวิว B #371)', () => {
    const stActor = { id: 'st-1', role: 'ST', ipAddress: null };
    const otherStActor = { id: 'st-2', role: 'ST', ipAddress: null };
    const qaActor = { id: 'qa-1', role: 'QAEngineer', ipAddress: null };

    const taskOf = (assignedTo: string) => ({
      id: 'task-1',
      title: 'ติดตั้ง Config',
      description: null,
      status: 'completed',
      assignedTo,
      configId: null,
      campaignId: null,
      updatedAt: d('2026-10-09T12:00:00.000Z'),
    });

    it('ST เห็นงานของตัวเอง — query กรอง assignedTo เป็นตัวเอง', async () => {
      prisma.task.findMany.mockResolvedValue([taskOf('st-1')]);

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'] },
        stActor,
      );

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: DEVICE_ID, assignedTo: 'st-1' },
        }),
      );
      expect(result.items.map((i) => i.id)).toEqual(['task:task-1']);
    });

    it('ST ไม่เห็นงานของช่างคนอื่น — DB ถูกสั่งกรองด้วย assignedTo ของตัวเองไปแล้ว ไม่ใช่กรองทีหลัง', async () => {
      // mock จำลองว่า DB กรองตาม where.assignedTo ให้แล้ว (คืนว่างเพราะ
      // 'task-1' เป็นของ st-2 ไม่ใช่ st-1) ยืนยันว่า query ส่ง assignedTo
      // ของ actor ไปจริง ไม่ได้พึ่งกรองในหน่วยความจำทีหลัง
      prisma.task.findMany.mockResolvedValue([]);

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'] },
        stActor,
      );

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: DEVICE_ID, assignedTo: 'st-1' },
        }),
      );
      expect(result.items).toEqual([]);
    });

    it('QAEngineer ไม่มี tasks:Read เลย — ไม่ query ตาราง Task แม้ขอ type นี้ตรงๆ', async () => {
      prisma.task.findMany.mockResolvedValue([taskOf('st-1')]);

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['task'] },
        qaActor,
      );

      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
    });

    it('Operation เห็นงานของทุกคน — ไม่กรอง assignedTo', async () => {
      prisma.task.findMany.mockResolvedValue([taskOf('st-2')]);

      await service.getHistory(DEVICE_ID, { types: ['task'] }, operationActor);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: DEVICE_ID },
        }),
      );
    });

    const overrideOf = (overriddenBy: string) => ({
      id: 'o1',
      configId: 'cfg-1',
      status: 'pending',
      reason: 'x',
      overriddenBy,
      overriddenAt: d('2026-10-11T05:00:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      rejectReason: null,
    });

    it('ST เห็นคำขอ Config Override ของตัวเอง — query กรอง overriddenBy เป็นตัวเอง', async () => {
      prisma.deviceConfigOverride.findMany.mockResolvedValue([
        overrideOf('st-1'),
      ]);

      const result = await service.getHistory(
        DEVICE_ID,
        { types: ['config-override'] },
        stActor,
      );

      expect(prisma.deviceConfigOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: DEVICE_ID, overriddenBy: 'st-1' },
        }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('ST ไม่เห็นคำขอ Config Override ของช่างคนอื่น — query กรอง overriddenBy ของตัวเองเท่านั้น ไม่ใช่ของ st-1 ที่เป็นเจ้าของจริง', async () => {
      prisma.deviceConfigOverride.findMany.mockResolvedValue([]);

      await service.getHistory(
        DEVICE_ID,
        { types: ['config-override'] },
        otherStActor,
      );

      expect(prisma.deviceConfigOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deviceId: DEVICE_ID, overriddenBy: 'st-2' },
        }),
      );
    });

    it('Operation เห็นคำขอ Config/Firmware Override ของทุกคน — ไม่กรอง overriddenBy', async () => {
      await service.getHistory(
        DEVICE_ID,
        { types: ['config-override', 'firmware-override'] },
        operationActor,
      );

      expect(prisma.deviceConfigOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deviceId: DEVICE_ID } }),
      );
      expect(prisma.deviceFirmwareOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deviceId: DEVICE_ID } }),
      );
    });
  });
});
