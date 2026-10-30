import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommandStatusSteps, commandStage } from "./command-status-steps";

describe("commandStage", () => {
  it("maps central statuses onto the four stages", () => {
    expect(commandStage("PENDING")).toEqual({ reached: 0, outcome: "pending" });
    expect(commandStage("DELIVERED")).toEqual({ reached: 1, outcome: "pending" });
    expect(commandStage("INSTALLING")).toEqual({ reached: 2, outcome: "pending" });
    expect(commandStage("SUCCESS")).toEqual({ reached: 2, outcome: "success" });
    expect(commandStage("FAILED")).toEqual({ reached: 1, outcome: "failed" });
    expect(commandStage("SOMETHING_NEW")).toBeNull();
  });
});

describe("CommandStatusSteps", () => {
  it("shows failure as text, not colour alone", () => {
    render(<CommandStatusSteps status="FAILED" />);
    expect(screen.getByText("ล้มเหลว")).toBeInTheDocument();
    expect(screen.queryByText("สำเร็จ")).not.toBeInTheDocument();
  });

  it("marks the current step for pending commands", () => {
    render(<CommandStatusSteps status="DELIVERED" />);
    expect(screen.getByText("ส่งแล้ว")).toHaveAttribute("aria-current", "step");
  });

  it("renders nothing for unknown statuses", () => {
    const { container } = render(<CommandStatusSteps status="MYSTERY" />);
    expect(container).toBeEmptyDOMElement();
  });
});
