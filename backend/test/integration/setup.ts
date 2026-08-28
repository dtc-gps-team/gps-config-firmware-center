import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Integration tests read the repo-root .env (same convention as prisma.config.ts).
loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const rawUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

/**
 * Safety guard — these tests call `deleteMany()` on every run, so refuse to
 * touch anything that is not an explicit `*_test` database. In CI `DATABASE_URL`
 * already points at `gps_config_firmware_test`; locally set `DATABASE_URL_TEST`
 * (see `.env.example`).
 */
function assertTestDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error(
      'Integration tests need DATABASE_URL_TEST (or a *_test DATABASE_URL). ' +
        'See .env.example.',
    );
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}" — the database ` +
        'name must end with "_test". Set DATABASE_URL_TEST.',
    );
  }
  return url;
}

export const TEST_DATABASE_URL = assertTestDatabase(rawUrl);

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
}

/** Wipe every table these tests write to, honouring FK order (children first). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.task.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
}

let seq = 0;

/** Create a User row to hang Tasks / Notifications off of. */
export function makeUser(
  prisma: PrismaClient,
  overrides: Partial<{
    username: string;
    role: 'SW' | 'Operation' | 'ST' | 'OT' | 'Auditor' | 'Admin';
  }> = {},
) {
  seq += 1;
  return prisma.user.create({
    data: {
      username: overrides.username ?? `itest-user-${Date.now()}-${seq}`,
      passwordHash: 'x',
      fullName: 'Integration Test User',
      role: overrides.role ?? 'OT',
    },
  });
}
