import { describe, expect, test } from "vitest";

import {
  facilitiesToCsv,
  regionUnitLabel,
  rankedToCsv,
  resolveExportProvenance,
  toCsv,
} from "@/lib/analysis/export-csv";

describe("resolveExportProvenance", () => {
  const snapshotArgs = {
    snapshotReferenceMonth: "2026-06",
    snapshotSource: "공공 스냅샷",
  };

  test("falls back to the public snapshot when no layer or cross result is active", () => {
    expect(resolveExportProvenance({ ...snapshotArgs, activeLayer: null })).toEqual({
      referenceMonth: "2026-06",
      source: "공공 스냅샷",
    });
  });

  test("uses the active private layer's own month and provider, not the snapshot's", () => {
    // 민간 큐브는 공공 스냅샷과 기준월이 다르다. 스냅샷 월을 찍으면 보고서가 틀어진다.
    expect(
      resolveExportProvenance({
        ...snapshotArgs,
        activeLayer: { referenceMonth: "2025-12", provider: "NH", label: "카드소비" },
      }),
    ).toEqual({ referenceMonth: "2025-12", source: "NH · 카드소비" });
  });

  test("the resolved source actually reaches the CSV meta block", () => {
    // 회귀 방지: 예전에는 provenance를 계산해 놓고도 CSV 호출부에 옛 dataSource를
    // 그대로 넘겨, 기준월만 고쳐지고 출처는 공공 캐시명이 찍혔다.
    const resolved = resolveExportProvenance({
      ...snapshotArgs,
      activeLayer: { referenceMonth: "2025-12", provider: "NH", label: "카드소비" },
    });
    const csv = rankedToCsv("카드매출 순위", resolved.referenceMonth, resolved.source, "live", [
      { rank: 1, code: "4882025000", sido: "경남", name: "거창읍", valueLabel: "57,019백만원", note: "" },
    ]);

    expect(csv).toContain("기준월,2025-12");
    expect(csv).toContain("출처,NH · 카드소비");
    expect(csv).not.toContain("공공 스냅샷");
  });

  test("a cross analysis result's own provenance wins over the active layer", () => {
    expect(
      resolveExportProvenance({
        ...snapshotArgs,
        analysisProvenance: {
          referenceMonth: "2025-12",
          source: "SKT 총생활인구 × NH 카드매출",
        },
        activeLayer: { referenceMonth: "2026-06", provider: "공공", label: "의료" },
      }),
    ).toEqual({ referenceMonth: "2025-12", source: "SKT 총생활인구 × NH 카드매출" });
  });
});

describe("export-csv", () => {
  test("escapes commas and quotes", () => {
    const csv = toCsv(["a", "b"], [['hello, world', 'say "hi"']]);
    expect(csv).toContain('"hello, world"');
    expect(csv).toContain('"say ""hi"""');
  });

  test("ranked csv includes provenance meta and sido", () => {
    const csv = rankedToCsv("의료 취약", "2026-06", "demo", "demo", [
      {
        rank: 1,
        code: "2611051000",
        name: "중구 중앙동",
        valueLabel: "85점",
        note: "취약",
        sido: "경남",
      },
    ]);
    expect(csv).toContain("기준월");
    expect(csv).toContain("2026-06");
    expect(csv).toContain("2611051000");
    expect(csv).toContain("시도시");
    expect(csv).toContain("경남");
  });

  test("facility csv lists rows with sido", () => {
    const csv = facilitiesToCsv("시설", "2026-06", "demo", "demo", [
      {
        id: "f1",
        name: "중앙의원",
        type: "의원",
        region: "중구",
        address: "경남",
        sido: "경남",
      },
    ]);
    expect(csv).toContain("중앙의원");
    expect(csv).toContain("의원");
    expect(csv).toContain("시도시");
    expect(csv).toContain("경남");
  });
});

describe("regionUnitLabel", () => {
  test("코드 자리수로 행정동·시군구를 가린다", () => {
    expect(regionUnitLabel(["4812125000", "4812126000"])).toBe("행정동");
    expect(regionUnitLabel(["48121", "48123"])).toBe("시군구");
    // 섞여 있으면 더 좁은 쪽으로 본다(실제로는 일어나지 않아야 한다).
    expect(regionUnitLabel(["48121", "4812125000"])).toBe("행정동");
    expect(regionUnitLabel([])).toBe("행정동");
  });

  test("공공 도구 시군구 합산(10자리, 뒤 5자리 0)도 시군구로 본다", () => {
    // rollupToDistricts(tool-registry.ts)는 10자리 행정동 코드 규약을 지키며 뒤를 0으로
    // 채운다("4817000000") — 5자리 판정만으로는 안 걸려 "행정동"으로 잘못 표기됐다(4차 리포트).
    expect(regionUnitLabel(["4817000000", "4825000000"])).toBe("시군구");
    // 진짜 행정동 코드는 뒤가 우연히도 0 다섯 개로 끝나지 않는다 — 실데이터로 확인됨.
    expect(regionUnitLabel(["4812125000"])).toBe("행정동");
  });

  test("시군구 결과의 CSV 머리글은 시군구코드다", () => {
    const csv = rankedToCsv("전출인구(시군구) 순위", "2025-12", "KCB · 거주이동", "live", [
      { rank: 1, code: "48250", sido: "경남", name: "김해시", valueLabel: "40,152명", note: "비고" },
    ]);
    expect(csv).toContain("시군구코드");
    expect(csv).not.toContain("행정동코드");
  });
});

describe("합성 인구를 실데이터라 내보내지 않는다", () => {
  const syntheticNotes = [
    "인구·세대·출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
    "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다.",
  ];

  test("고령화율 CSV에 live·supabase-cache가 없고 합성값임을 적는다", () => {
    const csv = rankedToCsv(
      "고령화율이 높은 지역",
      "2026-06",
      "supabase-cache",
      "live",
      [
        {
          rank: 1,
          code: "4817032000",
          sido: "경남",
          name: "진주시 정촌면",
          valueLabel: "24.92%",
          note: "고령화율 · 24.92%",
        },
      ],
      { sourceNotes: syntheticNotes, populationDerived: true },
    );
    expect(csv).not.toMatch(/,live(?:\r|$)/);
    expect(csv).not.toContain("supabase-cache");
    expect(csv).toContain("시설 실데이터");
    expect(csv).toContain("인구·세대·출생·사망은 합성값이라 대외 수치로 인용하지 마세요.");
  });

  test("KOSIS 실측 순위는 실데이터라 적고 합성 경고를 붙이지 않는다", () => {
    const csv = rankedToCsv(
      "재정자립도",
      "2025-12",
      "KOSIS 국가통계",
      "live",
      [{ rank: 1, code: "48840", sido: "경남", name: "남해군", valueLabel: "12.3%", note: "" }],
      { sourceNotes: syntheticNotes, populationDerived: false },
    );
    expect(csv).toMatch(/데이터모드,실데이터(?:\r|$)/);
    expect(csv).not.toContain("시설 실데이터");
    expect(csv).toContain("KOSIS 국가통계");
    expect(csv).not.toContain("합성값이라 대외 수치로 인용하지 마세요");
  });
});
