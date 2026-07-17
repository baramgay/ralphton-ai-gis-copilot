export type TongBanRow = {
  adm_cd2: string;
  month: string;
  tong: string;
  ban: string;
  population: number;
  households: number;
  malePopulation?: number;
  femalePopulation?: number;
  births?: number;
  deaths?: number;
  onePersonHouseholds?: number | null;
  youthPopulation?: number;
  workingAgePopulation?: number;
  elderlyPopulation?: number;
};

export type AggregatedRow = {
  population: number;
  households: number;
  malePopulation: number;
  femalePopulation: number;
  births: number;
  deaths: number;
  onePersonHouseholds: number | null;
  youthPopulation: number;
  workingAgePopulation: number;
  elderlyPopulation: number;
};

function makeRowKey(row: TongBanRow): string {
  return `${row.adm_cd2}|${row.month}|${row.tong}|${row.ban}`;
}

function sumField(rows: Iterable<TongBanRow>, field: keyof TongBanRow): number {
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
}

function sumOnePersonHouseholds(rows: Iterable<TongBanRow>): number | null {
  let total = 0;
  let hasValue = false;
  for (const row of rows) {
    if (row.onePersonHouseholds != null) {
      total += row.onePersonHouseholds;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}

export function aggregateTongBanRows(rows: TongBanRow[]): AggregatedRow {
  const deduped = new Map<string, TongBanRow>();
  for (const row of rows) {
    deduped.set(makeRowKey(row), row);
  }

  const uniqueRows = [...deduped.values()];

  return {
    population: sumField(uniqueRows, "population"),
    households: sumField(uniqueRows, "households"),
    malePopulation: sumField(uniqueRows, "malePopulation"),
    femalePopulation: sumField(uniqueRows, "femalePopulation"),
    births: sumField(uniqueRows, "births"),
    deaths: sumField(uniqueRows, "deaths"),
    onePersonHouseholds: sumOnePersonHouseholds(uniqueRows),
    youthPopulation: sumField(uniqueRows, "youthPopulation"),
    workingAgePopulation: sumField(uniqueRows, "workingAgePopulation"),
    elderlyPopulation: sumField(uniqueRows, "elderlyPopulation"),
  };
}

export function calculateNaturalChange(row: { births: number; deaths: number }): number {
  return row.births - row.deaths;
}
