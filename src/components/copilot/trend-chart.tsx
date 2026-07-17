"use client";

type TrendChartProps = {
  values: number[];
  labels: string[];
  tone?: "blue" | "red" | "green";
};

const tones = {
  blue: { stroke: "#2563eb", fill: "#dbeafe" },
  red: { stroke: "#dc2626", fill: "#fee2e2" },
  green: { stroke: "#059669", fill: "#d1fae5" },
};

export function TrendChart({ values, labels, tone = "blue" }: TrendChartProps) {
  const width = 320;
  const height = 94;
  const padding = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = padding + ((max - value) / span) * (height - padding * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;
  const palette = tones[tone];

  return (
    <figure className="m-0" aria-label={`${labels[0]}부터 ${labels.at(-1)}까지의 추세`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible" role="img">
        <line x1="8" x2="312" y1="86" y2="86" stroke="#e2e8f0" />
        <polygon points={area} fill={palette.fill} opacity=".65" />
        <polyline
          points={line}
          fill="none"
          stroke={palette.stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map(([x, y], index) => (
          <circle key={labels[index]} cx={x} cy={y} r={index === points.length - 1 ? 3.5 : 1.8} fill={palette.stroke}>
            <title>{`${labels[index]} · ${values[index].toLocaleString("ko-KR")}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex justify-between text-[10px] font-medium text-slate-400">
        <span>{labels[0]}</span><span>{labels.at(-1)}</span>
      </figcaption>
    </figure>
  );
}

