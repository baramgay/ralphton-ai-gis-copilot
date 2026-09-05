/**
 * Kimi 외부 검증 — 항목 5: RAG 검색 품질을 독립 질의로 잰다
 *
 * 실행: npx vitest run scripts/kimi-review/5-rag.test.ts
 *
 * 질의는 5-my-queries.md에서 읽는다(평가셋 미열람 상태에서 먼저 확정한 30개).
 * 채점: 1위 청크의 레이어 태그가 기대 레이어와 같으면 top-1, 5위 안에 있으면 top-5.
 * 「애매함 인정」 질의는 허용 레이어가 여럿이다.
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { retrieveRagChunks } from "@/lib/rag/retrieve";

type Case = { no: number; query: string; expect: string[]; vague: boolean };

function loadCases(): Case[] {
  const md = readFileSync("scripts/kimi-review/5-my-queries.md", "utf8");
  const cases: Case[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]*)\|/);
    if (!m) continue;
    const expectCell = m[3].trim();
    const expect = expectCell
      .split(/또는|,/)
      .map((s) => s.trim().split(".")[0].trim())
      .filter(Boolean);
    if (expectCell.includes("의료취약")) expect.push("rankHospitalScarcity", "tool-scarcity");
    cases.push({ no: Number(m[1]), query: m[2].trim(), expect, vague: m[4].includes("애매") });
  }
  return cases;
}

describe("항목5: 독립 질의 30개로 RAG 측정", () => {
  it("top-1 / top-5 적중률", () => {
    const cases = loadCases();
    console.log(`\n질의 ${cases.length}개 로드`);
    let top1 = 0, top5 = 0, top1Vague = 0, top5Vague = 0, vagueN = 0;
    const misses: string[] = [];
    for (const c of cases) {
      const hits = retrieveRagChunks({ query: c.query, limit: 5 });
      const layerOf = (id: string, tags: string[]) =>
        tags.find((t) => c.expect.includes(t)) ?? (c.expect.some((e) => id.includes(e)) ? id : null);
      const ranks = hits.map((h) => layerOf(h.chunk.id, h.chunk.tags) !== null);
      const hit1 = ranks[0] === true;
      const hit5 = ranks.some(Boolean);
      if (c.vague) {
        vagueN += 1;
        if (hit1) top1Vague += 1;
        if (hit5) top5Vague += 1;
      } else {
        if (hit1) top1 += 1;
        if (hit5) top5 += 1;
      }
      const mark = hit1 ? "①" : hit5 ? "⑤" : "✗";
      console.log(`${mark} #${c.no} ${c.query} → ${hits.map((h) => h.chunk.id).join(", ") || "(없음)"}`);
      if (!hit5) misses.push(`#${c.no} ${c.query} (기대: ${c.expect.join("/")})`);
    }
    console.log(`\n[확신 질의 ${cases.length - vagueN}개] top-1: ${top1}/${cases.length - vagueN}, top-5: ${top5}/${cases.length - vagueN}`);
    console.log(`[애매 질의 ${vagueN}개] top-1: ${top1Vague}/${vagueN}, top-5: ${top5Vague}/${vagueN}`);
    console.log(`[전체] top-1: ${top1 + top1Vague}/${cases.length}, top-5: ${top5 + top5Vague}/${cases.length}`);
    if (misses.length) console.log(`5위 밖: ${misses.join(" | ")}`);
  });

  it("의뢰자의 15개 평가셋 숫자(10/15, 15/15)를 그대로 재현해 본다", () => {
    // tests/rag/retrieval-quality.test.ts의 CASES — 내 30개 채점이 끝난 뒤에 열었다.
    const THEIRS: Array<[string, string, string]> = [
      ["불이 자주 나는 지역이 어디야", "kosis-safety", "fire_rate"],
      ["교통사고가 잦은 시군", "kosis-safety", "accident_rate"],
      ["아이 맡길 데가 부족한 곳", "kosis-welfare", "childcare"],
      ["혼자 사시는 어르신이 많은 지역", "kosis-welfare", "solo_elderly"],
      ["의사가 모자란 시군", "kosis-health", "doctors"],
      ["집이 비어 있는 곳이 많은 시군", "kosis-housing", "vacant"],
      ["재정이 취약한 지자체", "kosis-finance", "fiscal_independence"],
      ["차를 많이 가진 지역", "kosis-transport", "car_per_person"],
      ["쓰레기를 많이 버리는 시군", "kosis-environment", "waste_per_person"],
      ["학원이 몰려 있는 곳", "kosis-education", "academy"],
      ["낮에 사람이 많은 동네", "skt-daynight", "day_population"],
      ["장사가 잘되는 상권", "nh-consumption", "card_sales"],
      ["잘 사는 동네", "kcb-credit", "avg_income"],
      ["빚이 많은 지역", "kcb-credit", "loan_ratio"],
      ["출퇴근으로 빠져나가는 동네", "kcb-commute", "outbound_ratio"],
    ];
    let t1 = 0, t5 = 0;
    for (const [q, layerId, metricKey] of THEIRS) {
      const want = `metric-${layerId}-${metricKey}`;
      const hits = retrieveRagChunks({ query: q, limit: 5 });
      const rank = hits.findIndex((h) => h.chunk.id === want);
      if (rank === 0) t1 += 1;
      if (rank >= 0) t5 += 1;
      console.log(`[의뢰자셋] ${rank < 0 ? "✗5위밖" : `${rank + 1}위`} ${q} → ${want}`);
    }
    console.log(`[의뢰자셋 재현] top-1: ${t1}/15, top-5: ${t5}/15 (의뢰자 주장: 10/15, 15/15)`);
  });
});
