export type UsageDailyRow = {
  day: string; visits: number; visitors: number; analyses: number; exports: number; shares: number;
  datasets: Record<string, number>;
};
export function kstDay(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function calendarDate(day: string): Date {
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error("Invalid usage date");
  }
  return date;
}

export function usageStartDay(days: 30 | 90 | 365, now = new Date()): string {
  if (![30, 90, 365].includes(days)) throw new Error("Invalid usage interval");
  const date = calendarDate(kstDay(now));
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

const emptyRow = (day: string): UsageDailyRow => ({ day, visits: 0, visitors: 0, analyses: 0, exports: 0, shares: 0, datasets: {} });
const COUNTERS = ["visits", "visitors", "analyses", "exports", "shares"] as const;

function addRow(target: UsageDailyRow, source: UsageDailyRow): void {
  for (const key of COUNTERS) {
    if (!Number.isSafeInteger(source[key]) || source[key] < 0) throw new Error("Invalid usage counter");
    target[key] += source[key];
    if (!Number.isSafeInteger(target[key])) throw new Error("Usage counter overflow");
  }
  for (const [key, value] of Object.entries(source.datasets)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid dataset counter");
    const total = (target.datasets[key] ?? 0) + value;
    if (!Number.isSafeInteger(total)) throw new Error("Dataset counter overflow");
    Object.defineProperty(target.datasets, key, { value: total, writable: true, configurable: true, enumerable: true });
  }
}

function periodDay(day: string, period: "day" | "week" | "month"): string {
  if (period === "month") return `${day.slice(0, 7)}-01`;
  if (period === "day") return day;
  const date = calendarDate(day);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** Week/month visitors are summed daily unique browsers (visitor-days), never period-unique people. */
export function aggregateUsage(rows: UsageDailyRow[], options: { period: "day" | "week" | "month"; days: 30 | 90 | 365; now?: Date }): {
  period: "day" | "week" | "month"; startDay: string; endDay: string; totals: UsageDailyRow; series: UsageDailyRow[];
} {
  const { period, days, now = new Date() } = options;
  if (!["day", "week", "month"].includes(period)) throw new Error("Invalid usage period");
  const startDay = usageStartDay(days, now);
  const endDay = kstDay(now);
  const groups = new Map<string, UsageDailyRow>();
  const cursor = calendarDate(startDay);
  for (let index = 0; index < days; index++) {
    const key = periodDay(cursor.toISOString().slice(0, 10), period);
    if (!groups.has(key)) groups.set(key, emptyRow(key));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const totals = emptyRow(endDay);
  for (const row of rows) {
    calendarDate(row.day);
    if (row.day < startDay || row.day > endDay) continue;
    addRow(groups.get(periodDay(row.day, period))!, row);
    addRow(totals, row);
  }
  return { period, startDay, endDay, totals, series: [...groups.values()] };
}
