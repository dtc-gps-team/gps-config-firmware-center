import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCampaignRolloutDto,
  MAX_DEVICE_VALUES_PER_ROLLOUT,
} from './create-campaign-rollout.dto';

const CONFIG_ID = '3f1c2b1e-6a4d-4f6e-9a55-0c7f4f6d2a10';

async function errorProps(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateCampaignRolloutDto, {
    payloadType: 'Config',
    configId: CONFIG_ID,
    ...input,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('CreateCampaignRolloutDto (deviceValues, docs/17)', () => {
  it('ไม่ส่ง deviceValues ผ่านและไม่ต้องมีเหตุผล', async () => {
    expect(await errorProps({})).toEqual([]);
  });

  it('deviceValues พร้อมเหตุผลผ่าน', async () => {
    expect(
      await errorProps({
        deviceValues: [{ deviceId: 'DEV-1', fields: { SPEED_LIMIT: 180 } }],
        deviceValuesReason: 'ลูกค้าขอ',
      }),
    ).toEqual([]);
  });

  it('มี deviceValues แต่ไม่มีเหตุผลหรือเป็นช่องว่างล้วน ไม่ผ่าน', async () => {
    const values = [{ deviceId: 'DEV-1', fields: { SPEED_LIMIT: 180 } }];

    expect(await errorProps({ deviceValues: values })).toContain(
      'deviceValuesReason',
    );
    expect(
      await errorProps({ deviceValues: values, deviceValuesReason: '   ' }),
    ).toContain('deviceValuesReason');
  });

  it('deviceValues เป็นอาร์เรย์ว่างไม่ต้องมีเหตุผล', async () => {
    expect(await errorProps({ deviceValues: [] })).toEqual([]);
  });

  it(`เกิน ${MAX_DEVICE_VALUES_PER_ROLLOUT} เครื่อง ไม่ผ่าน`, async () => {
    const many = Array.from(
      { length: MAX_DEVICE_VALUES_PER_ROLLOUT + 1 },
      (_, i) => ({ deviceId: `DEV-${i}`, fields: { A: 1 } }),
    );

    expect(
      await errorProps({ deviceValues: many, deviceValuesReason: 'x' }),
    ).toContain('deviceValues');
  });

  it('รายการข้างในไม่มี deviceId หรือ fields ไม่ใช่ object ไม่ผ่าน', async () => {
    expect(
      await errorProps({
        deviceValues: [{ fields: { A: 1 } }],
        deviceValuesReason: 'x',
      }),
    ).toContain('deviceValues');
    expect(
      await errorProps({
        deviceValues: [{ deviceId: 'DEV-1', fields: 'ไม่ใช่ object' }],
        deviceValuesReason: 'x',
      }),
    ).toContain('deviceValues');
  });
});
