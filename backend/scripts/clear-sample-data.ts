import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// รันผ่าน plain `ts-node` จึงต้องโหลด root .env เอง เหมือน seed-demo.ts
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * ล้างข้อมูลตัวอย่างที่ `prisma db seed` ใส่มา (ลูกค้า อุปกรณ์ โมเดล Config Firmware) ออกจาก
 * **ฐานข้อมูลสำหรับเดโมโดยเฉพาะ** เหลือบัญชีทดสอบ สิทธิ์ และ Parameter Library ไว้ — ให้เดโมเริ่มจากระบบสะอาด
 * มีแต่ข้อมูลจริงที่ลงทะเบียนเอง
 *
 * **ปลอดภัยโดยการกันชื่อฐานข้อมูล:** ทำงานเฉพาะเมื่อชื่อฐานข้อมูลลงท้าย `_demo` เท่านั้น ถ้าไม่ใช่จะหยุดทันที
 * (ห้ามใช้กับฐานข้อมูล dev ปกติ) ใช้ `TRUNCATE ... CASCADE` จึงล้างตารางที่อ้างถึงตารางเหล่านี้ด้วย
 *
 * ขั้นตอนสร้างฐานข้อมูลเดโม (ไม่แตะฐานข้อมูล dev เดิม):
 *   1. สร้างฐานข้อมูลเปล่าชื่อลงท้าย _demo (เช่น gps_demo) แล้วตั้ง DATABASE_URL ชี้ไปที่นั่น
 *   2. npx prisma migrate deploy && npx prisma db seed
 *   3. npm run clear:sample-data
 *   4. npm run import:central-schema -- --model ESP32-DEVKIT-V1 --version 3
 */
const TABLES = ['Device', 'Customer', 'Config', 'Firmware', 'DeviceModel'];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = decodeURIComponent(
    new URL(url).pathname.replace(/^\//, '').split('?')[0],
  );
  if (!dbName.endsWith('_demo')) {
    throw new Error(
      `ปฏิเสธ: ฐานข้อมูล "${dbName}" ไม่ได้ลงท้ายด้วย _demo สคริปต์นี้ล้างข้อมูลจริง ใช้ได้กับฐานข้อมูลเดโมเท่านั้น`,
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('clear-sample-data.ts ห้ามรันบน production');
  }

  const prisma = new PrismaClient();
  try {
    const list = TABLES.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
    console.log(
      `ล้างข้อมูลตัวอย่างใน ${dbName} แล้ว: ${TABLES.join(', ')} (และตารางที่อ้างถึง)`,
    );
    const users = await prisma.user.count();
    const defs = await prisma.configFieldDefinition.count();
    console.log(
      `เหลือ: ผู้ใช้ ${users} บัญชี, พารามิเตอร์ใน Parameter Library ${defs} ตัว`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
