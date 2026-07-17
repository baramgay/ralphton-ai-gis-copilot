import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CopilotApp } from "@/components/copilot/copilot-app";

const snapshot = {
  mode: "demo" as const,
  referenceMonth: "2026-06",
  months: [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ],
  regions: [
    {
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      representativePoint: { lat: 35.1, lng: 129.04 },
      areaSquareKm: 1,
      months: [
        "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      ],
      population: Array(13).fill(5000),
      households: Array(13).fill(2200),
      populationDensity: Array(13).fill(5000),
      youthPopulation: Array(13).fill(600),
      workingAgePopulation: Array(13).fill(3200),
      elderlyPopulation: Array(13).fill(1200),
      onePersonHouseholds: Array(13).fill(900),
      births: Array(13).fill(2),
      deaths: Array(13).fill(3),
      naturalChange: Array(13).fill(-1),
    },
  ],
  facilities: [
    {
      id: "f1",
      name: "중앙의원",
      type: "의원" as const,
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      lat: 35.1,
      lng: 129.04,
      specialties: ["내과"],
      hours: null,
    },
    {
      id: "f2",
      name: "중앙약국",
      type: "약국" as const,
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      lat: 35.101,
      lng: 129.041,
      specialties: null,
      hours: null,
    },
  ],
  sourceNotes: ["테스트 데모 데이터"],
};

const boundary = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: {
        adm_cd2: "2611051000",
        adm_nm: "부산광역시 중구 중앙동",
        sggnm: "중구",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [129.03, 35.09],
            [129.05, 35.09],
            [129.05, 35.11],
            [129.03, 35.11],
            [129.03, 35.09],
          ],
        ],
      },
    },
  ],
};

describe("CopilotApp", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/data/snapshot")) {
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        if (url.includes("busan-administrative")) {
          return new Response(JSON.stringify(boundary), { status: 200 });
        }
        if (url.includes("/api/ai/parse")) {
          return new Response(JSON.stringify({
            mode: "demo",
            intent: { tool: "filterFacilitiesByTypeAndHours", filters: { facilityTypes: ["약국"] } },
            notice: "로컬 규칙 기반 분석으로 처리했습니다.",
          }), { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    );
  });

  test("renders the eight quick analyses and a keyless demo map", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);

    expect(await screen.findByText("DemoMap")).toBeInTheDocument();
    for (const label of [
      "의료 취약 지역",
      "고령 인구 × 의료 부족",
      "인구 증가 × 공급 부족",
      "최근접 의료기관 거리",
      "2km 접근성",
      "기장군 vs 강서구",
      "전체 의료기관",
      "초기화",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("img", { name: "부산 행정동 분석 지도" })).toBeInTheDocument();
    expect(screen.getByText("산식과 해석 기준")).toBeInTheDocument();
    expect(screen.getAllByText(/winsorized min-max/).length).toBeGreaterThan(0);
    expect(screen.getByText("의료취약지수")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/data/snapshot?mode=auto",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("switches help and data information tabs accessibly", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByText("DemoMap");

    fireEvent.click(screen.getByRole("tab", { name: "이용방법" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("빠른 분석");

    fireEvent.click(screen.getByRole("tab", { name: "데이터 정보" }));
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("2026-06"));
  });

  test("executes a distinct radius result and exposes its active metric", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByText("DemoMap");

    fireEvent.click(screen.getByRole("button", { name: "2km 접근성" }));

    expect(screen.getByRole("heading", { name: "2km 의료기관 접근성" })).toBeInTheDocument();
    expect(screen.getByText("2km 내 의료기관")).toBeInTheDocument();
  });

  test("keeps an explicit pharmacy query synchronized with facility results", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByText("DemoMap");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "약국" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    expect(await screen.findByRole("heading", { name: "의료기관 검색" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("AI GIS 분석 패널")).getByRole("button", { name: /중앙약국/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/의료취약지수/)).not.toBeInTheDocument();
  });

  test("supports arrow-key tab navigation and an accessible mobile sheet toggle", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByText("DemoMap");

    const analysisTab = screen.getByRole("tab", { name: "분석" });
    analysisTab.focus();
    fireEvent.keyDown(analysisTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "이용방법" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("3단계로 시작하기");

    const sheetToggle = screen.getByRole("button", { name: "분석 패널 확장" });
    fireEvent.click(sheetToggle);
    expect(sheetToggle).toHaveAttribute("aria-expanded", "true");
  });
});
