import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  filterLayersByQuery,
  groupByProvider,
  groupBySource,
  LayerSwitcher,
  type LayerOption,
} from "@/components/copilot/layer-switcher";
import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";

const layers: LayerOption[] = [
  { id: "population", label: "인구", provider: "공공" },
  { id: "skt-living", label: "생활인구", provider: "SKT" },
];

describe("LayerSwitcher", () => {
  test("renders every layer option", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^인구/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /생활인구/ })).toBeInTheDocument();
    // 「SKT」는 갈래 안 소제목과 버튼 안 꼬리표 두 자리에 나온다. 버튼 쪽을 지목한다.
    expect(screen.getByRole("button", { name: /생활인구/ }).textContent).toContain("SKT");
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

  const many: LayerOption[] = [
    { id: "population", label: "인구", provider: "공공" },
    { id: "medical", label: "의료기관", provider: "공공" },
    { id: "skt-living", label: "생활인구", provider: "SKT" },
    { id: "skt-daynight", label: "주야간인구", provider: "SKT" },
    { id: "nh-consumption", label: "카드소비", provider: "NH" },
    { id: "kcb-credit", label: "소득·신용", provider: "KCB" },
  ];

  /*
   * 큰 갈래는 민간과 공공 둘이다. 제공기관을 그대로 최상위에 놓으면 「공공」 아래에
   * 인구와 의료기관 둘만 서서, 첫 화면이 「공공 = 인구·의료」로 읽힌다 — 이 도구가
   * 의료 도구처럼 보이게 된다.
   */
  test("큰 갈래는 민간·공공 둘이고 제공기관은 그 아래다", () => {
    render(<LayerSwitcher layers={many} activeId="population" onChange={vi.fn()} />);

    expect(screen.getByText("민간 자료")).toBeInTheDocument();
    expect(screen.getByText("공공 자료")).toBeInTheDocument();
    // 제공기관은 사라지지 않는다 — 출처는 여전히 한눈에 보여야 한다
    for (const provider of ["SKT", "NH", "KCB"]) {
      expect(screen.getAllByText(provider).length).toBeGreaterThan(0);
    }
    // 「의료」가 큰 분류로 서지 않는다
    expect(screen.queryByText("의료 데이터")).not.toBeInTheDocument();
    // 묶어도 모든 레이어는 그대로 눌린다
    expect(screen.getAllByRole("button")).toHaveLength(many.length);
  });

  test("민간이 공공보다 먼저 온다 — 중심 자료가 먼저다", () => {
    const groups = groupBySource(many);
    expect(groups.map((group) => group.source)).toEqual(["민간", "공공"]);
    expect(groups[0].providers.map((entry) => entry.provider)).toEqual(["SKT", "NH", "KCB"]);
    expect(groups[1].providers.map((entry) => entry.provider)).toEqual(["공공"]);
  });

  test("어느 갈래에도 레이어가 없으면 그 갈래는 나오지 않는다", () => {
    const onlyPublic = groupBySource([{ id: "population", label: "인구", provider: "공공" }]);
    expect(onlyPublic.map((group) => group.source)).toEqual(["공공"]);
  });

  test("검색이 지표 이름·트리거에 걸린다 — 「유출」은 이동인구만", () => {
    const catalogLayers: LayerOption[] = CROSS_CANDIDATE_LAYERS.map((layer) => ({
      id: layer.id,
      label: layer.label,
      provider: layer.provider,
    }));
    const found = filterLayersByQuery(catalogLayers, "유출", CROSS_CANDIDATE_LAYERS);
    expect(found.map((layer) => layer.id)).toEqual(["skt-mobility"]);
  });

  test("「재정」으로 검색하면 KOSIS 재정 레이어가 나온다", () => {
    const catalogLayers: LayerOption[] = CROSS_CANDIDATE_LAYERS.map((layer) => ({
      id: layer.id,
      label: layer.label,
      provider: layer.provider,
    }));
    const found = filterLayersByQuery(catalogLayers, "재정", CROSS_CANDIDATE_LAYERS);
    expect(found.some((layer) => layer.id === "kosis-finance")).toBe(true);
  });

  test("검색어가 비면 지금 묶음 그대로다", () => {
    const found = filterLayersByQuery(layers, "   ", [
      { id: "population", label: "인구", metrics: [] },
      { id: "skt-living", label: "생활인구", metrics: [] },
    ]);
    expect(found.map((layer) => layer.id)).toEqual(["population", "skt-living"]);
  });

  test("화면에 「유출」을 치면 이동인구만 남는다", () => {
    const catalogLayers: LayerOption[] = CROSS_CANDIDATE_LAYERS.map((layer) => ({
      id: layer.id,
      label: layer.label,
      provider: layer.provider,
    }));
    render(<LayerSwitcher layers={catalogLayers} activeId="medical" onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("레이어 검색"), { target: { value: "유출" } });
    expect(screen.getByRole("button", { name: /이동인구/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^인구/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /의료기관/ })).not.toBeInTheDocument();
  });

  test("0건이면 무엇을 못 찾았는지 문장으로 말한다", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("레이어 검색"), { target: { value: "없는자료xyz" } });
    expect(screen.getByTestId("layer-search-empty")).toHaveTextContent("「없는자료xyz」에 해당하는 자료가 없습니다");
    expect(screen.queryByRole("button", { name: /^인구/ })).not.toBeInTheDocument();
  });

  test("고른 레이어를 목록 밖으로 빼지 않는다 — 민간·공공 목록이 본문이다", () => {
    render(<LayerSwitcher layers={many} activeId="skt-living" onChange={vi.fn()} />);
    const living = screen.getAllByRole("button", { name: /생활인구/ });
    expect(living).toHaveLength(1);
    const kicker = screen.getByText("민간 자료");
    expect(kicker.compareDocumentPosition(living[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("지표 자리는 고른 레이어가 있는 묶음 바로 아래다", () => {
    render(
      <LayerSwitcher
        layers={many}
        activeId="medical"
        onChange={vi.fn()}
        activeSlot={<div data-testid="active-slot">슬롯</div>}
      />,
    );
    const medical = screen.getByRole("button", { name: /의료기관/ });
    const slot = screen.getByTestId("active-slot");
    expect(medical.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("groupByProvider는 SKT·NH·KCB·공공 순으로 묶는다", () => {
    const groups = groupByProvider([
      { id: "a", label: "A", provider: "KCB" },
      { id: "b", label: "B", provider: "공공" },
      { id: "c", label: "C", provider: "NH" },
      { id: "d", label: "D", provider: "SKT" },
      { id: "e", label: "E", provider: "SKT" },
    ]);
    expect(groups.map((g) => g.provider)).toEqual(["SKT", "NH", "KCB", "공공"]);
    // 같은 기관 레이어는 한 묶음에 모인다
    expect(groups[0].layers.map((l) => l.id)).toEqual(["d", "e"]);
  });
});
