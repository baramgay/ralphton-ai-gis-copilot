import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LayerSwitcher, type LayerOption } from "@/components/copilot/layer-switcher";

const layers: LayerOption[] = [
  { id: "population", label: "인구", provider: "공공" },
  { id: "skt-living", label: "생활인구", provider: "SKT" },
];

describe("LayerSwitcher", () => {
  test("renders every layer option", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^인구/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /생활인구/ })).toBeInTheDocument();
    expect(screen.getByText("SKT")).toBeInTheDocument();
  });

  test("marks the active layer as pressed", () => {
    render(<LayerSwitcher layers={layers} activeId="skt-living" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /생활인구/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^인구/ })).toHaveAttribute("aria-pressed", "false");
  });

  test("fires onChange with the clicked layer id", () => {
    const onChange = vi.fn();
    render(<LayerSwitcher layers={layers} activeId="population" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /생활인구/ }));
    expect(onChange).toHaveBeenCalledWith("skt-living");
  });
});
