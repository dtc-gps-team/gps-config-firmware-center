import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { UrlTabs } from "./url-tabs";

beforeEach(() => {
  window.history.replaceState(null, "", "/tabs");
});

const tabs = [
  { id: "config", label: "Config", content: <p>เนื้อหา Config</p> },
  { id: "field-apply", label: "ส่งเข้ากล่อง", content: <p>เนื้อหาคำขอ</p> },
];

describe("UrlTabs", () => {
  it("ไม่มี prop ใหม่ยังเริ่มที่แท็บแรกและผู้ใช้สลับได้", () => {
    render(<UrlTabs tabs={tabs} />);

    expect(screen.getByRole("tab", { name: "Config" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "ส่งเข้ากล่อง" }));
    expect(screen.getByText("เนื้อหาคำขอ")).toBeInTheDocument();
  });

  it("สลับแท็บได้จาก preferredTab และเขียนสถานะลง URL", () => {
    const { rerender } = render(<UrlTabs tabs={tabs} />);

    rerender(<UrlTabs tabs={tabs} preferredTab="field-apply" />);

    expect(screen.getByText("เนื้อหาคำขอ")).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=field-apply");
  });

  it("ผู้ใช้เลือกแท็บก่อนโหลด preferredTab แล้วจะไม่ถูกย้ายภายหลัง", () => {
    const { rerender } = render(<UrlTabs tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "ส่งเข้ากล่อง" }));

    rerender(<UrlTabs tabs={tabs} preferredTab="config" />);

    expect(screen.getByText("เนื้อหาคำขอ")).toBeInTheDocument();
  });

  it("URL tab ที่ระบุไว้ชนะ preferredTab", () => {
    window.history.replaceState(null, "", "/tabs?tab=config");
    render(<UrlTabs tabs={tabs} preferredTab="field-apply" />);

    expect(screen.getByText("เนื้อหา Config")).toBeInTheDocument();
  });
});
