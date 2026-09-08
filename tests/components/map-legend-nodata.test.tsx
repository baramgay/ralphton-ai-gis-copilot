import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { DemoMap } from "@/components/copilot/demo-map";
import { KakaoMap } from "@/components/copilot/kakao-map";
import type {
  KakaoMapInstance,
  KakaoMarker,
  KakaoMapsNamespace,
  KakaoOverlay,
} from "@/components/copilot/kakao-sdk";
import type { BoundaryCollection } from "@/components/copilot/types";

const { loadKakaoSdkMock } = vi.hoisted(() => ({
  loadKakaoSdkMock: vi.fn(),
}));

vi.mock("@/components/copilot/kakao-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/copilot/kakao-sdk")>();
  return { ...actual, loadKakaoSdk: loadKakaoSdkMock };
});

/*
 * 범례의 「자료 없음 n곳」 줄.
 *
 * 무채색(회색)으로 칠한 지역이 있는데 범례가 말하지 않으면, 보는 사람은 그 지역을
 * 「색띠의 제일 옅은 쪽 = 가장 낮은 곳」으로 읽는다. 결손이 있을 때만 한 줄을 얹고,
 * 없을 때는 아예 렌더하지 않는다.
 *
 * 개수는 순위 행 가운데 지도 점수가 없는(null) 행의 수다. 경계 전체에서 점 있는
 * 곳을 빼는 식으로 세면, 상위 30곳만 칠하는 교차·추세 지도에서 순위 밖이 전부
 * 「자료 없음」으로 둔갑한다.
 */

function squareAt(lng: number, lat: number): [number, number][] {
  return [
    [lng, lat],
    [lng + 0.01, lat],
    [lng + 0.01, lat + 0.01],
    [lng, lat + 0.01],
    [lng, lat],
  ];
}

function boundary(): BoundaryCollection {
  return {
    type: "FeatureCollection",
    features: ["4817000001", "4817000002", "4817000003"].map((code, i) => ({
      type: "Feature",
      properties: { adm_cd2: code, adm_nm: `경상남도 진주시 동${i + 1}` },
      geometry: { type: "Polygon", coordinates: [squareAt(128 + i * 0.02, 35)] },
    })),
  };
}

const base = {
  boundary: boundary(),
  regions: [],
  facilities: [],
  scores: new Map([
    ["4817000001", 80],
    ["4817000002", 20],
  ]),
  selectedRegionCode: null,
  radiusKm: 2 as const,
  showFacilities: false,
  onSelectRegion: () => {},
};

describe("범례 자료 없음 줄", () => {
  test("결손이 있으면 개수와 함께 보인다", () => {
    render(<DemoMap {...base} noDataCount={3} />);
    expect(screen.getByTestId("map-legend-nodata")).toHaveTextContent("자료 없음 3곳");
  });

  test("결손이 0곳이면 아예 렌더하지 않는다", () => {
    render(<DemoMap {...base} noDataCount={0} />);
    expect(screen.queryByTestId("map-legend-nodata")).not.toBeInTheDocument();
  });

  test("prop이 없으면 아예 렌더하지 않는다", () => {
    render(<DemoMap {...base} />);
    expect(screen.queryByTestId("map-legend-nodata")).not.toBeInTheDocument();
  });

  test("색은 무채색 토큰에서 온다", () => {
    render(<DemoMap {...base} noDataCount={1} />);
    const swatch = screen.getByTestId("map-legend-nodata").querySelector("span");
    // 라이트 무채색 #e8eef5. 문자열을 손으로 적지 않고 noDataColor()가 준 값이다.
    expect(swatch?.getAttribute("style")).toContain("232, 238, 245");
  });
});

describe("카카오 지도 범례 자료 없음 줄", () => {
  class LatLng {}
  class MapInstance implements KakaoMapInstance {
    setCenter() {}
  }
  class Overlay implements KakaoOverlay {
    setMap() {}
  }
  class Marker extends Overlay implements KakaoMarker {}
  class MarkerClusterer {
    addMarkers() {}
    clear() {}
  }
  const maps = {
    load: (callback: () => void) => callback(),
    LatLng,
    Map: MapInstance,
    Polygon: Overlay,
    Marker,
    MarkerClusterer,
    Circle: Overlay,
    event: { addListener() {} },
  } as unknown as KakaoMapsNamespace;

  test("결손이 있으면 개수와 함께 보인다", () => {
    loadKakaoSdkMock.mockReset();
    loadKakaoSdkMock.mockResolvedValue(maps);
    render(
      <KakaoMap
        appKey="public-app-key"
        boundary={boundary()}
        regions={[]}
        facilities={[]}
        scores={new Map()}
        selectedRegionCode={null}
        radiusKm={2}
        showFacilities={false}
        legendLabel="상대 분석값"
        noDataCount={2}
        onSelectRegion={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId("map-legend-nodata")).toHaveTextContent("자료 없음 2곳");
  });

  test("결손이 0곳이면 아예 렌더하지 않는다", () => {
    loadKakaoSdkMock.mockReset();
    loadKakaoSdkMock.mockResolvedValue(maps);
    render(
      <KakaoMap
        appKey="public-app-key"
        boundary={boundary()}
        regions={[]}
        facilities={[]}
        scores={new Map()}
        selectedRegionCode={null}
        radiusKm={2}
        showFacilities={false}
        noDataCount={0}
        onSelectRegion={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.queryByTestId("map-legend-nodata")).not.toBeInTheDocument();
  });
});
