import type { LayerDescriptor } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

/**
 * 답하지 못한 질의에 가까운 지표를 제안한다.
 *
 * "카드매츨 높은 곳"처럼 한 글자만 어긋나도 아무것도 못 찾는다. 그렇다고 오타를 자동으로
 * 고쳐 답하면 위험하다 — "소비"와 "소득"은 한 글자 차이지만 전혀 다른 지표다. 잘못 고른
 * 답을 자신 있게 내놓느니, 무엇을 찾는지 되묻는 편이 낫다.
 *
 * 그래서 **자동 교정은 하지 않고 제안만** 한다. 고르는 것은 사람이 한다.
 */

/** 한글 음절을 초성·중성·종성으로 나눈다. 아니면 글자 그대로. */
function decompose(char: string): string {
  const code = char.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return char;
  const index = code - 0xac00;
  const initial = Math.floor(index / 588);
  const medial = Math.floor((index % 588) / 28);
  const final = index % 28;
  return `${String.fromCharCode(0x1100 + initial)}${String.fromCharCode(0x1161 + medial)}${final ? String.fromCharCode(0x11a7 + final) : ""}`;
}

/** 자모 단위로 편집거리를 잰다. 한 글자 오타가 자모 1~2개 차이로 잡힌다. */
export function jamoDistance(left: string, right: string): number {
  const a = [...left].map(decompose).join("");
  const b = [...right].map(decompose).join("");
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

export type MetricSuggestion = {
  layerId: string;
  layerLabel: string;
  metricKey: string;
  metricLabel: string;
  /** 이 표현으로 물으면 된다. */
  example: string;
  distance: number;
};

/**
 * 질의에서 지표처럼 보이는 토막을 트리거와 견줘 가까운 것을 고른다.
 *
 * 허용 거리는 트리거 길이에 비례한다. 고정값을 쓰면 "인구"처럼 짧은 트리거가 아무 말에나
 * 걸린다("오늘 날씨 어때"에 지표 셋을 제안하고 있었다). 두 글자짜리 트리거는 아예 제안에
 * 쓰지 않는다 — 그 정도로 짧으면 오타인지 다른 말인지 가릴 수 없다.
 */
/** 질의의 뼈대를 이루는 말. 지표 이름과 우연히 겹쳐도 제안 근거가 되지 못한다. */
const SHAPE_WORDS = new Set([
  "높은", "낮은", "많은", "적은", "상위", "하위", "지역", "행정동", "시군구", "읍면동",
  "어디", "알려", "찾아", "보여", "순위", "비중", "비율", "기준", "그리고", "에서",
]);

export function suggestMetrics(
  query: string,
  layers: readonly LayerLike[],
  limit = 3,
): MetricSuggestion[] {
  const compact = query.replace(/\s+/g, "");
  if (compact.length < 2) return [];

  const found: MetricSuggestion[] = [];
  for (const layer of layers) {
    for (const metric of layer.metrics) {
      let best = Number.POSITIVE_INFINITY;
      let bestTrigger = metric.triggers[0] ?? metric.label;
      let bestAllowed = 0;

      /*
       * "상권 좋은 곳"처럼 여러 지표에 걸치는 말은 오타가 아니라 범위가 넓은 것이다.
       * 편집거리로는 안 잡히므로, 질의의 두 글자 이상 토막이 트리거 안에 들어 있으면
       * 후보로 올린다("상권" → 야간 상권 · 카페 상권 · 유흥 상권).
       */
      // 띄어쓰기를 없앤 문자열에서 뽑으면 문장 전체가 한 단어가 된다. 원문에서 뽑는다.
      const words = (query.match(/[가-힣]{2,}/g) ?? []).filter((word) => !SHAPE_WORDS.has(word));
      for (const trigger of metric.triggers) {
        const key = trigger.replace(/\s+/g, "");
        if (key.length < 3) continue;
        if (words.some((word) => word.length >= 2 && key.includes(word))) {
          best = 0;
          bestTrigger = trigger;
          bestAllowed = 0;
          break;
        }
      }

      for (const trigger of metric.triggers) {
        const key = trigger.replace(/\s+/g, "");
        // 두 글자 이하는 오타인지 다른 말인지 가릴 수 없어 제안에 쓰지 않는다.
        if (key.length < 3) continue;
        const jamoLength = [...key].reduce((sum, char) => sum + decompose(char).length, 0);
        const allowed = Math.max(1, Math.round(jamoLength * 0.3));
        // 질의에서 트리거와 같은 길이의 토막들을 훑어 가장 가까운 것을 본다.
        for (let at = 0; at + key.length <= compact.length; at += 1) {
          const distance = jamoDistance(compact.slice(at, at + key.length), key);
          if (distance < best) {
            best = distance;
            bestTrigger = trigger;
            bestAllowed = allowed;
          }
        }
      }
      if (best <= bestAllowed) {
        found.push({
          layerId: layer.id,
          layerLabel: layer.label,
          metricKey: metric.key,
          metricLabel: metric.label,
          example: `${bestTrigger} 높은 곳`,
          distance: best,
        });
      }
    }
  }

  const seen = new Set<string>();
  return found
    .sort((left, right) => left.distance - right.distance || left.metricLabel.localeCompare(right.metricLabel, "ko"))
    .filter((item) => (seen.has(item.metricLabel) ? false : (seen.add(item.metricLabel), true)))
    .slice(0, limit);
}
