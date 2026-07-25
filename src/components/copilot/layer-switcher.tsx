export type LayerOption = { id: string; label: string; provider: string };

type LayerSwitcherProps = {
  layers: LayerOption[];
  activeId: string;
  onChange: (id: string) => void;
};

/** 제공기관 표시 순서. 목록에 없는 기관은 뒤에 등장 순서대로 붙는다. */
const PROVIDER_ORDER = ["공공", "SKT", "NH", "KCB"];

export function groupByProvider(layers: LayerOption[]): Array<{ provider: string; layers: LayerOption[] }> {
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

/**
 * 레이어가 11개로 늘면서 한 줄 나열로는 어느 것이 공공이고 어느 것이 민간인지, 같은
 * 기관 안에서 무엇이 묶이는지 읽히지 않았다. 제공기관별로 묶어 한 눈에 출처가 보이게 한다.
 */
export function LayerSwitcher({ layers, activeId, onChange }: LayerSwitcherProps) {
  const groups = groupByProvider(layers);

  return (
    <div role="group" aria-label="레이어 선택" className="space-y-2">
      {groups.map((group) => (
        <div key={group.provider}>
          <p className="ui-caption mb-1 font-bold text-slate-500">
            {group.provider}
            {group.provider === "공공" ? "" : " 민간데이터"}
          </p>
          <div className="layer-switcher">
            {group.layers.map((layer) => (
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
  );
}
