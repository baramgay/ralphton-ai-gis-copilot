import { useMemo, useState, type ReactNode } from "react";

import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";

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
  /**
   * 고른 레이어의 버튼 줄 **바로 아래**에 끼워 넣을 것 — 지표 고르기가 여기로 온다.
   *
   * 전에는 목록 전체가 끝난 뒤에 지표 콤보박스가 하나 있었다. 레이어가 스물둘이라
   * 위쪽 SKT 레이어를 고르면 그 콤보박스는 화면 밖이었고, 「이동인구에는 유입인구밖에
   * 없다」로 읽혔다 — 유출인구도 순유입도 그 상자 안에 있었는데 상자가 안 보였다.
   * 고른 자리에 붙여 두면 무엇을 더 고를 수 있는지가 고르는 순간 보인다.
   */
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
const PROVIDER_ORDER = ["SKT", "NH", "KCB", "공공", "KOSIS"];

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
        note: "이동통신·카드·신용 기반. 이 도구의 중심입니다.",
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

function LayerButton({
  layer,
  activeId,
  onChange,
}: {
  layer: LayerOption;
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={layer.id === activeId}
      className="layer-switcher-item"
      onClick={() => onChange(layer.id)}
    >
      <span className="layer-switcher-label">{layer.label}</span>
      <span className="layer-switcher-provider">{layer.provider}</span>
    </button>
  );
}

export function LayerSwitcher({
  layers,
  activeId,
  onChange,
  activeSlot,
  searchSource = CROSS_CANDIDATE_LAYERS,
}: LayerSwitcherProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => filterLayersByQuery(layers, query, searchSource),
    [layers, query, searchSource],
  );
  /*
   * 고른 레이어(또는 검색 결과가 하나일 때 그 레이어)를 맨 위에 둔다.
   * 22개가 민간→공공 순으로 서 있으면 기본값 의료기관의 지표 자리가 목록 바닥에
   * 깔려 첫 화면에 안 보인다.
   */
  const focus =
    visible.length === 1 ? visible[0] : visible.find((layer) => layer.id === activeId);
  const rest = focus ? visible.filter((layer) => layer.id !== focus.id) : visible;
  const groups = groupBySource(rest);
  const showSlot = Boolean(activeSlot && focus && focus.id === activeId);

  return (
    <div className="layer-picker">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="자료 이름 또는 지표"
        aria-label="레이어 검색"
        className="layer-search"
        data-testid="layer-search"
      />
      {visible.length === 0 ? (
        <p className="layer-search-empty" data-testid="layer-search-empty" role="status">
          「{query.trim()}」에 해당하는 자료가 없습니다
        </p>
      ) : (
        <div role="group" aria-label="레이어 선택" className="space-y-3">
          {focus ? (
            <div>
              <div className="layer-switcher">
                <LayerButton layer={focus} activeId={activeId} onChange={onChange} />
              </div>
              {showSlot ? <div className="mt-2">{activeSlot}</div> : null}
            </div>
          ) : null}
          {groups.length > 0 ? (
            <div className={query.trim() ? undefined : "layer-switcher-scroll"}>
              {groups.map((group) => (
                <div key={group.source}>
                  {query.trim() ? null : (
                    <>
                      <p className="layer-group-kicker">{group.source} 자료</p>
                      <p className="ui-caption mb-1.5">{group.note}</p>
                    </>
                  )}
                  {group.providers.map((byProvider) => (
                    <div key={byProvider.provider} className="mt-1.5">
                      <p className="ui-caption mb-1 font-bold">{byProvider.provider}</p>
                      <div className="layer-switcher">
                        {byProvider.layers.map((layer) => (
                          <LayerButton
                            key={layer.id}
                            layer={layer}
                            activeId={activeId}
                            onChange={onChange}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
