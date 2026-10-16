/**
 * ตั้งรหัสผ่านของบัญชีทดสอบทุกบัญชี (`*.test`) เป็นค่าใน `TEST_USERS_PASSWORD`
 *
 *   npm run test-users:set-password   (ในโฟลเดอร์ backend)
 *
 * ใช้ก่อนเปิด tunnel ทดสอบด้วยมือถือ (docs/19 หัวข้อ 10) เพราะฐานข้อมูล dev มีบัญชีทดสอบ
 * รหัส password123 อยู่แล้ว และ backend จะไม่ยอมเริ่มในโหมดเปิดสู่ภายนอกจนกว่าจะเปลี่ยน
 * (src/common/test-users.ts) หลังทดสอบตั้ง `TEST_USERS_PASSWORD=password123` แล้วรันซ้ำ
 * เพื่อคืนค่าเดิมได้ (ยอมเฉพาะตอนไม่ได้อยู่ในโหมดเปิดสู่ภายนอก)
 *
 * ไม่แสดงรหัสออกมา บอกแค่จำนวนบัญชีที่เปลี่ยน ไม่ลง Audit Log เพราะเป็นเครื่องมือของ
 * ผู้ดูแลเครื่องสำหรับบัญชีทดสอบเท่านั้น (เหมือน seed)
 */
import '../src/load-env';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  TEST_USERNAME_SUFFIX,
  validateTestUsersPassword,
} from '../src/common/test-users';

async function main(): Promise<void> {
  const password = process.env.TEST_USERS_PASSWORD;
  const error = validateTestUsersPassword(password, process.env);
  if (error) {
    throw new Error(`${error} ตั้งค่าใน .env ที่ root ของโปรเจกต์ก่อน`);
  }

  const prisma = new PrismaClient();
  try {
    const result = await prisma.user.updateMany({
      where: { username: { endsWith: TEST_USERNAME_SUFFIX } },
      data: { passwordHash: await bcrypt.hash(password as string, 10) },
    });
    console.log(
      `ตั้งรหัสผ่านใหม่ให้บัญชีทดสอบ ${result.count} บัญชี (รหัสอยู่ใน TEST_USERS_PASSWORD ของ .env)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
