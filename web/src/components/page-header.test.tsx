import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageHeader, PageHeaderMeta } from "./page-header";
import {
  BreadcrumbProvider,
  HeaderBreadcrumb,
} from "@/components/app-shell/breadcrumb";
import { Badge } from "@/components/ui/badge";

const nav = vi.hoisted(() => ({ pathname: "/config/abc" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "t", role: "Operation" } }),
}));

describe("PageHeader", () => {
  it("แสดงชื่อ คำอธิบาย สถานะ meta และปุ่ม", () => {
    render(
      <PageHeader
        title="TR-200 Fleet Standard"
        description="รายละเอียด Config"
        status={<Badge tone="warning" dot>Testing</Badge>}
        meta={<PageHeaderMeta items={[{ label: "โมเดล", value: "TR-200" }]} />}
        actions={<button type="button">อนุมัติ</button>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "TR-200 Fleet Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("รายละเอียด Config")).toBeInTheDocument();
    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(screen.getByText("โมเดล")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
  });

  it("ใช้นอก BreadcrumbProvider ได้", () => {
    render(<PageHeader title="ไม่มี provider" breadcrumb={[{ label: "x" }]} />);
    expect(screen.getByRole("heading", { name: "ไม่มี provider" })).toBeInTheDocument();
  });

  it("ส่งชื่อ record ไปต่อท้าย breadcrumb บนแถบบน", () => {
    nav.pathname = "/config/abc";
    render(
      <BreadcrumbProvider>
        <HeaderBreadcrumb />
        <PageHeader title="TR-200" breadcrumb={[{ label: "TR-200" }]} />
      </BreadcrumbProvider>,
    );
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(crumbs).toHaveTextContent("Config Editor");
    expect(crumbs).toHaveTextContent("TR-200");
    // ส่วนหัวเป็นลิงก์กลับไปหน้ารายการ ส่วนท้ายคือหน้าปัจจุบัน
    expect(screen.getByRole("link", { name: "Config Editor" })).toHaveAttribute(
      "href",
      "/config",
    );
  });
});

describe("Badge", () => {
  it("ใส่ tone เป็น data attribute และจุดสีซ่อนจาก screen reader", () => {
    render(<Badge tone="danger" dot>Rejected</Badge>);
    const badge = screen.getByText("Rejected");
    expect(badge).toHaveAttribute("data-tone", "danger");
    expect(badge.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
