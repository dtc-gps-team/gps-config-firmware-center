/**
 * โหลด `.env` ที่ root ของ repo เข้า `process.env` **ก่อน import module อื่นทั้งหมด**
 * (main.ts import ไฟล์นี้เป็นบรรทัดแรก)
 *
 * ทำไมต้องมี: `JwtModule.register({ secret: process.env.JWT_SECRET ?? 'changeme' })`
 * ใน `AuthModule` และ `TaskModule` อ่านค่าตอนไฟล์ถูก import ซึ่งเกิดก่อน
 * `ConfigModule.forRoot()` ใน `AppModule` จะโหลด `.env` เดิมจึงได้ `'changeme'` เสมอ
 * แม้ `.env` จะตั้ง `JWT_SECRET` ไว้แล้ว (token ทุกตัว sign ด้วยค่าที่ใครก็รู้) โหลดก่อน
 * ตรงนี้จุดเดียว แก้ได้ทุก module โดยไม่ต้องแก้ไฟล์ของแต่ละ module
 *
 * path ใช้ `../.env` เทียบกับ cwd แบบเดียวกับ `envFilePath` ของ `ConfigModule.forRoot()`
 * ไม่ override ค่าที่ตั้งจาก shell หรือ container อยู่แล้ว ไม่มีไฟล์ก็ข้ามไปเงียบๆ
 * (เช่นใน Docker ที่ส่ง env ผ่าน compose)
 */
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
