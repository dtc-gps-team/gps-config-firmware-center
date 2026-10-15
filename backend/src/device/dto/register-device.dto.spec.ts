import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDeviceDto } from './register-device.dto';

const base = {
  deviceId: 'DEV-0001',
  simNumber: '0899999999',
  modelId: '3f1c2b1e-6a4d-4f6e-9a55-0c7f4f6d2a10',
  protocol: 'TCP',
  imei: '860000000000001',
  serialNumber: 'SN-0001',
  blackboxId: 'BB-0001',
};

async function errorsFor(input: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDeviceDto, input);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property) };
}

describe('RegisterDeviceDto (imei / serialNumber / blackboxId บังคับกรอก)', () => {
  it('ครบทุกช่องผ่าน', async () => {
    const { fields } = await errorsFor(base);
    expect(fields).toEqual([]);
  });

  it.each(['imei', 'serialNumber', 'blackboxId'])(
    'ไม่ส่ง %s ไม่ผ่าน',
    async (field) => {
      const input: Record<string, unknown> = { ...base };
      delete input[field];
      const { fields } = await errorsFor(input);
      expect(fields).toContain(field);
    },
  );

  it.each(['imei', 'serialNumber', 'blackboxId'])(
    '%s เป็นช่องว่างล้วนไม่ผ่าน',
    async (field) => {
      const { fields } = await errorsFor({ ...base, [field]: '   ' });
      expect(fields).toContain(field);
    },
  );

  it('ตัดช่องว่างหัวท้ายก่อนตรวจและก่อนบันทึก', async () => {
    const { dto, fields } = await errorsFor({
      ...base,
      imei: '  860000000000009 ',
    });
    expect(fields).toEqual([]);
    expect(dto.imei).toBe('860000000000009');
  });
});
