import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AppTopbar } from "@/components/copilot/app-topbar";
import type { AnalysisSnapshot, RegionSeries } from "@/components/copilot/types";

function region(adm_cd2: string, adm_nm: string): RegionSeries {
  return {
    adm_cd2,
    adm_nm,
    representativePoint: { lat: 35.2, lng: 128.6 },
    areaSquareKm: 1,
    months: [],
    population: [],
    households: [],
    populationDensity: [],
    youthPopulation: [],
    workingAgePopulation: [],
    elderlyPopulation: [],
    onePersonHouseholds: [],
    births: [],
    deaths: [],
    naturalChange: [],
  };
}

const snapshot: AnalysisSnapshot = {
  mode: "demo",
  referenceMonth: "2026-06",
  months: [],
  regions: [
    region("4812125000", "경상남도 창원시 의창구 동읍"),
    region("4812151000", "경상남도 창원시 의창구 의창동"),
    region("4812351000", "경상남도 창원시 성산구 반송동"),
  ],
  facilities: [],
  sourceNotes: ["테스트 시연 데이터"],
};

describe("AppTopbar", () => {
  test("keeps the Gyeongnam identity visible before and after data loads", () => {
    const { rerender } = render(<AppTopbar snapshot={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "누리맵" })).toBeVisible();
    expect(screen.getByRole("note", { name: "분석 대상 지역: 경상남도" })).toHaveTextContent("경상남도");
    expect(screen.getByTestId("topbar-loading-meta")).toBeVisible();

    rerender(<AppTopbar snapshot={snapshot} />);

    expect(screen.getByRole("note", { name: "분석 대상 지역: 경상남도" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "누리맵" })).toBeVisible();
  });

  test("reports dong coverage and distinct district coverage from the snapshot", () => {
    render(<AppTopbar snapshot={snapshot} />);

    expect(screen.getByText("시연 · 2026-06 · 3개 행정동 · 2개 시군구")).toBeVisible();
    expect(screen.queryByText(/305개|22개/)).not.toBeInTheDocument();
  });

  test("retains direct access to the guide and data sources", () => {
    const onOpenTab = vi.fn();
    render(<AppTopbar snapshot={snapshot} onOpenTab={onOpenTab} />);

    fireEvent.click(screen.getByRole("button", { name: "활용가이드" }));
    fireEvent.click(screen.getByRole("button", { name: "활용데이터" }));

    expect(onOpenTab.mock.calls).toEqual([["help"], ["data"]]);
  });
});
