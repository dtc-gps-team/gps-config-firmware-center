/**
 * แถบเล็กๆ บอกว่าข้อมูลในหน้านี้เป็นตัวอย่างสำหรับ demo ยังไม่ได้ต่อ API จริง
 * (ดู web/src/lib/demo-data.ts) — ใส่ไว้ทุกหน้าที่ render DEMO_* เพื่อความ
 * ชัดเจน ไม่ให้เข้าใจผิดว่าเป็นข้อมูลสด
 */
export function DemoNote({ endpoint }: { endpoint: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="mr-1.5 inline-flex items-center rounded border border-warning/30 bg-warning-subtle px-1.5 py-0.5 font-medium text-warning-foreground">
        ข้อมูลตัวอย่าง
      </span>
      หน้านี้ยังไม่ต่อ API รอ <code className="font-mono">{endpoint}</code>
    </p>
  );
}
