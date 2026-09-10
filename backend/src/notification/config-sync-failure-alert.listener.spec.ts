import { Logger } from '@nestjs/common';
import { ConfigSyncFailure } from '../config-sync-writer/config-sync-writer-queue.service';
import { ConfigSyncFailureAlertListener } from './config-sync-failure-alert.listener';

type SyncFailedHandler = (failure: ConfigSyncFailure) => void;

const failure: ConfigSyncFailure = {
  configId: 'cfg-1',
  versionNumber: 4,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  attempts: 3,
  lastError: 'ECONNREFUSED config.dtc.co.th:909',
};

describe('ConfigSyncFailureAlertListener', () => {
  let queueOn: jest.Mock;
  let findMany: jest.Mock;
  let send: jest.Mock;
  let listener: ConfigSyncFailureAlertListener;
  let syncFailedHandler: SyncFailedHandler | undefined;

  /** เรียก handler ที่ listener ผูกไว้กับ event 'sync-failed' แล้วรอ microtask ให้ครบ */
  const fireSyncFailed = async (
    f: ConfigSyncFailure = failure,
  ): Promise<void> => {
    if (!syncFailedHandler)
      throw new Error('listener ไม่ได้ subscribe sync-failed');
    syncFailedHandler(f);
    // handler เป็น `void this.handleSyncFailed(...)` — flush promise chain
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    syncFailedHandler = undefined;
    queueOn = jest.fn((event: string, handler: SyncFailedHandler) => {
      if (event === 'sync-failed') syncFailedHandler = handler;
    });
    findMany = jest.fn().mockResolvedValue([{ id: 'op-1' }]);
    send = jest.fn().mockResolvedValue({ id: 'noti-1' });

    listener = new ConfigSyncFailureAlertListener(
      { on: queueOn } as never,
      { user: { findMany } } as never,
      { send } as never,
    );
    listener.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('onModuleInit() subscribe event sync-failed หนึ่งครั้ง', () => {
    expect(queueOn).toHaveBeenCalledTimes(1);
    expect(queueOn).toHaveBeenCalledWith('sync-failed', expect.any(Function));
    expect(syncFailedHandler).toBeDefined();
  });

  it('Operation active 1 คน — ยิง incident_alert ด้วย payload ตรงกับ ConfigSyncFailure', async () => {
    await fireSyncFailed();

    expect(findMany).toHaveBeenCalledWith({
      where: { role: { code: 'Operation' }, isActive: true },
      select: { id: true },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      userId: 'op-1',
      type: 'incident_alert',
      payload: {
        configId: 'cfg-1',
        versionNumber: 4,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        attempts: 3,
        lastError: 'ECONNREFUSED config.dtc.co.th:909',
      },
    });
  });

  it('Operation active หลายคน — ส่งครบทุกคน (type incident_alert)', async () => {
    findMany.mockResolvedValue([
      { id: 'op-1' },
      { id: 'op-2' },
      { id: 'op-3' },
    ]);

    await fireSyncFailed();

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userId: 'op-1', type: 'incident_alert' }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: 'op-2', type: 'incident_alert' }),
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ userId: 'op-3', type: 'incident_alert' }),
    );
  });

  it('ไม่มี Operation active เลย — ไม่เรียก send() และไม่ throw', async () => {
    findMany.mockResolvedValue([]);

    await expect(fireSyncFailed()).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('send() throw ให้ user คนหนึ่ง — user คนอื่นยังได้รับ (ไม่หลุดออกจาก loop)', async () => {
    findMany.mockResolvedValue([
      { id: 'op-1' },
      { id: 'op-2' },
      { id: 'op-3' },
    ]);
    send
      .mockResolvedValueOnce({ id: 'noti-1' })
      .mockRejectedValueOnce(new Error('fcm down'))
      .mockResolvedValueOnce({ id: 'noti-3' });

    await expect(fireSyncFailed()).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ userId: 'op-3' }),
    );
  });

  it('prisma.user.findMany throw — handler ไม่ throw ออกมา (try/catch ชั้นนอก)', async () => {
    findMany.mockRejectedValue(new Error('db unreachable'));

    await expect(fireSyncFailed()).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
