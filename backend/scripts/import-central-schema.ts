import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  type CentralSchemaDoc,
  planCentralSchemaImport,
  resolveImportTargetModel,
} from '../src/central-device/central-schema-import';

// รันผ่าน plain `ts-node` (ไม่ผ่าน prisma.config.ts) จึงต้องโหลด root .env เอง เหมือน seed-demo.ts
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * นำ schema ของกล่องจาก Server กลาง (ESP32 Central Management) เข้า Parameter Library ของเรา
 * เพื่อสร้าง Config สำหรับกล่องด้วยชื่อพารามิเตอร์ตัวเดียวกับที่ Server กลางรับ
 *
 *   npm run import:central-schema -- --model ESP32-DEVKIT-V1 --version 3 --as GPS-BOX-V1
 *   npm run import:central-schema -- --file ../mentor/delivery-server/schemas/ESP32-DEVKIT-V1/1.json --as GPS-BOX-V1
 *
 * - ดึงจาก Server กลางจริงด้วย `CENTRAL_BASE_URL` / `CENTRAL_ADMIN_USERNAME` / `CENTRAL_ADMIN_PASSWORD`
 *   (ค่าเดียวกับที่ backend ใช้ · อ่านอย่างเดียว ไม่สั่งอะไรกับกล่อง) หรืออ่านจากไฟล์ด้วย `--file`
 * - `--model` คือชื่อบอร์ดที่ Server กลางใช้ (`hardware_model`) · `--as` คือชื่อรุ่นในทะเบียนของเรา
 *   ที่จะผูกพารามิเตอร์ (ชื่อต่างกันได้ เช่นบอร์ด ESP32-DEVKIT-V1 = รุ่น GPS-BOX-V1 ในฐานที่ใช้ร่วมกัน)
 *   ไม่ระบุ `--as` -> ใช้รุ่นชื่อเดียวกับบอร์ด ถ้าไม่มีรุ่นชื่อนั้นสคริปต์จะหยุด ไม่สร้างรุ่นซ้ำเงียบๆ
 *   (ดู `resolveImportTargetModel()`) · รุ่นที่ยังไม่มีถูกสร้างด้วยโปรโตคอลเดียวคือ `--protocol`
 *   (ค่าเริ่มต้น HTTP) แล้วผูก `ConfigFieldDefinition` ของทุกพารามิเตอร์กับรุ่นนั้น
 * - รันซ้ำได้: พารามิเตอร์ที่มีอยู่แล้วอัปเดตป้าย/ค่าเริ่มต้น/ตัวเลือก ไม่สร้างซ้ำ ไม่ลบของเดิม
 *   และไม่แตะบัญชีหรือข้อมูลอื่น · เวอร์ชัน schema ที่สูงกว่ามีพารามิเตอร์เพิ่ม รันอีกครั้งด้วยเวอร์ชันใหม่ได้
 * - ใช้ `--dry-run` เพื่อดูแผนและรุ่นที่จะผูกโดยไม่เขียนฐานข้อมูล (ยังอ่านรายชื่อรุ่นจากฐาน)
 * - `min`/`max` ของพารามิเตอร์ตัวเลขเก็บเป็น `minValue`/`maxValue` (docs/30) ให้ระบบตรวจขอบเขตตั้งแต่ตอนกรอก
 * - `--st-overridable a,b` เปิดให้ช่างแก้ field เหล่านั้นผ่าน Override (ไม่ระบุ = ไม่แตะค่าเดิม)
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function fetchSchema(
  model: string,
  version: string,
): Promise<CentralSchemaDoc> {
  const base = process.env.CENTRAL_BASE_URL;
  const username = process.env.CENTRAL_ADMIN_USERNAME;
  const password = process.env.CENTRAL_ADMIN_PASSWORD;
  if (!base || !username || !password) {
    throw new Error(
      'ต้องตั้ง CENTRAL_BASE_URL, CENTRAL_ADMIN_USERNAME, CENTRAL_ADMIN_PASSWORD (หรือใช้ --file)',
    );
  }
  const timeout = AbortSignal.timeout(8000);
  const login = await fetch(new URL('/api/login', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: timeout,
  });
  if (!login.ok)
    throw new Error(`เข้าสู่ระบบ Server กลางไม่สำเร็จ (HTTP ${login.status})`);
  const { token } = (await login.json()) as { token?: string };
  if (!token) throw new Error('Server กลางไม่ส่ง token กลับมา');
  const res = await fetch(
    new URL(`/api/admin/schemas/${encodeURIComponent(model)}/${version}`, base),
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error(`ดึง schema ไม่สำเร็จ (HTTP ${res.status})`);
  return (await res.json()) as CentralSchemaDoc;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('import-central-schema.ts ห้ามรันบน production');
  }
  const file = arg('file');
  // docs/30 — field ที่เปิดให้ช่าง (ST) แก้ผ่าน Override คั่นด้วย comma
  // เช่น --st-overridable speed_limit.max_kmh,speed_limit.enabled
  const stOverridable = new Set(
    (arg('st-overridable') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );
  const schema: CentralSchemaDoc = file
    ? (JSON.parse(
        fs.readFileSync(path.resolve(file), 'utf-8'),
      ) as CentralSchemaDoc)
    : await fetchSchema(
        arg('model') ?? 'ESP32-DEVKIT-V1',
        arg('version') ?? '1',
      );
  const protocol = arg('protocol') ?? 'HTTP';

  const plan = planCentralSchemaImport(schema);
  console.log(
    `schema ${schema.hardware_model} เวอร์ชัน ${schema.schema_version}: นำเข้า ${plan.definitions.length} พารามิเตอร์`,
  );
  for (const s of plan.skipped) console.log(`  ข้าม ${s.key}: ${s.reason}`);
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.deviceModel.findMany({
      select: { name: true },
    });
    const target = resolveImportTargetModel(
      schema.hardware_model,
      arg('as'),
      existing.map((m) => m.name),
    );
    if ('error' in target) throw new Error(target.error);
    console.log(
      `ผูกกับรุ่น ${target.name}${target.create ? ' (สร้างใหม่)' : ''}`,
    );

    if (flag('dry-run')) {
      for (const d of plan.definitions) {
        console.log(
          `  ${d.fieldName} (${d.dataType}${d.unit ? `, ${d.unit}` : ''})`,
        );
      }
      console.log('dry-run: ไม่ได้เขียนฐานข้อมูล');
      return;
    }

    const model = await prisma.deviceModel.upsert({
      where: { name: target.name },
      update: {},
      create: { name: target.name, supportedProtocols: [protocol] },
    });
    console.log(
      `โมเดล ${model.name} (โปรโตคอล ${model.supportedProtocols.join(', ')})`,
    );

    for (const def of plan.definitions) {
      const row = await prisma.configFieldDefinition.upsert({
        where: { fieldName: def.fieldName },
        // อัปเดตเฉพาะ metadata ที่มาจาก schema ไม่แตะ stOverridable ที่ผู้ใช้ตั้งเอง
        update: {
          dataType: def.dataType,
          allowedValues: def.allowedValues,
          description: def.description,
          unit: def.unit,
          category: def.category,
          defaultValue: def.defaultValue,
          minValue: def.minValue,
          maxValue: def.maxValue,
          // เปิดให้ช่างแก้ผ่าน Override เฉพาะที่ระบุใน --st-overridable (docs/30)
          // ไม่ระบุ = ไม่แตะค่าที่ตั้งไว้เดิม
          ...(stOverridable.has(def.fieldName) ? { stOverridable: true } : {}),
        },
        create: { ...def, stOverridable: stOverridable.has(def.fieldName) },
      });
      await prisma.configFieldDefinitionModelSupport.upsert({
        where: {
          fieldDefinitionId_deviceModel_protocol: {
            fieldDefinitionId: row.id,
            deviceModel: model.name,
            protocol,
          },
        },
        update: {},
        create: {
          fieldDefinitionId: row.id,
          deviceModel: model.name,
          protocol,
        },
      });
    }
    console.log('เสร็จ: ผูกพารามิเตอร์ทั้งหมดกับโมเดลแล้ว');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
