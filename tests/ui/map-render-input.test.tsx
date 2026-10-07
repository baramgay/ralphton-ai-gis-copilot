import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CopilotApp } from "@/components/copilot/copilot-app";
import type { BoundaryCollection, AnalysisSnapshot } from "@/components/copilot/types";

const { polygonCount, cameraCount, mapProps } = vi.hoisted(() => ({
  polygonCount: vi.fn(), cameraCount: vi.fn(), mapProps: vi.fn(),
}));

let savedStorage: Array<[string, string]> = [];
let savedUrl = "/";
beforeEach(() => {
  vi.clearAllMocks();
  savedStorage = Object.entries(localStorage);
  savedUrl = window.location.href;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const [key, value] of savedStorage) localStorage.setItem(key, value);
  window.history.replaceState(null, "", savedUrl);
});

vi.mock("@/lib/analytics/client", () => ({ recordUsage: vi.fn(), recordVisit: vi.fn() }));
vi.mock("@/components/copilot/map-canvas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/copilot/map-canvas")>();
  return { MapCanvas: (props: Parameters<typeof original.MapCanvas>[0]) => {
    mapProps(props);
    return <original.MapCanvas {...props} />;
  } };
});
vi.mock("@/components/copilot/kakao-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/copilot/kakao-sdk")>();
  class Overlay { setMap() {} }
  class Polygon extends Overlay { constructor() { super(); polygonCount(); } }
  const maps = {
    load: (callback: () => void) => callback(),
    LatLng: class { constructor(readonly lat: number, readonly lng: number) {} },
    LatLngBounds: class { extend() {} },
    Map: class { setCenter() { cameraCount(); } setBounds() { cameraCount(); } setLevel() { cameraCount(); } relayout() {} },
    Polygon, Marker: Overlay, Circle: Overlay,
    event: { addListener() {} },
  };
  return { ...original, loadKakaoSdk: vi.fn().mockResolvedValue(maps),
    ensureMarkerClusterer: vi.fn().mockResolvedValue(false),
  };
});

test("typing a draft keeps map inputs and existing polygons unchanged", async () => {
  localStorage.clear();
  localStorage.setItem("ralphton-onboard-v1", "1");
  window.history.replaceState(null, "", "/");
  const snapshot = JSON.parse(readFileSync("public/data/official-snapshot.json", "utf8")) as AnalysisSnapshot;
  snapshot.regions = snapshot.regions.slice(0, 2);
  snapshot.facilities = [];
  const boundary = JSON.parse(readFileSync("public/data/administrative-dong-20260701.geojson", "utf8")) as BoundaryCollection;
  boundary.features = boundary.features.filter((feature) => snapshot.regions.some((region) => region.adm_cd2 === feature.properties.adm_cd2));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/api/data/snapshot")) return new Response(JSON.stringify(snapshot));
    if (path.includes("administrative-dong")) return new Response(JSON.stringify(boundary));
    if (path.includes("/api/health")) return new Response(JSON.stringify({ status: "ok", capabilities: {} }));
    if (path.includes("/api/data/sync")) return new Response(JSON.stringify({ ok: true, dataSyncConfigured: false }));
    return new Response("{}", { status: 404 });
  }));
  render(<CopilotApp kakaoMapKey="public-test-key" />);
  await waitFor(() => expect(screen.getByTestId("copilot-shell")).toBeInTheDocument());
  await waitFor(() => expect(polygonCount).toHaveBeenCalled());
  await act(async () => {});
  const beforePolygons = polygonCount.mock.calls.length;
  const beforeCamera = cameraCount.mock.calls.length;
  const beforeProps = mapProps.mock.calls.at(-1)![0];
  const input = screen.getByPlaceholderText("경남 지역을 질문하세요. 예: 김해 생활인구");
  for (const draft of ["양", "양산", "양산시"]) fireEvent.change(input, { target: { value: draft } });
  const afterProps = mapProps.mock.calls.at(-1)![0];
  const changed = ["boundary", "regions", "regionFilters", "facilities", "livePlaces", "scores", "focusRegionCodes", "hoverRows", "onSelectRegion", "onSelectFacility", "onSelectLivePlace"].filter((key) => beforeProps[key] !== afterProps[key]);
  expect({ changed, addedPolygons: polygonCount.mock.calls.length - beforePolygons, cameraCalls: cameraCount.mock.calls.length - beforeCamera }).toEqual({ changed: [], addedPolygons: 0, cameraCalls: 0 });
});
