import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LayerSwitcher, type LayerOption } from "@/components/copilot/layer-switcher";
import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";

const layers: LayerOption[] = CROSS_CANDIDATE_LAYERS.map(({ id, label, provider }) => ({ id, label, provider }));
const topics = ["사람과 이동", "상권과 소비", "소득과 지역경제", "생활과 공공서비스"];

beforeEach(() => {
  // jsdom does not implement the browser's native modal methods.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function () {
    this.setAttribute("open", "");
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  } });
});
afterEach(() => vi.restoreAllMocks());

const openCatalog = () => fireEvent.click(screen.getByRole("button", { name: "자료 변경" }));

describe("목적별 자료 선택", () => {
  test("처음에는 고른 자료와 조건만 보여 주고 분석을 실행하지 않는다", () => {
    const onChange = vi.fn();
    render(<LayerSwitcher layers={layers} activeId="skt-living" onChange={onChange}
      activeSlot={<button>고른 자료의 조건</button>} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("dataset-selected")).toHaveTextContent("생활인구");
    expect(screen.getByTestId("dataset-selected")).toHaveTextContent("SKT");
    expect(screen.getByRole("button", { name: "고른 자료의 조건" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /이동인구/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("카탈로그는 목적 네 개로 시작하며 모든 23개 자료가 정확히 한 목적에 있다", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    openCatalog();
    const dialog = screen.getByRole("dialog", { name: "자료 선택" });
    expect(dialog.parentElement).toBe(document.body);
    const found: string[] = [];
    for (const topic of topics) {
      fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${topic}`) }));
      found.push(...Array.from(dialog.querySelectorAll("[data-layer-id]"), node => node.getAttribute("data-layer-id")!));
    }
    expect(found).toHaveLength(23);
    expect(new Set(found).size).toBe(23);
    expect([...found].sort()).toEqual(layers.map(layer => layer.id).sort());
  });

  test("지표 트리거 유출 검색에서도 현재 지표 조건은 사라지지 않는다", () => {
    render(<LayerSwitcher layers={layers} activeId="skt-living" onChange={vi.fn()}
      activeSlot={<div data-testid="metric-context">총생활인구 · 행정동</div>} />);
    openCatalog();
    fireEvent.change(screen.getByRole("searchbox", { name: "자료 검색" }), { target: { value: "유출" } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /이동인구/ })).toBeVisible();
    expect(dialog.querySelectorAll("[data-layer-id]")).toHaveLength(1);
    expect(screen.getByTestId("metric-context")).toHaveTextContent("총생활인구 · 행정동");
    expect(within(dialog).getByRole("status")).toHaveTextContent("1개");
  });

  test("없는 자료 검색은 0개와 검색어를 알려 준다", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    openCatalog();
    fireEvent.change(screen.getByRole("searchbox", { name: "자료 검색" }), { target: { value: "없는자료xyz" } });
    expect(screen.getByTestId("layer-search-empty")).toHaveTextContent("「없는자료xyz」에 해당하는 자료가 없습니다");
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("0개");
  });

  test("자료 선택은 정확히 한 번 실행하고 닫힌 뒤 변경 버튼으로 포커스를 돌린다", () => {
    const onChange = vi.fn();
    render(<LayerSwitcher layers={layers} activeId="population" onChange={onChange} />);
    const opener = screen.getByRole("button", { name: "자료 변경" });
    opener.focus();
    openCatalog();
    fireEvent.change(screen.getByRole("searchbox", { name: "자료 검색" }), { target: { value: "유출" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /이동인구/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("skt-mobility");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test("Escape로 취소하면 분석하지 않고 포커스를 복구한다", () => {
    const onChange = vi.fn();
    const backgroundKeyDown = vi.fn();
    render(<div onKeyDown={backgroundKeyDown}><LayerSwitcher layers={layers} activeId="population" onChange={onChange} /></div>);
    const opener = screen.getByRole("button", { name: "자료 변경" });
    opener.focus();
    openCatalog();
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("searchbox", { name: "자료 검색" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(backgroundKeyDown).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  test("Tab과 Shift+Tab은 모달 경계를 벗어나지 않는다", () => {
    render(<LayerSwitcher layers={layers} activeId="population" onChange={vi.fn()} />);
    openCatalog();
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    buttons.at(-1)!.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(buttons.at(-1)).toHaveFocus();
  });

  test("교차 분석은 실제 분석 이름을 쓰고 의료기관을 선택한 것처럼 표시하지 않는다", () => {
    render(<LayerSwitcher layers={layers} activeId="" onChange={vi.fn()}
      selectionLabel="카드매출 증가 추세" selectionDetail="진주시 · 최근 3개월 · NH"
      activeSlot={<p>분석 조건 요약</p>} />);
    expect(screen.getByTestId("dataset-selected")).toHaveTextContent("카드매출 증가 추세");
    expect(screen.getByTestId("dataset-selected")).toHaveTextContent("진주시 · 최근 3개월 · NH");
    openCatalog();
    fireEvent.click(screen.getByRole("button", { name: "전체 자료 보기" }));
    expect(screen.getByRole("dialog").querySelectorAll('[data-layer-id][aria-pressed="true"]')).toHaveLength(0);
  });
});
