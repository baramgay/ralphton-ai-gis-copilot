# 누리맵 토큰표 — 2026-09-05 시안

정본 `src/app/globals.css`의 토큰 **이름은 그대로** 둡니다. 이 표는 ① 기존 토큰의 값 조정과
② 새 토큰 추가만 담습니다. 테마는 `html`에 속성 없음(라이트) / `data-theme="dark"`(기본) /
`data-theme="contrast"`(고대비), 시스템은 OS를 따라 라이트·다크로 해소(기존 `theme.ts` 규칙).

---

## 1. 새 토큰 — Liquid Glass (지도 위 부유층 전용)

| 토큰 | 라이트 | 다크(기본) | 고대비 | 쓰임 |
|---|---|---|---|---|
| `--glass-bg` | `rgb(255 255 255 / 72%)` | `rgb(13 21 36 / 72%)` | `#000` | 작은 유리: `map-float-bar` `query-hero-chip` `map-context-badge` `copilot-topbar` |
| `--glass-bg-strong` | `rgb(255 255 255 / 85%)` | `rgb(10 17 30 / 85%)` | `#000` | 글자를 직접 품는 유리: `query-hero-input` `probe-card` 모바일 시트 |
| `--glass-border` | `rgb(255 255 255 / 60%)` | `rgb(148 163 184 / 30%)` | `#fff` | 유리 외곽선 |
| `--glass-edge` | `inset 0 1px 0 rgb(255 255 255 / 75%), inset 0 -1px 0 rgb(15 23 42 / 6%)` | `inset 0 1px 0 rgb(255 255 255 / 13%), inset 0 -1px 0 rgb(0 0 0 / 35%)` | `none` | 1px 스페큘러 — 빛은 위에서 온다 |
| `--glass-shadow` | `0 12px 32px rgb(15 23 42 / 16%), 0 2px 6px rgb(15 23 42 / 8%)` | `0 14px 36px rgb(0 0 0 / 50%), 0 2px 8px rgb(0 0 0 / 35%)` | `none` | 유리의 깊이 |
| `--glass-blur` | `blur(24px) saturate(170%)` | 동일 | `none` | 큰 면(상단바·시트·지점 카드) |
| `--glass-blur-sm` | `blur(14px) saturate(150%)` | 동일 | `none` | 작은 면(버튼 줄·칩) |
| `--glass-text` | `var(--text-1)` | `var(--text-1)` | `#fff` | 유리 위 글자는 `--text-1`·`--text-2`만 허용(굵기 600+). `--text-3` 이하·색 글자는 유리 위 금지 — 근거: `MEASURED.md` 표 1 |

**불투명도 하한 72%.** 그 아래로 내리면 최악의 타일(순백 위성) 위에서 복합 바탕이 중간
회색이 되어 밝은 글자도 어두운 글자도 AA(4.5:1)를 못 넘습니다. 근거 수치는
`MEASURED.md` 표 2. 알파를 내리고 싶은 자리가 생기면 그 자리는 유리가 아니라 불투명
면으로 바꿔야 한다는 신호입니다.

**고대비에서의 붕괴.** `--glass-bg`가 `#000`으로, 엣지·그림자·흐림이 `none`으로 붕괴합니다.
컴포넌트가 `var(--glass-*)`만 쓰면 테마 교체 한 줄로 유리가 사라집니다(시안 05).
대신 모든 경계가 2px 순백으로 올라갑니다.

## 2. 새 토큰 — 자간·모션·터치

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--ls-display` | `-0.015em` | `--fs-display`(17px) 결과 제목 |
| `--ls-title` | `-0.01em` | `--fs-title`(15px) — 기존 `ui-title` 값 유지 |
| `--ls-body` | `0` | 본문 |
| `--ls-caption` | `0.01em` | `--fs-caption`(11px) 메타 |
| `--dur-press` | `100ms` | pointer-down 눌림 피드백 |
| `--dur-ui` | `140ms` | 색·테두리 상태 전이(기존값) |
| `--dur-sheet` | `240ms` | 시트·패널 개폐(기존값) |
| `--dur-materialize` | `220ms` | 유리 등장(blur+scale+opacity 동시) |
| `--ease-out-expo` | `cubic-bezier(0.22, 1, 0.36, 1)` | 감속 스프링 근사(기존 시트 곡선) |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 되돌아오는 전이 |
| `--touch-min` | `44px` | `map-float-btn` `sheet-snap-btn` 모바일 `probe-radius` 버튼 |

### Pretendard ← SF Pro 감각 매핑

| SF Pro | Pretendard weight | 쓰는 자리 |
|---|---|---|
| Regular 400 | 400 | (거의 안 씀 — 유리 위는 500부터) |
| Medium 500 | 500 | 입력창 본문, 유리 위 본문 |
| Semibold 600 | 600 | 칩·버튼 라벨, 유리 위 강조 |
| Bold 700 | 700 | 행 이름, 섹션 제목, 결론문 |
| Heavy 800 | 800 | 결과 대제목, 순위 값, `section-label` |

주의 두 가지.
- 한글은 라틴보다 어깨가 넓어 SF의 음수 자간을 그대로 옮기면 달라붙습니다. 위
  `--ls-*`는 SF 추적표 대비 약 30% 약하게 잡은 값입니다(17px: SF −0.022em → 여기서는 −0.015em).
- 자간은 크기별로 다릅니다. 단일 `letter-spacing`을 전역에 걸지 마십시오 — 큰 글자는
  조이고(−), 작은 글자는 벌립니다(+).
- 숫자 열(`rank-value`, `probe-region-distance`, 메타의 개수)은 `font-variant-numeric:
  tabular-nums` 유지. Pretendard 고정폭 숫자가 정렬을 지켜 줍니다.

## 3. 기존 토큰 — 값 조정 제안 (이름 변경 없음)

| 토큰 | 지금 | 제안 | 이유 |
|---|---|---|---|
| `--accent` (다크) | `#22d3ee` | 유지 | 색은 자료에만 쓴다는 규칙과 맞음 |
| `--accent` (고대비) | `#fff` | 유지 + `--accent-soft: #fff`, `--accent-line: #fff` 추가 | 지금 고대비 블록에는 `--accent`만 있고 soft/line이 없어, 이 둘을 쓰는 규칙이 고대비에서 라이트 값(파랑)으로 떨어집니다 — 부록 C-6과 같은 함정 |
| `--shadow-panel` | 테마별 | 유지 | 패널은 불투명이라 유리 작업과 무관 |
| `--surface-map` (다크) | `#0a1120` | 유지 | 타일 도착 전 바닥색으로 적절 |
| `--score-track` (고대비) | `#333` | 유지하되 시안 05처럼 `score-bar`에 1px 백색 외곽 추가 | 채움/트랙 대비만으로는 경계가 안 보임 |

## 4. 지키는 규칙 (부록 C 재발 방지)

1. 새 토큰을 어두운 블록에만 정의하지 마십시오. `:root`(라이트)에 반드시 기본값 —
   라이트에서 조용히 무시되어 화면이 무너지는 함정(부록 C-6)이 여기서 납니다.
2. `--glass-*`를 패널·표에 쓰지 마십시오. 유리는 지도 위 부유층 전용입니다(MATERIALS.md).
3. Tailwind v4: 가운데 정렬을 덮을 때는 `transform`이 아니라 `translate`입니다
   (`translate: none`). 시안 03·04의 `.map-float-dock`이 그 규칙을 그대로 따릅니다.
4. `color-scheme`를 테마마다 맞춥니다 — 스크롤바·폼 컨트롤 크롬이 그것을 봅니다.
