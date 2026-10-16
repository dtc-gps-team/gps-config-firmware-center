import {
  MIN_INITIAL_ADMIN_PASSWORD_LENGTH,
  planInitialAdmin,
} from './initial-admin';

const strongPassword = 'z'.repeat(MIN_INITIAL_ADMIN_PASSWORD_LENGTH);

describe('planInitialAdmin', () => {
  it('ไม่ได้ตั้งทั้งคู่ -> null (ไม่สร้าง)', () => {
    expect(planInitialAdmin({})).toBeNull();
  });

  it('ตั้งครบและรหัสยาวพอ -> คืนชื่อและรหัส (ตัดช่องว่างของชื่อ)', () => {
    expect(
      planInitialAdmin({
        INITIAL_ADMIN_USERNAME: ' owner ',
        INITIAL_ADMIN_PASSWORD: strongPassword,
      }),
    ).toEqual({ username: 'owner', password: strongPassword });
  });

  it.each([
    [{ INITIAL_ADMIN_USERNAME: 'owner' }],
    [{ INITIAL_ADMIN_PASSWORD: strongPassword }],
  ])('ตั้งไม่ครบ (%p) -> throw', (env) => {
    expect(() => planInitialAdmin(env)).toThrow('ทั้งคู่');
  });

  it(`รหัสสั้นกว่า ${MIN_INITIAL_ADMIN_PASSWORD_LENGTH} ตัวอักษร -> throw`, () => {
    expect(() =>
      planInitialAdmin({
        INITIAL_ADMIN_USERNAME: 'owner',
        INITIAL_ADMIN_PASSWORD: 'short',
      }),
    ).toThrow('อย่างน้อย');
  });
});
