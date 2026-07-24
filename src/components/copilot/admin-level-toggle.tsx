import type { AdminLevel } from "@/lib/layers/types";

const LABELS: Record<AdminLevel, string> = { dong: "읍면동", sgg: "시군구" };

export function AdminLevelToggle({
  value,
  onChange,
}: {
  value: AdminLevel;
  onChange: (level: AdminLevel) => void;
}) {
  return (
    <div role="group" aria-label="분석 단위" className="admin-level-toggle">
      {(["sgg", "dong"] as AdminLevel[]).map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={value === level}
          onClick={() => onChange(level)}
        >
          {LABELS[level]}
        </button>
      ))}
    </div>
  );
}
