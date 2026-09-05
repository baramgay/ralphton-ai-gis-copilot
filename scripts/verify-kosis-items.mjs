/*
 * 우리가 집은 itmId가 **정말 그 항목인지** KOSIS 원장에 물어본다.
 *
 * 25개 지표는 표(tblId)와 항목(itmId) 두 값으로 골라 온다. 표는 이름으로 확인되지만
 * itmId는 「T10」·「T20」·「T001」 같은 코드라 눈으로는 맞는지 알 수 없다. 한 칸을
 * 잘못 집으면 **율 대신 건수**가 실리고, 그 순간 창원이 5배 부푼 값으로 1위가 된다
 * (율만 싣기로 한 규칙이 여기에 걸려 있다).
 *
 * 값의 범위로는 이미 전부 율처럼 보인다 — 그러나 「율처럼 보이는 건수」는 얼마든지
 * 있다. 그래서 원장의 항목명(ITM_NM)과 단위(UNIT_NM)를 직접 받아 맞춰 본다.
 *
 * 판정 기준 둘:
 *   1) 그 itmId가 표에 실제로 존재하는가 (없으면 조용히 빈 레이어가 된다)
 *   2) 그 **항목 자체가** 율인가 — 표 이름이 아니라
 *
 * 실행: node scripts/verify-kosis-items.mjs
 * 종료 코드로 판정한다(초록 0 / 붉음 1). 네트워크가 필요하므로 게이트에는 넣지 않는다.
 */
import { readFileSync } from "node:fs";

import { fetchKosisTable, readKey } from "./adapters/_kosis-core.mjs";
import { KOSIS_LAYER_SPECS } from "./adapters/kosis-indicators.mjs";

const SECRET_PATH = "C:/업무/_secrets/부동산월보-kosis-api-key.txt";

/*
 * 키 읽기는 수집기와 **같은 함수**를 쓴다. 여기서 따로 짰다가 한 번 데였다 — 이 키는
 * "="로 끝나는데 그것을 「이름=값」의 구분자로 보고 잘라, 빈 키를 보내고 26개 지표가
 * 전부 「표 없음」으로 나왔다. 자료가 없는 것처럼 보였지만 없던 것은 키였다.
 */
function loadKey() {
  const fromEnv = process.env.KOSIS_API_KEY?.trim();
  return fromEnv || readKey(readFileSync, SECRET_PATH);
}

/*
 * 「율인가」를 어떻게 가리는가.
 *
 * 처음에는 항목명에 「건수」가 들어 있으면 건수로 봤다. 그러자 「주민만명당 화재발생건수
 * (A÷B×10000)」가 붉어졌다 — 이름에 건수가 들어 있을 뿐 **명백한 율**이다. 반대로
 * 「생활계폐기물 재활용률」은 통과해야 하는데 붉었다: 「율」로 찾고 있었고 이 낱말은
 * 「률」이다.
 *
 * 그래서 낱말이 아니라 **산식**을 본다. KOSIS 원장은 율 항목의 이름에 (A÷B×N)을 함께
 * 적는다. 그것이 가장 확실한 신호다. 산식이 없는 항목(「보급률」·「주택소유가구비율」)은
 * 낱말로, 그것도 없으면 표 이름으로 본다(「학급당 학생수」 표의 T001 「전체」처럼 율이
 * 항목이 아니라 표에 적혀 있는 경우가 있다).
 */
const RATE_PATTERN = /÷|\/|당\s|당$|율|률|비중|비율|지수|보급|포장/;

const hasFormula = (name) => /[(（].{0,12}÷/.test(name ?? "");

/*
 * ⚠️ 표 이름으로 받아 주는 것은 **표에 율 항목이 아예 없을 때뿐이다.**
 *
 * 처음에는 표 이름만 맞으면 통과시켰다. 그러자 `fire_rate`의 itmId를 일부러 분자(T001,
 * 원본 화재발생 건수)로 바꿔도 초록이었다 — 표 이름이 「주민만명당 화재발생건수」라
 * 율로 읽혔기 때문이다. **검사가 지키려던 바로 그 오집을 못 봤다.** 표 안에 산식을 가진
 * 항목(T10)이 있다면, 그 표에서 율은 그 항목이고 나머지는 분자·분모다.
 */
function rateEvidence(picked, siblings) {
  if (hasFormula(picked.name)) return `산식 ${picked.name.match(/[(（][^)）]{0,24}/)?.[0] ?? ""}`;
  if (RATE_PATTERN.test(picked.name)) return `항목명 ${picked.name}`;
  if (picked.unit === "%") return "단위 %";
  const tableHasRateItem = siblings.some((item) => hasFormula(item.name));
  if (tableHasRateItem) return null;
  if (RATE_PATTERN.test(picked.table)) return `표 이름 ${picked.table}`;
  return null;
}

const key = loadKey();
const failures = [];
const rows = [];
const check = (ok, label, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
};

for (const spec of KOSIS_LAYER_SPECS) {
  for (const metric of spec.metrics) {
    let table;
    try {
      // itmId를 빼고 받아 표 안의 **모든 항목**을 본다. 우리가 집은 것이 그중 어느
      // 것인지, 그리고 다른 후보가 무엇이었는지 같이 봐야 오집을 알아볼 수 있다.
      table = await fetchKosisTable({ apiKey: key, orgId: "101", tblId: metric.tblId, years: 1 });
    } catch (error) {
      check(false, `${spec.id}.${metric.key} 표를 못 받음`, String(error).slice(0, 80));
      rows.push({ 지표: `${spec.id}.${metric.key}`, 결과: "표 없음" });
      continue;
    }

    const items = new Map();
    for (const row of table) {
      if (!row.ITM_ID) continue;
      if (!items.has(row.ITM_ID))
        items.set(row.ITM_ID, { name: row.ITM_NM, unit: row.UNIT_NM ?? "", table: row.TBL_NM ?? "" });
    }
    const picked = items.get(metric.itmId);

    if (!picked) {
      check(false, `${spec.id}.${metric.key} itmId ${metric.itmId}가 표에 없음`, [...items.keys()].join("/"));
      rows.push({ 지표: `${spec.id}.${metric.key}`, 결과: `없는 itmId(${[...items.keys()].join("/")})` });
      continue;
    }

    const evidence = rateEvidence(picked, [...items.values()]);
    check(
      evidence !== null,
      `${spec.id}.${metric.key}가 율이 아니다`,
      `[${metric.itmId}] ${picked.name} / ${picked.unit} — 이 표의 율 항목은 ${
        [...items].filter(([, item]) => hasFormula(item.name)).map(([id]) => id).join("/") || "(없음)"
      }`,
    );

    rows.push({
      지표: `${spec.id}.${metric.key}`,
      우리라벨: `${metric.label} (${metric.unit})`,
      원장항목: `${picked.name.replace(/＜br＞/g, " ")} [${metric.itmId}]`,
      원장단위: picked.unit || "(없음)",
      율근거: evidence ? evidence.slice(0, 28) : "**없음**",
    });
  }
}

console.table(rows);
console.log(failures.length === 0 ? "\n전부 통과" : `\n실패 ${failures.length}건:\n - ${failures.join("\n - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
