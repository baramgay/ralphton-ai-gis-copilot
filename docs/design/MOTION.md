# 누리맵 모션 스펙 — 값으로

원칙 한 줄: **반응은 pointer-down에 즉시, 전이는 200~320ms 안에, 제스처가 닿는 것은 스프링.**
곡선 토큰은 TOKENS.md §2에 있습니다(`--dur-*`, `--ease-*`).

## 1. 전이 표 (CSS로 되는 것)

| 전이 | 속성 | 시간 | 곡선 | 비고 |
|---|---|---|---|---|
| 버튼 눌림 | `transform: scale(0.97)` | 100ms | `ease-out` | pointer-down에 즉시. 끝까지 기다리는 피드백은 죽은 것 |
| 눌림 해제 | `scale(1)` | 160ms | `--ease-out-expo` | 돌아올 때가 조금 더 느리다 |
| 호버·선택 색 | `background-color` `border-color` `color` | 140ms | `ease` | 기존 `--dur-ui` 유지 |
| `rank-row.is-selected` 진입 | `box-shadow`(inset 3px) + 배경 | 140ms | `ease` | 막대가 밀려들어오는 선 애니메이션 없이 색만 |
| 유리 등장(materialize) | `opacity 0→1` + `scale(0.96→1)` + `blur(0→24px)` | 220ms | `--ease-out-expo` | 페이드만 하지 말고 흐림·크기를 함께 — 재질이 「도착」해야 한다 |
| 시트 개폐 (버튼/스냅) | `transform: translateY` | 240ms | `--ease-out-expo` | 기존 곡선 유지. 200~320ms 범위 안 |
| 시트 열릴 때 도크 상승 | `bottom` | 240ms | `--ease-out-expo` | 시트와 같은 시간·같은 곡선 — 한 몸처럼 움직인다 |
| 테마 전환 | `background-color` `color` `border-color` | 180ms | `ease` | 기존값. 밝기 급변은 완만하게 |
| 토스트 | `opacity` + `translateY(8px→0)` | 180ms | `ease` | 기존 `toast-in` 유지 |
| 스켈레톤 shimmer | `background-position` | 1600ms | `ease-in-out` ∞ | 느린 반복(0.6Hz 이상). 0.2Hz 부근의 느린 진동 금지 |

공통 제한: 애니메이션은 `transform`과 `opacity`(합성 스레드)만. `width`·`height`·
`top/left` 애니메이션은 레이아웃을 다시 깨웁니다.

## 2. 스프링이 필요한 것 (CSS로 안 되는 것)

시트 손잡이 드래그·지도 팬에 붙는 도크 — 손이 닿는 것은 전부 스프링입니다.
CSS transition은 도중에 잡아 뒤집을 수 없으므로, 이 둘만 JS 스프링을 씁니다.

| 대상 | damping | response | 비고 |
|---|---|---|---|
| 시트 드래그 후 스냅 | 1.0 | 0.30 | 오버슈트 없음. 손에서 놓은 뒤 정리만 한다 |
| 시트를 세게 던졌을 때만 | 0.8 | 0.30 | 바운스는 **제스처가 운동량을 가져왔을 때만** |

구현 규칙 (Apple WWDC 2018 「Designing Fluid Interfaces」를 웹으로 옮긴 것):

1. **1:1 추적** — 드래그 중 시트는 손가락에 붙습니다. Pointer Events + `setPointerCapture`,
   잡은 지점의 오프셋을 존중합니다.
2. **속도 넘겨주기** — 놓는 순간의 포인터 속도를 스프링 초기 속도로. 끊김(벽돌벽) 금지.
3. **투사 스냅** — 놓은 위치가 아니라 **가고 있는 위치**로 스냅을 고릅니다:
   `project(v) = (v/1000) · d/(1−d)`, `d = 0.998`; `목표 = 현재 + project(놓을 때 속도)`에
   가장 가까운 스냅점(낮게 40 · 중간 56 · 높게 78 dvh).
4. **중단 가능** — 움직이는 시트를 다시 잡으면 화면 위 현재값(presentation value)에서
   새 스프링을 시작합니다. 목표값에서 시작하면 점프합니다.
5. **경계 반발** — 36dvh 아래·92dvh 위로는 러버밴드:
   `follow = (over × dim × 0.55) / (dim + 0.55 × |over|)`.

## 3. 방향 일관성

- 나간 길로 들어옵니다: 시트는 아래로 내려가 닫히고 아래에서 올라와 열립니다.
- 되돌리는 전이는 거울 곡선을 씁니다(나갈 때 `cubic-bezier(0.22,1,0.36,1)`이면
  들어올 때는 그 역행).
- 패널 접힘은 `opacity` 160ms(기존) — 위치가 안 바뀌는 전이라 페이드가 맞습니다.

## 4. 줄임 신호 (accessibility)

| 신호 | 물러서는 법 |
|---|---|
| `prefers-reduced-motion: reduce` | 슬라이드·스프링 전부 200ms opacity 교차페이드로. `transform` 제거. shimmer·pulse 정지(시안 06에 반영됨) |
| `prefers-reduced-transparency: reduce` | 유리 전부 `--surface-1` 불투명, `backdrop-filter` 제거 |
| `prefers-contrast: more` / 고대비 테마 | 시안 05 토큰 붕괴 |

줄임이 「반응 없음」을 뜻하지는 않습니다 — 눌림 하이라이트와 색 변화는 남깁니다.

## 5. 지도가 움직이는 동안 (성능과 모션의 경계)

팬·줌 중에는 유리 뒤가 매 프레임 다시 흐려집니다. 그래서:

1. 팬 시작(`movestart`) → 모든 `--glass-*` 표면에 `.is-map-moving` 클래스:
   `backdrop-filter: none` + 배경을 `--glass-bg-strong`(85%)으로 승격.
2. 팬 종료(`idle`) → 120ms 디바운스 후 클래스 제거. 흐림이 180ms 페이드로 돌아옵니다
   (`backdrop-filter`는 불연속이라, 실제로는 배경 알파만 페이드하고 흐름은 즉시 복귀).
3. 이 물러서기의 실측 효과는 `MEASURED.md` 표 4에 있습니다.

## 6. Tailwind v4 주의 (부록 C-5)

가운데 정렬을 덮을 때 `transform: none`이 아니라 **`translate: none`**입니다.
`-translate-x-1/2`는 별도 CSS 속성 `translate`에 값을 넣습니다. 시안 03·04의
`.map-float-dock`이 `left:0; right:0; translate:none;` 조합을 그대로 보여 줍니다.
