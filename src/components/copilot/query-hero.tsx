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

/** 질문 입력과 진행·복구 안내. 지도 밖 작업 영역에서 항상 접근할 수 있다. */
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
          placeholder="경남 지역을 질문하세요. 예: 김해 생활인구"
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
          {isParsing ? <span className="query-hero-spinner" aria-hidden="true" /> : null}
          <span>{isParsing ? "분석 중" : "분석하기"}</span>
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
          {noticeTone === "success" ? <><span>분석 완료 · 결과와 지도를 확인하세요</span><span className="sr-only">{notice}</span></> : notice}
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

      {/*
       * 최근 질문은 **내가 쓴 말**이고 예시는 **우리가 준 말**이다. 둘이 같은 모양이면
       * 자기 오타를 제품 문구로 읽는다 — 실제로 「의려취약지역」이라는 자기 입력을 보고
       * 오타를 고치라는 말을 들었다.
       *
       * 유리 위에서는 색으로 가를 수 없으므로(색 글자는 최악의 타일에서 깨진다) 앞에
       * 「최근」이라는 말을 붙여 가른다.
       */}
      {recentQueries.length > 0 ? (
        <div
          className="query-hero-chips is-optional"
          data-testid="recent-queries"
          aria-label="최근 질문"
        >
          <span className="query-hero-chip-note">최근</span>
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
