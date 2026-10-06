import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { DATASET_DESCRIPTIONS, DATASET_TOPICS, type DatasetTopicId } from "./dataset-topics";

import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";
import { HUB_PLATFORM } from "@/lib/layers/channel";

export type LayerOption = { id: string; label: string; provider: string };

/** 검색에 쓰는 최소 정보. 정본은 catalog.ts 의 label · metrics[].label · triggers. */
export type LayerSearchSource = {
  id: string;
  label: string;
  metrics: readonly { label: string; triggers: readonly string[] }[];
};

type LayerSwitcherProps = {
  layers: LayerOption[];
  activeId: string;
  onChange: (id: string) => void;
  selectionLabel?: string;
  selectionDetail?: string;
  /** 선택한 자료의 지표·단위·적용 조건. 탐색 창을 열어도 유지한다. */
  activeSlot?: ReactNode;
  /** 검색 색인. 생략하면 카탈로그 정본을 쓴다. */
  searchSource?: readonly LayerSearchSource[];
};

/**
 * 레이어 이름뿐 아니라 지표 이름·트리거에도 걸린다.
 * 「유출」을 치면 이동인구가 남는다 — 레이어 이름에는 그 글자가 없다.
 */
export function filterLayersByQuery<T extends { id: string; label: string }>(
  layers: readonly T[],
  query: string,
  source: readonly LayerSearchSource[],
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...layers];
  const byId = new Map(source.map((entry) => [entry.id, entry]));
  return layers.filter((layer) => {
    const entry = byId.get(layer.id);
    if (layer.label.toLowerCase().includes(needle)) return true;
    if (!entry) return false;
    if (entry.label.toLowerCase().includes(needle)) return true;
    return entry.metrics.some(
      (metric) =>
        metric.label.toLowerCase().includes(needle) ||
        metric.triggers.some((trigger) => trigger.toLowerCase().includes(needle)),
    );
  });
}

/**
 * 큰 갈래는 **민간과 공공** 둘이다.
 *
 * 전에는 제공기관을 그대로 최상위에 놓아 「공공」 아래에 인구와 의료 둘만 서 있었다.
 * 그러면 첫 화면이 「공공 = 인구·의료」로 읽히고, 이 도구가 의료 도구처럼 보인다.
 * 실제 정체는 **민간 특화 데이터(SKT·NH·KCB)를 중심으로 쓰고 공공을 함께 쓰는** 것이다.
 * 의료기관은 공공 자료 중 하나이지 큰 분류가 아니다.
 *
 * 제공기관은 사라지지 않고 **한 단 아래**로 내려간다 — 출처는 여전히 한눈에 보여야 한다.
 */
const PRIVATE_PROVIDERS = ["SKT", "NH", "KCB"];

/** 제공기관 표시 순서. 목록에 없는 기관은 뒤에 등장 순서대로 붙는다. */
const PROVIDER_ORDER = ["SKT", "NH", "KCB", "공공", "KOSIS", "경상남도"];

export type ProviderGroup = { provider: string; layers: LayerOption[] };
export type SourceGroup = { source: "민간" | "공공"; note: string; providers: ProviderGroup[] };

export function groupByProvider(layers: LayerOption[]): ProviderGroup[] {
  const groups = new Map<string, LayerOption[]>();
  for (const layer of layers) {
    const bucket = groups.get(layer.provider) ?? [];
    bucket.push(layer);
    groups.set(layer.provider, bucket);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const left = PROVIDER_ORDER.indexOf(a[0]);
      const right = PROVIDER_ORDER.indexOf(b[0]);
      return (left < 0 ? PROVIDER_ORDER.length : left) - (right < 0 ? PROVIDER_ORDER.length : right);
    })
    .map(([provider, items]) => ({ provider, layers: items }));
}

/** 민간이 먼저다. 이 도구의 중심 자료이고, 공공은 함께 쓰는 쪽이다. */
export function groupBySource(layers: LayerOption[]): SourceGroup[] {
  const byProvider = groupByProvider(layers);
  const pick = (isPrivate: boolean) =>
    byProvider.filter((group) => PRIVATE_PROVIDERS.includes(group.provider) === isPrivate);

  return (
    [
      {
        source: "민간" as const,
        note: `이동통신·카드·신용 기반. ${HUB_PLATFORM}이 제공하는 이 도구의 중심 자료입니다.`,
        providers: pick(true),
      },
      {
        source: "공공" as const,
        note: "주민등록 인구와 의료기관 등 행정 기준 자료입니다.",
        providers: pick(false),
      },
    ] satisfies SourceGroup[]
  ).filter((group) => group.providers.length > 0);
}

export function LayerSwitcher({
  layers,
  activeId,
  onChange,
  activeSlot,
  selectionLabel,
  selectionDetail,
  searchSource = CROSS_CANDIDATE_LAYERS,
}: LayerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<DatasetTopicId | "all" | "overview">("overview");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const selected = layers.find((layer) => layer.id === activeId);
  const selectedLabel = selectionLabel ?? selected?.label ?? "자료를 선택하세요";
  const topics = DATASET_TOPICS.filter((topic) => layers.some((layer) => (topic.layerIds as readonly string[]).includes(layer.id)));
  const visible = useMemo(() => {
    const searched = filterLayersByQuery(layers, query, searchSource);
    if (query.trim() || topicId === "all") return searched;
    const topic = DATASET_TOPICS.find((item) => item.id === topicId);
    return topic ? searched.filter((layer) => (topic.layerIds as readonly string[]).includes(layer.id)) : [];
  }, [layers, query, searchSource, topicId]);
  const overview = topicId === "overview" && !query.trim();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    searchRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      trigger?.focus();
    };
  }, [open]);

  const closeCatalog = () => {
    dialogRef.current?.close();
    setOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCatalog();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'))
      .filter((node) => !node.matches(":disabled") && !node.closest("[hidden]"));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="dataset-picker">
      <section className="dataset-selected" data-testid="dataset-selected" aria-label="선택한 자료">
        <div className="dataset-selected-heading">
          <div>
            <p className="dataset-selected-name">{selectedLabel}</p>
            {selected ? <span className="dataset-selected-provider">{selected.provider}</span> : null}
          </div>
          <button ref={triggerRef} type="button" className="dataset-change-button" aria-haspopup="dialog"
            onClick={() => { setQuery(""); setTopicId("overview"); setOpen(true); }}>자료 변경</button>
        </div>
        <p className="dataset-selected-description">{selectionDetail ?? (selected ? DATASET_DESCRIPTIONS[selected.id] : "목적에 맞는 자료를 골라 분석하세요.")}</p>
      </section>
      {activeSlot ? <div className="dataset-controls">{activeSlot}</div> : null}
      {open ? createPortal(
        <dialog ref={dialogRef} className="dataset-dialog" aria-labelledby={titleId}
          onClose={() => setOpen(false)} onCancel={(event) => { event.preventDefault(); closeCatalog(); }} onKeyDown={handleKeyDown}>
          <header className="dataset-dialog-header">
            <div><h2 id={titleId} className="dataset-dialog-title">자료 선택</h2><p>궁금한 목적을 고르거나 자료·지표를 검색하세요.</p></div>
            <button type="button" className="dataset-dialog-close" aria-label="자료 선택 닫기" onClick={closeCatalog}>닫기</button>
          </header>
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="예: 유출인구, 카드매출, 빈집" aria-label="자료 검색" className="dataset-search" data-testid="layer-search" />
          <p className="dataset-catalog-count" role="status" aria-live="polite">
            {overview ? `${layers.length}개 자료 · 목적을 선택하세요` : `${query.trim() ? "전체 자료 검색" : topics.find((topic) => topic.id === topicId)?.label ?? "전체 자료"} · ${visible.length}개`}
          </p>
          {overview ? (
            <div className="dataset-topic-grid">
              {topics.map((topic) => <button key={topic.id} type="button" className="dataset-topic-card" onClick={() => setTopicId(topic.id)}>
                <span className="dataset-topic-title">{topic.label}</span><span className="dataset-topic-description">{topic.description}</span>
                <span className="dataset-topic-count">{layers.filter((layer) => (topic.layerIds as readonly string[]).includes(layer.id)).length}개 자료</span>
              </button>)}
              <button type="button" className="dataset-all-button" onClick={() => setTopicId("all")}>전체 자료 보기</button>
            </div>
          ) : (
            <>
              <nav className="dataset-topic-nav" aria-label="자료 목적">
                <button type="button" aria-pressed={topicId === "all" || Boolean(query.trim())} onClick={() => { setQuery(""); setTopicId("all"); }}>전체</button>
                {topics.map((topic) => <button key={topic.id} type="button" aria-pressed={!query.trim() && topicId === topic.id}
                  onClick={() => { setQuery(""); setTopicId(topic.id); }}>{topic.label}</button>)}
              </nav>
              {visible.length === 0 ? <p className="dataset-empty" data-testid="layer-search-empty">「{query.trim()}」에 해당하는 자료가 없습니다</p> : (
                <div className="dataset-catalog-grid" role="group" aria-label="자료 선택 목록">
                  {visible.map((layer) => <button key={layer.id} type="button" className="dataset-card" data-layer-id={layer.id}
                    aria-pressed={layer.id === activeId} onClick={() => { onChange(layer.id); closeCatalog(); }}>
                    <span className="dataset-card-label">{layer.label}</span><span className="dataset-card-provider">{layer.provider}</span>
                    <span className="dataset-card-description">{DATASET_DESCRIPTIONS[layer.id]}</span>
                  </button>)}
                </div>
              )}
            </>
          )}
        </dialog>, document.body,
      ) : null}
    </div>
  );
}
