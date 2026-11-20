import { Logger } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import {
  type CentralDeviceClient,
  CentralUnavailableError,
} from './central-device.client';
import { CentralDeviceService } from './central-device.service';

/**
 * เลือก Server กลาง ESP32 หรือ device-hub ตามรุ่นของเครื่อง (docs/33 §0 ข้อ 2)
 * ผู้เรียก (campaign, config-apply-request, device) ใช้ method เดิมทุกตัว ไม่ต้องรู้ว่ากล่องอยู่ทางไหน
 */
const ESP = 'BOX-0001';
const TA = '353358017784062';

function fakeClient(
  model: string,
  deviceId: string,
  schemaKeys: string[],
): CentralDeviceClient & Record<string, jest.Mock> {
  return {
    listGatewayDevices: jest.fn().mockResolvedValue([
      {
        device_id: deviceId,
        online: true,
        hardware_model: model,
        schema_version_reported: 1,
        firmware_version_reported: '1.0',
      },
    ]),
    listRegistryDevices: jest
      .fn()
      .mockResolvedValue([
        { device_id: deviceId, hardware_model: model, status: 'active' },
      ]),
    getSchema: jest.fn().mockResolvedValue({
      hardware_model: model,
      schema_version: 1,
      parameters: schemaKeys.map((key) => ({ key, type: 'integer' })),
    }),
    putDeviceConfig: jest.fn().mockResolvedValue({
      config_version: 1,
      command: {
        command_id: `${model}-cmd`,
        device_id: deviceId,
        action: 'config',
        status: 'QUEUED',
      },
    }),
    getCommand: jest.fn().mockResolvedValue({
      command_id: 'x',
      device_id: deviceId,
      action: 'config',
      status: 'SUCCESS',
    }),
    getDeviceConfig: jest.fn().mockResolvedValue({
      device_id: deviceId,
      reported: { config_version: 1, settings: { a: 1 }, reported_at: null },
    }),
    pushFirmware: jest.fn(),
    listDeviceCommands: jest.fn().mockResolvedValue([]),
  };
}

const config = {
  get: (_k: string, d?: string) => d ?? 'mock',
} as unknown as NestConfigService;

/** prisma ปลอม: ESP = รุ่นเดิม (null), TA = hub */
function fakePrisma(): PrismaService {
  const channels: Record<string, string | null> = { [ESP]: null, [TA]: 'hub' };
  return {
    device: {
      findUnique: jest.fn(({ where }: { where: { deviceId: string } }) =>
        Promise.resolve(
          where.deviceId in channels
            ? { model: { deliveryChannel: channels[where.deviceId] } }
            : null,
        ),
      ),
    },
  } as unknown as PrismaService;
}

function setup(withHub = true) {
  const central = fakeClient('ESP32-DEVKIT-V1', ESP, ['gps.send_interval_sec']);
  const hub = fakeClient('TA255L', TA, ['meitrack.track_interval_sec']);
  const service = new CentralDeviceService(
    central,
    config,
    withHub ? hub : null,
    fakePrisma(),
  );
  return { central, hub, service };
}

describe('CentralDeviceService: เลือกทางส่งตามรุ่นของเครื่อง', () => {
  it('รุ่น deliveryChannel null -> pushConfig ไป Server กลาง ไม่แตะ device-hub', async () => {
    const { central, hub, service } = setup();
    const out = await service.pushConfig(ESP, { 'gps.send_interval_sec': 10 });
    expect(out).toMatchObject({ kind: 'sent' });
    expect(central.putDeviceConfig).toHaveBeenCalled();
    expect(hub.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('รุ่น hub -> pushConfig ไป device-hub ไม่แตะ Server กลาง', async () => {
    const { central, hub, service } = setup();
    const out = await service.pushConfig(TA, {
      'meitrack.track_interval_sec': 60,
    });
    expect(out).toEqual({
      kind: 'sent',
      commandId: 'TA255L-cmd',
      configVersion: 1,
    });
    expect(hub.putDeviceConfig).toHaveBeenCalledWith(TA, {
      meitrack: { track_interval_sec: 60 },
    });
    expect(central.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('รุ่น hub แต่ปิด device-hub (DEVICE_HUB_MODE=mock) -> unavailable พร้อมเหตุผล', async () => {
    const { central, service } = setup(false);
    const out = await service.pushConfig(TA, {
      'meitrack.track_interval_sec': 60,
    });
    expect(out.kind).toBe('unavailable');
    expect((out as { reason: string }).reason).toContain('DEVICE_HUB_MODE');
    expect(central.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('checkConfig รุ่น hub ใช้ schema ของ device-hub -> key ของ ESP32 ถูกปฏิเสธ', async () => {
    const { hub, service } = setup();
    const out = await service.checkConfig(TA, { 'gps.send_interval_sec': 10 });
    expect(out.kind).toBe('rejected');
    expect(hub.getSchema).toHaveBeenCalledWith('TA255L', 1);
  });

  it('readReportedFields / readSupportedSchema รุ่น hub อ่านจาก device-hub', async () => {
    const { central, hub, service } = setup();
    expect(await service.readReportedFields(TA)).toEqual({
      fields: { a: 1 },
      reportedAt: null,
    });
    expect((await service.readSupportedSchema(TA))?.keys).toEqual([
      'meitrack.track_interval_sec',
    ]);
    expect(hub.getDeviceConfig).toHaveBeenCalledWith(TA);
    expect(central.getDeviceConfig).not.toHaveBeenCalled();
  });

  it('getCommandOutcome: id ขึ้นต้น hub- ถาม device-hub · อื่นๆ ถาม Server กลาง', async () => {
    const { central, hub, service } = setup();
    expect(await service.getCommandOutcome('hub-123')).toEqual({
      kind: 'success',
    });
    expect(hub.getCommand).toHaveBeenCalledWith('hub-123');
    await service.getCommandOutcome('abc');
    expect(central.getCommand).toHaveBeenCalledWith('abc');
    expect(hub.getCommand).toHaveBeenCalledTimes(1);
  });

  it('getCommandOutcome hub- ขณะปิด device-hub -> unavailable (รอถามใหม่)', async () => {
    const { service } = setup(false);
    expect(await service.getCommandOutcome('hub-123')).toEqual({
      kind: 'unavailable',
    });
  });

  it('listDevices รวมทั้งสองฝั่ง เรียงตาม deviceId', async () => {
    const { service } = setup();
    const list = await service.listDevices();
    expect(list.reachable).toBe(true);
    expect(list.devices.map((d) => d.deviceId)).toEqual([TA, ESP].sort());
  });

  it('device-hub ล่ม -> สถานะ Server กลางยังติดต่อได้ (หน้าเว็บของ ESP32 ไม่หาย) รายการเหลือเฉพาะฝั่ง Server กลาง', async () => {
    const { hub, service } = setup();
    (hub.listGatewayDevices as jest.Mock).mockRejectedValue(
      new CentralUnavailableError('hub ล่ม'),
    );
    const list = await service.listDevices();
    expect(list.reachable).toBe(true);
    expect(list.error).toBeNull();
    expect((await service.getStatus()).reachable).toBe(true);
    expect(list.devices.map((d) => d.deviceId)).toEqual([ESP]);
    // กล่องฝั่ง hub ได้ unavailable พร้อมเหตุผลของ hub (ไม่ใช่ "ไม่รู้จักกล่อง")
    const hubPush = await service.pushConfig(TA, {
      'meitrack.track_interval_sec': 60,
    });
    expect(hubPush.kind).toBe('unavailable');
    expect((hubPush as { reason: string }).reason).toContain('hub ล่ม');
    // กล่องฝั่ง Server กลางยังส่งได้ตามปกติ
    expect(
      (await service.pushConfig(ESP, { 'gps.send_interval_sec': 10 })).kind,
    ).toBe('sent');
  });

  it('findDevice รุ่น hub หาในรายการของ device-hub', async () => {
    const { service } = setup();
    expect((await service.findDevice(TA)).device?.hardwareModel).toBe('TA255L');
    expect((await service.findDevice(ESP)).device?.hardwareModel).toBe(
      'ESP32-DEVKIT-V1',
    );
  });

  it('อ่านรุ่นจากฐานไม่ได้ -> ถอยไป Server กลาง และ log เตือนพร้อม deviceId + สาเหตุ (review #491 ข้อ 1)', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const central = fakeClient('ESP32-DEVKIT-V1', TA, [
        'gps.send_interval_sec',
      ]);
      const hub = fakeClient('TA255L', TA, ['meitrack.track_interval_sec']);
      const prisma = {
        device: {
          findUnique: jest
            .fn()
            .mockRejectedValue(new Error('connection terminated')),
        },
      } as unknown as PrismaService;
      const service = new CentralDeviceService(central, config, hub, prisma);

      await service.pushConfig(TA, { 'gps.send_interval_sec': 10 });

      expect(central.putDeviceConfig).toHaveBeenCalled();
      expect(hub.putDeviceConfig).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`${TA}.*connection terminated`)),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('สร้างแบบเดิม (ไม่มี prisma / hub) -> ทุกเครื่องไป Server กลาง', async () => {
    const central = fakeClient('ESP32-DEVKIT-V1', ESP, [
      'gps.send_interval_sec',
    ]);
    const service = new CentralDeviceService(central, config);
    await service.pushConfig(ESP, { 'gps.send_interval_sec': 10 });
    expect(central.putDeviceConfig).toHaveBeenCalled();
    expect((await service.listDevices()).devices).toHaveLength(1);
  });
});
