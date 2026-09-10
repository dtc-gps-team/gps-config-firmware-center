import { Logger } from '@nestjs/common';
import {
  ConfigSyncFailure,
  ConfigSyncWriterQueue,
} from './config-sync-writer-queue.service';
import {
  ConfigSyncWriter,
  LegacyConfigWrite,
} from './config-sync-writer.interface';

/** promise ที่คุม resolve/reject จากข้างนอกได้ — จำลอง writer ที่ยัง in-flight */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

const defer = (): Deferred => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const write = (over: Partial<LegacyConfigWrite> = {}): LegacyConfigWrite => ({
  configId: 'cfg-1',
  versionNumber: 3,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  fields: { APN: 'internet' },
  ...over,
});

describe('ConfigSyncWriterQueue', () => {
  let writer: jest.Mocked<ConfigSyncWriter>;
  let queue: ConfigSyncWriterQueue;

  /** promise ภายในของ job ล่าสุดต่อ configId (fire-and-forget → ต้องดึงมา await เอง) */
  const pending = (configId: string): Promise<void> =>
    (
      queue as unknown as { runningByConfigId: Map<string, Promise<void>> }
    ).runningByConfigId.get(configId) ?? Promise.resolve();

  /** flush microtask queue หลายรอบ — enqueueConfigSync chain ผ่าน .catch().then()
   * ก่อนถึง writer call จริง ต้องรอหลาย tick */
  const tick = async (rounds = 8): Promise<void> => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  };

  let errorLog: jest.SpyInstance<unknown, unknown[]>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    writer = {
      writeConfigToLegacySystem: jest.fn(),
      writeFirmwarePointerToLegacySystem: jest.fn(),
    };
    queue = new ConfigSyncWriterQueue(writer);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('สำเร็จตั้งแต่ attempt แรก — เรียก writer ครั้งเดียว ไม่ emit sync-failed', async () => {
    writer.writeConfigToLegacySystem.mockResolvedValue(undefined);
    const failed = jest.fn();
    queue.on('sync-failed', failed);

    queue.enqueueConfigSync(write());
    await pending('cfg-1');

    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('พังแล้วสำเร็จตอน attempt 2 — เรียก writer 2 ครั้ง มี backoff คั่น ไม่ emit', async () => {
    writer.writeConfigToLegacySystem
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    const failed = jest.fn();
    queue.on('sync-failed', failed);

    queue.enqueueConfigSync(write());
    const p = pending('cfg-1');

    // ก่อนครบ backoff แรก (500ms) — ยังเรียกแค่ครั้งเดียว
    await tick();
    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500);
    await p;

    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it('พังครบ 3 ครั้ง — emit sync-failed พร้อม payload ถูกต้อง', async () => {
    writer.writeConfigToLegacySystem.mockRejectedValue(new Error('boom'));
    const failures: ConfigSyncFailure[] = [];
    queue.on('sync-failed', (f: ConfigSyncFailure) => failures.push(f));

    queue.enqueueConfigSync(write({ versionNumber: 7 }));
    const p = pending('cfg-1');

    // backoff รวม 500 + 1000 = 1500ms
    await jest.advanceTimersByTimeAsync(1500);
    await p;

    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([
      {
        configId: 'cfg-1',
        versionNumber: 7,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        attempts: 3,
        lastError: 'boom',
      },
    ]);
  });

  it('พังครบ 3 ครั้ง โดยไม่มี listener — ยัง log บรรทัดสรุป "ล้มเหลวถาวร" (review #131 ข้อ 1)', async () => {
    writer.writeConfigToLegacySystem.mockRejectedValue(new Error('boom'));
    // ไม่ผูก listener 'sync-failed' เลย

    queue.enqueueConfigSync(write({ versionNumber: 7 }));
    const p = pending('cfg-1');
    await jest.advanceTimersByTimeAsync(1500);
    await p;

    expect(errorLog).toHaveBeenCalledTimes(1);
    const msg = String(errorLog.mock.calls[0]?.[0]);
    expect(msg).toContain('ล้มเหลวถาวร');
    expect(msg).toContain('cfg-1 v7');
    expect(msg).toContain('boom');
  });

  it('2 job ของ configId เดียวกัน enqueue พร้อมกัน — รันตามลำดับ ไม่ overlap', async () => {
    const first = defer();
    const second = defer();
    writer.writeConfigToLegacySystem
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    queue.enqueueConfigSync(write({ versionNumber: 1 }));
    queue.enqueueConfigSync(write({ versionNumber: 2 }));
    const p = pending('cfg-1');

    // job แรกยัง in-flight → job สองยังไม่ถูกเรียก
    await tick();
    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(1);
    expect(writer.writeConfigToLegacySystem).toHaveBeenLastCalledWith(
      expect.objectContaining({ versionNumber: 1 }),
    );

    first.resolve();
    await tick();

    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(2);
    expect(writer.writeConfigToLegacySystem).toHaveBeenLastCalledWith(
      expect.objectContaining({ versionNumber: 2 }),
    );

    second.resolve();
    await p;
  });

  it('job ของ configId คนละตัว enqueue พร้อมกัน — รันพร้อมกันได้ ไม่ block กัน', async () => {
    const a = defer();
    const b = defer();
    writer.writeConfigToLegacySystem.mockImplementation((input) =>
      input.configId === 'cfg-A' ? a.promise : b.promise,
    );

    queue.enqueueConfigSync(write({ configId: 'cfg-A' }));
    queue.enqueueConfigSync(write({ configId: 'cfg-B' }));

    await tick();
    expect(writer.writeConfigToLegacySystem).toHaveBeenCalledTimes(2);

    a.resolve();
    b.resolve();
    await pending('cfg-A');
    await pending('cfg-B');
  });

  it('listener ของ sync-failed throw (sync) — ไม่ทำให้ enqueueConfigSync throw ออกมาที่ caller', async () => {
    writer.writeConfigToLegacySystem.mockRejectedValue(new Error('boom'));
    queue.on('sync-failed', () => {
      throw new Error('listener พัง');
    });

    expect(() => queue.enqueueConfigSync(write())).not.toThrow();
    const p = pending('cfg-1');

    await jest.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBeUndefined();
  });
});
