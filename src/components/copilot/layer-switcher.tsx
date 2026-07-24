export type LayerOption = { id: string; label: string; provider: string };

type LayerSwitcherProps = {
  layers: LayerOption[];
  activeId: string;
  onChange: (id: string) => void;
};

export function LayerSwitcher({ layers, activeId, onChange }: LayerSwitcherProps) {
  return (
    <div role="group" aria-label="레이어 선택" className="layer-switcher">
      {layers.map((layer) => (
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
  );
}
