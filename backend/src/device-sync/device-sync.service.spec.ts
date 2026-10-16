import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEVICE_SYNC_POLL_AFTER_SECONDS,
  DeviceSyncService,
} from './device-sync.service';

const DEVICE_ID = 'DEV-0001';

const config = {
  id: 'cfg-1',
  name: 'GT06N มาตรฐาน',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'approved' as const,
  deletedAt: null as Date | null,
  fields: { SPEED_LIMIT: 120, APN: 'internet' },
};

const device = {
  deviceId: DEVICE_ID,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed' as const,
};

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    rolloutId: 'rollout-1',
    deviceId: DEVICE_ID,
    status: 'pending' as const,
    pulledAt: null as Date | null,
    createdAt: new Date('2026-10-20T09:58:00.000Z'),
    rollout: {
      id: 'rollout-1',
      status: 'active' as const,
      applyMode: 'real',
      payloadType: 'Config',
      configId: 'cfg-1',
    },
    ...overrides,
  };
}

describe('DeviceSyncService', () => {
  let service: DeviceSyncService;
  let campaignRolloutTarget: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  let deviceModel: { findUnique: jest.Mock };
  let configModel: { findUnique: jest.Mock };
  let deviceConfigOverride: { findFirst: jest.Mock };
  let recordTargetResult: jest.Mock;

  beforeEach(async () => {
    campaignRolloutTarget = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      // แถวล่าสุดที่ appendLateReport อ่านก่อนต่อข้อความ
      findUnique: jest.fn().mockResolvedValue({ resultDetail: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    deviceModel = { findUnique: jest.fn().mockResolvedValue(device) };
    configModel = { findUnique: jest.fn().mockResolvedValue(config) };
    deviceConfigOverride = { findFirst: jest.fn().mockResolvedValue(null) };
    recordTargetResult = jest.fn().mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        DeviceSyncService,
        {
          provide: PrismaService,
          useValue: {
            campaignRolloutTarget,
            device: deviceModel,
            config: configModel,
            deviceConfigOverride,
          },
        },
        {
          provide: CampaignRolloutService,
          useValue: { recordTargetResult },
        },
      ],
    }).compile();
    service = module.get(DeviceSyncService);
  });

  describe('listJobs', () => {
    it('ไม่มีงาน -> jobs ว่าง พร้อม serverTime และ pollAfterSeconds ไม่ query อื่นต่อ', async () => {
      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs).toEqual([]);
      expect(result.pollAfterSeconds).toBe(DEVICE_SYNC_POLL_AFTER_SECONDS);
      expect(new Date(result.serverTime).toString()).not.toBe('Invalid Date');
      expect(deviceModel.findUnique).not.toHaveBeenCalled();
    });

    it('query เฉพาะ target pending ของเครื่องนี้ ใน Rollout active + real + Config เรียงตามเวลาสร้าง (paused ไม่แจกงาน)', async () => {
      await service.listJobs(DEVICE_ID);

      expect(campaignRolloutTarget.findMany).toHaveBeenCalledWith({
        where: {
          deviceId: DEVICE_ID,
          status: 'pending',
          rollout: {
            status: 'active',
            applyMode: 'real',
            payloadType: 'Config',
            configId: { not: null },
          },
        },
        include: { rollout: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('มีงาน -> ส่ง Config พร้อมค่าหลังรวมค่าเฉพาะเครื่องที่อนุมัติแล้ว และบันทึก pulledAt ครั้งแรก', async () => {
      campaignRolloutTarget.findMany.mockResolvedValue([makeTarget()]);
      deviceConfigOverride.findFirst.mockResolvedValue({
        fields: { SPEED_LIMIT: 180 },
      });

      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs).toEqual([
        {
          jobId: 'job-1',
          rolloutId: 'rollout-1',
          createdAt: '2026-10-20T09:58:00.000Z',
          payloadType: 'Config',
          config: {
            configId: 'cfg-1',
            name: 'GT06N มาตรฐาน',
            deviceModel: 'GT06N',
            protocol: 'TCP',
            fields: { SPEED_LIMIT: 180, APN: 'internet' },
          },
        },
      ]);
      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', pulledAt: null, status: 'pending' },
        data: { pulledAt: expect.any(Date) as Date },
      });
      expect(recordTargetResult).not.toHaveBeenCalled();
    });

    it('หลายงาน -> ส่งตามลำดับที่ query มา (เก่าไปใหม่) และโหลด Config ซ้ำครั้งเดียว', async () => {
      campaignRolloutTarget.findMany.mockResolvedValue([
        makeTarget({ id: 'job-1' }),
        makeTarget({
          id: 'job-2',
          rolloutId: 'rollout-2',
          createdAt: new Date('2026-10-20T09:59:00.000Z'),
          rollout: {
            id: 'rollout-2',
            status: 'active',
            applyMode: 'real',
            payloadType: 'Config',
            configId: 'cfg-1',
          },
        }),
      ]);

      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs.map((j) => j.jobId)).toEqual(['job-1', 'job-2']);
      expect(configModel.findUnique).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['ไม่พบ Config', null, 'ไม่พบ Config'],
      [
        'Config ถูกลบ',
        { ...config, deletedAt: new Date() },
        'ใช้งานไม่ได้อีกต่อไป',
      ],
      [
        'Config ถูกถอนอนุมัติ',
        { ...config, status: 'rejected' },
        'ใช้งานไม่ได้อีกต่อไป',
      ],
    ])(
      '%s -> ไม่ส่งงาน และบันทึก failed พร้อมเหตุผลผ่าน recordTargetResult',
      async (_name, cfg, reason) => {
        campaignRolloutTarget.findMany.mockResolvedValue([makeTarget()]);
        configModel.findUnique.mockResolvedValue(cfg);

        const result = await service.listJobs(DEVICE_ID);

        expect(result.jobs).toEqual([]);
        expect(recordTargetResult).toHaveBeenCalledWith(
          DEVICE_ID,
          { configId: 'cfg-1' },
          false,
          expect.stringContaining(reason) as string,
          'rollout-1',
        );
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      },
    );

    it('อุปกรณ์ไม่ใช่สถานะ installed แล้ว -> ไม่ส่งงาน บันทึก failed', async () => {
      campaignRolloutTarget.findMany.mockResolvedValue([makeTarget()]);
      deviceModel.findUnique.mockResolvedValue({
        ...device,
        status: 'decommissioned',
      });

      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs).toEqual([]);
      expect(recordTargetResult).toHaveBeenCalledWith(
        DEVICE_ID,
        { configId: 'cfg-1' },
        false,
        expect.stringContaining('decommissioned') as string,
        'rollout-1',
      );
    });

    it('โมเดลหรือโปรโตคอลไม่ตรงกับ Config -> ไม่ส่งงาน บันทึก failed', async () => {
      campaignRolloutTarget.findMany.mockResolvedValue([makeTarget()]);
      deviceModel.findUnique.mockResolvedValue({
        ...device,
        deviceModel: 'GT06L',
      });

      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs).toEqual([]);
      expect(recordTargetResult).toHaveBeenCalledWith(
        DEVICE_ID,
        { configId: 'cfg-1' },
        false,
        expect.stringContaining('ไม่ตรงกับอุปกรณ์') as string,
        'rollout-1',
      );
    });

    it('งานที่ผิดไม่ขวางงานอื่น: งานแรก Config ถูกลบ งานสองยังส่งได้', async () => {
      campaignRolloutTarget.findMany.mockResolvedValue([
        makeTarget({
          id: 'job-bad',
          rollout: {
            id: 'rollout-1',
            status: 'active',
            applyMode: 'real',
            payloadType: 'Config',
            configId: 'cfg-gone',
          },
        }),
        makeTarget({ id: 'job-ok' }),
      ]);
      configModel.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'cfg-gone' ? null : config),
      );

      const result = await service.listJobs(DEVICE_ID);

      expect(result.jobs.map((j) => j.jobId)).toEqual(['job-ok']);
      expect(recordTargetResult).toHaveBeenCalledTimes(1);
    });
  });

  describe('reportResult', () => {
    it('งานไม่ใช่ของเครื่องนี้ หรือไม่มี -> 404 (query scope ด้วย deviceId และ Rollout real/Config)', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(null);

      await expect(
        service.reportResult(DEVICE_ID, 'job-x', 'success'),
      ).rejects.toThrow(NotFoundException);
      expect(campaignRolloutTarget.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'job-x',
          deviceId: DEVICE_ID,
          rollout: { payloadType: 'Config', applyMode: 'real' },
        },
        include: { rollout: true },
      });
      expect(recordTargetResult).not.toHaveBeenCalled();
    });

    it('รายงานสำเร็จครั้งแรก -> บันทึกผ่าน recordTargetResult ด้วย rolloutId ของงาน (ไม่เปิด fallback) accepted true', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(
        makeTarget({ pulledAt: new Date() }),
      );

      const result = await service.reportResult(
        DEVICE_ID,
        'job-1',
        'success',
        'ใช้ค่าเรียบร้อย',
      );

      expect(result).toEqual({ accepted: true });
      expect(recordTargetResult).toHaveBeenCalledWith(
        DEVICE_ID,
        { configId: 'cfg-1' },
        true,
        'ใช้ค่าเรียบร้อย',
        'rollout-1',
      );
    });

    it('รายงาน failed ไม่ใส่ detail -> ใช้ข้อความมาตรฐาน', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(
        makeTarget({ pulledAt: new Date() }),
      );

      await service.reportResult(DEVICE_ID, 'job-1', 'failed');

      expect(recordTargetResult).toHaveBeenCalledWith(
        DEVICE_ID,
        { configId: 'cfg-1' },
        false,
        'อุปกรณ์รายงานว่าใช้ Config ไม่สำเร็จ',
        'rollout-1',
      );
    });

    it('ส่งซ้ำ (target มีผลแล้ว) -> 200 accepted false already-reported ไม่นับซ้ำ', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(
        makeTarget({ status: 'success' }),
      );

      await expect(
        service.reportResult(DEVICE_ID, 'job-1', 'success'),
      ).resolves.toEqual({ accepted: false, reason: 'already-reported' });
      expect(recordTargetResult).not.toHaveBeenCalled();
    });

    describe('รายงานที่ไม่ถูกนับ ต้องเก็บข้อความของเครื่องไว้ให้ Operation เห็น (docs/19 §4.2)', () => {
      it('ส่งซ้ำหลังมีผลแล้ว -> ต่อท้าย resultDetail เดิม ไม่เปลี่ยนสถานะ', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({ status: 'failed' }),
        );
        campaignRolloutTarget.findUnique.mockResolvedValue({
          resultDetail: 'Rollout ถูก rollback',
        });

        await service.reportResult(
          DEVICE_ID,
          'job-1',
          'success',
          'ใช้ค่าไปแล้ว',
        );

        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          // เขียนแบบมีเงื่อนไขว่าข้อความยังเป็นค่าที่อ่านมา (ไม่ทับการเขียนอื่น)
          where: { id: 'job-1', resultDetail: 'Rollout ถูก rollback' },
          data: {
            resultDetail:
              'Rollout ถูก rollback | [รายงานล่าช้าจากเครื่อง: ใช้ Config สำเร็จ] ใช้ค่าไปแล้ว',
          },
        });
        const call = (
          campaignRolloutTarget.updateMany.mock.calls as {
            data: Record<string, unknown>;
          }[][]
        )[0][0];
        expect(call.data).not.toHaveProperty('status');
        expect(recordTargetResult).not.toHaveBeenCalled();
      });

      it('resultDetail เดิมเป็น null และเครื่องไม่ส่ง detail -> บันทึกเฉพาะผลที่เครื่องรายงาน', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({ status: 'success' }),
        );

        await service.reportResult(DEVICE_ID, 'job-1', 'failed');

        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          where: { id: 'job-1', resultDetail: null },
          data: {
            resultDetail: '[รายงานล่าช้าจากเครื่อง: ใช้ Config ไม่สำเร็จ]',
          },
        });
      });

      it('เครื่องส่งซ้ำอีกรอบ -> ไม่ต่อซ้ำ ข้อความไม่โตขึ้น', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({ status: 'failed' }),
        );
        campaignRolloutTarget.findUnique.mockResolvedValue({
          resultDetail: 'เดิม | [รายงานล่าช้าจากเครื่อง: ใช้ Config สำเร็จ] x',
        });

        await service.reportResult(DEVICE_ID, 'job-1', 'success', 'x');

        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      });

      it.each(['cancelled', 'completed', 'rejected'])(
        'Rollout เป็น %s (rollout-closed) -> เก็บข้อความไว้เช่นกัน',
        async (status) => {
          campaignRolloutTarget.findFirst.mockResolvedValue(
            makeTarget({
              rollout: {
                id: 'rollout-1',
                status,
                applyMode: 'real',
                payloadType: 'Config',
                configId: 'cfg-1',
              },
            }),
          );

          await service.reportResult(DEVICE_ID, 'job-1', 'success', 'ok');

          expect(campaignRolloutTarget.updateMany).toHaveBeenCalledTimes(1);
          expect(recordTargetResult).not.toHaveBeenCalled();
        },
      );

      it('แพ้การ claim พร้อมกัน -> เก็บข้อความของเครื่องที่แพ้ไว้ด้วย', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({ pulledAt: new Date() }),
        );
        recordTargetResult.mockResolvedValue(false);
        campaignRolloutTarget.findUnique.mockResolvedValue({
          resultDetail: 'ผลที่ชนะ',
        });

        await service.reportResult(DEVICE_ID, 'job-1', 'failed', 'ล้ม');

        expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
          where: { id: 'job-1', resultDetail: 'ผลที่ชนะ' },
          data: {
            resultDetail:
              'ผลที่ชนะ | [รายงานล่าช้าจากเครื่อง: ใช้ Config ไม่สำเร็จ] ล้ม',
          },
        });
      });

      it('รายงานที่ถูกบันทึกปกติ -> ไม่ต่อข้อความ', async () => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({ pulledAt: new Date() }),
        );

        await service.reportResult(DEVICE_ID, 'job-1', 'success');

        expect(campaignRolloutTarget.findUnique).not.toHaveBeenCalled();
        expect(campaignRolloutTarget.updateMany).not.toHaveBeenCalled();
      });
    });

    it('recordTargetResult แพ้การ claim (race) -> accepted false already-reported', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(
        makeTarget({ pulledAt: new Date() }),
      );
      recordTargetResult.mockResolvedValue(false);

      await expect(
        service.reportResult(DEVICE_ID, 'job-1', 'success'),
      ).resolves.toEqual({ accepted: false, reason: 'already-reported' });
    });

    it.each(['cancelled', 'completed', 'rejected'])(
      'Rollout เป็น %s แล้ว -> accepted false rollout-closed ไม่บันทึก',
      async (status) => {
        campaignRolloutTarget.findFirst.mockResolvedValue(
          makeTarget({
            rollout: {
              id: 'rollout-1',
              status,
              applyMode: 'real',
              payloadType: 'Config',
              configId: 'cfg-1',
            },
          }),
        );

        await expect(
          service.reportResult(DEVICE_ID, 'job-1', 'success'),
        ).resolves.toEqual({ accepted: false, reason: 'rollout-closed' });
        expect(recordTargetResult).not.toHaveBeenCalled();
      },
    );

    it('Rollout paused (Auto Pause) -> ยังรับผลของเครื่องที่ดึงไปก่อนหยุดได้', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(
        makeTarget({
          pulledAt: new Date(),
          rollout: {
            id: 'rollout-1',
            status: 'paused',
            applyMode: 'real',
            payloadType: 'Config',
            configId: 'cfg-1',
          },
        }),
      );

      await expect(
        service.reportResult(DEVICE_ID, 'job-1', 'success'),
      ).resolves.toEqual({ accepted: true });
    });

    it('รายงานโดยไม่เคยดึงงาน -> ตั้ง pulledAt ให้ก่อนบันทึกผล', async () => {
      campaignRolloutTarget.findFirst.mockResolvedValue(makeTarget());

      await service.reportResult(DEVICE_ID, 'job-1', 'success');

      expect(campaignRolloutTarget.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', pulledAt: null, status: 'pending' },
        data: { pulledAt: expect.any(Date) as Date },
      });
    });
  });
});
