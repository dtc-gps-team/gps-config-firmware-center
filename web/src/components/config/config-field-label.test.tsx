import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfigFieldLabel } from "./config-field-label";

describe("ConfigFieldLabel", () => {
  it("มีคำอธิบาย -> คำอธิบายขึ้นก่อน fieldName อยู่รองลงมา", () => {
    render(
      <ConfigFieldLabel
        fieldName="data_server.host"
        description="โดเมนของเซิร์ฟเวอร์ปลายทาง"
      />,
    );

    expect(screen.getByText("โดเมนของเซิร์ฟเวอร์ปลายทาง")).toBeInTheDocument();
    expect(screen.getByText("data_server.host")).toBeInTheDocument();
  });

  it("ไม่มีคำอธิบาย -> แสดง fieldName เดี่ยวๆ เหมือนเดิม", () => {
    render(<ConfigFieldLabel fieldName="data_server.host" />);

    expect(screen.getByText("data_server.host")).toBeInTheDocument();
  });

  it("คำอธิบายเป็นช่องว่างล้วน -> ถือว่าไม่มีคำอธิบาย แสดง fieldName เดี่ยวๆ", () => {
    render(<ConfigFieldLabel fieldName="data_server.host" description="   " />);

    expect(screen.getByText("data_server.host")).toBeInTheDocument();
    expect(
      screen.queryByText("โดเมนของเซิร์ฟเวอร์ปลายทาง"),
    ).not.toBeInTheDocument();
  });
});
