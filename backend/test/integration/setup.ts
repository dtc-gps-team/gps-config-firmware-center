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

/**
 * Wipe every table these tests write to, honouring FK order (children first).
 * `Role` is reference data (not test-specific), not something tests create
 * fresh each run, so it is intentionally left alone here — see
 * `getOrCreateRoleId` below, which finds-or-creates a Role row on demand.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.task.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
}

let seq = 0;

type RoleCode = 'SW' | 'Operation' | 'ST' | 'OT' | 'Auditor' | 'Admin';

/**
 * Find-or-create a Role row by code. Role is a real table now (not a Postgres
 * enum — see backend/prisma/schema.prisma), so `User.roleId` needs an actual
 * row to point at instead of a literal string.
 */
async function getOrCreateRoleId(
  prisma: PrismaClient,
  code: RoleCode,
): Promise<string> {
  const role = await prisma.role.upsert({
    where: { code },
    update: {},
    create: { code, name: code },
  });
  return role.id;
}

/** Create a User row to hang Tasks / Notifications off of. */
export async function makeUser(
  prisma: PrismaClient,
  overrides: Partial<{
    username: string;
    role: RoleCode;
  }> = {},
) {
  seq += 1;
  const roleId = await getOrCreateRoleId(prisma, overrides.role ?? 'OT');
  return prisma.user.create({
    data: {
      username: overrides.username ?? `itest-user-${Date.now()}-${seq}`,
      passwordHash: 'x',
      fullName: 'Integration Test User',
      roleId,
    },
  });
}
