import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { groupByProvider, LayerSwitcher, type LayerOption } from "@/components/copilot/layer-switcher";

const layers: LayerOption[] = [
  { id: "population", label: "인구", provider: "공공" },
  { id: "skt-living", label: "생활인구", provider: "SKT" },
];

describe("LayerSwitcher", () => {
  test("renders every layer option", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^인구/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /생활인구/ })).toBeInTheDocument();
    expect(screen.getByText("SKT")).toBeInTheDocument();
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

  test("제공기관별로 묶어 출처가 한 눈에 보이게 한다", () => {
    const many: LayerOption[] = [
      { id: "population", label: "인구", provider: "공공" },
      { id: "skt-living", label: "생활인구", provider: "SKT" },
      { id: "skt-daynight", label: "주야간인구", provider: "SKT" },
      { id: "nh-consumption", label: "카드소비", provider: "NH" },
      { id: "kcb-credit", label: "소득·신용", provider: "KCB" },
    ];
    render(<LayerSwitcher layers={many} activeId="population" onChange={vi.fn()} />);

    // 민간 제공기관에는 성격이 드러나는 라벨을 붙인다
    expect(screen.getByText("SKT 민간데이터")).toBeInTheDocument();
    expect(screen.getByText("NH 민간데이터")).toBeInTheDocument();
    expect(screen.getByText("KCB 민간데이터")).toBeInTheDocument();
    // 공공은 민간으로 오인되면 안 된다
    expect(screen.queryByText("공공 민간데이터")).not.toBeInTheDocument();
    // 그룹으로 묶어도 모든 레이어는 그대로 눌린다
    expect(screen.getAllByRole("button")).toHaveLength(many.length);
  });

  test("groupByProvider는 공공·SKT·NH·KCB 순으로 묶는다", () => {
    const groups = groupByProvider([
      { id: "a", label: "A", provider: "KCB" },
      { id: "b", label: "B", provider: "공공" },
      { id: "c", label: "C", provider: "NH" },
      { id: "d", label: "D", provider: "SKT" },
      { id: "e", label: "E", provider: "SKT" },
    ]);
    expect(groups.map((g) => g.provider)).toEqual(["공공", "SKT", "NH", "KCB"]);
    // 같은 기관 레이어는 한 묶음에 모인다
    expect(groups[1].layers.map((l) => l.id)).toEqual(["d", "e"]);
  });
});
