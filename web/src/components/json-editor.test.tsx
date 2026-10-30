import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { JsonEditor } from "./json-editor";

describe("JsonEditor", () => {
  it("renders the typed text in one real textarea and a colored layer behind it", () => {
    const { container } = render(
      <JsonEditor id="j" value={'{"a": 1}'} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue('{"a": 1}');
    const layer = container.querySelector("pre[aria-hidden]")!;
    expect(layer.textContent).toContain('{"a": 1}');
    expect(layer.querySelector(".text-info-foreground")?.textContent).toBe('"a"');
  });

  it("forwards edits and marks invalid state", () => {
    const onChange = vi.fn();
    render(<JsonEditor id="j" value="{" onChange={onChange} invalid />);
    const area = screen.getByRole("textbox");
    expect(area).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(area, { target: { value: "{}" } });
    expect(onChange).toHaveBeenCalledWith("{}");
  });
});
