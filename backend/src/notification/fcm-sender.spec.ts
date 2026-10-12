import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RealFcmSender } from './fcm-sender';

describe('RealFcmSender.resolvePath', () => {
  it('relative path -> resolve เทียบ repo root (cwd ขึ้นไป 1 level)', () => {
    const input = './secrets/fcm-service-account.json';

    expect(RealFcmSender.resolvePath(input)).toBe(
      path.resolve(process.cwd(), '..', input),
    );
  });

  it('relative path ที่ไม่มี ./ นำหน้า ก็ resolve เทียบ repo root เหมือนกัน', () => {
    const input = 'secrets/fcm-service-account.json';

    expect(RealFcmSender.resolvePath(input)).toBe(
      path.resolve(process.cwd(), '..', input),
    );
  });

  it('absolute path -> คืนค่าเดิมเป๊ะๆ ไม่ถูกแก้', () => {
    // สร้าง absolute path ที่แน่ใจว่า absolute จริงบน OS ที่รันเทส
    // (Windows -> C:\..., POSIX -> /...) โดยไม่ hardcode string
    const abs = path.resolve('/tmp/some-service-account.json');
    expect(path.isAbsolute(abs)).toBe(true);

    expect(RealFcmSender.resolvePath(abs)).toBe(abs);
  });
});

describe('RealFcmSender constructor — fail fast', () => {
  it('ไฟล์ไม่มีจริง -> throw error ที่มีทั้ง path เดิม และ path ที่ resolve แล้ว', () => {
    const missing = './__no_such_fcm_service_account__.json';
    const resolved = RealFcmSender.resolvePath(missing);

    let thrown: Error | undefined;
    try {
      // fs.existsSync() throw ก่อนถึง cert()/initializeApp() — ไม่แตะ Firebase SDK
      new RealFcmSender(missing);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain(missing);
    expect(thrown?.message).toContain(resolved);
  });
});

describe('RealFcmSender.assertDevProject — กันยิง production', () => {
  let dir: string;
  const writeAccount = (projectId: unknown) => {
    const file = path.join(dir, 'sa.json');
    fs.writeFileSync(file, JSON.stringify({ project_id: projectId }));
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-guard-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('project_id ลงท้าย -dev -> ผ่าน ไม่ throw', () => {
    const file = writeAccount('gps-config-firmware-center-dev');
    expect(() => RealFcmSender.assertDevProject(file, false)).not.toThrow();
  });

  it('project_id ไม่ลงท้าย -dev (production) -> throw พร้อมบอก project_id ที่ตรวจพบ', () => {
    const file = writeAccount('gps-config-firmware-center');
    expect(() => RealFcmSender.assertDevProject(file, false)).toThrow(
      /project_id "gps-config-firmware-center" ไม่ลงท้ายด้วย "-dev".*production/,
    );
  });

  it('ไม่มี project_id ในไฟล์ -> throw', () => {
    const file = writeAccount(undefined);
    expect(() => RealFcmSender.assertDevProject(file, false)).toThrow(
      /project_id "undefined"/,
    );
  });

  it('FCM_ALLOW_NON_DEV_PROJECT เปิดชัดเจน -> ไม่ throw', () => {
    const file = writeAccount('some-other-project');
    expect(() => RealFcmSender.assertDevProject(file, true)).not.toThrow();
  });

  it('constructor ด้วยไฟล์ production -> throw ก่อนแตะ Firebase SDK', () => {
    const file = writeAccount('gps-config-firmware-center');
    expect(() => new RealFcmSender(file)).toThrow(/ไม่ลงท้ายด้วย "-dev"/);
  });
});
