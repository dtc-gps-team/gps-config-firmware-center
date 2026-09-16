/**
 * พื้นหลังเต็มจอของหน้า Login — สื่อถึง "แผนที่ + อุปกรณ์ GPS" ตามที่ขอ
 * ประกอบด้วยหลายชั้น (ทุกชั้น aria-hidden เพราะเป็น decoration ล้วนๆ):
 *   1. blob ไล่สีเบลอ 2 ก้อน ขยับช้าๆ
 *   2. ลาย dot-grid จางๆ ทั่วจอ ให้ความรู้สึกเหมือนตารางแผนที่
 *   3. เส้นทางเชื่อมจุดอุปกรณ์ "ไหล" ต่อเนื่อง (stroke-dashoffset) เหมือน
 *      สัญญาณกำลังวิ่งผ่านเส้นทาง
 *   4. จุด "อุปกรณ์" กระจายบนแผนที่ — ส่วนใหญ่สีปกติ (primary) มี 1 จุดสี
 *      warning (เตือนเบาๆ) และ 1 จุดสี danger (มี ping — สื่อว่าต้องการ
 *      ความสนใจ) จุดที่เหลือเรือง/หรี่สลับเบาๆ แบบ stagger (ไม่พร้อมกัน)
 *      ให้ความรู้สึกทยอยรายงานเข้ามา
 *
 * ทั้งหมดใช้ transform/opacity ล้วน เพื่อ perf และเคารพ prefers-reduced-motion
 * (ปิด animation ทั้งหมดไว้ใน globals.css แล้ว)
 */

type PointTone = "primary" | "warning" | "danger";

const DOT_CLASS: Record<PointTone, string> = {
  primary: "bg-sidebar-primary/80",
  warning: "bg-amber-400/80",
  danger: "bg-rose-400/80",
};

const PING_CLASS: Record<PointTone, string> = {
  primary: "bg-sidebar-primary/60",
  warning: "bg-amber-400/60",
  danger: "bg-rose-400/60",
};

const MAP_POINTS: { x: number; y: number; tone: PointTone }[] = [
  { x: 12, y: 22, tone: "primary" },
  { x: 76, y: 16, tone: "warning" },
  { x: 54, y: 42, tone: "primary" },
  { x: 88, y: 62, tone: "danger" },
  { x: 30, y: 72, tone: "primary" },
  { x: 16, y: 88, tone: "primary" },
];

/** index ใน MAP_POINTS ที่ให้มี ping ring (สื่อว่ากำลังส่งสัญญาณสด/ต้องการ
 *  ความสนใจ) — ตั้งใจให้แค่ 2 จุด ไม่ใช่ทุกจุด กันดูรกเกินไป */
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
            className="animate-route-flow"
            x1={MAP_POINTS[a].x}
            y1={MAP_POINTS[a].y}
            x2={MAP_POINTS[b].x}
            y2={MAP_POINTS[b].y}
            stroke="white"
            strokeOpacity={0.14}
            strokeWidth={0.15}
            strokeDasharray="1.2 1.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {MAP_POINTS.map((p, i) => {
        const pinging = PINGING_POINT_INDEXES.has(i);
        return (
          <span
            key={i}
            className="absolute flex size-2.5 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {pinging && (
              <span
                className={`absolute inline-flex size-full animate-ping rounded-full ${PING_CLASS[p.tone]}`}
              />
            )}
            <span
              className={`relative inline-flex size-2.5 rounded-full ${DOT_CLASS[p.tone]} ${pinging ? "" : "animate-device-glow"}`}
              style={pinging ? undefined : { animationDelay: `${i * 0.6}s` }}
            />
          </span>
        );
      })}
    </div>
  );
}
