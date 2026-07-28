"use client";

import type { FormEvent, RefObject } from "react";

export type QueryHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isParsing: boolean;
  parseStage: "idle" | "intent" | "analyze" | "done";
  notice: string | null;
  /** 답은 냈지만 요청의 일부를 반영하지 못했을 때 그 사실을 밝히는 줄. */
  caveat?: string | null;
  noticeTone: "neutral" | "error" | "success";
  /** 오타·모호한 말에 되묻는 후보. 자동 교정은 하지 않는다. */
  suggestions: readonly string[];
  onPickSuggestion: (value: string) => void;
  examples: readonly string[];
  recentQueries: readonly string[];
  onClearRecent: () => void;
};

/**
 * 자연어 질의를 지도 위 히어로로 올린다.
 *
 * 이 도구의 주기능은 민간데이터를 자연어로 분석하는 것인데, 질의창이 왼쪽 패널의 레이어
 * 버튼 14개 **아래**에 묻혀 있었다. 모바일에서는 더 나빠서, 결과 시트가 첫 화면부터 열려
 * 질의창을 아예 덮었다 — Playwright가 `질의 실행` 버튼을 20회 재시도 끝에 포기했다
 * (`result-panel subtree intercepts pointer events`). 주기능이 도달 불가였다.
 *
 * 그래서 질의창은 어느 패널에도 속하지 않는다. 지도 위 최상단에 떠 있어 좌우 패널·바텀
 * 시트가 어떤 상태든 늘 닿는다. 안내·되묻기도 함께 올린다 — 왼쪽 패널이 접혀 있을 때
 * "혹시 카드매출인가요?"를 못 보면 되묻는 의미가 없다.
 */
export function QueryHero({
  query,
  onQueryChange,
  onSubmit,
  inputRef,
  isParsing,
  parseStage,
  notice,
  noticeTone,
  caveat,
  suggestions,
  onPickSuggestion,
  examples,
  recentQueries,
  onClearRecent,
}: QueryHeroProps) {
  const busy = parseStage === "intent" || parseStage === "analyze";

  return (
    <div className="query-hero" data-testid="query-hero">
      <form className="query-hero-form" onSubmit={onSubmit}>
        <label htmlFor="analysis-query" className="sr-only">
          분석 질의
        </label>
        <input
          id="analysis-query"
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="무엇이 궁금하세요? 예: 생활인구 많은 동네"
          maxLength={1000}
          autoComplete="off"
          className="query-hero-input"
        />
        <button
          type="submit"
          aria-label="질의 실행"
          disabled={isParsing || !query.trim()}
          className="query-hero-submit"
        >
          {isParsing ? "…" : "↑"}
        </button>
      </form>

      {busy ? (
        <p className="query-hero-status" role="status" data-testid="parse-stage">
          <span className="query-hero-pulse" />
          {parseStage === "intent" ? "질문을 이해하는 중…" : "분석을 실행하는 중…"}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          aria-live={noticeTone === "error" ? "assertive" : "polite"}
          data-testid="query-notice"
          className={`query-hero-notice is-${noticeTone}`}
        >
          {notice}
        </p>
      ) : null}

      {caveat ? (
        <p role="status" aria-live="polite" data-testid="query-caveat" className="query-hero-notice is-warn">
          {caveat}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="query-hero-chips" aria-label="가까운 지표 제안">
          {suggestions.slice(0, 6).map((item) => (
            <button
              key={item}
              type="button"
              className="query-hero-chip is-suggestion"
              onClick={() => onPickSuggestion(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {/*
       * 예시는 질문거리가 없을 때만 보여 준다. 이미 타이핑 중인 사람에게는 방해이고,
       * 답을 받아 본 사람에게는 최근 질문이 더 쓸모 있다.
       */}
      {query.trim().length === 0 ? (
        <div className="query-hero-chips is-optional" aria-label="추천 질문">
          {examples.slice(0, 4).map((item) => (
            <button
              key={item}
              type="button"
              className="query-hero-chip"
              onClick={() => onPickSuggestion(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {recentQueries.length > 0 ? (
        <div
          className="query-hero-chips is-optional"
          data-testid="recent-queries"
          aria-label="최근 질문"
        >
          {recentQueries.slice(0, 3).map((item) => (
            <button
              key={item}
              type="button"
              className="query-hero-chip is-recent"
              title={item}
              onClick={() => onPickSuggestion(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className="query-hero-chip is-clear"
            data-testid="clear-recent-queries"
            onClick={onClearRecent}
          >
            지우기
          </button>
        </div>
      ) : null}
    </div>
  );
}
