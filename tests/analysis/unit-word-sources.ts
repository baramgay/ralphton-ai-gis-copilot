/**
 * 공간 단위 낱말을 지키는 파일 목록.
 *
 * 사용자에게 문구가 나가는 자리만 담는다. 질의를 알아듣기 위한 낱말 목록
 * (`query-catalog.ts`·`resolve-layer-query.ts`·`suggest-metric.ts`)은 뺀다 —
 * 거기서 「읍면동」을 지우면 그렇게 친 사람의 질문을 못 알아듣는다.
 */
export const UNIT_WORD_SOURCES = [
  "src/app/layout.tsx",
  "src/components/copilot/admin-level-toggle.tsx",
  "src/components/copilot/app-topbar.tsx",
  "src/components/copilot/copilot-app.tsx",
  "src/lib/analysis/glossary.ts",
  "src/lib/analysis/usage-guide.ts",
  "src/lib/data/live-sync.ts",
  "src/lib/data/population-live.ts",
  "src/lib/data/vitals-live.ts",
  "src/lib/layers/catalog.ts",
  "src/lib/layers/stats-view.ts",
  "src/lib/layers/to-analysis-view.ts",
  "src/lib/rag/catalog-chunks.ts",
];
