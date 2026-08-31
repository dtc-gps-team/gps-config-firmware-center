import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, makeUser, resetDb } from './setup';

const TEST_JWT_SECRET = 'itest-secret';

function buildService(prisma: PrismaClient): AuthService {
  const jwtService = new JwtService({ secret: TEST_JWT_SECRET });
  return new AuthService(prisma as unknown as PrismaService, jwtService);
}

describe('AuthService (integration — real postgres)', () => {
  let prisma: PrismaClient;
  let service: AuthService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = buildService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('login สำเร็จ: query User+Role จริง, bcrypt.compare ผ่านจริง, JWT verify กลับมาได้ payload {sub, role: role.code}', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const user = await makeUser(prisma, {
      username: 'itest.sw',
      role: 'SW',
      passwordHash,
    });

    const result = await service.login('itest.sw', 'correct-password');

    expect(result.role).toBe('SW');

    const jwtService = new JwtService({ secret: TEST_JWT_SECRET });
    const decoded = jwtService.verify<{ sub: string; role: string }>(
      result.accessToken,
    );
    expect(decoded.sub).toBe(user.id);
    expect(decoded.role).toBe('SW');
  });

  it('password ผิด → 401 (แม้ username มีจริง)', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    await makeUser(prisma, { username: 'itest.wrong-pw', passwordHash });

    await expect(
      service.login('itest.wrong-pw', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('username ไม่มีในระบบ → 401', async () => {
    await expect(
      service.login('no-such-user', 'anything'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('user ถูกปิดใช้งาน (isActive=false) → 401 แม้ password ถูก', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const user = await makeUser(prisma, {
      username: 'itest.disabled',
      passwordHash,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    await expect(
      service.login('itest.disabled', 'correct-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
