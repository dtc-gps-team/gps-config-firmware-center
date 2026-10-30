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
 *   5. วงโคจรดาวเทียมเส้นบางเอียงรอบจุดอุปกรณ์จุดหนึ่ง พร้อมดาวเทียมจุดเดียววิ่งช้าๆ
 *      (เดิมเป็นลำแสงเรดาร์ไล่สีทึบ ซึ่งเด่นและสว่างเกินจนแย่งสายตาจากการ์ด Login
 *      และไม่ได้สื่อ GPS — เปลี่ยนเป็นเส้นบางล้วน ไม่มีพื้นทึบ)
 *   6. จุดข้อมูลเล็กๆ วิ่งตามเส้นทางระหว่างอุปกรณ์ สื่อว่าอุปกรณ์รายงานเข้ามา
 *
 * ทั้งหมดใช้ transform/opacity ล้วน เพื่อ perf และเคารพ prefers-reduced-motion
 * (ปิด animation ทั้งหมดไว้ใน globals.css แล้ว)
 */

/**
 * ตำแหน่งจุดอุปกรณ์ (% ของจอ) วางไว้ **นอกพื้นที่การ์ด Login** (การ์ดอยู่กลางจอราว
 * x 35-65%) เพื่อให้ทุกจุด เส้นทาง และวงเรดาร์เห็นเต็มๆ ไม่ถูกการ์ดบัง — รอบแรกวาง
 * เรดาร์ไว้กลางจอ ขอบวงเลยโผล่เป็นเส้นโค้งเหนือการ์ดแต่ตัวกวาดถูกบังหมด · แบ่งเป็น
 * กลุ่มซ้าย (0, 1, 5) กับกลุ่มขวา (2, 3, 4) ต่อกันด้วยเส้นทางที่วิ่งใต้การ์ด
 */
const MAP_POINTS: { x: number; y: number }[] = [
  { x: 9, y: 20 },
  { x: 24, y: 44 },
  { x: 84, y: 28 },
  { x: 93, y: 64 },
  { x: 74, y: 84 },
  { x: 14, y: 80 },
];

/** index ใน MAP_POINTS ที่ให้มี ping ring (สื่อว่ากำลังส่งสัญญาณสด) —
 *  ตั้งใจให้แค่ 2 จุด ไม่ใช่ทุกจุด กันดูรกเกินไป */
const PINGING_POINT_INDEXES = new Set([0, 3]);

/** index ของจุดที่เป็นศูนย์กลางวงโคจรดาวเทียม — ใส่แค่จุดเดียว */
const ORBIT_HUB_INDEX = 2;

/** คู่จุดที่ลากเส้นประเชื่อมกัน (อ้าง index ใน MAP_POINTS) — เป็นทางต่อเนื่องเดียว
 *  ซ้ายบน → ซ้ายล่าง → ขวาล่าง → ขวาบน คล้ายเส้นทาง vehicle วิ่งระหว่างอุปกรณ์ ·
 *  ช่วงล่าง (5→4) วิ่งใต้ขอบล่างของการ์ด */
const ROUTE_LINES: readonly [number, number][] = [
  [0, 1],
  [1, 5],
  [5, 4],
  [4, 3],
  [3, 2],
];

export function LoginBackground() {
  const orbitHub = MAP_POINTS[ORBIT_HUB_INDEX];

  return (
    <div aria-hidden className="animate-bg-in pointer-events-none absolute inset-0 overflow-hidden bg-sidebar">
      <div className="animate-drift-a absolute -top-24 -left-24 size-96 rounded-full bg-sidebar-primary/30 blur-3xl" />
      <div className="animate-drift-b absolute -right-32 -bottom-24 size-[28rem] rounded-full bg-sidebar-accent/70 blur-3xl" />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--brand-50) 8%, transparent) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* วงโคจรดาวเทียม: วงรีเส้นบางสองวงเอียงสวนกัน + ดาวเทียมหนึ่งจุดบนวงแรก
          (ซ่อนบนจอเล็กที่การ์ดกินเกือบทั้งจอ) */}
      <div
        className="absolute hidden size-[26rem] -translate-x-1/2 -translate-y-1/2 md:block"
        style={{ left: `${orbitHub.x}%`, top: `${orbitHub.y}%` }}
      >
        <div className="absolute inset-0 -rotate-[24deg]">
          <div className="absolute inset-x-0 top-1/2 h-[9rem] -translate-y-1/2 rounded-[50%] border border-white/12" />
          <span
            className="animate-orbit absolute top-0 left-0 size-2 rounded-full bg-sidebar-primary shadow-[0_0_10px_2px] shadow-sidebar-primary/60"
            style={{
              offsetPath: `path("M 0 208 A 208 72 0 1 1 416 208 A 208 72 0 1 1 0 208")`,
              offsetRotate: "0deg",
            }}
          />
        </div>
        <div className="absolute inset-0 rotate-[22deg]">
          <div className="absolute inset-x-6 top-1/2 h-[7rem] -translate-y-1/2 rounded-[50%] border border-white/8" />
        </div>
      </div>

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

      {/* จุดข้อมูลวิ่งตามเส้นทาง (translate เป็นหน่วย vw/vh ตามพิกัด % ของจอ) */}
      {ROUTE_LINES.map(([a, b], i) => (
        <span
          key={`packet-${i}`}
          className="animate-packet absolute hidden size-1.5 rounded-full bg-brand-200/80 md:block"
          style={
            {
              left: `${MAP_POINTS[a].x}%`,
              top: `${MAP_POINTS[a].y}%`,
              "--dx": `${MAP_POINTS[b].x - MAP_POINTS[a].x}vw`,
              "--dy": `${MAP_POINTS[b].y - MAP_POINTS[a].y}vh`,
              animationDelay: `${i * 1.3}s`,
            } as React.CSSProperties
          }
        />
      ))}

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
