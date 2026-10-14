/**
 * แปลงค่า env `TRUST_PROXY` เป็นค่าที่ส่งให้ Express `app.set('trust proxy', ...)`
 * (รีวิว B บน #301 ข้อ 1)
 *
 * ทำไมต้องมี: Audit Log บันทึก `req.ip` ถ้า backend อยู่หลัง reverse proxy /
 * load balancer โดยไม่ตั้ง trust proxy ทุกแถวจะได้ IP ของ proxy เหมือนกันหมด
 *
 * - ไม่ตั้ง / ว่าง / `0` / `false` -> `false` (ปิด เหมือนพฤติกรรมเดิม)
 * - จำนวนเต็มบวก เช่น `1` -> จำนวน proxy ที่เชื่อถือ (นับจากฝั่ง backend)
 * - ค่าอื่น -> throw ตอน startup ให้รู้ทันที ไม่เดาความหมายเอง
 *
 * **ค่าเริ่มต้นต้องปิดเสมอ** ถ้าเปิดทั้งที่ไม่มี proxy จริง ผู้ใช้ส่ง header
 * `X-Forwarded-For` ปลอม IP ที่ลง Audit Log ได้ ซึ่งแย่กว่าได้ IP ของ proxy
 * รับเฉพาะจำนวน hop ไม่รับ `true` (เชื่อทุก hop) ด้วยเหตุผลเดียวกัน
 */
export function resolveTrustProxy(raw: string | undefined): number | false {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === '' || value === '0' || value === 'false') {
    return false;
  }
  if (/^[1-9]\d*$/.test(value)) {
    return Number(value);
  }
  throw new Error(
    `TRUST_PROXY ต้องเป็นจำนวน proxy (จำนวนเต็มบวก เช่น 1) หรือไม่ตั้งเลย แต่ได้ "${raw}"`,
  );
}
