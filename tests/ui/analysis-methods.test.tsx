import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisMethods } from "@/components/copilot/analysis-methods";

const trendPresets = [
  { id: "living-growth", label: "생활인구 변화", subtitle: "어느 지역이 늘었는지", query: "생활인구 늘어나는 동" },
  { id: "sales-growth", label: "카드매출 변화", subtitle: "매출이 달라진 지역", query: "카드매출 늘어나는 동" },
] as const;
const crossPresets = [
  { id: "living-sales", label: "생활인구와 카드매출", subtitle: "사람과 소비 함께 보기", query: "생활인구 대비 카드매출", group: "민간 × 민간" },
  { id: "population-medical", label: "인구와 의료기관", subtitle: "주민 수와 의료 공급", query: "인구 대비 의료기관", group: "공공 × 공공" },
] as const;

afterEach(cleanup);

function setup() {
  const onTrend = vi.fn();
  const onCross = vi.fn();
  render(<AnalysisMethods trendPresets={trendPresets} crossPresets={crossPresets} crossGroups={["민간 × 민간", "공공 × 공공"]} onTrend={onTrend} onCross={onCross} />);
  return { onTrend, onCross };
}

describe("AnalysisMethods", () => {
  it("starts with current conditions and does not expose or execute advanced presets", () => {
    const { onTrend, onCross } = setup();
    expect(screen.getByRole("button", { name: "현재 수준" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("현재 조건의 지역 순위를 지도와 결과에서 확인하세요.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-presets")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cross-presets")).not.toBeInTheDocument();
    expect(onTrend).not.toHaveBeenCalled();
    expect(onCross).not.toHaveBeenCalled();
  });

  it("reveals only the selected method and changes modes without triggering analyses", () => {
    const { onTrend, onCross } = setup();
    fireEvent.click(screen.getByRole("button", { name: "변화 보기" }));
    expect(screen.getByTestId("trend-presets")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-presets")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "함께 보기" }));
    expect(screen.queryByTestId("trend-presets")).not.toBeInTheDocument();
    expect(screen.getByTestId("cross-presets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "변화 보기" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "현재 수준" }));
    expect(screen.queryByTestId("trend-presets")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cross-presets")).not.toBeInTheDocument();
    expect(onTrend).not.toHaveBeenCalled();
    expect(onCross).not.toHaveBeenCalled();
  });

  it("executes the exact trend query once per activation while preserving preset labels and IDs", () => {
    const { onTrend, onCross } = setup();
    fireEvent.click(screen.getByRole("button", { name: "변화 보기" }));
    const preset = screen.getByTestId("trend-sales-growth");
    expect(preset).toHaveAccessibleName("카드매출 변화");
    expect(preset).toHaveTextContent("매출이 달라진 지역");
    fireEvent.pointerDown(preset);
    expect(onTrend).not.toHaveBeenCalled();
    fireEvent.click(preset);
    expect(onTrend).toHaveBeenCalledExactlyOnceWith("카드매출 늘어나는 동");
    expect(onCross).not.toHaveBeenCalled();
  });

  it("groups cross presets and sends the exact chosen query once", () => {
    const { onTrend, onCross } = setup();
    fireEvent.click(screen.getByRole("button", { name: "함께 보기" }));
    const choices = screen.getByTestId("cross-presets");
    expect(within(choices).getByRole("heading", { name: "민간 × 민간" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cross-living-sales"));
    expect(onCross).toHaveBeenCalledExactlyOnceWith("생활인구 대비 카드매출");
    expect(onTrend).not.toHaveBeenCalled();
  });
});
