import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/copilot/kakao-map", () => ({
  KakaoMap: ({ onError }: { onError: (message: string) => void }) => (
    <button onClick={() => onError("SDK 401: API key and allowed domain configuration")}>연결 실패 재현</button>
  ),
}));
vi.mock("@/components/copilot/demo-map", () => ({ DemoMap: () => <div>경계 지도</div> }));

import { MapCanvas } from "@/components/copilot/map-canvas";

describe("MapCanvas fallback", () => {
  it("shows a usable fallback and retry without provider configuration errors", () => {
    render(<MapCanvas
      kakaoMapKey="test-key"
      boundary={{ type: "FeatureCollection", features: [] }}
      regions={[]}
      facilities={[]}
      scores={new Map()}
      selectedRegionCode={null}
      radiusKm={2}
      showFacilities={false}
      onSelectRegion={vi.fn()}
    />);
    fireEvent.click(screen.getByText("연결 실패 재현"));
    expect(screen.getByText("경계 지도")).toBeVisible();
    expect(screen.getByRole("button", { name: "지도 다시 불러오기" })).toBeVisible();
    expect(screen.queryByText(/SDK 401/)).not.toBeInTheDocument();
    expect(screen.getByText(/경계 지도에서 지역 선택과 분석을 계속/)).toBeVisible();
  });
});
