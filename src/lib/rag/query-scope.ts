import { detectOutOfScopePlace, extractQuerySignals } from "@/lib/analysis/query-signals";

/** Topics for which this app has no observations; a nearby place is not evidence. */
export function ragQueryIssue(query: string): "out-of-scope" | "unsupported-topic" | null {
  if (detectOutOfScopePlace(query)) {
    const signals = extractQuerySignals(query);
    if (signals.districts.length === 0 && signals.dongs.length === 0) return "out-of-scope";
  }
  if (/실거래가|부동산\s*(?:가격|시세)|아파트\s*(?:가격|시세)|비트코인|가상화폐|날씨|기상\s*예보/.test(query)) {
    return "unsupported-topic";
  }
  return null;
}
