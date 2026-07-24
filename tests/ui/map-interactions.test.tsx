import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DemoMap } from "@/components/copilot/demo-map";
import { KakaoMap } from "@/components/copilot/kakao-map";
import { MapCanvas } from "@/components/copilot/map-canvas";
import type {
  KakaoMapInstance,
  KakaoMarker,
  KakaoMapsNamespace,
  KakaoOverlay,
} from "@/components/copilot/kakao-sdk";
import type { BoundaryCollection, Facility, RegionSeries } from "@/components/copilot/types";

const { loadKakaoSdkMock } = vi.hoisted(() => ({
  loadKakaoSdkMock: vi.fn(),
}));

vi.mock("@/components/copilot/kakao-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/copilot/kakao-sdk")>();
  return { ...actual, loadKakaoSdk: loadKakaoSdkMock };
});

const boundary: BoundaryCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { adm_cd2: "4812125000", adm_nm: "경상남도 창원시 의창구 동읍" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [129.03, 35.09],
          [129.05, 35.09],
          [129.05, 35.11],
          [129.03, 35.11],
          [129.03, 35.09],
        ]],
      },
    },
  ],
};

const months = [
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
];

const regions: RegionSeries[] = [{
  adm_cd2: "4812125000",
  adm_nm: "경상남도 창원시 의창구 동읍",
  representativePoint: { lat: 35.1, lng: 129.04 },
  areaSquareKm: 1,
  months,
  population: Array(13).fill(5_000),
  households: Array(13).fill(2_200),
  populationDensity: Array(13).fill(5_000),
  youthPopulation: Array(13).fill(600),
  workingAgePopulation: Array(13).fill(3_200),
  elderlyPopulation: Array(13).fill(1_200),
  onePersonHouseholds: Array(13).fill(900),
  births: Array(13).fill(2),
  deaths: Array(13).fill(3),
  naturalChange: Array(13).fill(-1),
}];

const facilities: Facility[] = [
  {
    id: "clinic",
    name: "중앙의원",
    type: "의원",
    adm_cd2: "4812125000",
    adm_nm: "경상남도 창원시 의창구 동읍",
    lat: 35.1,
    lng: 129.04,
    specialties: ["내과"],
    hours: null,
  },
  {
    id: "pharmacy",
    name: "중앙약국",
    type: "약국",
    adm_cd2: "4812125000",
    adm_nm: "경상남도 창원시 의창구 동읍",
    lat: 35.101,
    lng: 129.041,
    specialties: null,
    hours: null,
  },
];

describe("DemoMap facility interactions", () => {
  test("renders every passed facility and selects markers by pointer or keyboard", () => {
    const onSelectFacility = vi.fn();

    render(
      <DemoMap
        boundary={boundary}
        regions={regions}
        facilities={facilities}
        scores={new Map([["4812125000", 73]])}
        selectedRegionCode={null}
        radiusKm={2}
        showFacilities={false}
        legendLabel="의료 취약도"
        onSelectRegion={vi.fn()}
        onSelectFacility={onSelectFacility}
      />,
    );

    const clinic = screen.getByRole("button", { name: "중앙의원 · 의원 선택" });
    const pharmacy = screen.getByRole("button", { name: "중앙약국 · 약국 선택" });

    fireEvent.click(clinic);
    fireEvent.keyDown(pharmacy, { key: "Enter" });
    fireEvent.keyDown(pharmacy, { key: " " });

    expect(onSelectFacility).toHaveBeenNthCalledWith(1, facilities[0]);
    expect(onSelectFacility).toHaveBeenNthCalledWith(2, facilities[1]);
    expect(onSelectFacility).toHaveBeenNthCalledWith(3, facilities[1]);
    expect(screen.getByText("의료 취약도")).toBeInTheDocument();
    expect(screen.getByText("정규화 0–100")).toBeInTheDocument();
  });
});

describe("KakaoMap facility interactions", () => {
  beforeEach(() => {
    loadKakaoSdkMock.mockReset();
  });

  test("adds all passed facilities to the cluster and forwards marker clicks", async () => {
    const markerRecords: Array<{ marker: KakaoMarker; title?: string }> = [];
    const listeners = new Map<object, Map<string, () => void>>();

    class LatLng {}
    class MapInstance implements KakaoMapInstance {
      setCenter() {}
    }
    class Overlay implements KakaoOverlay {
      setMap() {}
    }
    class Marker extends Overlay implements KakaoMarker {
      constructor(options: { title?: string }) {
        super();
        markerRecords.push({ marker: this, title: options.title });
      }
    }
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
      event: {
        addListener(target: object, eventName: string, handler: () => void) {
          const targetListeners = listeners.get(target) ?? new Map<string, () => void>();
          targetListeners.set(eventName, handler);
          listeners.set(target, targetListeners);
        },
      },
    } as unknown as KakaoMapsNamespace;
    loadKakaoSdkMock.mockResolvedValue(maps);
    const onSelectFacility = vi.fn();

    render(
      <KakaoMap
        appKey="public-app-key"
        boundary={boundary}
        regions={regions}
        facilities={facilities}
        scores={new Map([["4812125000", 73]])}
        selectedRegionCode={null}
        radiusKm={2}
        showFacilities={false}
        legendLabel="의료 취약도"
        onSelectRegion={vi.fn()}
        onSelectFacility={onSelectFacility}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(markerRecords).toHaveLength(2));
    const pharmacy = markerRecords.find((record) => record.title?.startsWith("중앙약국"));
    expect(pharmacy).toBeDefined();

    listeners.get(pharmacy!.marker)?.get("click")?.();

    expect(onSelectFacility).toHaveBeenCalledWith(facilities[1]);
  });
});

describe("MapCanvas SDK fallback", () => {
  test("switches to DemoMap when the bounded SDK loader rejects", async () => {
    loadKakaoSdkMock.mockReset();
    loadKakaoSdkMock.mockRejectedValue(new Error("Kakao Maps SDK 로드 시간 초과"));

    render(
      <MapCanvas
        kakaoMapKey="public-app-key"
        boundary={boundary}
        regions={regions}
        facilities={facilities}
        scores={new Map()}
        selectedRegionCode={null}
        radiusKm={2}
        showFacilities={false}
        onSelectRegion={vi.fn()}
      />,
    );

    expect(await screen.findByText("DemoMap", {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.getByText(/Kakao 지도 연결 실패/)).toBeInTheDocument();
  });
});
