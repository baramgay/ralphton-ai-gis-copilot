import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { KakaoMap } from "@/components/copilot/kakao-map";
import type {
  KakaoLatLngBounds,
  KakaoMapInstance,
  KakaoMapsNamespace,
  KakaoOverlay,
} from "@/components/copilot/kakao-sdk";
import type { BoundaryCollection, RegionSeries } from "@/components/copilot/types";

/**
 * 지도가 어디를 비추는가.
 *
 * prod에서 앱을 열면 화면이 온통 파란 단색이었다. 분석 1위(거창군 북상면)가 자동 선택되고
 * 지도가 그 폴리곤 하나로 setLevel(6)까지 확대해, 산속 읍면 하나가 뷰포트를 가득 채운
 * 것이었다. 390px에서는 특히 심해 "경남 어디가 높은가"를 볼 방법이 아예 없었다.
 *
 * 렌더링 스모크로는 안 잡힌다 — 지도는 정상적으로 그려졌고, 다만 엉뚱한 곳을 비췄다.
 * 그래서 카메라 호출 자체를 잰다.
 */

const { loadKakaoSdkMock } = vi.hoisted(() => ({ loadKakaoSdkMock: vi.fn() }));

vi.mock("@/components/copilot/kakao-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/copilot/kakao-sdk")>();
  return { ...actual, loadKakaoSdk: loadKakaoSdkMock };
});

const months = [
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
];

/** 경남 서쪽 끝과 동쪽 끝에 하나씩. 전역 보기가 되면 둘 다 들어와야 한다. */
const boundary: BoundaryCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { adm_cd2: "4812125000", adm_nm: "경상남도 창원시 의창구 동읍" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [128.60, 35.20],
          [128.70, 35.20],
          [128.70, 35.30],
          [128.60, 35.30],
          [128.60, 35.20],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { adm_cd2: "4888037000", adm_nm: "경상남도 거창군 북상면" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [127.80, 35.70],
          [127.95, 35.70],
          [127.95, 35.85],
          [127.80, 35.85],
          [127.80, 35.70],
        ]],
      },
    },
  ],
};

const regions: RegionSeries[] = [
  {
    adm_cd2: "4888037000",
    adm_nm: "경상남도 거창군 북상면",
    representativePoint: { lat: 35.78, lng: 127.87 },
    areaSquareKm: 1,
    months,
    population: Array(13).fill(1_000),
    households: Array(13).fill(400),
    populationDensity: Array(13).fill(1_000),
    youthPopulation: Array(13).fill(100),
    workingAgePopulation: Array(13).fill(500),
    elderlyPopulation: Array(13).fill(400),
    onePersonHouseholds: Array(13).fill(200),
    births: Array(13).fill(0),
    deaths: Array(13).fill(2),
    naturalChange: Array(13).fill(-2),
  },
];

type Camera = {
  centers: Array<{ lat: number; lng: number }>;
  levels: number[];
  bounds: Array<Array<{ lat: number; lng: number }>>;
  circles: number;
};

function buildMaps(camera: Camera): KakaoMapsNamespace {
  class LatLng {
    constructor(
      readonly lat: number,
      readonly lng: number,
    ) {}
  }
  class Bounds implements KakaoLatLngBounds {
    readonly points: Array<{ lat: number; lng: number }> = [];
    extend(position: object) {
      const point = position as LatLng;
      this.points.push({ lat: point.lat, lng: point.lng });
    }
  }
  class MapInstance implements KakaoMapInstance {
    setCenter(position: object) {
      const point = position as LatLng;
      camera.centers.push({ lat: point.lat, lng: point.lng });
    }
    setLevel(level: number) {
      camera.levels.push(level);
    }
    setBounds(bounds: KakaoLatLngBounds) {
      camera.bounds.push((bounds as Bounds).points);
    }
    relayout() {}
  }
  class Overlay implements KakaoOverlay {
    setMap() {}
  }
  class Circle extends Overlay {
    constructor() {
      super();
      camera.circles += 1;
    }
  }

  return {
    load: (callback: () => void) => callback(),
    LatLng,
    LatLngBounds: Bounds,
    Map: MapInstance,
    Polygon: Overlay,
    Marker: Overlay,
    Circle,
    event: { addListener() {} },
  } as unknown as KakaoMapsNamespace;
}

function renderMap(props: {
  selectedRegionCode: string | null;
  followSelection?: boolean;
  showRadius?: boolean;
}) {
  const camera: Camera = { centers: [], levels: [], bounds: [], circles: 0 };
  loadKakaoSdkMock.mockResolvedValue(buildMaps(camera));
  render(
    <KakaoMap
      appKey="public-app-key"
      boundary={boundary}
      regions={regions}
      facilities={[]}
      scores={new Map([["4888037000", 99]])}
      radiusKm={2}
      showFacilities={false}
      legendLabel="의료 취약도"
      onSelectRegion={vi.fn()}
      onError={vi.fn()}
      {...props}
    />,
  );
  return camera;
}

describe("KakaoMap 카메라", () => {
  beforeEach(() => {
    loadKakaoSdkMock.mockReset();
  });

  test("자동 선택된 1위를 따라 확대하지 않고 경계 전체를 비춘다", async () => {
    const camera = renderMap({ selectedRegionCode: "4888037000", followSelection: false });

    await waitFor(() => expect(camera.bounds.length).toBeGreaterThan(0));

    // 경계 두 폴리곤을 모두 감싸는 사각형이어야 한다.
    const [southWest, northEast] = camera.bounds[0];
    expect(southWest.lat).toBeCloseTo(35.2, 5);
    expect(southWest.lng).toBeCloseTo(127.8, 5);
    expect(northEast.lat).toBeCloseTo(35.85, 5);
    expect(northEast.lng).toBeCloseTo(128.7, 5);

    // 선택 지역으로 파고드는 확대(setLevel(6))가 없어야 한다.
    expect(camera.levels).not.toContain(6);
    expect(camera.centers).toHaveLength(0);
  });

  test("사용자가 직접 고른 지역은 따라간다", async () => {
    const camera = renderMap({ selectedRegionCode: "4888037000", followSelection: true });

    await waitFor(() => expect(camera.centers.length).toBeGreaterThan(0));
    expect(camera.centers.at(-1)).toEqual({ lat: 35.78, lng: 127.87 });
    expect(camera.levels).toContain(6);
  });

  test("반경 원은 showRadius일 때만 그린다", async () => {
    const withRadius = renderMap({
      selectedRegionCode: "4888037000",
      followSelection: true,
      showRadius: true,
    });
    await waitFor(() => expect(withRadius.circles).toBe(1));
  });

  test("의료 분석이 아니면 반경 원을 그리지 않는다", async () => {
    const withoutRadius = renderMap({
      selectedRegionCode: "4888037000",
      followSelection: true,
      showRadius: false,
    });
    // 원이 없어도 지도는 그려진다. 그려진 뒤에 원 개수를 본다.
    await waitFor(() => expect(withoutRadius.bounds.length).toBeGreaterThan(0));
    expect(withoutRadius.circles).toBe(0);
  });
});
