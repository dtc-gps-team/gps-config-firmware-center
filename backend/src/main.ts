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
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
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
