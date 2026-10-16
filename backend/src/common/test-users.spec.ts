import * as bcrypt from 'bcrypt';
import {
  DEFAULT_TEST_USER_PASSWORD,
  MIN_TEST_USERS_PASSWORD_LENGTH,
  TestUserReader,
  assertNoDefaultTestPasswords,
  planTestUsersSeed,
  validateTestUsersPassword,
} from './test-users';

const DEV = {};
const EXPOSED = { TRUST_PROXY: '1' };
const strongPassword = 'y'.repeat(MIN_TEST_USERS_PASSWORD_LENGTH);

describe('validateTestUsersPassword', () => {
  it('ไม่ได้ตั้ง -> error', () => {
    expect(validateTestUsersPassword(undefined, DEV)).toMatch('ไม่ได้ตั้ง');
    expect(validateTestUsersPassword('', DEV)).toMatch('ไม่ได้ตั้ง');
  });

  it('password123 ตอนพัฒนา -> ใช้ได้ (ไว้คืนค่าเดิมหลังทดสอบ)', () => {
    expect(
      validateTestUsersPassword(DEFAULT_TEST_USER_PASSWORD, DEV),
    ).toBeNull();
  });

  it('password123 ตอนเปิดสู่ภายนอก -> error', () => {
    expect(
      validateTestUsersPassword(DEFAULT_TEST_USER_PASSWORD, EXPOSED),
    ).toMatch('ใช้ไม่ได้เมื่อเปิดสู่ภายนอก');
  });

  it(`สั้นกว่า ${MIN_TEST_USERS_PASSWORD_LENGTH} ตัวอักษร -> error ทั้งสองโหมด`, () => {
    const short = 'y'.repeat(MIN_TEST_USERS_PASSWORD_LENGTH - 1);
    expect(validateTestUsersPassword(short, DEV)).toMatch('อย่างน้อย');
    expect(validateTestUsersPassword(short, EXPOSED)).toMatch('อย่างน้อย');
  });

  it('รหัสยาวพอ -> ใช้ได้ทั้งสองโหมด', () => {
    expect(validateTestUsersPassword(strongPassword, DEV)).toBeNull();
    expect(validateTestUsersPassword(strongPassword, EXPOSED)).toBeNull();
  });
});

describe('planTestUsersSeed', () => {
  describe('พัฒนาในเครื่อง (พฤติกรรมเดิม)', () => {
    it('ไม่ได้ตั้งอะไร -> สร้าง รหัส password123 เหมือนเดิม', () => {
      expect(planTestUsersSeed(DEV)).toEqual({
        create: true,
        password: DEFAULT_TEST_USER_PASSWORD,
      });
    });

    it('ตั้ง TEST_USERS_PASSWORD -> สร้างด้วยรหัสนั้น', () => {
      expect(
        planTestUsersSeed({ TEST_USERS_PASSWORD: strongPassword }),
      ).toEqual({ create: true, password: strongPassword });
    });

    it('SEED_TEST_USERS=false -> ไม่สร้าง', () => {
      expect(planTestUsersSeed({ SEED_TEST_USERS: 'false' }).create).toBe(
        false,
      );
    });
  });

  describe('เปิดสู่ภายนอก', () => {
    it.each([
      [{ NODE_ENV: 'production' }],
      [{ TRUST_PROXY: '1' }],
      [{ TRUST_PROXY: '1', TEST_USERS_PASSWORD: strongPassword }],
    ])('ไม่ได้ตั้ง SEED_TEST_USERS=true (%p) -> ไม่สร้าง', (env) => {
      expect(planTestUsersSeed(env).create).toBe(false);
    });

    it('SEED_TEST_USERS=true + รหัสที่ตั้งเอง -> สร้างด้วยรหัสนั้น', () => {
      expect(
        planTestUsersSeed({
          ...EXPOSED,
          SEED_TEST_USERS: 'true',
          TEST_USERS_PASSWORD: strongPassword,
        }),
      ).toEqual({ create: true, password: strongPassword });
    });

    it.each([undefined, DEFAULT_TEST_USER_PASSWORD, 'short'])(
      'SEED_TEST_USERS=true แต่รหัส %p ใช้ไม่ได้ -> throw ไม่สร้างด้วยรหัสที่ทุกคนรู้',
      (password) => {
        expect(() =>
          planTestUsersSeed({
            ...EXPOSED,
            SEED_TEST_USERS: 'true',
            TEST_USERS_PASSWORD: password,
          }),
        ).toThrow('SEED_TEST_USERS=true');
      },
    );
  });
});

describe('assertNoDefaultTestPasswords', () => {
  let defaultHash: string;
  let otherHash: string;

  beforeAll(async () => {
    defaultHash = await bcrypt.hash(DEFAULT_TEST_USER_PASSWORD, 4);
    otherHash = await bcrypt.hash(strongPassword, 4);
  });

  function readerOf(
    users: { username: string; passwordHash: string }[],
  ): TestUserReader & { user: { findMany: jest.Mock } } {
    return { user: { findMany: jest.fn().mockResolvedValue(users) } };
  }

  it('พัฒนาในเครื่อง -> ไม่ตรวจเลย ไม่แตะฐานข้อมูล', async () => {
    const reader = readerOf([
      { username: 'admin.test', passwordHash: defaultHash },
    ]);

    await expect(
      assertNoDefaultTestPasswords(reader, DEV),
    ).resolves.toBeUndefined();
    expect(reader.user.findMany).not.toHaveBeenCalled();
  });

  it('เปิดสู่ภายนอก + ยังมีบัญชีทดสอบรหัส password123 -> throw พร้อมรายชื่อบัญชี', async () => {
    const reader = readerOf([
      { username: 'admin.test', passwordHash: defaultHash },
      { username: 'st.test', passwordHash: otherHash },
      { username: 'superadmin.test', passwordHash: defaultHash },
    ]);

    await expect(assertNoDefaultTestPasswords(reader, EXPOSED)).rejects.toThrow(
      /admin\.test, superadmin\.test/,
    );
  });

  it('เปิดสู่ภายนอก + เปลี่ยนรหัสแล้วทุกบัญชี -> ผ่าน', async () => {
    const reader = readerOf([
      { username: 'admin.test', passwordHash: otherHash },
    ]);

    await expect(
      assertNoDefaultTestPasswords(reader, EXPOSED),
    ).resolves.toBeUndefined();
  });

  it('ตรวจเฉพาะบัญชี *.test ที่ยังใช้งานอยู่', async () => {
    const reader = readerOf([]);

    await assertNoDefaultTestPasswords(reader, EXPOSED);

    expect(reader.user.findMany).toHaveBeenCalledWith({
      where: { username: { endsWith: '.test' }, isActive: true },
      select: { username: true, passwordHash: true },
    });
  });
});
