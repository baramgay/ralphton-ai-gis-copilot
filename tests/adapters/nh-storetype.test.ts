import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, cleanDongCode, finalizeShares, storeTypeOf } from "../../scripts/adapters/nh-storetype.mjs";

// 0 dong | 1 date | 2 대 | 3 중 | 4 소 | 5 시도 | 6 시군구 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
function row(dong: string, sub: string, amountAll: number) {
  return `${dong},20251209,G,47,${sub},경남,양산시,10,1000,20,${amountAll}`;
}

describe("nh-storetype adapter", () => {
  it("소분류 코드를 생활업종으로 묶는다", () => {
    expect(storeTypeOf("G47711")).toBe("fuel"); // 주유소
    expect(storeTypeOf("I56111")).toBe("restaurant"); // 한식
    expect(storeTypeOf("I56191")).toBe("restaurant"); // 간이 음식점 — 같은 업태로 묶인다
    expect(storeTypeOf("G47122")).toBe("grocery"); // 편의점
    expect(storeTypeOf("I56221")).toBe("cafe"); // 커피 전문점
    expect(storeTypeOf("I56211")).toBe("pub"); // 유흥 주점
    expect(storeTypeOf("Q86102")).toBe("medical"); // 일반병원
    expect(storeTypeOf("G47811")).toBe("medical"); // 의약품 소매 — 의료로 묶는다
    expect(storeTypeOf("C29999")).toBeNull(); // 제조업은 생활업종이 아니다
  });

  it("BOM을 제거한다", () => {
    expect(cleanDongCode("﻿4833025300")).toBe("4833025300");
  });

  it("여러 소분류를 한 업태로 합산하고 전체 매출 대비 비중을 낸다", () => {
    const acc = aggregateRows([
      row("4833025300", "I56111", 300), // 한식
      row("4833025300", "I56191", 200), // 간이 — restaurant 합산 500
      row("4833025300", "G47711", 400), // 주유소
      row("4833025300", "C29999", 100), // 그룹 밖이지만 분모에는 포함
    ]);
    const shares = finalizeShares(acc.get("4833025300"));

    expect(shares.restaurant_share).toBeCloseTo(50, 6); // 500/1000
    expect(shares.fuel_share).toBeCloseTo(40, 6);
    expect(shares.cafe_share).toBeCloseTo(0, 6);
    // 생활업종 비중의 합은 100%가 아니다 — 제조·기타가 분모에 남는다
    const sum = shares.restaurant_share + shares.fuel_share;
    expect(sum).toBeCloseTo(90, 6);
  });

  it("매출이 없으면 비중을 지어내지 않는다", () => {
    const shares = finalizeShares({ total: 0, fuel: 0, restaurant: 0, grocery: 0, cafe: 0, pub: 0, medical: 0 });
    expect(shares.fuel_share).toBeNull();
    expect(shares.cafe_share).toBeNull();
  });

  it("동을 분리하고 잘못된 행을 무시한다", () => {
    const acc = aggregateRows(["", row("48", "G47711", 100), row("4833025300", "G47711", 200)]);
    expect(acc.size).toBe(1);
    expect(acc.get("4833025300").fuel).toBe(200);
  });
});
