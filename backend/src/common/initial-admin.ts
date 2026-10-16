/**
 * SuperAdmin คนแรกของเครื่องที่เพิ่ง deploy (`prisma/seed.ts` ใช้)
 *
 * ทำไมต้องมี: ในโหมดเปิดสู่ภายนอก seed ไม่สร้างบัญชีทดสอบ (ดู test-users.ts) เครื่องใหม่จึง
 * ไม่มีใคร login ได้เลย ตั้ง `INITIAL_ADMIN_USERNAME` และ `INITIAL_ADMIN_PASSWORD` แล้ว seed
 * สร้าง SuperAdmin ให้ **เฉพาะเมื่อยังไม่มีผู้ใช้ role SuperAdmin เลย** รัน seed ซ้ำจึงไม่
 * สร้างซ้ำหรือเปลี่ยนรหัสของใคร จากนั้นสร้างผู้ใช้อื่นผ่านหน้าจัดการผู้ใช้ตามปกติ
 */

export const MIN_INITIAL_ADMIN_PASSWORD_LENGTH = 12;

export type InitialAdminPlan = { username: string; password: string } | null;

/** อ่านค่าจาก env คืน `null` ถ้าไม่ได้ตั้งทั้งคู่ throw ถ้าตั้งไม่ครบหรือรหัสสั้นเกินไป */
export function planInitialAdmin(env: NodeJS.ProcessEnv): InitialAdminPlan {
  const username = env.INITIAL_ADMIN_USERNAME?.trim() ?? '';
  const password = env.INITIAL_ADMIN_PASSWORD ?? '';

  if (username === '' && password === '') return null;
  if (username === '' || password === '') {
    throw new Error(
      'ต้องตั้ง INITIAL_ADMIN_USERNAME และ INITIAL_ADMIN_PASSWORD ทั้งคู่ หรือไม่ตั้งเลย',
    );
  }
  if (password.length < MIN_INITIAL_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `INITIAL_ADMIN_PASSWORD ต้องยาวอย่างน้อย ${MIN_INITIAL_ADMIN_PASSWORD_LENGTH} ตัวอักษร`,
    );
  }
  return { username, password };
}
