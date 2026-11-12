import { CONFIG_MODEL_INCLUDE, toConfigView } from './config-model';

describe('config-model', () => {
  it('include ดึงแค่ชื่อรุ่นจาก relation (ไม่ดึงข้อมูลรุ่นทั้งแถว)', () => {
    expect(CONFIG_MODEL_INCLUDE).toEqual({
      model: { select: { name: true } },
    });
  });

  it('toConfigView: เอา object model ออก ใส่ deviceModel เป็นชื่อรุ่น และคง modelId/idMaster ไว้', () => {
    const view = toConfigView({
      id: 'cfg-1',
      idMaster: 'master-1',
      modelId: 'model-1',
      protocol: 'TCP',
      model: { name: 'ESP32-DEVKIT-V1' },
    });

    expect(view).toEqual({
      id: 'cfg-1',
      idMaster: 'master-1',
      modelId: 'model-1',
      protocol: 'TCP',
      deviceModel: 'ESP32-DEVKIT-V1',
    });
    expect(view).not.toHaveProperty('model');
  });
});
