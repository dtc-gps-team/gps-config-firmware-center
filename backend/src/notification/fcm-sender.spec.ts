import * as path from 'path';
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
