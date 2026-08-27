import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Single source of truth: the repo-root .env (see .env.example from Sprint 0).
// The backend package has no local .env — Prisma reads DATABASE_URL from ../.env.
loadEnv({ path: path.resolve(__dirname, '../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
