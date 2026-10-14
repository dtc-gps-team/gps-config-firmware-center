import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryAuditLogDto } from './query-audit-log.dto';

async function errorFields(input: Record<string, unknown>) {
  const errors = await validate(plainToInstance(QueryAuditLogDto, input));
  return errors.map((e) => e.property);
}

describe('QueryAuditLogDto (from / to / actorName)', () => {
  it('ไม่ส่งอะไรเลยผ่าน', async () => {
    expect(await errorFields({})).toEqual([]);
  });

  it('from/to เป็น ISO 8601 ผ่าน', async () => {
    expect(
      await errorFields({
        from: '2026-10-13T17:00:00.000Z',
        to: '2026-10-14T16:59:59.999Z',
      }),
    ).toEqual([]);
  });

  it.each(['from', 'to'])('%s ไม่ใช่วันที่ ไม่ผ่าน', async (field) => {
    expect(await errorFields({ [field]: 'not-a-date' })).toContain(field);
    expect(await errorFields({ [field]: '2026-13-45' })).toContain(field);
  });

  it('actorName ถูกตัดช่องว่างหัวท้าย', async () => {
    const dto = plainToInstance(QueryAuditLogDto, { actorName: '  สมชาย ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.actorName).toBe('สมชาย');
  });

  it('actorName ยาวเกิน 100 ตัวอักษร ไม่ผ่าน', async () => {
    expect(await errorFields({ actorName: 'ก'.repeat(101) })).toContain(
      'actorName',
    );
  });
});
