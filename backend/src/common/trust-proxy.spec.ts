import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it.each([undefined, '', '  ', '0', 'false', 'FALSE'])(
    'ค่า %p -> ปิด (false) เหมือนพฤติกรรมเดิม',
    (raw) => {
      expect(resolveTrustProxy(raw)).toBe(false);
    },
  );

  it.each([
    ['1', 1],
    [' 2 ', 2],
  ])('จำนวนเต็มบวก %p -> จำนวน proxy %p', (raw, expected) => {
    expect(resolveTrustProxy(raw)).toBe(expected);
  });

  it.each(['true', 'yes', '-1', '1.5', 'loopback', '01'])(
    'ค่าที่ไม่ชัดเจน %p -> throw ตอน startup ไม่เดาเอง',
    (raw) => {
      expect(() => resolveTrustProxy(raw)).toThrow('TRUST_PROXY');
    },
  );
});

/**
 * ตรวจกับ Express จริงว่า `req.ip` ที่ controller เห็น (ตัวเดียวกับที่ส่งเข้า
 * Audit Log) เปลี่ยนตามค่าที่ตั้ง — ปิด: ไม่เชื่อ X-Forwarded-For (กันปลอม IP)
 * เปิด 1 hop: ใช้ IP ของผู้ใช้ที่ proxy ส่งต่อมา
 */
@Controller()
class IpEchoController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function appWith(
  raw: string | undefined,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [IpEchoController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const trust = resolveTrustProxy(raw);
  if (trust !== false) app.set('trust proxy', trust);
  await app.init();
  return app;
}

describe('trust proxy กับ req.ip จริง', () => {
  let app: INestApplication<App> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('ไม่ตั้ง TRUST_PROXY: ไม่เชื่อ X-Forwarded-For ที่ client ส่งมาเอง', async () => {
    app = await appWith(undefined);

    const res = await request(app.getHttpServer())
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.9');

    expect((res.body as { ip: string }).ip).not.toBe('203.0.113.9');
  });

  it('TRUST_PROXY=1: ใช้ IP ของผู้ใช้ที่ proxy ส่งต่อมา', async () => {
    app = await appWith('1');

    const res = await request(app.getHttpServer())
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.9');

    expect((res.body as { ip: string }).ip).toBe('203.0.113.9');
  });
});
