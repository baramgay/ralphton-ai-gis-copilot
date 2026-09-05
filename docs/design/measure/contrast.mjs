// 대비비 실측 — WCAG 2.x 상대 휘도. 순수 계산이라 어느 환경에서나 같은 값이 나온다.
// 실행: node docs/design/measure/contrast.mjs
//
// 방법: 유리의 실제 배경 = 유리 틴트를 타일 색 위에 알파 합성한 값.
// 합성은 타일 색의 단조 함수이므로, 극단(순백 타일 / 순흑 타일)에서 AA를 넘으면
// 그 사이의 모든 타일에서 넘는다. 그래서 극단 둘만 재면 된다.
// blur는 타일을 타일 평균색으로 바꿀 뿐이라 대비 계산에서는 평균색 합성과 같다.

const L = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const over = (fg, a, bg) => fg.map((v, i) => Math.round(a * v + (1 - a) * bg[i]));
const ratio = (c1, c2) => {
  const [a, b] = [L(c1), L(c2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};
const fmt = (r) => r.toFixed(2).padStart(5);

const WHITE = [255, 255, 255], BLACK = [10, 10, 12]; // 타일 극단

const rows = [];
const add = (label, fg, bg) => rows.push([label, fg, bg, ratio(fg, bg)]);

// ── 다크 유리 (글자 밝음): 최악 = 순백 타일 ──
const dg72w = over(hex("#0d1524"), 0.72, WHITE); // --glass-bg 다크
const dg85w = over(hex("#0a111e"), 0.85, WHITE); // --glass-bg-strong 다크
const dg72b = over(hex("#0d1524"), 0.72, BLACK);
const dg85b = over(hex("#0a111e"), 0.85, BLACK);
for (const [name, glass] of [["다크유리72% × 순백타일", dg72w], ["다크유리85% × 순백타일", dg85w], ["다크유리72% × 순흑타일", dg72b], ["다크유리85% × 순흑타일", dg85b]]) {
  add(`${name} / text-1 #f1f5f9`, hex("#f1f5f9"), glass);
  add(`${name} / text-2 #c7d2e0 (유리 위 최소 라벨)`, hex("#c7d2e0"), glass);
  add(`${name} / text-3 #8fa3bd (참고: 유리 위 금지)`, hex("#8fa3bd"), glass);
  add(`${name} / accent #22d3ee (배지 제목)`, hex("#22d3ee"), glass);
  add(`${name} / accent-warm #fbbf24 (지점 경고)`, hex("#fbbf24"), glass);
}

// ── 라이트 유리 (글자 어두움): 최악 = 순흑 타일(야간·위성 어두운 곳) ──
const lg72b = over([255, 255, 255], 0.72, BLACK);
const lg85b = over([255, 255, 255], 0.85, BLACK);
const lg72w = over([255, 255, 255], 0.72, WHITE);
const lg85w = over([255, 255, 255], 0.85, WHITE);
for (const [name, glass] of [["라이트유리72% × 순흑타일", lg72b], ["라이트유리85% × 순흑타일", lg85b], ["라이트유리72% × 순백타일", lg72w], ["라이트유리85% × 순백타일", lg85w]]) {
  add(`${name} / text-1 #0f172a`, hex("#0f172a"), glass);
  add(`${name} / text-2 #334155 (유리 위 최소 라벨)`, hex("#334155"), glass);
  add(`${name} / text-3 #64748b (참고: 유리 위 금지)`, hex("#64748b"), glass);
  add(`${name} / accent #2563eb (배지 제목)`, hex("#2563eb"), glass);
  add(`${name} / accent-warm #b45309 (지점 경고)`, hex("#b45309"), glass);
}

// ── 고대비: 반투명 없음, 계산이 곧 실측 ──
add("고대비 #fff / #000", hex("#ffffff"), hex("#000000"));
add("고대비 #eee / #000 (text-3)", hex("#eeeeee"), hex("#000000"));
add("고대비 #ddd / #000 (text-4)", hex("#dddddd"), hex("#000000"));
add("고대비 반전 #000 / #fff (is-active)", hex("#000000"), hex("#ffffff"));

// ── 알파 하한 근거: 72%를 내리면 어디서 깨지는가 ──
console.log("== 표 1. 유리 위 글자 대비 (극단 타일, WCAG AA 본문 4.5 / 큰 글자 3.0) ==");
let fail = 0;
for (const [label, fg, bg, r] of rows) {
  const aa = r >= 4.5 ? "AA✓" : r >= 3.0 ? "큰글자만" : "실패";
  if (r < 4.5) fail++;
  console.log(`${fmt(r)}  ${aa}  ${label}`);
}
console.log(`\nAA(4.5) 미달: ${fail}건\n`);

console.log("== 표 2. 알파 하한의 근거 — 다크 유리 + 순백 타일 + 밝은 글자(#f1f5f9) ==");
for (const a of [0.50, 0.60, 0.65, 0.70, 0.72, 0.80, 0.85]) {
  const g = over(hex("#0d1524"), a, WHITE);
  console.log(`알파 ${(a * 100).toFixed(0).padStart(2)}% → 복합 rgb(${g.join(",")}) 대비 ${fmt(ratio(hex("#f1f5f9"), g))}`);
}
console.log("\n== 표 3. 같은 질문, 라이트 유리 + 순흑 타일 + 어두운 글자(#0f172a) ==");
for (const a of [0.50, 0.60, 0.65, 0.70, 0.72, 0.80, 0.85]) {
  const g = over([255, 255, 255], a, BLACK);
  console.log(`알파 ${(a * 100).toFixed(0).padStart(2)}% → 복합 rgb(${g.join(",")}) 대비 ${fmt(ratio(hex("#0f172a"), g))}`);
}
