import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // เพิ่มใหม่: web (localhost:3000) กับ backend (localhost:3001) อยู่คนละ
  // origin กัน ถ้าไม่เปิด CORS ตรงนี้ browser จะบล็อก response ตอน web เรียก
  // fetch() ข้าม origin (แม้ NEXT_PUBLIC_API_BASE_URL จะตั้งถูกแล้วก็ตาม) —
  // origin มาจาก env WEB_ORIGIN เผื่อ deploy จริงพอร์ต/โดเมนไม่ตรงกับ dev
  // .trim() กันเคส WEB_ORIGIN มีช่องว่างหลัง comma (เช่น "a.com, b.com") ที่จะ
  // ทำให้ตัวถัดไปเหลือ " b.com" แล้วโดนบล็อกแบบเงียบๆ (พบจาก review PR #48)
  app.enableCors({
    origin:
      process.env.WEB_ORIGIN?.split(',').map((o) => o.trim()) ??
      'http://localhost:3000',
    // ไม่เปิด credentials: web ใช้ Bearer token ผ่าน Authorization header
    // (เก็บใน localStorage) ไม่ได้ใช้ cookie เลย — ดู web/src/lib/api.ts
    // ถ้าเปลี่ยนไปใช้ cookie-based session ทีหลังค่อยเปิดเป็น true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
