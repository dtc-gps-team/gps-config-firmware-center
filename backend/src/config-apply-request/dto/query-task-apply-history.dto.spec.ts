import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryTaskApplyHistoryDto } from './query-task-apply-history.dto';

const build = (query: Record<string, unknown>) =>
  plainToInstance(QueryTaskApplyHistoryDto, query);

const ID = '22222222-2222-4222-8222-222222222222';

describe('QueryTaskApplyHistoryDto', () => {
  it('ไม่ส่งอะไรเลย: ผ่าน', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('limit จาก query string แปลงเป็นตัวเลข และต้องอยู่ระหว่าง 1 ถึง 50', async () => {
    const ok = build({ limit: '20' });
    expect(ok.limit).toBe(20);
    expect(await validate(ok)).toHaveLength(0);

    for (const bad of ['0', '51', 'abc']) {
      expect((await validate(build({ limit: bad }))).length).toBeGreaterThan(0);
    }
  });

  it('before ต้องเป็น cursor <ISO>_<uuid> เท่านั้น', async () => {
    expect(
      await validate(build({ before: `2026-11-12T03:20:00.000Z_${ID}` })),
    ).toHaveLength(0);
    for (const bad of [
      '2026-11-12_' + ID,
      '2026-11-12T03:20:00.000Z_not-a-uuid',
      `2026-11-12T03:20:00.000Z_${ID}' OR 1=1`,
    ]) {
      expect((await validate(build({ before: bad }))).length).toBeGreaterThan(
        0,
      );
    }
  });

  it('result และ kind รับเฉพาะค่าที่กำหนด', async () => {
    expect(
      await validate(build({ result: 'unsuccessful', kind: 'firmware' })),
    ).toHaveLength(0);
    expect(
      (await validate(build({ result: 'failed' }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(build({ kind: 'campaign' }))).length,
    ).toBeGreaterThan(0);
  });
});
