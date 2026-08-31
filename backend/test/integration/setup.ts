import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient, Role } from '@prisma/client';

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
 * `getOrCreateRole` below, which finds-or-creates a Role row on demand.
 * `RolePermission` rows ARE test-specific (permission-guard tests grant/revoke
 * them per test) — tests that touch them clean up their own rows explicitly
 * (see permission-guard-http.integration-spec.ts) since not every suite uses
 * RolePermission at all.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.task.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.device.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

let seq = 0;

export type RoleCode = 'SW' | 'Operation' | 'ST' | 'OT' | 'Auditor' | 'Admin';

/**
 * Find-or-create a Role row by code. Role is a real table now (not a Postgres
 * enum — see backend/prisma/schema.prisma), so `User.roleId` needs an actual
 * row to point at instead of a literal string. Exported (not just used
 * internally by `makeUser`) so permission-guard tests can grab the same Role
 * row to attach `RolePermission` grants to.
 */
export async function getOrCreateRole(
  prisma: PrismaClient,
  code: RoleCode,
): Promise<Role> {
  return prisma.role.upsert({
    where: { code },
    update: {},
    create: { code, name: code },
  });
}

/** Create a User row to hang Tasks / Notifications off of. */
export async function makeUser(
  prisma: PrismaClient,
  overrides: Partial<{
    username: string;
    role: RoleCode;
    // ปกติไม่ต้องใช้จริง ('x' พอสำหรับ Task/Notification ที่ไม่ต้อง login จริง) —
    // ใส่ hash จริง (bcrypt.hash(...)) เฉพาะตอนเทส auth.service ที่ต้อง bcrypt.compare ผ่านจริง
    passwordHash: string;
  }> = {},
) {
  seq += 1;
  const role = await getOrCreateRole(prisma, overrides.role ?? 'OT');
  return prisma.user.create({
    data: {
      username: overrides.username ?? `itest-user-${Date.now()}-${seq}`,
      passwordHash: overrides.passwordHash ?? 'x',
      fullName: 'Integration Test User',
      roleId: role.id,
    },
  });
}
