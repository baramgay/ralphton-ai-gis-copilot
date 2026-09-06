import { describe, expect, test } from "vitest";

import { hoverCaptionOf } from "@/lib/gis/hover-caption";

const dong = {
  code: "4812125000",
  name: "창원시 의창구 동읍",
  valueLabel: "8,000명",
  metrics: [{ label: "총생활인구", value: 8000, unit: "명" }],
};

const sgg = {
  code: "48121",
  name: "창원시 의창구",
  valueLabel: "30.6%",
  metrics: [
    { label: "재정자립도", value: 30.6, unit: "%" },
    { label: "빈집 비율", value: 12.3, unit: "%" },
  ],
};

const grid = {
  code: "2209_3388",
  name: "창원시의창구 팔룡동 500m격자 21",
  valueLabel: "567만원/월",
  metrics: [{ label: "평균소득", value: 567, unit: "만원/월" }],
};

describe("hoverCaptionOf", () => {
  test("분석을 고르기 전에는 시군 이름만 남긴다", () => {
    const caption = hoverCaptionOf(
      "4812125000",
      "경상남도 창원시 의창구 동읍",
      [],
    );
    expect(caption.name).toBe("창원시 의창구");
    expect(caption.value).toBeNull();
  });

  test("행정동 분석은 그 동의 지표 값을 적는다", () => {
    const caption = hoverCaptionOf(
      "4812125000",
      "경상남도 창원시 의창구 동읍",
      [dong],
    );
    expect(caption.name).toBe("창원시 의창구 동읍");
    expect(caption.value).toBe("총생활인구 8,000명");
  });

  test("시군구 분석은 행정동 면 위에서도 시군 값을 적는다", () => {
    const caption = hoverCaptionOf(
      "4812125000",
      "경상남도 창원시 의창구 동읍",
      [sgg],
    );
    expect(caption.name).toBe("창원시 의창구");
    expect(caption.value).toBe("재정자립도 30.6% · 빈집 비율 12.3%");
  });

  test("격자 분석은 격자 코드로 값을 찾는다", () => {
    const caption = hoverCaptionOf(
      "2209_3388",
      "창원시의창구 팔룡동 500m격자 21",
      [grid],
    );
    expect(caption.name).toBe("창원시의창구 팔룡동 500m격자 21");
    expect(caption.value).toBe("평균소득 567만원/월");
  });

  test("순위에 없는 면은 이름만 남기고 값을 지어내지 않는다", () => {
    const caption = hoverCaptionOf(
      "4825025000",
      "경상남도 김해시 내외동",
      [dong],
    );
    expect(caption.name).toBe("김해시 내외동");
    expect(caption.value).toBeNull();
  });
});
