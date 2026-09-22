import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SensitiveInput, SensitiveValue } from "./sensitive-value";

describe("SensitiveValue", () => {
  it("ไม่ render ค่าจริงเป็น plaintext ในโหมด default — โชว์ ••••••••", () => {
    render(<SensitiveValue value="SUPER_SECRET_PASSWORD" />);

    expect(screen.queryByText("SUPER_SECRET_PASSWORD")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
  });

  it("กดปุ่ม toggle แล้วค่าจริงถึงจะปรากฏ", async () => {
    const user = userEvent.setup();
    render(<SensitiveValue value="SUPER_SECRET_PASSWORD" />);

    await user.click(screen.getByRole("button", { name: "แสดงค่า" }));

    expect(screen.getByText("SUPER_SECRET_PASSWORD")).toBeInTheDocument();
    expect(screen.queryByText("••••••••")).not.toBeInTheDocument();
  });

  it("ค่าว่างโชว์ — แทน ไม่ต้อง mask (ไม่มีอะไรให้ดู)", () => {
    render(<SensitiveValue value="" />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("••••••••")).not.toBeInTheDocument();
  });
});

describe("SensitiveInput", () => {
  it("input เป็น type password ตาม default — ไม่ expose ค่าจริงในรูปแบบ text ที่ browser render", () => {
    render(<SensitiveInput value="SUPER_SECRET_PASSWORD" readOnly />);

    const input = screen.getByDisplayValue("SUPER_SECRET_PASSWORD");
    expect(input).toHaveAttribute("type", "password");
  });

  it("กดปุ่ม toggle แล้ว type เปลี่ยนเป็น text", async () => {
    const user = userEvent.setup();
    render(<SensitiveInput value="SUPER_SECRET_PASSWORD" readOnly />);

    await user.click(screen.getByRole("button", { name: "แสดงค่า" }));

    const input = screen.getByDisplayValue("SUPER_SECRET_PASSWORD");
    expect(input).toHaveAttribute("type", "text");
  });
});
