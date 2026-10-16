import * as bcrypt from 'bcrypt';
import { isExposedEnvironment } from './exposed-environment';

/**
 * กติกาของบัญชีทดสอบ (`*.test` ที่ `prisma/seed.ts` สร้าง) ที่ใช้ร่วมกัน 3 จุด:
 * seed, การตรวจตอน backend เริ่ม (main.ts) และสคริปต์ `test-users:set-password`
 *
 * ทำไมต้องมี: บัญชีทดสอบทุกบทบาท รวม `superadmin.test` ใช้รหัส `password123` ซึ่งอยู่ใน
 * โค้ดบน GitHub ตอนพัฒนาในเครื่องไม่เป็นไร แต่ถ้า backend เปิดสู่ภายนอก (deploy หรือเปิด
 * tunnel ตาม docs/19 หัวข้อ 10) ใครก็ login เป็น SuperAdmin ได้ แม้ `JWT_SECRET` จะเป็น
 * ค่าสุ่มแล้วก็ตาม ใช้กติกาเดียวกับ jwt-secret.ts คือ `isExposedEnvironment()`
 */

export const DEFAULT_TEST_USER_PASSWORD = 'password123';
export const TEST_USERNAME_SUFFIX = '.test';
export const MIN_TEST_USERS_PASSWORD_LENGTH = 12;

/** ตรวจรหัสที่จะตั้งให้บัญชีทดสอบ คืนข้อความ error หรือ `null` ถ้าใช้ได้
 * `password123` ใช้ได้เฉพาะตอนพัฒนาในเครื่อง (ไว้คืนค่าเดิมหลังทดสอบ) */
export function validateTestUsersPassword(
  password: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  const value = password ?? '';
  if (value === '') return 'ไม่ได้ตั้ง TEST_USERS_PASSWORD';
  if (value === DEFAULT_TEST_USER_PASSWORD) {
    return isExposedEnvironment(env)
      ? `TEST_USERS_PASSWORD ยังเป็น ${DEFAULT_TEST_USER_PASSWORD} ซึ่งใช้ไม่ได้เมื่อเปิดสู่ภายนอก`
      : null;
  }
  if (value.length < MIN_TEST_USERS_PASSWORD_LENGTH) {
    return `TEST_USERS_PASSWORD ต้องยาวอย่างน้อย ${MIN_TEST_USERS_PASSWORD_LENGTH} ตัวอักษร`;
  }
  return null;
}

export type TestUsersSeedPlan =
  { create: false; reason: string } | { create: true; password: string };

/**
 * seed ควรสร้างบัญชีทดสอบไหม และใช้รหัสอะไร
 *
 * - พัฒนาในเครื่อง: สร้างเหมือนเดิม รหัส `TEST_USERS_PASSWORD` ถ้าตั้งไว้ ไม่งั้น
 *   `password123` ปิดได้ด้วย `SEED_TEST_USERS=false`
 * - เปิดสู่ภายนอก: ไม่สร้าง เว้นแต่ `SEED_TEST_USERS=true` และตั้ง `TEST_USERS_PASSWORD`
 *   ที่ผ่าน `validateTestUsersPassword()` (เช่นเครื่องเดโม) ถ้าขอให้สร้างแต่รหัสใช้ไม่ได้
 *   throw ให้ seed หยุด ไม่สร้างด้วยรหัสที่ทุกคนรู้
 */
export function planTestUsersSeed(env: NodeJS.ProcessEnv): TestUsersSeedPlan {
  const flag = env.SEED_TEST_USERS?.trim().toLowerCase();

  if (!isExposedEnvironment(env)) {
    if (flag === 'false') {
      return { create: false, reason: 'SEED_TEST_USERS=false' };
    }
    const password = env.TEST_USERS_PASSWORD || DEFAULT_TEST_USER_PASSWORD;
    const error = validateTestUsersPassword(password, env);
    if (error) throw new Error(error);
    return { create: true, password };
  }

  if (flag !== 'true') {
    return {
      create: false,
      reason:
        'เปิดสู่ภายนอก (NODE_ENV=production หรือตั้ง TRUST_PROXY) ไม่สร้างบัญชีทดสอบ ' +
        'ตั้ง SEED_TEST_USERS=true พร้อม TEST_USERS_PASSWORD ถ้าต้องการ',
    };
  }
  const error = validateTestUsersPassword(env.TEST_USERS_PASSWORD, env);
  if (error) throw new Error(`SEED_TEST_USERS=true แต่ ${error}`);
  return { create: true, password: env.TEST_USERS_PASSWORD as string };
}

/** ส่วนของ PrismaClient ที่การตรวจตอนเริ่มต้องใช้ แยกไว้ให้เทสต์ส่ง mock ได้ */
export interface TestUserReader {
  user: {
    findMany: (args: {
      where: { username: { endsWith: string }; isActive: boolean };
      select: { username: true; passwordHash: true };
    }) => Promise<{ username: string; passwordHash: string }[]>;
  };
}

/**
 * ตรวจตอน backend เริ่ม (หลังต่อฐานข้อมูลได้ ก่อนรับคำขอ): เปิดสู่ภายนอกแล้วยังมีบัญชี
 * ทดสอบที่ใช้งานอยู่ใช้รหัส `password123` ให้ throw เพื่อไม่ให้ backend รัน
 *
 * จำเป็นแม้ seed จะไม่สร้างบัญชีทดสอบในโหมดนี้แล้ว เพราะฐานข้อมูลที่มีอยู่ (เช่นฐานข้อมูล
 * dev ที่ใช้ทดสอบด้วยมือถือ) มีบัญชีเหล่านี้อยู่ก่อน และ seed ไม่ลบหรือแก้ของเดิม
 */
export async function assertNoDefaultTestPasswords(
  reader: TestUserReader,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!isExposedEnvironment(env)) return;

  const users = await reader.user.findMany({
    where: { username: { endsWith: TEST_USERNAME_SUFFIX }, isActive: true },
    select: { username: true, passwordHash: true },
  });
  const offenders: string[] = [];
  for (const u of users) {
    if (await bcrypt.compare(DEFAULT_TEST_USER_PASSWORD, u.passwordHash)) {
      offenders.push(u.username);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `ยังมีบัญชีทดสอบที่ใช้รหัส ${DEFAULT_TEST_USER_PASSWORD} (${offenders.join(', ')}) ` +
        `แต่ backend กำลังรันแบบที่คนภายนอกเข้าถึงได้ (NODE_ENV=production หรือตั้ง TRUST_PROXY) ` +
        `ใครก็ login เป็นบัญชีเหล่านี้ได้ ให้ตั้ง TEST_USERS_PASSWORD ใน .env แล้วรัน ` +
        `npm run test-users:set-password ในโฟลเดอร์ backend`,
    );
  }
}
