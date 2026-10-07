import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/copilot/kakao-map", () => ({
  KakaoMap: vi.fn(({ onError }: { onError: (message: string) => void }) => (
    <button onClick={() => onError("SDK 401: API key and allowed domain configuration")}>연결 실패 재현</button>
  )),
}));
vi.mock("@/components/copilot/demo-map", () => ({ DemoMap: vi.fn(() => <div>경계 지도</div>) }));

import { MapCanvas } from "@/components/copilot/map-canvas";
import { DemoMap } from "@/components/copilot/demo-map";
import { KakaoMap } from "@/components/copilot/kakao-map";
import type { BoundaryCollection, RegionSeries } from "@/components/copilot/types";

function boundary(codes: string[]): BoundaryCollection {
  return {
    type: "FeatureCollection",
    features: codes.map((code, index) => ({
      type: "Feature",
      properties: {
        adm_cd2: code,
        adm_nm: code.startsWith("48250") || index === 2 ? "경상남도 김해시 내외동" : "경상남도 양산시 물금읍",
      },
      geometry: { type: "Polygon", coordinates: [[[128, 35], [129, 35], [129, 36], [128, 35]]] },
    })),
  };
}

function region(code: string, name: string): RegionSeries {
  return {
    adm_cd2: code, adm_nm: name, representativePoint: { lat: 35.3, lng: 129 }, areaSquareKm: 1,
    months: [], population: [], households: [], populationDensity: [], youthPopulation: [],
    workingAgePopulation: [], elderlyPopulation: [], onePersonHouseholds: [], births: [], deaths: [], naturalChange: [],
  };
}

const dongBoundary = boundary(["4833025300", "4833051000", "4825052000"]);
const regions = [
  region("4833025300", "경상남도 양산시 물금읍"),
  region("4833051000", "경상남도 양산시 중앙동"),
  region("4825052000", "경상남도 김해시 내외동"),
];
const mapProps = {
  kakaoMapKey: "", boundary: dongBoundary, regions, facilities: [],
  scores: new Map([["4833025300", 90], ["4833051000", 80], ["4825052000", 70]]),
  hoverRows: [{ code: "4833025300", name: "양산시 물금읍", valueLabel: "90명" }],
  selectedRegionCode: null, radiusKm: 2 as const, showFacilities: false, onSelectRegion: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe("MapCanvas analysis scope", () => {
  it("limits both map engines to the requested district and restores the whole province", () => {
    const { rerender } = render(<MapCanvas {...mapProps} regionFilters={["양산시"]} />);
    const demoProps = vi.mocked(DemoMap).mock.calls.at(-1)?.[0];
    expect(demoProps?.boundary.features.map((feature) => feature.properties.adm_cd2)).toEqual(["4833025300", "4833051000"]);
    expect(demoProps?.regions.map((item) => item.adm_cd2)).toEqual(["4833025300", "4833051000"]);
    expect(demoProps?.scores).toBe(mapProps.scores);
    expect(demoProps?.hoverRows).toBe(mapProps.hoverRows);

    rerender(<MapCanvas {...mapProps} kakaoMapKey="test-key" regionFilters={["양산시"]} />);
    expect(vi.mocked(KakaoMap).mock.calls.at(-1)?.[0].boundary.features).toEqual(demoProps?.boundary.features);

    rerender(<MapCanvas {...mapProps} regionFilters={[]} />);
    expect(vi.mocked(DemoMap).mock.calls.at(-1)?.[0].boundary).toBe(dongBoundary);
    expect(vi.mocked(DemoMap).mock.calls.at(-1)?.[0].regions).toBe(regions);
  });

  it("restricts a dong code to that dong while retaining its containing district geometry", () => {
    const { rerender } = render(<MapCanvas {...mapProps} regionFilters={["4833025300"]} />);
    expect(vi.mocked(DemoMap).mock.calls.at(-1)?.[0].boundary.features.map((feature) => feature.properties.adm_cd2)).toEqual(["4833025300"]);
    rerender(<MapCanvas {...mapProps} boundary={boundary(["48330", "48250"])} regionFilters={["4833025300"]} />);
    expect(vi.mocked(DemoMap).mock.calls.at(-1)?.[0].boundary.features.map((feature) => feature.properties.adm_cd2)).toEqual(["48330"]);
  });

  it("keeps five-digit district geometry and matching dong labels for a coded scope", () => {
    const sggBoundary = boundary(["48330", "48250"]);
    render(<MapCanvas {...mapProps} boundary={sggBoundary} regionFilters={["48330"]} />);
    const result = vi.mocked(DemoMap).mock.calls.at(-1)?.[0];
    expect(result?.boundary.features.map((feature) => feature.properties.adm_cd2)).toEqual(["48330"]);
    expect(result?.regions.map((item) => item.adm_cd2)).toEqual(["4833025300", "4833051000"]);
  });

  it("filters grid geometry by its regional name without changing cell values", () => {
    render(<MapCanvas {...mapProps} boundary={boundary(["2095_3379", "2095_3380", "2096_3381"])} regionFilters={["양산시"]} />);
    const result = vi.mocked(DemoMap).mock.calls.at(-1)?.[0];
    expect(result?.boundary.features.map((feature) => feature.properties.adm_cd2)).toEqual(["2095_3379", "2095_3380"]);
    expect(result?.scores).toBe(mapProps.scores);
  });
});

describe("MapCanvas fallback", () => {
  it("shows a usable fallback and retry without provider configuration errors", () => {
    render(<MapCanvas
      kakaoMapKey="test-key"
      boundary={{ type: "FeatureCollection", features: [] }}
      regions={[]}
      facilities={[]}
      scores={new Map()}
      selectedRegionCode={null}
      radiusKm={2}
      showFacilities={false}
      onSelectRegion={vi.fn()}
    />);
    fireEvent.click(screen.getByText("연결 실패 재현"));
    expect(screen.getByText("경계 지도")).toBeVisible();
    expect(screen.getByRole("button", { name: "지도 다시 불러오기" })).toBeVisible();
    expect(screen.queryByText(/SDK 401/)).not.toBeInTheDocument();
    expect(screen.getByText(/경계 지도에서 지역 선택과 분석을 계속/)).toBeVisible();
  });
});
