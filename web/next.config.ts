import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // build แบบ standalone ให้ web/Dockerfile คัดลอกแค่ไฟล์ที่ต้องใช้รันจริง (image เล็ก
  // ไม่ต้องมี node_modules ทั้งหมด) มีผลเฉพาะตอน `next build` ไม่กระทบ `next dev`
  output: "standalone",
};

export default nextConfig;
