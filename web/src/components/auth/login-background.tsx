/**
 * พื้นหลังเต็มจอของหน้า Login — สื่อถึง "แผนที่ + อุปกรณ์ GPS" ตามที่ขอ
 * ประกอบด้วย 3 ชั้น (ทุกชั้น aria-hidden เพราะเป็น decoration ล้วนๆ):
 *   1. blob ไล่สีเบลอ 2 ก้อน ขยับช้าๆ (จากพาเนล Login เดิม)
 *   2. ลาย dot-grid จางๆ ทั่วจอ ให้ความรู้สึกเหมือนตารางแผนที่
 *   3. จุด "อุปกรณ์" กระจายอยู่บนแผนที่ พร้อมเส้นประเชื่อมบางจุด (คล้ายเส้นทาง)
 *      — 2 จุดมี ping ring (สัญญาณ GPS กำลังส่ง) ใช้ Tailwind core
 *      animate-ping ทั้งหมดใช้ transform/opacity ล้วน เพื่อ perf และเคารพ
 *      prefers-reduced-motion (ปิด animate-ping ไว้ใน globals.css แล้ว)
 */

const MAP_POINTS = [
  { x: 12, y: 22 },
  { x: 76, y: 16 },
  { x: 54, y: 42 },
  { x: 88, y: 62 },
  { x: 30, y: 72 },
  { x: 16, y: 88 },
] as const;

/** index ใน MAP_POINTS ที่ให้มี ping ring (สื่อว่ากำลังส่งสัญญาณสด) —
 *  ตั้งใจให้แค่ 2 จุด ไม่ใช่ทุกจุด กันดูรกเกินไป (ขอ "ขยับเล็กๆน้อยๆ") */
const PINGING_POINT_INDEXES = new Set([0, 3]);

/** คู่จุดที่ลากเส้นประเชื่อมกัน (อ้าง index ใน MAP_POINTS) — คล้ายเส้นทาง
 *  vehicle วิ่งระหว่างอุปกรณ์ */
const ROUTE_LINES: readonly [number, number][] = [
  [0, 2],
  [2, 1],
  [2, 4],
  [4, 5],
  [2, 3],
];

export function LoginBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-sidebar">
      <div className="animate-drift-a absolute -top-24 -left-24 size-96 rounded-full bg-sidebar-primary/30 blur-3xl" />
      <div className="animate-drift-b absolute -right-32 -bottom-24 size-[28rem] rounded-full bg-sidebar-accent/70 blur-3xl" />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {ROUTE_LINES.map(([a, b], i) => (
          <line
            key={i}
            x1={MAP_POINTS[a].x}
            y1={MAP_POINTS[a].y}
            x2={MAP_POINTS[b].x}
            y2={MAP_POINTS[b].y}
            stroke="white"
            strokeOpacity={0.12}
            strokeWidth={0.15}
            strokeDasharray="1.2 1.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {MAP_POINTS.map((p, i) => (
        <span
          key={i}
          className="absolute flex size-2.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        >
          {PINGING_POINT_INDEXES.has(i) && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sidebar-primary/60" />
          )}
          <span className="relative inline-flex size-2.5 rounded-full bg-sidebar-primary/80" />
        </span>
      ))}
    </div>
  );
}
