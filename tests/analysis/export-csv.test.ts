import { describe, expect, test } from "vitest";

import {
  facilitiesToCsv,
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
