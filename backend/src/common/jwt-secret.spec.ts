import { MIN_JWT_SECRET_LENGTH, assertJwtSecret } from './jwt-secret';

const strongSecret = 'x'.repeat(MIN_JWT_SECRET_LENGTH);

describe('assertJwtSecret', () => {
  describe('พัฒนาในเครื่อง (ไม่ใช่ production และไม่ได้ตั้ง TRUST_PROXY)', () => {
    it.each([undefined, '', 'changeme', 'short'])(
      'JWT_SECRET %p -> ไม่ throw (ไม่บังคับตอนพัฒนา)',
      (secret) => {
        expect(() => assertJwtSecret({ JWT_SECRET: secret })).not.toThrow();
      },
    );
  });

  describe.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['ตั้ง TRUST_PROXY (เปิด tunnel ตอนทดสอบ)', { TRUST_PROXY: '1' }],
  ])('%s', (_label, base) => {
    it.each([
      [undefined, 'ไม่ได้ตั้งค่า'],
      ['   ', 'ไม่ได้ตั้งค่า'],
      ['changeme', 'ยังเป็นค่าตัวอย่าง'],
      ['changeme-generate-a-real-secret', 'ยังเป็นค่าตัวอย่าง'],
      ['x'.repeat(MIN_JWT_SECRET_LENGTH - 1), 'สั้นกว่า'],
    ])('JWT_SECRET %p -> throw (%s)', (secret, reason) => {
      expect(() => assertJwtSecret({ ...base, JWT_SECRET: secret })).toThrow(
        reason,
      );
    });

    it(`ค่าสุ่มยาว ${MIN_JWT_SECRET_LENGTH} ตัวอักษรขึ้นไป -> ไม่ throw`, () => {
      expect(() =>
        assertJwtSecret({ ...base, JWT_SECRET: strongSecret }),
      ).not.toThrow();
    });
  });
});
