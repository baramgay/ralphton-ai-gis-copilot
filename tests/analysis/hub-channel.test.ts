import { describe, expect, test } from "vitest";

import { DATA_INVENTORY, HUB_INVENTORY } from "@/lib/analysis/data-inventory";
import { providerSourceLabel } from "@/lib/analysis/data-mode";
import { CUBE_LAYERS, MEDICAL_LAYER } from "@/lib/layers/catalog";
import { HUB_PLATFORM, isHubProvider } from "@/lib/layers/channel";
import { CURATED_RAG_CORPUS } from "@/lib/rag/corpus";

/*
 * 이 도구가 쓰는 자료의 대부분은 경남빅데이터허브플랫폼이 내준 것이다. 그런데 화면에는
 * 기관 약칭(SKT·NH·KCB)만 적혀 있어서 **창구가 어디에도 없었다** — 출처를 물으면
 * 「SKT」라고만 답하는 셈이었다.
 *
 * 이름 한 줄은 언제든 조용히 사라진다(문구를 다듬다가, 묶음을 다시 짜다가). 그래서
 * 여기서 못박는다. 개수를 세지 않고 **어느 기관이 창구에 속하는지**를 본다 — 개수만
 * 세면 하나가 빠지고 하나가 늘었을 때 통과한다.
 */
describe("제공 창구 표기", () => {
  const HUB_LAYER_IDS = [...CUBE_LAYERS, MEDICAL_LAYER]
    .filter((layer) => isHubProvider(layer.provider))
    .map((layer) => layer.id)
    .sort();

  test("민간데이터 세 기관과 경상남도 기업정보가 창구에 속한다", () => {
    expect([...HUB_INVENTORY.providers].sort()).toEqual(["KCB", "NH", "SKT", "경상남도"]);
  });

  /* 주민등록·의료기관·국가통계는 직접 받는다. 안 온 곳을 적으면 출처가 틀린다. */
  test("직접 받는 자료에는 창구를 붙이지 않는다", () => {
    for (const group of DATA_INVENTORY) {
      if (group.provider === "공공" || group.provider === "KOSIS") {
        expect(group.channel, `${group.provider} 에 창구가 붙었다`).toBeNull();
      } else {
        expect(group.channel, `${group.provider} 에 창구가 없다`).toBe(HUB_PLATFORM);
      }
    }
  });

  test("창구 합계는 실제로 센 값이다", () => {
    const hubGroups = DATA_INVENTORY.filter((group) => group.channel === HUB_PLATFORM);
    expect(HUB_INVENTORY.layers).toBe(HUB_LAYER_IDS.length);
    expect(HUB_INVENTORY.metrics).toBe(
      hubGroups.reduce((sum, group) => sum + group.metricCount, 0),
    );
    expect(HUB_INVENTORY.layers).toBeGreaterThan(0);
  });

  /*
   * 레이어를 바꿀 때 뜨는 문장이 출처를 규정한다. 이 문장이 보고서로 옮겨진다.
   */
  test("출처 문구가 기관과 창구를 함께 말한다", () => {
    expect(providerSourceLabel("SKT")).toBe(`SKT 민간데이터 · ${HUB_PLATFORM}`);
    expect(providerSourceLabel("NH")).toBe(`NH 민간데이터 · ${HUB_PLATFORM}`);
    expect(providerSourceLabel("KCB")).toBe(`KCB 민간데이터 · ${HUB_PLATFORM}`);
    expect(providerSourceLabel("경상남도")).toBe(`경상남도 공공데이터 · ${HUB_PLATFORM}`);
  });

  test("직접 받는 자료의 출처 문구에는 창구가 없다", () => {
    expect(providerSourceLabel("KOSIS")).not.toContain(HUB_PLATFORM);
    expect(providerSourceLabel("공공")).not.toContain(HUB_PLATFORM);
  });

  /* 기관 이름은 창구에 밀려 사라지면 안 된다. 창구는 기관 옆에 붙는 것이다. */
  test("창구를 적어도 기관 이름이 남는다", () => {
    for (const provider of ["SKT", "NH", "KCB"]) {
      expect(providerSourceLabel(provider)).toContain(provider);
    }
  });

  test("창구 이름으로 물어도 답할 문서가 코퍼스에 있다", () => {
    const chunk = CURATED_RAG_CORPUS.find((entry) => entry.id === "gn-bigdata-hub");
    expect(chunk).toBeDefined();
    expect(chunk!.body).toContain(HUB_PLATFORM);
    expect(chunk!.keywords).toContain(HUB_PLATFORM);
    /* 창구에 속하지 않는 자료를 속한다고 말하면 안 된다. */
    expect(chunk!.body).toMatch(/KOSIS|국가통계포털/);
  });
});
