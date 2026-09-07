import { spawn } from "node:child_process";

/*
 * 배포본 검사 묶음. `npm run verify`(유닛·타입·린트·빌드)는 로컬만 보므로,
 * 배포본이 붉어도 게이트는 초록이었다. 이 러너가 배포본 쪽 게이트다.
 *
 * 전부 브라우저로 실제 배포본을 두드리므로 느리다(10분 안팎). 로컬 게이트에
 * 넣지 않고, main 푸시 뒤 CI와 출시 전 수동으로 돌린다.
 * CI는 여기서 빠른 4종만 고른다(배포 시차·외부 의존 때문에 실패해도 머지를
 * 막지 않는다 — continue-on-error. 전체는 수동 출시 확인).
 *
 * 실행: node scripts/verify-prod.mjs [URL] [스크립트...]
 *   예: node scripts/verify-prod.mjs https://gnbc.site/ terms sgg
 * 이름은 `verify-<이름>-prod.mjs` / `verify-<이름>.mjs`의 <이름> 부분이다.
 */
const URL = process.argv[2] ?? process.env.PROD_URL ?? "https://gnbc.site/";
const only = new Set(process.argv.slice(3));

const SCRIPTS = [
  { name: "terms", file: "verify-terms-prod.mjs" },
  { name: "stats", file: "verify-stats-prod.mjs" },
  { name: "probe", file: "verify-probe-prod.mjs" },
  { name: "suggestions", file: "verify-suggestions-prod.mjs" },
  { name: "sgg", file: "verify-sgg-prod.mjs" },
  { name: "map-overlap", file: "verify-map-overlap.mjs" },
  { name: "panel-scroll", file: "verify-panel-scroll.mjs" },
  { name: "touch-targets", file: "verify-touch-targets.mjs" },
  { name: "contrast-all", file: "verify-contrast-all.mjs" },
  { name: "glass", file: "verify-glass.mjs" },
  { name: "readable", file: "verify-readable.mjs" },
  { name: "perf", file: "verify-perf-prod.mjs" },
];

const picked = only.size > 0 ? SCRIPTS.filter((script) => only.has(script.name)) : SCRIPTS;
if (only.size > 0) {
  const known = new Set(SCRIPTS.map((script) => script.name));
  for (const name of only) {
    if (!known.has(name)) {
      console.error(`알 수 없는 검사: ${name} (가능: ${[...known].join(", ")})`);
      process.exit(2);
    }
  }
}

const TIMEOUT_MS = 8 * 60_000;

function run(file) {
  return new Promise((resolve) => {
    console.log(`\n===== ${file} =====`);
    const child = spawn("node", [`scripts/${file}`, URL], { stdio: "inherit" });
    const timer = setTimeout(() => {
      console.error(`!! ${file}: ${TIMEOUT_MS / 1000}초 초과, 중단한다`);
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ file, ok: false, detail: String(error) });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0, detail: `exit ${code}` });
    });
  });
}

const results = [];
for (const script of picked) {
  results.push(await run(script.file));
}

console.log("\n===== prod 검사 요약 =====");
for (const result of results) {
  console.log(`${result.ok ? "  OK  " : "  !!  "} ${result.file}${result.ok ? "" : ` — ${result.detail}`}`);
}
const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? "\nprod 검사 전부 통과" : `\n실패 ${failed.length}건`);
process.exit(failed.length === 0 ? 0 : 1);
