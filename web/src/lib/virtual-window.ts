/**
 * Windowing ของตารางแถวสูงคงที่ — คำนวณช่วงแถวที่ต้อง render จากตำแหน่งเลื่อน
 * ใช้เฉพาะเมื่อแถวเกิน `VIRTUALIZE_THRESHOLD` (DESIGN.md: ข้อมูลเกิน 200 แถวจริง)
 */
export const VIRTUALIZE_THRESHOLD = 200;

export type VirtualWindow = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
};

export function computeWindow(opts: {
  total: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): VirtualWindow {
  const { total, rowHeight, scrollTop, viewportHeight, overscan = 8 } = opts;
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.min(total, first - overscan));
  const end = Math.min(total, first + visible + overscan);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight),
  };
}
