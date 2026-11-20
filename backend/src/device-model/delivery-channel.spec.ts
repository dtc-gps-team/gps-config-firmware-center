import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeviceModelDto } from './dto/create-device-model.dto';
import { UpdateDeviceModelDto } from './dto/update-device-model.dto';
import { DELIVERY_CHANNELS, resolveDeliveryChannel } from './delivery-channel';

/** ทางส่งเข้ากล่องต่อรุ่น (docs/33 D1 + §0 ข้อ 3) */
describe('resolveDeliveryChannel', () => {
  it('null / undefined -> central (ข้อมูลเดิมทำงานเหมือนเดิม)', () => {
    expect(resolveDeliveryChannel(null)).toBe('central');
    expect(resolveDeliveryChannel(undefined)).toBe('central');
  });

  it('hub -> hub · central -> central', () => {
    expect(resolveDeliveryChannel('hub')).toBe('hub');
    expect(resolveDeliveryChannel('central')).toBe('central');
  });

  it('ค่าที่ไม่รู้จักในฐานข้อมูล -> central (ไม่ส่งผิดทาง)', () => {
    expect(resolveDeliveryChannel('xyz')).toBe('central');
  });

  it('มีแค่ 2 ค่า', () => {
    expect([...DELIVERY_CHANNELS]).toEqual(['central', 'hub']);
  });
});

describe('DeviceModel DTO: deliveryChannel', () => {
  const create = (deliveryChannel: unknown) =>
    plainToInstance(CreateDeviceModelDto, {
      name: 'TA255L',
      supportedProtocols: ['TCP'],
      deliveryChannel,
    });
  const update = (body: Record<string, unknown>) =>
    plainToInstance(UpdateDeviceModelDto, body);

  it('create: hub ผ่าน', async () => {
    expect(await validate(create('hub'))).toHaveLength(0);
  });

  it('create: ค่าที่ไม่รู้จัก ไม่ผ่าน', async () => {
    for (const value of ['none', 'xyz']) {
      const errors = await validate(create(value));
      expect(errors.map((e) => e.property)).toContain('deliveryChannel');
    }
  });

  it('create: ไม่ส่งมา -> ผ่าน', async () => {
    expect(await validate(create(undefined))).toHaveLength(0);
  });

  it('update: hub ผ่าน · ค่าที่ไม่รู้จัก ไม่ผ่าน · null ผ่าน (กลับเป็นค่าเริ่มต้น)', async () => {
    expect(await validate(update({ deliveryChannel: 'hub' }))).toHaveLength(0);
    const errors = await validate(update({ deliveryChannel: 'none' }));
    expect(errors.map((e) => e.property)).toContain('deliveryChannel');
    expect(await validate(update({ deliveryChannel: null }))).toHaveLength(0);
  });
});
