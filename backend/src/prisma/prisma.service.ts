import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // issue #157 PR 1 — `Device.apiKeyHash` (credential, mirror `User.passwordHash`)
    // ไม่ select ออกมาเองโดย default ทุก query ทั่วทั้งระบบ กัน `GET /devices`/
    // `GET /devices/{id}` ที่ทุก Role อ่านได้ (`DeviceService.findAll`/
    // `findByDeviceId` คืน Device เต็มไม่มี select อยู่แล้ว) รั่ว hash ออกไปโดย
    // ไม่ตั้งใจเวลามี field credential ใหม่ — จุดเดียวที่ต้องอ่านค่าจริง
    // (`DeviceApiKeyGuard`) override กลับเป็น query เดียวด้วย
    // `omit: { apiKeyHash: false }`
    super({ omit: { device: { apiKeyHash: true } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
