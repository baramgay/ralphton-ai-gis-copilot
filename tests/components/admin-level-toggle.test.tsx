import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AdminLevelToggle } from "@/components/copilot/admin-level-toggle";

describe("AdminLevelToggle", () => {
  test("renders both options", () => {
    render(<AdminLevelToggle value="sgg" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "시군구" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "읍면동" })).toBeInTheDocument();
  });

  test("marks the active level as pressed", () => {
    render(<AdminLevelToggle value="dong" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "읍면동" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "시군구" })).toHaveAttribute("aria-pressed", "false");
  });

  test("fires onChange with the clicked level", () => {
    const onChange = vi.fn();
    render(<AdminLevelToggle value="sgg" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "읍면동" }));
    expect(onChange).toHaveBeenCalledWith("dong");
  });
});
