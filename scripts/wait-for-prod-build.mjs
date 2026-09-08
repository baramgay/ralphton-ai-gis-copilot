/*
 * 배포본에 새 빌드가 올라왔는지 기다린다.
 *
 * CI가 push 직후에 배포본을 재면 Vercel이 아직 직전 빌드를 서빙 중이라,
 * 옛 빌드를 재고 초록불을 낸다. 뜻 없는 초록불은 검사가 없는 것보다 나쁘다.
 * `/api/health`의 build.commitSha(Vercel이 주입한 커밋)가 지금 push한 SHA와
 * 같아질 때까지 폴링한다.
 *
 * 상한 안에 안 맞으면 실패가 아니라 명시적 건너뜀(SKIP)으로 끝낸다 —
 * 옛 빌드를 재는 것보다 낫다. CI는 이 출력을 읽어 검사 단계를 건너뛴다.
 *
 * 실행: node scripts/wait-for-prod-build.mjs [URL] [SHA] [상한초] [간격초]
 *   종료 0 + MATCHED → 검사 진행
 *   종료 0 + SKIPPED → 검사 건너뜀
 *   종료 1 → 사용법 오류 등
 */
const URL = process.argv[2] ?? process.env.PROD_URL ?? "https://gnbc.site/";
const WANT = process.argv[3] ?? process.env.GITHUB_SHA ?? "";
const LIMIT_S = Number(process.argv[4] ?? 300);
const INTERVAL_S = Number(process.argv[5] ?? 20);

if (!WANT) {
  console.error("기대하는 커밋 SHA가 없다. SHA 인자를 넘겨라.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + LIMIT_S * 1000;

async function readSha() {
  const response = await fetch(`${URL.replace(/\/$/, "")}/api/health`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const sha = body?.build?.commitSha;
  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

/*
 * 끝낼 때 `process.exit()`를 쓰지 않는다. 방금 `fetch`가 남긴 핸들이 닫히는 중에
 * 강제 종료하면 윈도우 libuv가 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
 * 로 죽으면서 **종료 코드 127**을 낸다 — MATCHED 를 찍고도 실패로 끝났다(실측).
 * CI 는 이 종료 코드로 판정하므로, 그대로 두면 새 빌드가 올라와 있는데도 검사를
 * 건너뛴다. 반복문을 빠져나가 자연히 끝내면 종료 코드는 0이다.
 */
let attempt = 0;
for (;;) {
  attempt += 1;
  let sha = null;
  try {
    sha = await readSha();
  } catch {
    sha = null;
  }
  console.log(`[${attempt}회] 배포본 커밋: ${sha ?? "(읽기 실패)"} / 기대: ${WANT}`);
  if (sha === WANT) {
    console.log("MATCHED — 새 빌드가 올라와 있다. 검사를 진행한다.");
    break;
  }
  if (Date.now() >= deadline) {
    console.log(
      `SKIPPED — ${LIMIT_S}초 안에 새 빌드가 안 올라왔다. 옛 빌드를 재지 않고 검사를 건너뜀.`,
    );
    break;
  }
  await sleep(INTERVAL_S * 1000);
}
