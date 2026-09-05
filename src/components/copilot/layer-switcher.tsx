export type LayerOption = { id: string; label: string; provider: string };

type LayerSwitcherProps = {
  layers: LayerOption[];
  activeId: string;
  onChange: (id: string) => void;
};

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
        note: "이동통신·카드·신용 기반. 이 도구의 중심 자료입니다.",
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

export function LayerSwitcher({ layers, activeId, onChange }: LayerSwitcherProps) {
  const groups = groupBySource(layers);

  return (
    <div role="group" aria-label="레이어 선택" className="space-y-3">
      {groups.map((group) => (
        <div key={group.source}>
          <p className="ui-chip font-bold text-slate-700">{group.source} 데이터</p>
          <p className="ui-caption mb-1.5 text-slate-500">{group.note}</p>
          {group.providers.map((byProvider) => (
            <div key={byProvider.provider} className="mt-1.5">
              <p className="ui-caption mb-1 font-bold text-slate-500">{byProvider.provider}</p>
              <div className="layer-switcher">
                {byProvider.layers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    aria-pressed={layer.id === activeId}
                    className="layer-switcher-item"
                    onClick={() => onChange(layer.id)}
                  >
                    <span className="layer-switcher-label">{layer.label}</span>
                    <span className="layer-switcher-provider">{layer.provider}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
