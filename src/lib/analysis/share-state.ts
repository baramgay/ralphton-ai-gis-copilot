import type { AnalysisIntent } from "@/lib/analysis/intent-schema";
import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";

export type ShareState = {
  tool?: string;
  region?: string;
  radius?: 1 | 2 | 3;
  q?: string;
  markers?: "priority" | "selected";
  tab?: "control" | "help" | "data";
};

const RADIUS_SET = new Set([1, 2, 3]);

export function parseShareState(search: string | URLSearchParams): ShareState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const radiusRaw = Number(params.get("radius") ?? "");
  const markers = params.get("markers");
  const tab = params.get("tab");
  return {
    tool: params.get("tool") ?? undefined,
    region: params.get("region") ?? undefined,
    radius: RADIUS_SET.has(radiusRaw) ? (radiusRaw as 1 | 2 | 3) : undefined,
    q: params.get("q") ?? undefined,
    markers: markers === "selected" || markers === "priority" ? markers : undefined,
    tab: tab === "control" || tab === "help" || tab === "data" ? tab : undefined,
  };
}

export function buildShareSearch(state: ShareState): string {
  const params = new URLSearchParams();
  if (state.tool) params.set("tool", state.tool);
  if (state.region) params.set("region", state.region);
  if (state.radius) params.set("radius", String(state.radius));
  if (state.q) params.set("q", state.q.slice(0, 200));
  if (state.markers && state.markers !== "priority") params.set("markers", state.markers);
  if (state.tab && state.tab !== "control") params.set("tab", state.tab);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function shareStateFromIntent(
  intent: AnalysisIntent,
  extras?: {
    region?: string | null;
    q?: string;
    markers?: "priority" | "selected";
  },
): ShareState {
  return {
    tool: intent.tool,
    region: extras?.region ?? intent.filters.regions?.[0] ?? intent.filters.compare?.[0],
    radius: intent.filters.radiusKm as 1 | 2 | 3 | undefined,
    q: extras?.q,
    markers: extras?.markers,
  };
}

/** Detect follow-up style queries that should keep prior intent/region. */
export function isFollowUpQuery(query: string): boolean {
  return /이 결과|그중|그 중|여기서|해당 동|이 동|여기만|방금|이어서|추가로|반경\s*[123]\s*km|그 지역/.test(
    query,
  );
}

export function applyFollowUpMerge(
  query: string,
  intent: AnalysisIntent,
  previous: AnalysisIntent | null,
  selectedRegionCode: string | null,
  selectedRegionName: string | null,
): AnalysisIntent {
  if (!isFollowUpQuery(query)) return intent;

  const filters = { ...intent.filters };

  if ((!filters.regions || filters.regions.length === 0) && selectedRegionCode) {
    filters.regions = [selectedRegionName ?? selectedRegionCode];
  }

  if (
    previous &&
    intent.tool === previous.tool &&
    (!filters.facilityTypes || filters.facilityTypes.length === 0) &&
    previous.filters.facilityTypes?.length
  ) {
    filters.facilityTypes = previous.filters.facilityTypes;
  }

  if (filters.radiusKm == null && previous?.filters.radiusKm != null) {
    filters.radiusKm = previous.filters.radiusKm;
  }

  // "반경 Nkm" follow-up
  const radiusMatch = /반경\s*([123])\s*km/.exec(query);
  if (radiusMatch) {
    filters.radiusKm = Number(radiusMatch[1]) as 1 | 2 | 3;
  }

  const merged = { tool: intent.tool, filters };
  const parsed = AnalysisIntentSchema.safeParse(merged);
  return parsed.success ? parsed.data : intent;
}
