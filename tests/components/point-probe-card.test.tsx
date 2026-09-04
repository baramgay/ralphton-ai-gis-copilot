import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PointProbeCard } from "@/components/copilot/point-probe-card";
import type { RadiusProbe } from "@/lib/gis/point-probe";

/*
 * 이 카드는 좁은 화면에서 세로 314px을 차지한다 — 727px 기기에서 지도에 남는 자리가
 * 173px(24%)뿐이었다(배포본 실측). 한 곳을 찍고 나면 다른 곳을 찍을 자리가 없다.
 * 접기가 그 해결이라, 접었을 때 **무엇이 사라지고 무엇이 남는지**가 계약이다.
 *
 * 지도 위에서 실제로 눌리는지는 여기서 못 잰다(jsdom에는 레이아웃이 없다).
 * 그쪽은 `scripts/verify-probe-prod.mjs`가 배포본에서 재고, 이 검사는 기전만 지킨다.
 */
const probe: RadiusProbe = {
  point: { lat: 35.2278, lng: 128.6817 },
  radiusKm: 2,
  containing: { code: "4812300000", name: "경상남도 창원시성산구 용지동" },
  facilities: [
    { id: "f1", name: "가까운의원", type: "의원", lat: 35.228, lng: 128.682, distanceKm: 0.05 },
  ],
  byType: [{ type: "의원", count: 1 }],
  nearest: { id: "f1", name: "가까운의원", type: "의원", lat: 35.228, lng: 128.682, distanceKm: 0.05 },
  regions: [{ code: "4812300000", name: "경상남도 창원시성산구 용지동", contains: true, distanceKm: 0 }],
  boundaryEdgeKm: 0.9,
  notes: ["반경 안 인구·소비 합계는 내지 않습니다."],
};

const view = () => (
  <PointProbeCard probe={probe} radiusKm={2} onRadiusChange={vi.fn()} onClose={vi.fn()} />
);

describe("지점 분석 카드 접기", () => {
  test("처음에는 펼쳐져 있다", () => {
    render(view());
    expect(screen.getByTestId("probe-card")).toHaveAttribute("data-collapsed", "no");
    expect(screen.getByText("걸치는 행정동 1곳")).toBeInTheDocument();
  });

  test("접으면 본문이 사라진다", () => {
    render(view());
    fireEvent.click(screen.getByTestId("probe-collapse"));
    expect(screen.getByTestId("probe-card")).toHaveAttribute("data-collapsed", "yes");
    expect(screen.queryByText("걸치는 행정동 1곳")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "반경 선택" })).not.toBeInTheDocument();
  });

  test("접어도 무엇을 보고 있는지는 남는다", () => {
    // 한 줄만 남기고 답까지 지우면 접는 뜻이 없다. 접은 채로 여기저기 눌러 가며
    // 동 이름과 시설 수를 훑을 수 있어야 한다.
    render(view());
    fireEvent.click(screen.getByTestId("probe-collapse"));
    expect(screen.getByTestId("probe-region")).toHaveTextContent("창원시성산구 용지동");
    expect(screen.getByTestId("probe-card")).toHaveTextContent("반경 2km 시설 1곳");
  });

  test("다시 펼칠 수 있다", () => {
    render(view());
    const toggle = screen.getByTestId("probe-collapse");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByTestId("probe-collapse")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("probe-collapse"));
    expect(screen.getByText("걸치는 행정동 1곳")).toBeInTheDocument();
  });
});

describe("경계 경고", () => {
  test("경계에서 100m 밖이면 경고를 띄우지 않는다", () => {
    render(view());
    expect(screen.queryByTestId("probe-edge-warn")).not.toBeInTheDocument();
  });

  test("경계에 붙어 있으면 동 이름 바로 밑에 적는다", () => {
    render(
      <PointProbeCard
        probe={{ ...probe, boundaryEdgeKm: 0.034 }}
        radiusKm={2}
        onRadiusChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("probe-edge-warn")).toHaveTextContent("34m");
  });
});
