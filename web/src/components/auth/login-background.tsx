/**
 * พื้นหลังเต็มจอของหน้า Login — สื่อถึง "แผนที่ + อุปกรณ์ GPS" ตามที่ขอ
 * ประกอบด้วยหลายชั้น (ทุกชั้น aria-hidden เพราะเป็น decoration ล้วนๆ):
 *   1. blob ไล่สีเบลอ 2 ก้อน ขยับช้าๆ
 *   2. ลาย dot-grid จางๆ ทั่วจอ ให้ความรู้สึกเหมือนตารางแผนที่
 *   3. เส้นทางเชื่อมจุดอุปกรณ์ "ไหล" ต่อเนื่อง (stroke-dashoffset) เหมือน
 *      สัญญาณกำลังวิ่งผ่านเส้นทาง
 *   4. จุด "อุปกรณ์" กระจายบนแผนที่ (สีเดียวกันหมด — primary) มี 2 จุดที่มี
 *      ping ring (สื่อว่ากำลังส่งสัญญาณสด) จุดที่เหลือเรือง/หรี่สลับเบาๆ
 *      แบบ stagger (ไม่พร้อมกัน) ให้ความรู้สึกทยอยรายงานเข้ามา
 *   5. วงแสงเรดาร์กวาดช้าๆ รอบจุดอุปกรณ์จุดหนึ่ง (conic-gradient หมุน) —
 *      ใส่แค่จุดเดียวตามที่แนะนำ กันดูรกเกินไป
 *
 * ทั้งหมดใช้ transform/opacity ล้วน เพื่อ perf และเคารพ prefers-reduced-motion
 * (ปิด animation ทั้งหมดไว้ใน globals.css แล้ว)
 */

const MAP_POINTS: { x: number; y: number }[] = [
  { x: 12, y: 22 },
  { x: 76, y: 16 },
  { x: 54, y: 42 },
  { x: 88, y: 62 },
  { x: 30, y: 72 },
  { x: 16, y: 88 },
];

/** index ใน MAP_POINTS ที่ให้มี ping ring (สื่อว่ากำลังส่งสัญญาณสด) —
 *  ตั้งใจให้แค่ 2 จุด ไม่ใช่ทุกจุด กันดูรกเกินไป */
const PINGING_POINT_INDEXES = new Set([0, 3]);

/** index ของจุดที่ให้มีวงแสงเรดาร์กวาดล้อมรอบ — ใส่แค่จุดเดียว */
const RADAR_POINT_INDEX = 2;

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
  const radarPoint = MAP_POINTS[RADAR_POINT_INDEX];

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

      {/* วง "ระยะเรดาร์" นิ่งๆ — เป็น anchor ให้สายตาเห็นตำแหน่งตลอดเวลา
          แม้ตอนที่ลำแสงกวาดไปอยู่อีกด้านหนึ่ง */}
      <div
        className="absolute size-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sidebar-primary/30"
        style={{ left: `${radarPoint.x}%`, top: `${radarPoint.y}%` }}
      />
      <div
        className="absolute size-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sidebar-primary/20"
        style={{ left: `${radarPoint.x}%`, top: `${radarPoint.y}%` }}
      />
      <div
        className="animate-radar-spin absolute size-80 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${radarPoint.x}%`,
          top: `${radarPoint.y}%`,
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(120,190,255,0.55) 55deg, transparent 100deg)",
          maskImage: "radial-gradient(circle, black 75%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(circle, black 75%, transparent 100%)",
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
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sidebar-primary/60" />
            )}
            <span
              className={`relative inline-flex size-2.5 rounded-full bg-sidebar-primary/80 ${pinging ? "" : "animate-device-glow"}`}
              style={pinging ? undefined : { animationDelay: `${i * 0.6}s` }}
            />
          </span>
        );
      })}
    </div>
  );
}
