import { INestApplication } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Incident, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConfigSyncWriterQueue } from '../../src/config-sync-writer/config-sync-writer-queue.service';
import { ConfigModule } from '../../src/config/config.module';
import { ActingUser, ConfigService } from '../../src/config/config.service';
import { IncidentModule } from '../../src/incident/incident.module';
import { INCIDENT_SOURCE } from '../../src/incident/incident-metadata';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * config-sync-writer wiring (docs/07 §5, มติ #32 §9.5) — เชื่อม
 * `ConfigService.approve()` -> `ConfigSyncWriterQueue.enqueueConfigSync()` และ
 * `IncidentModule` ที่ฟัง `'sync-failed'` สร้าง Incident อัตโนมัติ · รันบน
 * postgres จริง + DI graph จริง (mock writer โหมด default)
 */
describe('config-sync-writer wiring (integration — real postgres + DI graph)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let configService: ConfigService;
  let queue: ConfigSyncWriterQueue;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigModule,
        IncidentModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init(); // trigger onModuleInit -> IncidentService ผูก listener

    configService = moduleFixture.get(ConfigService);
    queue = moduleFixture.get(ConfigSyncWriterQueue);
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function makeOperator(): Promise<ActingUser> {
    const op = await makeUser(prisma, { role: 'Operation' });
    return { id: op.id, role: 'Operation' };
  }

  async function makeTestingConfig(
    fields: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const sw = await makeUser(prisma, { role: 'SW' });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'testing',
        fields: fields as Prisma.InputJsonValue,
        createdBy: sw.id,
      },
    });
    return { id: config.id };
  }

  async function waitForIncident(
    where: Partial<Pick<Incident, 'relatedConfigId' | 'source'>>,
    timeoutMs = 6000,
  ): Promise<Incident | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await prisma.incident.findFirst({ where });
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  it('approve config ที่มี fields -> mock writer สำเร็จ ไม่มี Incident', async () => {
    const op = await makeOperator();
    const { id } = await makeTestingConfig({ APN: 'internet' });

    const approved = await configService.approve(id, op);
    expect(approved.status).toBe('approved');

    // ให้ job (fire-and-forget) มีเวลารันจนจบ
    await new Promise((r) => setTimeout(r, 300));
    const incidentCount = await prisma.incident.count();
    expect(incidentCount).toBe(0);
  });

  it("emit 'sync-failed' บน queue -> IncidentModule สร้าง Incident ตาม shape", async () => {
    const { id } = await makeTestingConfig({ APN: 'internet' });

    queue.emit('sync-failed', {
      configId: id,
      versionNumber: 2,
      deviceModel: 'GT06N',
      protocol: 'TCP',
      attempts: 3,
      lastError: 'connection refused',
    });

    const incident = await waitForIncident({ relatedConfigId: id });
    expect(incident).not.toBeNull();
    expect(incident?.source).toBe(INCIDENT_SOURCE.configSyncWriter);
    expect(incident?.severity).toBe('high');
    expect(incident?.status).toBe('open');
    expect(incident?.metadata).toEqual({
      versionNumber: 2,
      attempts: 3,
      lastError: 'connection refused',
    });
  });

  it('approve config ที่ fields ว่าง -> mock writer reject -> retry ครบ -> สร้าง Incident', async () => {
    const op = await makeOperator();
    const { id } = await makeTestingConfig({});

    const approved = await configService.approve(id, op);
    expect(approved.status).toBe('approved'); // approve ต้องสำเร็จเสมอ ไม่รอ sync

    const incident = await waitForIncident({
      relatedConfigId: id,
      source: INCIDENT_SOURCE.configSyncWriter,
    });
    expect(incident).not.toBeNull();
    expect((incident?.metadata as { attempts?: number } | null)?.attempts).toBe(
      3,
    );
  }, 15000);
});
