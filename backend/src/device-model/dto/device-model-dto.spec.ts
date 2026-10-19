import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeviceModelDto } from './create-device-model.dto';
import { UpdateDeviceModelDto } from './update-device-model.dto';

/**
 * กฎ "1 โมเดลมีได้โปรโตคอลเดียว" (มติรีวิวพี่เลี้ยง 19 ต.ค. 2569) —
 * `supportedProtocols` ยังเป็น array แต่ต้องมี 1 ค่าพอดี
 */
describe('CreateDeviceModelDto: supportedProtocols', () => {
  const build = (supportedProtocols: unknown) =>
    plainToInstance(CreateDeviceModelDto, {
      name: 'GT06N',
      supportedProtocols,
    });

  it('1 ค่า -> ผ่าน', async () => {
    expect(await validate(build(['TCP']))).toHaveLength(0);
  });

  it('ว่างเปล่า -> ไม่ผ่าน', async () => {
    const errors = await validate(build([]));
    expect(errors.map((e) => e.property)).toContain('supportedProtocols');
  });

  it('มากกว่า 1 ค่า -> ไม่ผ่าน พร้อมข้อความบอกกฎ', async () => {
    const errors = await validate(build(['TCP', 'UDP']));
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.join(' ')).toContain('1 โมเดลมีได้โปรโตคอลเดียว');
  });
});

describe('UpdateDeviceModelDto: supportedProtocols', () => {
  const build = (body: Record<string, unknown>) =>
    plainToInstance(UpdateDeviceModelDto, body);

  it('ไม่ส่ง supportedProtocols -> ผ่าน (optional)', async () => {
    expect(await validate(build({ status: 'active' }))).toHaveLength(0);
  });

  it('1 ค่า -> ผ่าน', async () => {
    expect(await validate(build({ supportedProtocols: ['UDP'] }))).toHaveLength(
      0,
    );
  });

  it('มากกว่า 1 ค่า -> ไม่ผ่าน', async () => {
    const errors = await validate(
      build({ supportedProtocols: ['TCP', 'UDP'] }),
    );
    expect(errors.map((e) => e.property)).toContain('supportedProtocols');
  });
});
