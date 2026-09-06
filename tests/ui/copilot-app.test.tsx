import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CopilotApp } from "@/components/copilot/copilot-app";

/**
 * 조작 패널을 연다.
 *
 * 질의창이 지도 위 히어로로 올라가면서 이 패널은 기본으로 접힌다. 접힌 패널은
 * `aria-hidden`이라 접근성 트리에서 빠지고, getByRole이 그 안의 것을 못 찾는다 — 그것이
 * 맞는 동작이다(눈에 안 보이는 것은 스크린리더에도 안 보여야 한다). 그러니 패널 내용을
 * 만지는 테스트는 사람이 하듯 먼저 열어야 한다.
 */
function openControls() {
  // 배치는 localStorage에 남는다. 앞 테스트가 열어 둔 채로 끝나면 여기서 무조건 누를 때
  // 오히려 닫힌다 — 실제로 그 순서 의존 때문에 두 테스트가 깨졌다. 열려 있으면 놔둔다.
  const toggle = screen.getByRole("button", { name: "조작" });
  if (toggle.getAttribute("aria-pressed") === "true") return;
  fireEvent.click(toggle);
}

const snapshot = {
  mode: "demo" as const,
  referenceMonth: "2026-06",
  months: [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ],
  regions: [
    {
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
      lat: 35.1,
      lng: 129.04,
      specialties: ["내과"],
      hours: null,
    },
    {
      id: "f2",
      name: "중앙약국",
      type: "약국" as const,
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
        adm_cd2: "4812125000",
        adm_nm: "경상남도 창원시 의창구 동읍",
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
    /*
     * 질의를 실행하면 앱이 공유 URL을 `history.replaceState`로 주소창에 쓴다. jsdom의 URL은
     * 파일 전체가 공유하므로, 앞 테스트가 남긴 `?tool=…&q=…`를 다음 테스트가 "공유 링크로
     * 열렸다"로 읽고 그 질의를 복원 실행한다. 매 테스트를 빈 주소에서 시작한다.
     */
    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("ralphton-onboard-v1", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/data/snapshot")) {
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        if (url.includes("administrative-dong")) {
          return new Response(JSON.stringify(boundary), { status: 200 });
        }
        if (url.includes("/api/ai/parse")) {
          return new Response(JSON.stringify({
            mode: "demo",
            intent: { tool: "filterFacilitiesByTypeAndHours", filters: { facilityTypes: ["약국"] } },
            notice: "질문을 분석에 반영했습니다.",
          }), { status: 200 });
        }
        if (url.includes("/api/kakao/places")) {
          return new Response(JSON.stringify({ ok: true, places: [], notice: "장소 없음" }), { status: 200 });
        }
        if (url.includes("/api/health")) {
          return new Response(
            JSON.stringify({
              status: "ok",
              capabilities: {
                kakaoMapsJs: false,
                kakaoRest: false,
                ai: false,
                publicData: false,
                supabase: false,
                dataSync: false,
                populationLive: false,
                cronAlert: false,
                ragRemoteEmbed: false,
              },
              publishedLive: { available: false },
              syncOps: {
                lastStatus: "idle",
                stale: true,
                recommendSync: true,
                reason: "게시된 live 스냅샷이 없습니다. 시설 동기화를 권장합니다.",
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/data/sync")) {
          return new Response(
            JSON.stringify({
              ok: true,
              dataSyncConfigured: false,
              publishedLive: { available: false },
              syncOps: {
                lastStatus: "idle",
                stale: true,
                recommendSync: true,
                reason: "게시된 live 스냅샷이 없습니다. 시설 동기화를 권장합니다.",
                lastAttemptAt: null,
                lastFacilityCount: null,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/rag/search")) {
          return new Response(JSON.stringify({ ok: true, hits: [], context: "" }), { status: 200 });
        }
        if (url.includes("/data/layers/skt-living.json")) {
          return new Response(
            JSON.stringify({
              layerId: "skt-living",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    living_total: Array(13).fill(8000),
                    elderly_ratio: Array(13).fill(18),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/skt-mobility.json")) {
          return new Response(
            JSON.stringify({
              layerId: "skt-mobility",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    inflow_total: Array(13).fill(9000),
                    outflow_total: Array(13).fill(4000),
                    net_flow: Array(13).fill(5000),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/skt-daynight.json")) {
          return new Response(
            JSON.stringify({
              layerId: "skt-daynight",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    day_population: Array(13).fill(11000),
                    night_population: Array(13).fill(7000),
                    day_night_ratio: Array(13).fill(157.1),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/nh-consumption.json")) {
          return new Response(
            JSON.stringify({
              layerId: "nh-consumption",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: { card_sales: Array(13).fill(12000), card_txns: Array(13).fill(34000) },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/nh-storetype.json")) {
          return new Response(
            JSON.stringify({
              layerId: "nh-storetype",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    restaurant_share: Array(13).fill(18.2),
                    cafe_share: Array(13).fill(2.1),
                    pub_share: Array(13).fill(0.9),
                    grocery_share: Array(13).fill(21.4),
                    fuel_share: Array(13).fill(24.8),
                    medical_store_share: Array(13).fill(3.6),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/nh-industry.json")) {
          return new Response(
            JSON.stringify({
              layerId: "nh-industry",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    food_share: Array(13).fill(21.5),
                    retail_share: Array(13).fill(48.2),
                    health_share: Array(13).fill(12.1),
                    leisure_share: Array(13).fill(3.4),
                    education_share: Array(13).fill(2.8),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/nh-hourly.json")) {
          return new Response(
            JSON.stringify({
              layerId: "nh-hourly",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    day_sales: Array(13).fill(8200),
                    night_sales: Array(13).fill(940),
                    night_share: Array(13).fill(7.3),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/nh-demographics.json")) {
          return new Response(
            JSON.stringify({
              layerId: "nh-demographics",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    youth_share: Array(13).fill(28.4),
                    middle_share: Array(13).fill(45.1),
                    senior_share: Array(13).fill(26.5),
                    female_share: Array(13).fill(52.3),
                    corporate_share: Array(13).fill(18.7),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/kcb-commute.json")) {
          return new Response(
            JSON.stringify({
              layerId: "kcb-commute",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    jobs_in: Array(13).fill(4200),
                    job_ratio: Array(13).fill(132.5),
                    outbound_ratio: Array(13).fill(48.1),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/kcb-migration.json")) {
          return new Response(
            JSON.stringify({
              layerId: "kcb-migration",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: { move_in: Array(13).fill(1200), move_out_sgg: Array(13).fill(3400) },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/data/layers/kcb-credit.json")) {
          return new Response(
            JSON.stringify({
              layerId: "kcb-credit",
              adminLevel: "dong",
              referenceMonth: "2026-06",
              months: snapshot.months,
              cells: [
                {
                  code: "4812125000",
                  name: "창원시 의창구 동읍",
                  point: { lat: 35.1, lng: 129.04 },
                  areaKm2: 1,
                  series: {
                    avg_income: Array(13).fill(320),
                    credit_score: Array(13).fill(850),
                    card_spend: Array(13).fill(90),
                    loan_ratio: Array(13).fill(40),
                    delinquency_ratio: Array(13).fill(2),
                    highend_ratio: Array(13).fill(5),
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    );
  });

  test(
    "renders the eight quick analyses and a keyless demo map",
    async () => {
      render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);

      expect(await screen.findByTestId("demo-map-badge", {}, { timeout: 20_000 })).toBeInTheDocument();
      openControls();
      for (const label of [
        "의료 접근성",
        "고령 대비 의료",
        "인구 증가",
        "최근접 의료기관",
        "반경 내 의료기관",
        "지역 비교",
        "의료기관 목록",
        "초기화",
      ]) {
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      }
      expect(
        screen.getByRole("img", { name: /경상남도 행정동 분석 지도/ }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("result-panel")).toBeInTheDocument();
      expect(screen.getByText("산식 · 해석 기준")).toBeInTheDocument();
      expect(screen.getAllByText(/winsorized min-max/).length).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledWith(
        "/api/data/snapshot?mode=auto",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
    30_000,
  );

  test("switches help and data information tabs accessibly", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    fireEvent.click(screen.getByRole("tab", { name: "이용" }));
    expect(screen.getByTestId("usage-guide")).toBeInTheDocument();
    expect(screen.getByText("활용 가이드")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "데이터" }));
    await waitFor(() => expect(screen.getByText("행정동")).toBeInTheDocument());
    // 「무엇을 썼는가」는 결과만큼 중요하다. 데이터 탭에 목록이 실제로 있어야 한다.
    expect(screen.getByTestId("data-inventory")).toBeInTheDocument();
  });

  test("executes a distinct radius result and exposes its active metric", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    fireEvent.click(screen.getByRole("button", { name: "반경 내 의료기관" }));

    expect(screen.getByRole("heading", { name: "2km 의료기관 접근성" })).toBeInTheDocument();
    expect(screen.getByText("2km 내 의료기관")).toBeInTheDocument();
  });

  test("keeps an explicit pharmacy query synchronized with facility results", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "약국" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    expect(await screen.findByRole("heading", { name: "의료기관 검색" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("result-panel")).getByRole("button", { name: /중앙약국/ }),
    ).toBeInTheDocument();
    // Facility search should not use scarcity ranking title
    expect(screen.queryByRole("heading", { name: /의료 접근성/ })).not.toBeInTheDocument();
  });

  test("supports mobile panel toggles for left and right sheets", async () => {
    /*
     * 같은 버튼이 폭에 따라 다르게 동작한다 — 좁으면 바텀시트를, 넓으면 접힘 상태를
     * 움직인다. jsdom은 matchMedia가 없어 기본이 "넓은 화면"이므로, 모바일 동작을 보려면
     * 좁은 화면이라고 답하게 해야 한다. 안 그러면 이 테스트는 이름과 달리 데스크톱을 잰다.
     */
    vi.stubGlobal(
      "matchMedia",
      vi.fn((queryText: string) => ({
        matches: queryText.includes("max-width: 900px"),
        media: queryText,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );

    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.click(screen.getByRole("button", { name: "조작" }));
    expect(screen.getByLabelText("분석 조작 패널").className).toMatch(/sheet-open/);

    fireEvent.click(screen.getByRole("button", { name: "결과" }));
    expect(screen.getByTestId("result-panel").className).toMatch(/sheet-open/);

    vi.unstubAllGlobals();
  });

  test("shows compare picker when gu compare is selected", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    fireEvent.click(screen.getByRole("button", { name: "지역 비교" }));
    expect(await screen.findByTestId("compare-picker")).toBeInTheDocument();
    expect(screen.getByLabelText("비교 지역 A")).toBeInTheDocument();
    expect(screen.getByLabelText("비교 지역 B")).toBeInTheDocument();
    const compare = screen.getByTestId("compare-picker");
    expect(within(compare).getByRole("button", { name: "행정동" })).toBeInTheDocument();
    fireEvent.click(within(compare).getByRole("button", { name: "행정동" }));
    expect(screen.getByLabelText("비교 지역 A")).toBeInTheDocument();
  });

  test("theme controls are available in settings", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge", {}, { timeout: 10_000 });

    openControls();
    await fireEvent.click(screen.getByRole("tab", { name: "분석" }));
    // Open settings details
    const details = screen.getByText("화면 설정");
    fireEvent.click(details);

    expect(await screen.findByTestId("theme-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-system")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("theme-dark"));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    fireEvent.click(screen.getByTestId("theme-light"));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBeUndefined();
    });
  });

  test("copy conclusion button appears after analysis", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge", {}, { timeout: 10_000 });
    expect(await screen.findByTestId("one-line-conclusion")).toBeInTheDocument();
    expect(screen.getByTestId("copy-conclusion")).toBeInTheDocument();
  });

  test("help tab shows evaluator guide and method summary on results", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge", {}, { timeout: 10_000 });
    expect(await screen.findByTestId("method-summary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "이용" }));
    expect(await screen.findByTestId("evaluator-guide")).toBeInTheDocument();
    expect(screen.getByText(/평가자 점검 가이드/)).toBeInTheDocument();
  });

  test("facility list shows sort controls", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge", {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "의료기관 목록" }));
    expect(await screen.findByTestId("facility-sort-name")).toBeInTheDocument();
    expect(screen.getByTestId("facility-sort-type")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("facility-sort-type"));
    expect(screen.getByTestId("facility-sort-type")).toHaveAttribute("aria-pressed", "true");
  });

  test("hides medical quick analysis and sources methodology/month from the active layer when a cube layer is selected", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    // Medical is the default layer: quick analysis grid is present.
    expect(screen.getByRole("button", { name: "의료 접근성" })).toBeInTheDocument();
    expect(screen.getByTestId("method-summary")).toHaveTextContent(/2km 무시설 15%/);

    const layerGroup = screen.getByRole("group", { name: "레이어 선택" });
    fireEvent.click(within(layerGroup).getByRole("button", { name: /^인구/ }));

    // Cube layer active: medical-only quick analysis grid and radius picker are gone.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "의료 접근성" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("2. 빠른 분석")).not.toBeInTheDocument();
    expect(screen.queryByText("3. 접근 반경")).not.toBeInTheDocument();
    // NL query box stays available for cube layers.
    expect(screen.getByRole("textbox", { name: "분석 질의" })).toBeInTheDocument();

    // Methodology now describes the active metric (총인구), not the medical formula.
    expect(screen.getByTestId("method-summary")).toHaveTextContent(/총인구/);
    expect(screen.getByTestId("method-summary")).not.toHaveTextContent(/2km 무시설 15%/);
    // Reference-month/provider badge is sourced from the active layer, not left dangling.
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("공공");
  });

  test("공공 도구 질의는 그 질의의 산식을 방법론에 보여 준다", async () => {
    /*
     * 공공 도구 결과는 activeLayerId가 "medical"인 채로 렌더돼, 방법론 칸이 무엇을 물어도
     * 의료 접근성 취약지수 공식만 보여 주고 있었다(prod 실측). "세대수 많은 동"을 물었는데 화면
     * 아래에 "공급 부족 35% + 고령 수요 25% …"가 붙어 나왔다.
     */
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    // 공용 목은 늘 시설 검색을 돌려준다. 이 테스트는 **순위** 결과가 필요하므로 그것만 바꾼다.
    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/parse")) {
        return new Response(
          JSON.stringify({
            mode: "demo",
            intent: { tool: "rankHouseholdCount", filters: { limit: 20 } },
            notice: "기준월 세대 수가 많은 행정동 순입니다.",
          }),
          { status: 200 },
        );
      }
      return inner(input, init);
    }) as typeof global.fetch;

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "세대수 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/세대/);
    });
    expect(screen.getByTestId("method-summary")).not.toHaveTextContent(/2km 무시설 15%/);
    expect(screen.getByTestId("method-summary")).not.toHaveTextContent(/공급 부족 35%/);
  });

  test("routes a 생활인구 natural-language query to the SKT private layer", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    // Default layer is 의료(공공). Submit a private-data NL query.
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "생활인구 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    // NL switched the active choropleth to the SKT 생활인구 layer (not public 인구):
    // methodology sources the private metric and provenance shows SKT.
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/생활인구/);
    });
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("SKT");
  });

  test("routes a 유입인구 natural-language query to the SKT mobility layer", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "유입인구 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/유입인구/);
    });
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("SKT");
  });

  test("routes a 카드매출 query to the NH consumption layer", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "카드매출 높은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/카드매출/);
    });
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("NH");
  });

  test("routes a 평균소득 query to the KCB credit layer", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "평균소득 높은 지역" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/평균소득/);
    });
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("KCB");
  });

  test("runs a 민간×민간 교차분석 for '생활인구 대비 카드매출'", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    // give the remote cubes (skt-living + nh-consumption) a tick to load
    await waitFor(() => expect(screen.getByTestId("result-panel")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "생활인구 대비 카드매출 낮은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    const hits = await screen.findAllByText(/교차분석/, {}, { timeout: 15_000 });
    expect(hits.length).toBeGreaterThan(0);
    // both operands' providers are surfaced
    expect(screen.getAllByText(/SKT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NH/).length).toBeGreaterThan(0);
    // the summary explains the shortfall rather than just listing a ranking
    expect(screen.getAllByText(/가장 부족한 곳/).length).toBeGreaterThan(0);

    // methodology must describe the cross formula, not the medical layer it borrows
    // activeLayerId from
    expect(screen.getByTestId("method-summary")).toHaveTextContent(/합성점수/);
    expect(screen.getByTestId("method-summary")).not.toHaveTextContent(/2km 무시설 15%/);
    // the one-line conclusion must not claim the ranking is by operand A alone
    expect(screen.getByTestId("one-line-conclusion")).toHaveTextContent(/가장 부족한 곳/);
  }, 30_000);

  /*
   * 리졸버 테스트가 통과해도 화면에서 실행되는지는 별개다.
   *
   * 의료 교차가 그렇게 새어 나갔다 — resolveCrossQuery는 정상이었는데 CUBE_LAYER_METRICS에
   * medical이 빠져 있어 runCross가 조용히 false를 돌려주고, 화면은 아무 말 없이 단일 결과를
   * 보여줬다. 리졸버 테스트는 전부 통과하고 있었다. 그래서 여기서는 **실제로 실행됐는지**를
   * 화면 글자로 확인한다.
   */
  test("세 지표 질의가 다중조건으로 실행된다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    await waitFor(() => expect(screen.getByTestId("result-panel")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "생활인구 많고 카드매출 높고 연체율 낮은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    const hits = await screen.findAllByText(/다중조건/, {}, { timeout: 15_000 });
    expect(hits.length).toBeGreaterThan(0);

    // 세 지표가 모두 결과에 나타나야 한다 — 두 개만 잡고 하나를 버리면 안 된다.
    const method = screen.getByTestId("method-summary");
    expect(method).toHaveTextContent(/총생활인구/);
    expect(method).toHaveTextContent(/카드/);
    expect(method).toHaveTextContent(/연체/);
    // 마지막 지표는 낮은 쪽으로 물었으므로 부호가 −여야 한다.
    expect(method).toHaveTextContent(/−z\(/);
  }, 30_000);

  test("routes a 주야비 query to the SKT day/night layer", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "주야비 높은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/주야비/);
    });
    expect(screen.getByTestId("data-provenance")).toHaveTextContent("SKT");
  });

  test("CSV·보고서·한글·슬라이드 내보내기 버튼이 결과 패널에 노출된다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    expect(await screen.findByTestId("export-report")).toBeInTheDocument();
    expect(screen.getByTestId("export-csv")).toBeInTheDocument();
    expect(screen.getByTestId("export-hwp")).toBeInTheDocument();
    expect(screen.getByTestId("export-slides")).toBeInTheDocument();
  });

  test("선택 지역의 민간데이터 종합 프로파일을 백분위와 함께 보여준다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    const profile = await screen.findByTestId("region-profile", {}, { timeout: 15_000 });
    // 여러 제공기관의 지표가 한 패널에 모인다
    expect(within(profile).getAllByText(/\[SKT\]/).length).toBeGreaterThan(0);
    expect(within(profile).getAllByText(/\[NH\]/).length).toBeGreaterThan(0);
    expect(within(profile).getAllByText(/\[KCB\]/).length).toBeGreaterThan(0);
    // 절대값만 보고 오판하지 않도록 백분위 기준을 명시한다
    expect(within(profile).getByText(/백분위/)).toBeInTheDocument();
  }, 30_000);

  test("레이어와 프리셋이 각각 제공기관·정책영역으로 묶여 보인다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    /*
     * 레이어: 큰 갈래는 민간·공공 둘이고 제공기관은 그 아래다. 제공기관을 최상위에 놓으면
     * 「공공」 아래에 인구와 의료기관 둘만 서서 이 도구가 의료 도구처럼 보인다.
     */
    const layerGroup = screen.getByRole("group", { name: "레이어 선택" });
    expect(within(layerGroup).getByText("민간 데이터")).toBeInTheDocument();
    expect(within(layerGroup).getByText("공공 데이터")).toBeInTheDocument();
    expect(within(layerGroup).queryByText("의료 데이터")).toBeNull();
    for (const provider of ["SKT", "NH", "KCB"]) {
      expect(within(layerGroup).getAllByText(provider).length).toBeGreaterThan(0);
    }

    // 프리셋: 정책 영역으로 좁힌 뒤 고른다
    const presets = await screen.findByTestId("cross-presets");
    expect(within(presets).getByText("상권 활력")).toBeInTheDocument();
    expect(within(presets).getByText("취약·격차")).toBeInTheDocument();
    // 묶어도 모든 프리셋은 그대로 눌린다
    expect(within(presets).getByTestId("cross-living-vs-sales")).toBeInTheDocument();
    expect(within(presets).getByTestId("cross-senior-vs-medical")).toBeInTheDocument();
  }, 30_000);

  test("민간 레이어를 보다가 공공 질의를 하면 결과가 바뀐다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    // 먼저 민간 레이어로 전환
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "카드매출 높은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/카드매출/);
    });

    // 이어서 공공 도구 질의. 활성 레이어를 되돌리지 않으면 민간 레이어 분석이 우선해
    // 화면이 그대로 남는다(알림만 바뀌고 결과는 안 바뀌는 상태).
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "약국" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    expect(await screen.findByRole("heading", { name: "의료기관 검색" })).toBeInTheDocument();
    expect(screen.getByTestId("method-summary")).not.toHaveTextContent(/카드매출/);
  }, 30_000);

  test("프로파일에서 추세 기간을 바꿀 수 있다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    const profile = await screen.findByTestId("region-profile", {}, { timeout: 15_000 });
    // 기본은 전 기간
    expect(within(profile).getByTestId("trend-months-0")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(profile).getByTestId("trend-months-3"));
    expect(within(profile).getByTestId("trend-months-3")).toHaveAttribute("aria-pressed", "true");
    expect(within(profile).getByTestId("trend-months-0")).toHaveAttribute("aria-pressed", "false");
  }, 30_000);

  test("원클릭 추세 프리셋이 자연어 없이 추세를 낸다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    await waitFor(() => expect(screen.getByTestId("trend-presets")).toBeInTheDocument());

    fireEvent.click(await screen.findByTestId("trend-sales-rising"));

    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/변화율/);
    });
  }, 30_000);

  test("큐브가 늦게 와도 사용자에게 다시 하라고 하지 않는다", async () => {
    // 큐브는 화면이 뜬 뒤에 받으므로, 바로 민간 질의를 던지면 아직 없을 수 있다.
    // 그때 "잠시 후 다시 시도"로 끝내지 말고, 받아 와서 그대로 이어 실행해야 한다.
    const base = fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/data/layers/nh-consumption.json")) {
          await gate;
        }
        return base(input);
      }),
    );

    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "카드매출 늘어나는 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    // 아직 큐브가 없으니 결과는 없지만, 사용자에게 재시도를 요구하지는 않는다.
    await waitFor(() => {
      expect(screen.getByText(/민간데이터 레이어를 불러오는 중/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/다시 시도해 주세요/)).toBeNull();

    // 큐브가 도착하면 눌렀던 질의가 저절로 이어진다.
    release();
    expect(await screen.findAllByText(/증가 추세/, {}, { timeout: 20_000 })).not.toHaveLength(0);
  }, 30_000);

  test("추세 질의는 값 크기가 아니라 변화 순으로 답한다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "카드매출 늘어나는 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    // 제목이 "많은 곳"이 아니라 추세임을 밝힌다
    expect(await screen.findAllByText(/증가 추세/, {}, { timeout: 15_000 })).not.toHaveLength(0);
    // 산식에 변화율 정의가 실린다
    await waitFor(() => {
      expect(screen.getByTestId("method-summary")).toHaveTextContent(/변화율/);
    });
  }, 30_000);

  test("one-click 교차분석 preset runs without typing a query", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    await waitFor(() => expect(screen.getByTestId("cross-presets")).toBeInTheDocument());

    fireEvent.click(await screen.findByTestId("cross-living-vs-sales"));

    const hits = await screen.findAllByText(/교차분석/, {}, { timeout: 15_000 });
    expect(hits.length).toBeGreaterThan(0);
  }, 30_000);

  test("selecting the 의료 layer clears a cross-analysis result instead of leaving it on screen", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    await waitFor(() => expect(screen.getByTestId("cross-presets")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("cross-living-vs-sales"));
    await screen.findAllByText(/교차분석/, {}, { timeout: 15_000 });

    // 교차분석은 activeLayerId를 medical로 두므로, 의료 버튼을 눌러도 상태가 그대로라
    // 결과가 남을 수 있다. 레이어 선택은 언제나 새 분석을 시작해야 한다.
    const layerGroup = screen.getByRole("group", { name: "레이어 선택" });
    // KOSIS 「보건의료」가 목록에 들어와 /의료/ 는 둘을 문다. 앞머리로 묶는다.
    fireEvent.click(within(layerGroup).getByRole("button", { name: /^의료기관/ }));

    // 직전 동작을 알리는 상태 문구(role="status")는 남아도 되지만, 결과 패널은
    // 선택한 레이어의 분석으로 바뀌어야 한다.
    await waitFor(() => {
      expect(within(screen.getByTestId("result-panel")).queryAllByText(/교차분석/)).toHaveLength(0);
    });
    // 의료 레이어의 기본 분석(의료 접근성 취약지수)이 돌아왔는지 방법론으로 확인
    expect(screen.getByTestId("method-summary")).toHaveTextContent(/2km 무시설 15%/);
  }, 30_000);

  test("의료취약 × 민간 교차가 실제로 실행된다", async () => {
    // 해석(resolveCrossQuery)만 테스트하면 이 결함을 못 잡는다. 실제로 겪었다 —
    // 교차 후보에는 의료를 더했는데 지표 목록에서 빠뜨려 runCross가 조용히 false를
    // 돌렸고, 화면은 직전 분석을 그대로 두었다. prod에서야 드러났다.
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    await waitFor(() => expect(screen.getByTestId("cross-presets")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "소득 낮고 의료 취약한 지역" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    // 교차로 실행됐음이 안내와 결과에 드러나야 한다.
    await waitFor(
      () => {
        expect(screen.getByTestId("query-notice").textContent ?? "").toMatch(/교차분석/);
      },
      { timeout: 15_000 },
    );
    expect(screen.getByTestId("query-notice").textContent ?? "").toMatch(/의료 접근성 취약지수/);
    expect(screen.queryByText(/분석을 실행하는 중/)).toBeNull();
  }, 30_000);

  test("답하지 못한 질의에는 직전 결과임을 밝힌다", async () => {
    // 답을 못 찾아도 화면에는 직전 분석이 남는다(작업을 잃지 않게). 그런데 그러면
    // "부산 소득 높은 곳"에 경남 순위가 붙어 그 질문의 답처럼 읽힌다(prod 실측).
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    expect(screen.queryByTestId("stale-answer-notice")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "부산 소득 높은 곳" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(screen.getByTestId("query-notice").textContent ?? "").toMatch(/부산.*범위 밖/);
    });
    expect(screen.getByTestId("stale-answer-notice")).toBeInTheDocument();

    // 답할 수 있는 질의로 바꾸면 표시가 사라진다.
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "생활인구 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => expect(screen.queryByTestId("stale-answer-notice")).toBeNull());
  }, 30_000);

  /*
   * 답 못 한 말이 「최근 질문」 칩으로 돌아오면 다시 누를거리가 된다. 오타로 아무것도
   * 못 찾은 말까지 예시 옆에 나란히 서서, 실제로 자기 입력을 제품 오타로 읽는 일이 있었다.
   */
  /*
   * 담는 쪽을 고쳐도 **이미 담긴 것은 그 사람 브라우저에 남는다**. 오타로 친 말이
   * 배포 뒤에도 칩으로 계속 떠서, 자기 입력을 제품이 쓴 문구로 읽는 일이 되풀이됐다.
   */
  test("옛 자리에 쌓인 최근 질문은 첫 실행에서 버린다", async () => {
    window.localStorage.setItem(
      "ralphton-recent-queries-v1",
      JSON.stringify(["의려취약지역", "부산 소득 높은 곳"]),
    );
    window.localStorage.removeItem("ralphton-recent-queries-v2");
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge", {}, { timeout: 20_000 });

    await waitFor(() =>
      expect(window.localStorage.getItem("ralphton-recent-queries-v1")).toBeNull(),
    );
    expect(screen.queryByTestId("recent-queries")).toBeNull();
  }, 30_000);

  test("답하지 못한 질의는 최근 질문에 남기지 않는다", async () => {
    // 같은 파일의 앞선 테스트가 남긴 기록을 지우고 시작한다(jsdom의 localStorage는 공유된다).
    window.localStorage.removeItem("ralphton-recent-queries-v2");
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "부산 소득 높은 곳" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => {
      expect(screen.getByTestId("query-notice").textContent ?? "").toMatch(/부산.*범위 밖/);
    });
    expect(screen.queryByTestId("recent-queries")).toBeNull();

    // 답을 받은 질의는 남는다 — 기억 자체를 끈 것이 아니다.
    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "생활인구 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));
    await waitFor(() => expect(screen.getByTestId("recent-queries")).toBeInTheDocument());
    expect(screen.getByTestId("recent-queries").textContent ?? "").not.toMatch(/부산/);
  }, 30_000);

  test("shows one-line conclusion in the result panel", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    expect(await screen.findByTestId("one-line-conclusion")).toBeInTheDocument();
    expect(screen.getByTestId("one-line-conclusion").textContent).toMatch(/한 줄 결론/);
  });

  test("renders the map even when the status APIs never answer", async () => {
    // /api/health·/api/data/sync는 상단 배지와 동기화 권고 토스트에만 쓰인다.
    // prod 실측에서 이 둘의 서버리스 콜드스타트가 2~3초였고, 화면 렌더와 한 Promise.all에
    // 묶여 있어 지도에 필요한 데이터가 1초에 도착하고도 3초 넘게 대기 화면이 남았다.
    const base = fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health") || url.includes("/api/data/sync")) {
          return new Promise<Response>(() => {});
        }
        return base(input);
      }),
    );

    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    expect(await screen.findByTestId("demo-map-badge", {}, { timeout: 20_000 })).toBeInTheDocument();
    expect(screen.getByTestId("result-panel")).toBeInTheDocument();
  }, 30_000);

  test("동반 지표가 목록 줄에 실린다 — 상세 카드에만 있지 않다", async () => {
    /*
     * `rankHouseholdCount`는 세대 수와 **세대당 인구** 둘을 붙이고, 산식 각주는
     * "세대당 인구를 함께 보세요"라고 말한다. 그런데 행의 `note`가 metrics[0] 하나로만
     * 만들어져서 두 번째 지표는 클릭해야 나오는 상세 카드에만 있었다(prod 실측).
     *
     * 이 `note`는 목록뿐 아니라 CSV·HWP·리포트·슬라이드 다섯 곳이 공통으로 읽는 칸이라,
     * 여기서 빠지면 내보낸 파일에도 없다. 목록에 보이면 파일에도 실린다.
     *
     * 첫 지표만 담으면 note가 오른쪽 값과 같아져 화면이 통째로 숨긴다 — 그래서 이 검사는
     * `.rank-note`가 **존재하는지**부터 본다.
     */
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/parse")) {
        return new Response(
          JSON.stringify({
            mode: "demo",
            intent: { tool: "rankHouseholdCount", filters: { limit: 20 } },
            notice: "기준월 세대 수가 많은 행정동 순입니다.",
          }),
          { status: 200 },
        );
      }
      return inner(input, init);
    }) as typeof global.fetch;

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "세대수 많은 동" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-panel").querySelector(".rank-note")).not.toBeNull();
    });
    expect(screen.getByTestId("result-panel").querySelector(".rank-note")?.textContent).toMatch(
      /세대당 인구/,
    );
  });

  test("공유 링크는 질문을 다시 실행한다 — 도구 이름만 재생하지 않는다", async () => {
    /*
     * 링크는 `tool`과 `q`를 함께 싣는다. 예전에는 `tool`이 있으면 그것만 재생하고 `q`는
     * 입력창에 채워 두기만 했다. 그런데 시군구 단위(adminLevel)·"상위 10%"(percentLimit)·
     * "400만원 이상"(valueThreshold)은 **질문을 파싱해야** 나오는 조건이라 `tool` 하나에
     * 담기지 않는다 — "총인구 많은 시군구 상위 10%"를 공유하면 305개 읍면동 전체 순위로
     * 열렸다(prod 실측). 조건이 조용히 빠진 답이 나오는 것이 가장 나쁘다.
     *
     * 질문을 다시 태우면 그 조건들이 원래 경로에서 다시 나온다. 그래서 이 검사는
     * **질문이 실제로 실행됐는지**를 본다 — 입력창에 글자만 채우는 것으로는 통과하지 않는다.
     */
    const parsed: string[] = [];
    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/parse") && typeof init?.body === "string") {
        parsed.push(JSON.parse(init.body).query as string);
      }
      return inner(input, init);
    }) as typeof global.fetch;

    const shared = "총인구 많은 시군구 상위 10%";
    window.history.replaceState(null, "", `?tool=rankPopulation&q=${encodeURIComponent(shared)}`);
    try {
      render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
      await screen.findByTestId("demo-map-badge");
      await waitFor(() => expect(parsed).toContain(shared));
      expect((screen.getByRole("textbox", { name: "분석 질의" }) as HTMLInputElement).value).toBe(
        shared,
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  }, 20_000);
  test("규칙이 놓친 질문을 AI가 지표로 지목하면 그 레이어로 전환한다", async () => {
    /*
     * 규칙이 못 잡는 표현("아이 키우기 좋은 곳")은 지금까지 "바로 분석하기 어렵습니다"로
     * 끝났다. 서버가 지표를 지목해 주면 그 지표 이름을 질문에 붙여 민간 리졸버를 한 번 더
     * 돌린다 — 지역·방향·단위 판정은 이미 그 안에 있다.
     *
     * 리졸버 단위 테스트로는 이 자리를 못 본다. 화면까지 닿는지를 본다.
     */
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/parse")) {
        return new Response(
          JSON.stringify({
            mode: "live",
            intent: null,
            parser: "ai",
            notice: "카드소비 · 카드매출 지표를 묻는 질문으로 읽었습니다.",
            metricHint: {
              layerId: "nh-consumption",
              metricKey: "card_sales",
              metricLabel: "카드매출",
              layerLabel: "카드소비",
            },
          }),
          { status: 200 },
        );
      }
      return inner(input, init);
    }) as typeof global.fetch;

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "아이 키우기 좋은 곳" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/질문을 지표로 옮겨 읽었습니다/);
    });
    expect(document.body.textContent).toMatch(/카드소비 · 카드매출 레이어로 전환했습니다/);
  }, 20_000);

  test("첫 화면에서 지표 자리와 할 수 있는 일을 스크롤 없이 말한다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    expect(screen.getByTestId("analysis-intro")).toHaveTextContent(
      /자료를 지도에 겹쳐 보고, 질문으로 순위를 냅니다/,
    );
    expect(screen.getByTestId("metric-picker")).toHaveTextContent(
      /이 레이어는 지점 목록이라 고를 지표가 없습니다/,
    );
    expect(screen.getByRole("group", { name: "분석 단위" })).toBeInTheDocument();
  });

  test("고르기 영역은 접히면 한 줄 요약이고 누르면 다시 펼쳐진다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    const summary = screen.getByTestId("picker-summary");
    expect(summary).toHaveTextContent(/의료기관/);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("레이어 검색")).toBeInTheDocument();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("레이어 검색")).not.toBeInTheDocument();
    expect(summary).toHaveTextContent(/의료기관 · 지점 목록 · 행정동/);

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("레이어 검색")).toBeInTheDocument();
  });

  test("지표를 고르면 고르기가 접히고 지도 위 한 줄이 따라 바뀐다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    const layerGroup = screen.getByRole("group", { name: "레이어 선택" });
    fireEvent.click(within(layerGroup).getByRole("button", { name: /^인구/ }));
    fireEvent.click(within(screen.getByTestId("metric-picker")).getByRole("button", { name: /총인구/ }));

    expect(screen.getByTestId("picker-summary")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("picker-summary")).toHaveTextContent(/인구 · 총인구 · 행정동/);
    expect(screen.getByTestId("demo-map-badge")).toHaveTextContent(/인구 · 총인구 · 행정동 · 2026-06/);
  });

  test("「유출」검색 후 이동인구를 고르면 유입·유출·순유입 칩이 보인다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    fireEvent.change(screen.getByLabelText("레이어 검색"), { target: { value: "유출" } });
    fireEvent.click(screen.getByRole("button", { name: /이동인구/ }));
    const chips = screen.getByTestId("metric-picker");
    expect(within(chips).getByRole("button", { name: /유입인구/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /유출인구/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /순유입/ })).toBeInTheDocument();
  });

  test("「재정」검색이면 KOSIS 재정 레이어가 손에 닿는다", async () => {
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");
    openControls();

    fireEvent.change(screen.getByLabelText("레이어 검색"), { target: { value: "재정" } });
    expect(screen.getByRole("button", { name: /지방재정/ })).toBeInTheDocument();
  });

  test("AI가 지목한 지표를 리졸버가 못 잡으면 평소 안내로 내려간다", async () => {
    // 지목만 믿고 화면을 바꾸면, 리졸버가 다른 지표를 골랐을 때 안내와 결과가 어긋난다.
    render(<CopilotApp boundaryVersion="20260701" kakaoMapKey="" />);
    await screen.findByTestId("demo-map-badge");

    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ai/parse")) {
        return new Response(
          JSON.stringify({
            mode: "live",
            intent: null,
            parser: "ai",
            notice: "해석하지 못했습니다.",
            metricHint: {
              layerId: "nh-consumption",
              metricKey: "card_sales",
              // 리졸버가 알아보지 못하는 이름 — 질문에 붙여도 매칭되지 않는다.
              metricLabel: "존재하지않는지표이름",
              layerLabel: "카드소비",
            },
          }),
          { status: 200 },
        );
      }
      return inner(input, init);
    }) as typeof global.fetch;

    fireEvent.change(screen.getByRole("textbox", { name: "분석 질의" }), {
      target: { value: "아이 키우기 좋은 곳" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질의 실행" }));

    await waitFor(() => {
      expect(document.body.textContent).not.toMatch(/질문을 지표로 옮겨 읽었습니다/);
    });
    expect(document.body.textContent).not.toMatch(/레이어로 전환했습니다/);
  }, 20_000);
});

describe("로딩 화면의 상단 바", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("ralphton-onboard-v1", "1");
    /*
     * 스냅샷·경계가 영영 오지 않는 상태를 만든다. 느린 회선에서 사용자가 실제로 보는
     * 화면이고, 예전에는 이 화면에 제품 이름조차 없었다.
     */
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  });

  test("데이터가 오기 전에도 제품 이름이 접근성 트리에 있다", async () => {
    render(<CopilotApp boundaryVersion="20260701" />);

    expect(screen.getByRole("heading", { name: /누리맵/ })).toBeVisible();
    expect(screen.getByTestId("topbar-loading-meta")).toHaveTextContent("준비하는 중");
    expect(screen.getByTestId("copilot-boot")).toHaveAttribute("aria-busy", "true");
  });

  test("모르는 값을 그럴듯하게 적지 않는다 — 기준월도 데이터 모드도 없다", () => {
    render(<CopilotApp boundaryVersion="20260701" />);

    /*
     * 스냅샷이 없는데 "시연 데이터"·"실데이터" 딱지를 붙이면 오지 않은 것을 온 것처럼
     * 읽게 된다. 기준월도 마찬가지다.
     */
    const topbar = screen.getByRole("banner");
    expect(topbar.textContent).not.toMatch(/시연|실데이터|\d{4}-\d{2}|읍면동/);
  });

  test("눌러도 열 패널이 없는 버튼은 내보내지 않는다", () => {
    render(<CopilotApp boundaryVersion="20260701" />);

    expect(screen.queryByRole("button", { name: "활용가이드" })).toBeNull();
    expect(screen.queryByRole("button", { name: "활용데이터" })).toBeNull();
  });

  test("본 셸은 아직 없다 — h1이 준비 신호가 아님을 못 박는다", () => {
    render(<CopilotApp boundaryVersion="20260701" />);

    expect(screen.queryByTestId("copilot-shell")).toBeNull();
  });
});
