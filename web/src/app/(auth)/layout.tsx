/**
 * เดิม wrapper นี้ center+padding เอง (เหมาะกับการ์ดฟอร์มลอยเดี่ยวๆ) — ย้าย
 * ความรับผิดชอบนั้นไปให้แต่ละหน้าเองแทน เพราะหน้า Login ตอนนี้เป็น split-panel
 * เต็มจอ (LoginHeroPanel + ฟอร์ม) ไม่ใช่การ์ดลอยกลางจอเฉยๆ แล้ว
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
