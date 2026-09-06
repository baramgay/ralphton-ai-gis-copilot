# 누리맵 — 상관·이상치 질의 결과가 화면에 안 나온다 (수정 지시)

작성 2026-09-06 · 대상 커밋 `9cf707f` (main) · 배포본 https://ralphton-ai-gis-copilot.vercel.app

UI/UX 개선 15커밋은 배포본에서 전건 확인했습니다(게이트 유닛 1,762 · e2e 26 · 배포본 검사
contrast-all·readable·glass·panel-scroll·probe·touch-targets 전부 초록, 7개 폭에서 겹침 0 ·
44×44 미달 0). 아래 한 건만 고쳐 주세요. **이 결함은 개선 과정에서 새로 생긴 것이 아니라
원래 숨어 있던 것이 드러난 것**입니다.

---

## 1. 환경

- 레포: `C:\업무\랄프톤` (main)
- 스택: Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Vitest · Playwright
- 게이트: `npm run verify` (test → typecheck → lint → build). e2e 는 `VERIFY_E2E=1 npm run verify`
  - 이 레포에 `npm run gate` 는 **없습니다**
- 배포: `vercel --prod --scope na-da-s-projects`
- 손댈 파일
  | 파일 | 자리 |
  |---|---|
  | `src/components/copilot/copilot-app.tsx` | `analysis` 메모 1529 · `runStats` 2298~2393 |
  | `scripts/verify-stats-prod.mjs` | 판정 기준(고치지 말 것 — 이 검사가 결함을 맞게 잡았습니다) |
  | `scripts/verify-terms-prod.mjs` | 43~47행 (§4, 낡은 단정) |

---

## 2. 증상 (배포본에서 3회 재현, 3/3 실패)

질의창에 **「재정자립도와 빈집 비율의 상관관계」** 를 넣고 실행하면:

- 상단 알림: `상관분석 · 재정자립도 × 빈집 비율 (시군구 단위)` ← 질의는 맞게 읽었습니다
- 결과 패널: `총생활인구 순위 · 2025-12 · 행정동 305개`, 24줄, 「1위 양산시 물금읍(100점)」
  ← **전혀 다른 답**

읽는 사람은 위의 알림을 보고 아래 순위를 상관분석 결과로 읽습니다. 이 제품에서 가장 나쁜
실패 모양입니다 — 비어 있는 것이 아니라 **다른 답을 자신 있게** 내놓습니다.

`node scripts/verify-stats-prod.mjs https://ralphton-ai-gis-copilot.vercel.app` 가 8건 실패로
잡습니다(표본 18이어야 할 자리에 24줄, 점수 문구 등).

상태를 +1200 / 3000 / 6000 / 10000 ms 로 지켜봐도 활성 레이어는 계속 `생활인구(SKT)` 입니다.
느린 것이 아니라 **영영 안 바뀝니다.**

---

## 3. 원인

`analysis` 메모(`copilot-app.tsx:1529`):

```tsx
const analysis = useMemo<AnalysisView | null>(() => {
  if (activeLayerId !== "medical") {
    if (layerAnalysisResult) return { ...layerAnalysisResult.analysis, id: activeLayerId };
    if (layerLoadingView) return layerLoadingView;
  }
  return quickAnalysis;   // customAnalysis 가 여기에 실려 있다
}, [activeLayerId, layerAnalysisResult, layerLoadingView, quickAnalysis]);
```

질의 결과(`customAnalysis`)는 `quickAnalysis`(1392) 안에 실려 마지막 줄로만 나옵니다. 즉
**활성 레이어가 `medical` 일 때만** 질의 결과가 화면에 닿습니다. `"medical"` 이 사실상
「질의 결과 모드」의 표식으로 쓰이고 있습니다.

그래서 `setCustomAnalysis` 를 부르는 갈래는 전부 `setActiveLayerId("medical")` 를 같이 부릅니다.
**`runStats` 하나만 안 부릅니다.**

| 갈래 | 줄 | `setActiveLayerId("medical")` |
|---|---|---|
| `rememberQuery` | 1222 | O |
| `drillIntoDistrict` | 1971 | O |
| **`runStats`** | **2340** | **X ← 여기** |
| `runCross` | 2420 | O |
| `runMulti` | 2477 | O |
| `runTrend` | 2601 | O |
| `runTrendCross` | 2730 | O |
| (레이어 재계산) | 3117 | O |

기본 레이어가 `medical` 이던 동안에는 이미 medical 이라 표가 안 났습니다. 기본을
`skt-living` 으로 바꾼 `3b68dff` 가 이것을 **드러낸 것**이지 만든 것이 아닙니다. 그 한 줄은
되돌리지 마세요 — 첫 화면을 의료로 열지 않는 것이 맞습니다.

---

## 4. 할 일

### 4-1. 상관·이상치 결과가 화면에 나오게 한다 (필수)

두 길 중 하나를 고르세요.

**길 A — 형제와 같게 (한 줄).**
`runStats` 의 `setCustomAnalysis({ id: "cross", … })` 바로 앞에 `setActiveLayerId("medical");`
를 넣습니다. 다른 일곱 갈래와 같은 모양이 되고, 위험이 가장 작습니다.

**길 B — 표식을 없앤다 (권장, 다만 확인할 자리가 더 있음).**
`analysis` 가 `customAnalysis` 를 먼저 돌려주게 해서 레이어 id 에 기대지 않게 합니다.
다음 갈래가 또 빠뜨려도 안 깨집니다. 대신 같은 표식을 쓰는 **다른 자리도 함께** 맞춰야 합니다:

- `scores` 메모 1608 — 지도에 칠할 값. 상관 결과는 칠할 것이 없어야 합니다(2336의 주석 참조)
- `showRadius` 4446 — `activeLayerId === "medical" && !customAnalysis`
- 3255 · 3434 의 주석 — 「medical 로 두고 customAnalysis 로 렌더한다」는 설명이 거짓이 됩니다

길 B 를 고르면 위 네 자리를 **전부** 손보고, 안 고친 자리가 없는지 `customAnalysis` 와
`activeLayerId !== "medical"` 을 각각 훑어 확인하세요. 어느 길이든 상관 결과에서 지도가
엉뚱한 색으로 칠해지지 않아야 합니다.

**회귀 테스트를 같이 넣으세요.** 유닛(`tests/ui/`)에서 상관 질의를 실행한 뒤 결과 패널에
상관 결과가 나오는지 봅니다. 넣은 뒤 **일부러 깨뜨려**(그 줄을 지우고) 붉은불이 나는지
확인하고, 되돌린 뒤 초록을 확인하세요. 안 깨뜨려 본 테스트는 가드가 아닙니다.

### 4-2. 낡아진 단정 하나 (같이)

`scripts/verify-terms-prod.mjs` 43~47행이 **첫 화면**에 「의료 접근성」과
「공급·거리·고령수요 합성」이 있어야 한다고 단정합니다. 기본 레이어가 바뀌어 첫 화면에는
이제 없습니다 — 의료기관 레이어를 고르면 부제까지 정상으로 나옵니다. **제품 결함이 아니라
검사가 낡은 것**입니다.

두 단정을 「의료기관 레이어를 고른 뒤」로 옮기세요. 단정을 지우지는 마세요 — 이 검사는
「의료취약지수」라는 옛 이름이 되살아나는 것을 막는 자리입니다.

---

## 5. 어기면 되돌리는 규칙

1. **최소 변경.** 이 결함에 직결된 줄만. 지나가다 눈에 띈 것은 고치지 말고 적어서 주세요.
2. **배포본으로 판정.** 로컬 초록만으로 완료라 하지 않습니다.
3. **파이프 뒤 `&&` 금지.** `게이트 | tail && 배포` 는 붉은 게이트로도 배포합니다.
   로그로 빼고 `echo exit=$?` 로 봅니다.
4. **색은 토큰으로.** Tailwind 색 유틸리티를 새로 쓰지 마세요(테마 전환이 열거로 덮습니다).
5. **「읍면동」 금지 — 「행정동」.** 소스 주석도 포함이고 테스트가 잡습니다.
6. **산출물에 개발자 말투 금지.** 화면 글자에 파일 경로·환경변수·명령을 넣지 마세요.
7. **가드는 깨뜨려 봐야 가드입니다.** 초록불은 「위반 없음」과 「검사가 못 봄」을 구분 못 합니다.

---

## 6. 완료 판정

배포한 뒤 **배포본 주소로** 다음을 전부 통과해야 합니다.

```
npm run verify                      # 유닛 1,762+ · tsc · lint · build
VERIFY_E2E=1 npm run verify         # e2e 26+
node scripts/verify-stats-prod.mjs   https://ralphton-ai-gis-copilot.vercel.app
node scripts/verify-terms-prod.mjs   https://ralphton-ai-gis-copilot.vercel.app
node scripts/verify-contrast-all.mjs https://ralphton-ai-gis-copilot.vercel.app
node scripts/verify-touch-targets.mjs https://ralphton-ai-gis-copilot.vercel.app
node scripts/verify-panel-scroll.mjs https://ralphton-ai-gis-copilot.vercel.app
```

각 명령의 **종료 코드**로 판정하고, 결과에 종료 코드를 그대로 적어 주세요.

눈으로도 한 번 보세요: 「재정자립도와 빈집 비율의 상관관계」를 물었을 때 알림과 결과 패널이
**같은 것을 말하는지**, 그리고 상관 결과에서 지도가 엉뚱하게 칠해지지 않는지.

## 7. 제출

커밋을 `main` 에 올리고, 커밋 해시 · 고른 길(A/B) · 위 7개 명령의 종료 코드 · 배포 주소를
적어 주세요. 되돌린 것이나 못 고친 것이 있으면 그것도 적어 주세요.
