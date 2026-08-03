/*
 * 행정안전부 1741000 계열(행정동별 통반단위) 오퍼레이션 접근상태 진단.
 *
 * prod 앱을 두드리는 다른 스크립트와 달리 이건 정부 API를 직접 두드린다 — data.go.kr
 * 서비스키·경로 문제를 코드 배포 없이 먼저 가른다.
 *
 * 오라클(대조군 실험으로 확정, docs/PUBLIC-DATA-API-SPEC.md 참고):
 *   HTTP 200                              → 경로 있음 + 이 키 승인됨
 *   HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED → 경로는 있고 이 키가 그 오퍼레이션에 미승인
 *   HTTP 400 NO_OPENAPI_SERVICE_ERROR      → 그 경로에 오픈API 자체가 없음(이름이 틀림)
 *
 * 정상 요청만 던지면 "막혔다"까지만 보인다 — 마지막 두 항목(틀린 키·없는 경로)이
 * 대조군이다. 이 스크립트가 그 둘과 다른 결과를 내면 오라클 자체가 무효화된 것이니
 * 먼저 의심하라.
 *
 * 키 값은 절대 출력하지 않는다. URL은 fetch에만 쓰고 어떤 로그에도 내보내지 않는다.
 */
import { readFileSync } from "node:fs";

const KEY = readFileSync(".env.local", "utf8").match(/^DATA_GO_KR_SERVICE_KEY=(.*)$/m)?.[1]?.trim();
if (!KEY) throw new Error(".env.local에 DATA_GO_KR_SERVICE_KEY 없음");

// 포털에서 확인한 "행정동별(통반단위)" 8종 전체(2026-08-04, 페이지 열람만으로 확인 — API 호출 아님).
const OPERATIONS = [
  ["admmPpltnHhStus", "인구·세대현황 (15108065)", "이미 코드에서 사용 중"],
  ["admmSexdAgePpltn", "성/연령별 인구수 (15108072)", "연령별 분석에 필요"],
  ["admmSexdBrthReg", "성별 출생등록자수 (15108075)", "이미 코드에서 사용 중(646ec3f)"],
  ["admmSexdAgeErsr", "성/연령별 사망말소자수 (15108077)", "이미 코드에서 사용 중(646ec3f)"],
  ["admmHsmbHh", "세대원수별 세대수 (15108081)", "현재 앱 지표 범위 밖"],
  ["admmSexdAgeOneHh", "성/연령별 1인세대수 (15108083)", "1인가구 지표에 필요"],
  ["admmSexdPpltnAvrgAge", "성별 평균연령 (15108087)", "현재 앱 지표 범위 밖"],
  ["admmSexdPpltnIrds", "성별 인구증감 (15108089)", "이미 자체 계산 중 — 불필요"],
];

const CONTROLS = [
  ["admmZZZZZZ", "없는 경로(대조군)", "─"],
];

const verdict = (status, body) => {
  if (status === 200) return "200 정상";
  if (/SERVICE_KEY_IS_NOT_REGISTERED/.test(body)) return "403 미승인";
  if (/NO_OPENAPI_SERVICE_ERROR/.test(body)) return "400 경로없음";
  return `? HTTP ${status}`;
};

async function probe(op, key) {
  const suffix = op.charAt(0).toUpperCase() + op.slice(1);
  const url = new URL(`https://apis.data.go.kr/1741000/${op}/select${suffix}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("type", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1");
  url.searchParams.set("admmCd", "4817025000");
  url.searchParams.set("srchFrYm", "202606");
  url.searchParams.set("srchToYm", "202606");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.text()).replace(/\s+/g, " ");
    return verdict(res.status, body);
  } catch (error) {
    return `예외 ${String(error).slice(0, 40)}`;
  }
}

console.log("연산".padEnd(24), "데이터셋".padEnd(30), "쓸모", "결과");
console.log("-".repeat(100));
for (const [op, label, use] of OPERATIONS) {
  console.log(op.padEnd(24), label.padEnd(30), use.padEnd(28), await probe(op, KEY));
}
console.log();
console.log("=== 대조군 (오라클 유효성 확인용) ===");
for (const [op, label, use] of CONTROLS) {
  console.log(op.padEnd(24), label.padEnd(30), use.padEnd(28), await probe(op, KEY));
}
