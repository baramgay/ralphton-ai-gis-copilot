import { describe, expect, test } from "vitest";

import { dataModeLabel, dataModeTitle, populationIsLive } from "@/lib/analysis/data-mode";

/*
 * prod가 `mode: "live"`인데 인구는 합성값이었다(2026-07-31 실측). `mode`는 시설 동기화가
 * 됐다는 뜻이고, 인구·세대 계열은 기준 스냅샷 그대로였다 — 물금읍 고령비율이 13개월 내내
 * 11.35로 고정이었고, 고령비율 12개월 변화의 전체 범위가 -0.035 ~ +0.055%p였다.
 * 화면은 그냥 "실데이터"라고 적고 있었다. 공공기관 보고서로 옮겨지는 숫자다.
 */
const PROD_NOTES = [
  "경상남도 행정동 경계를 기준으로 만든 결정론적 시연 데이터입니다.",
  "인구·세대·출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
  "HIRA 병원정보서비스(v2)로 경남 시설 4272곳을 갱신했습니다.",
  "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다.",
];

const FULLY_LIVE_NOTES = [
  "HIRA 병원정보서비스(v2)로 경남 시설 4272곳을 갱신했습니다.",
  "행정안전부 주민인구 API로 2026-06 인구를 갱신했습니다.",
];

describe("populationIsLive", () => {
  test("시설만 갱신된 live 스냅샷은 인구가 실측이 아니다", () => {
    expect(populationIsLive("live", PROD_NOTES)).toBe(false);
  });

  test("각주 하나만 남아도 잡는다 — 합성값 문구", () => {
    expect(populationIsLive("live", ["인구·세대·출생·사망 값은 합성값이며 …"])).toBe(false);
  });

  test("각주 하나만 남아도 잡는다 — 기준 스냅샷 유지 문구", () => {
    expect(populationIsLive("live", ["인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다."])).toBe(false);
  });

  test("인구까지 실데이터면 참", () => {
    expect(populationIsLive("live", FULLY_LIVE_NOTES)).toBe(true);
  });

  test("demo는 무조건 거짓", () => {
    expect(populationIsLive("demo", FULLY_LIVE_NOTES)).toBe(false);
  });
});

describe("배지와 설명이 사실을 말한다", () => {
  test("시설만 실데이터일 때 배지가 '실데이터'라고 하지 않는다", () => {
    expect(dataModeLabel("live", PROD_NOTES)).toBe("시설 실데이터");
    expect(dataModeTitle("live", PROD_NOTES)).toMatch(/인구·세대는 기준 스냅샷/);
  });

  test("전부 실데이터면 그대로 '실데이터'", () => {
    expect(dataModeLabel("live", FULLY_LIVE_NOTES)).toBe("실데이터");
    expect(dataModeTitle("live", FULLY_LIVE_NOTES)).toBe("데이터: 실데이터");
  });

  test("demo는 시연이라 말한다", () => {
    expect(dataModeLabel("demo", PROD_NOTES)).toBe("시연");
    expect(dataModeTitle("demo", PROD_NOTES)).toMatch(/합성값/);
  });
});
