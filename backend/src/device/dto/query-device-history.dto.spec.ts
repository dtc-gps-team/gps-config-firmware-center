import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryDeviceHistoryDto } from './query-device-history.dto';

const build = (query: Record<string, unknown>) =>
  plainToInstance(QueryDeviceHistoryDto, query);

describe('QueryDeviceHistoryDto', () => {
  it('ไม่ส่งอะไรเลย: ผ่าน', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('limit เป็นข้อความจาก query string: แปลงเป็นตัวเลข และต้องอยู่ระหว่าง 1 ถึง 100', async () => {
    const ok = build({ limit: '30' });
    expect(ok.limit).toBe(30);
    expect(await validate(ok)).toHaveLength(0);

    expect((await validate(build({ limit: '0' }))).length).toBeGreaterThan(0);
    expect((await validate(build({ limit: '101' }))).length).toBeGreaterThan(0);
    expect((await validate(build({ limit: 'abc' }))).length).toBeGreaterThan(0);
  });

  it('types คั่นด้วยจุลภาค: แยกเป็นรายการ ตัดช่องว่าง และตรวจว่าเป็นชนิดที่รู้จัก', async () => {
    const dto = build({ types: 'rollout, task ,incident' });
    expect(dto.types).toEqual(['rollout', 'task', 'incident']);
    expect(await validate(dto)).toHaveLength(0);

    expect(
      (await validate(build({ types: 'rollout,whatever' }))).length,
    ).toBeGreaterThan(0);
  });

  it('before ต้องเป็น cursor รูปแบบ <ISO>_<id>', async () => {
    expect(
      await validate(build({ before: '2026-10-09T23:59:58.000Z_task:abc-1' })),
    ).toHaveLength(0);
    expect(
      (await validate(build({ before: '2026-10-09_task:abc' }))).length,
    ).toBeGreaterThan(0);
    expect((await validate(build({ before: 'x' }))).length).toBeGreaterThan(0);
  });
});
