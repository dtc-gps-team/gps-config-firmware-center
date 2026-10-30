import { describe, expect, it } from "vitest";

import { computeWindow } from "./virtual-window";

describe("computeWindow", () => {
  it("renders only the viewport plus overscan at the top", () => {
    const w = computeWindow({ total: 1000, rowHeight: 50, scrollTop: 0, viewportHeight: 500 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(18);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe((1000 - 18) * 50);
  });

  it("keeps total height constant while scrolled", () => {
    const w = computeWindow({ total: 1000, rowHeight: 50, scrollTop: 10_000, viewportHeight: 500 });
    expect(w.padTop + (w.end - w.start) * 50 + w.padBottom).toBe(1000 * 50);
  });

  it("clamps at the end of the list", () => {
    const w = computeWindow({ total: 250, rowHeight: 50, scrollTop: 99_999, viewportHeight: 500 });
    expect(w.end).toBe(250);
    expect(w.padBottom).toBe(0);
  });
});
