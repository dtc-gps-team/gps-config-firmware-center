import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "./data-table";

type Row = { id: string; name: string; kind: string };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "ชื่อ", meta: { filterVariant: "text", label: "ชื่อ" } },
  { accessorKey: "kind", header: "ชนิด" },
];

const rows: Row[] = [
  { id: "1", name: "alpha", kind: "A" },
  { id: "2", name: "beta", kind: "B" },
  { id: "3", name: "gamma", kind: "A" },
];

function many(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), name: `row-${i}`, kind: "A" }));
}

describe("DataTable", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/list");
    window.localStorage.clear();
  });

  it("writes search and sort to the URL and restores them on mount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DataTable columns={columns} data={rows} urlSync />);

    await user.type(screen.getByRole("textbox", { name: "ค้นหารวม" }), "beta");
    expect(window.location.search).toBe("?q=beta");
    expect(screen.getByText("1 / 3 รายการ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ชื่อ/ }));
    expect(window.location.search).toContain("sort=name");
    unmount();

    render(<DataTable columns={columns} data={rows} urlSync />);
    expect(screen.getByRole("textbox", { name: "ค้นหารวม" })).toHaveValue("beta");
    expect(screen.getByText("1 / 3 รายการ")).toBeInTheDocument();
  });

  it("clears filters from the URL with the clear button", async () => {
    window.history.replaceState(null, "", "/list?q=alpha&tab=x");
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} urlSync />);

    await user.click(screen.getByRole("button", { name: /ล้างตัวกรอง/ }));
    expect(window.location.search).toBe("?tab=x");
    expect(screen.getByText("3 / 3 รายการ")).toBeInTheDocument();
  });

  it("shows a floating action bar with the selected rows", async () => {
    const user = userEvent.setup();
    let seen: Row[] = [];
    render(
      <DataTable
        columns={columns}
        data={rows}
        selectable={{
          getRowId: (r) => r.id,
          bulkActions: (selected) => {
            seen = selected;
            return <span>พร้อมทำ {selected.length}</span>;
          },
        }}
      />,
    );

    expect(screen.queryByRole("region", { name: "การกระทำกับรายการที่เลือก" })).not.toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox", { name: "เลือกแถวนี้" });
    await user.click(boxes[0]);
    await user.click(boxes[2]);

    const bar = await screen.findByRole("region", { name: "การกระทำกับรายการที่เลือก" });
    expect(within(bar).getByText("พร้อมทำ 2")).toBeInTheDocument();
    expect(seen.map((r) => r.name)).toEqual(["alpha", "gamma"]);
  });

  it("saves the current view and applies it later", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} urlSync savedViewsKey="t" />);

    await user.type(screen.getByRole("textbox", { name: "ค้นหารวม" }), "alpha");
    await user.click(screen.getByRole("button", { name: /ตัวกรองที่บันทึก/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "ชื่อตัวกรอง" }), { target: { value: "เฉพาะ alpha" } });
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await user.click(screen.getByRole("button", { name: /ล้างตัวกรอง/ }));
    expect(screen.getByText("3 / 3 รายการ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ตัวกรองที่บันทึก/ }));
    await user.click(screen.getByRole("button", { name: "เฉพาะ alpha" }));
    expect(screen.getByText("1 / 3 รายการ")).toBeInTheDocument();
    expect(window.location.search).toBe("?q=alpha");
  });

  it("renders every row up to 200 and only a window above that", () => {
    const { rerender } = render(<DataTable columns={columns} data={many(150)} />);
    expect(screen.getAllByRole("row")).toHaveLength(150 + 2);

    rerender(<DataTable columns={columns} data={many(500)} />);
    expect(screen.getAllByRole("row").length).toBeLessThan(80);
    expect(screen.getByText("500 / 500 รายการ")).toBeInTheDocument();
  });
});
