import { CentralDeviceController } from './central-device.controller';
import type { CentralDeviceService } from './central-device.service';

describe('CentralDeviceController', () => {
  it('GET /central/status แนบ applyMode ของระบบ (docs/27 §5.6) ให้ Mobile ซ่อนปุ่มในโหมด central', async () => {
    const central = {
      getStatus: jest.fn().mockResolvedValue({
        mode: 'real',
        reachable: true,
        error: null,
        checkedAt: '2026-10-27T00:00:00.000Z',
      }),
    } as unknown as CentralDeviceService;
    const controller = new CentralDeviceController(central, 'central');

    await expect(controller.getStatus()).resolves.toEqual({
      mode: 'real',
      reachable: true,
      error: null,
      checkedAt: '2026-10-27T00:00:00.000Z',
      applyMode: 'central',
    });
  });
});
