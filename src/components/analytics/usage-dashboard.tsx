"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Period = "day" | "week" | "month";
type Counts = { visits: number; visitors: number; analyses: number; exports: number; shares: number };
export type UsageStats = {
  timezone: string; period: Period; days: number; startDate: string; endDate: string;
  totals: Counts; series: (Counts & { date: string })[];
  datasets: { id: string; label: string; count: number }[]; updatedAt: string;
};

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "일간" }, { value: "week", label: "주간" }, { value: "month", label: "월간" },
];
const METRICS: { key: keyof Counts; label: string; description: string }[] = [
  { key: "visits", label: "방문", description: "수집된 방문 이벤트" },
  { key: "visitors", label: "방문 브라우저 일수", description: "하루 안에서 중복을 제외한 익명 브라우저" },
  { key: "analyses", label: "분석", description: "성공적으로 실행한 분석" },
  { key: "exports", label: "내보내기", description: "내보내기 요청" },
  { key: "shares", label: "공유", description: "공유 요청" },
];
const VISITOR_DEFINITION = "방문 브라우저 일수는 익명 브라우저를 하루에 한 번 셉니다. 주간·월간은 일별 값을 합산하므로 실제 사람 수나 기간 전체의 고유 방문자 수와 다릅니다.";
const number = (value: number) => value.toLocaleString("ko-KR");
const control = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60";

function validCounts(value: unknown): value is Counts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Record<string, unknown>;
  return METRICS.every(({ key }) => typeof counts[key] === "number" && Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0);
}

function validStats(value: unknown): value is UsageStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as UsageStats;
  return stats.timezone === "Asia/Seoul" && PERIODS.some((period) => period.value === stats.period)
    && Number.isInteger(stats.days) && typeof stats.startDate === "string" && typeof stats.endDate === "string"
    && typeof stats.updatedAt === "string" && Number.isFinite(Date.parse(stats.updatedAt))
    && validCounts(stats.totals) && Array.isArray(stats.series)
    && stats.series.every((row) => validCounts(row) && typeof row.date === "string")
    && Array.isArray(stats.datasets) && stats.datasets.every((row) => typeof row.id === "string" && typeof row.label === "string" && Number.isSafeInteger(row.count) && row.count >= 0);
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildUsageCsv(stats: UsageStats): string {
  const rows: (string | number)[][] = [
    ["누리맵 이용 통계"], ["시간대", stats.timezone], ["집계 단위", PERIODS.find((item) => item.value === stats.period)?.label ?? stats.period],
    ["조회 시작일", stats.startDate], ["조회 종료일", stats.endDate], ["갱신 시각", stats.updatedAt],
    ["방문자 정의", VISITOR_DEFINITION], ["집계 기준", "분석은 성공한 실행, 내보내기·공유는 요청 횟수입니다."], [],
    ["기간", ...METRICS.map((metric) => metric.label)],
    ["합계", ...METRICS.map((metric) => stats.totals[metric.key])],
    ...stats.series.map((row) => [row.date, ...METRICS.map((metric) => row[metric.key])]), [],
    ["데이터 ID", "데이터", "분석 횟수", "데이터별 분석 중 비중"],
  ];
  const total = stats.datasets.reduce((sum, row) => sum + row.count, 0);
  for (const row of stats.datasets) rows.push([row.id, row.label, row.count, `${total ? (row.count / total * 100).toFixed(1) : "0.0"}%`]);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function Trend({ rows }: { rows: UsageStats["series"] }) {
  const width = 720;
  const height = 240;
  const margin = 28;
  const maximum = Math.max(1, ...rows.flatMap((row) => [row.visits, row.analyses]));
  const point = (index: number, value: number) => `${margin + index / Math.max(1, rows.length - 1) * (width - margin * 2)},${height - margin - value / maximum * (height - margin * 2)}`;
  return <div>
    <div className="mb-4 flex flex-wrap gap-5 text-sm font-medium text-slate-700">
      <span className="flex items-center gap-2"><span className="w-6 border-t-[3px] border-blue-700 [[data-theme=contrast]_&]:border-white" aria-hidden="true" />방문</span>
      <span className="flex items-center gap-2"><span className="w-6 border-t-[3px] border-dashed border-emerald-700 [[data-theme=contrast]_&]:border-white" aria-hidden="true" />분석</span>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="방문과 분석 추이" className="w-full overflow-visible">
      <title>방문과 분석 추이</title>
      <desc>파란 실선은 방문, 초록 점선은 분석입니다. 정확한 값은 아래 기간별 이용 집계 표에서 확인할 수 있습니다.</desc>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1={margin} x2={width - margin} y1={height - margin - fraction * (height - margin * 2)} y2={height - margin - fraction * (height - margin * 2)} stroke="#cbd5e1" />
        <text x={margin} y={height - margin - fraction * (height - margin * 2) - 7} className="fill-current text-slate-600" fontSize="13">{number(maximum * fraction)}</text>
      </g>)}
      <polyline points={rows.map((row, index) => point(index, row.visits)).join(" ")} fill="none" className="stroke-current text-blue-700 [[data-theme=contrast]_&]:text-white" strokeWidth="3" />
      <polyline points={rows.map((row, index) => point(index, row.analyses)).join(" ")} fill="none" className="stroke-current text-emerald-700 [[data-theme=contrast]_&]:text-white" strokeWidth="3" strokeDasharray="7 4" />
      {rows.length === 1 && <><circle cx={margin} cy={height - margin - rows[0].visits / maximum * (height - margin * 2)} r="4" className="fill-current text-blue-700 [[data-theme=contrast]_&]:text-white" /><circle cx={margin} cy={height - margin - rows[0].analyses / maximum * (height - margin * 2)} r="4" className="fill-current text-emerald-700 [[data-theme=contrast]_&]:text-white" /></>}
    </svg>
    <div className="mt-2 flex justify-between gap-4 text-xs text-slate-600"><span>{rows[0]?.date}</span><span>{rows.at(-1)?.date}</span></div>
  </div>;
}

export function UsageDashboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "login" | "error" | "configuration">("loading");
  const [password, setPassword] = useState("");
  const [accessPending, setAccessPending] = useState(false);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setState("loading");
      setStats(null);
      try {
        const response = await fetch(`/api/usage/stats?period=${period}&days=${days}`, { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setState("login"); return; }
        if (response.status === 503) { setState("configuration"); return; }
        if (!response.ok) throw new Error("Usage request failed");
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!validStats(data)) throw new Error("Invalid usage response");
        setStats(data);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [period, days, revision]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccessPending(true);
    setAccessError("");
    try {
      const response = await fetch("/api/usage/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      setPassword("");
      if (response.status === 503) { setState("configuration"); return; }
      if (!response.ok) { setAccessError(response.status === 401 ? "비밀번호를 확인해 주세요." : "접속하지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
      setRevision((value) => value + 1);
    } catch {
      setPassword("");
      setAccessError("접속하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setAccessPending(false); }
  }

  async function logout() {
    setAccessPending(true);
    setStats(null);
    setPassword("");
    setAccessError("");
    try {
      const response = await fetch("/api/usage/access", { method: "DELETE" });
      setState(response.ok ? "login" : "error");
    } catch { setState("error"); }
    finally { setAccessPending(false); }
  }

  function download() {
    if (!stats) return;
    const url = URL.createObjectURL(new Blob([buildUsageCsv(stats)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nurimap-usage-${stats.startDate}-${stats.endDate}-${stats.period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const datasetTotal = stats?.datasets.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const empty = stats && METRICS.every(({ key }) => stats.totals[key] === 0);

  return <main className="usage-dashboard h-dvh overflow-y-auto bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-5">
        <div><Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue-700">← 누리맵으로 돌아가기</Link>
          <p className="mt-3 text-sm font-semibold text-blue-700">누리맵 운영</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">이용 현황</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">방문부터 분석·공유까지, 실제 수집한 이용 기록을 확인합니다.</p>
        </div>
        {state === "ready" && <button type="button" onClick={() => void logout()} disabled={accessPending} className={control}>로그아웃</button>}
      </header>

      {state === "login" ? <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="access-title">
        <h2 id="access-title" className="text-xl font-bold">운영자 접속</h2><p className="mt-2 text-sm leading-6 text-slate-600">이용 통계는 관리자 비밀번호로 보호됩니다.</p>
        <form onSubmit={(event) => void login(event)} className="mt-6 space-y-4">
          <div><label htmlFor="usage-password" className="mb-2 block text-sm font-semibold">관리자 비밀번호</label><input id="usage-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={accessPending} className="min-h-12 w-full rounded-xl border border-slate-400 bg-white px-4 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700" /></div>
          {accessError && <p role="alert" className="text-sm text-red-700">{accessError}</p>}
          <button type="submit" disabled={accessPending} className={`${control} w-full border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}>{accessPending ? "확인 중…" : "대시보드 열기"}</button>
        </form>
      </section> : <>
        <section aria-label="집계 조건" className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div role="group" aria-label="집계 단위" className="flex gap-1 rounded-xl bg-slate-100 p-1">{PERIODS.map((item) => <button key={item.value} type="button" aria-pressed={period === item.value} onClick={() => setPeriod(item.value)} className={`min-h-11 min-w-16 rounded-lg px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-blue-700 ${period === item.value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"}`}>{item.label}</button>)}</div>
            <label className="flex items-center gap-2 text-sm font-semibold">조회 범위<select value={days} onChange={(event) => setDays(Number(event.target.value))} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700"><option value={30}>최근 30일</option><option value={90}>최근 90일</option><option value={365}>최근 1년</option></select></label>
          </div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setRevision((value) => value + 1)} disabled={state === "loading"} className={control}>새로고침</button><button type="button" onClick={download} disabled={!stats} className={control}>CSV 내려받기</button></div>
        </section>
        {state === "loading" && <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">이용 통계를 불러오는 중…</p>}
        {state === "error" && <p role="alert" className="rounded-2xl border border-red-200 bg-white p-8 text-red-700">통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
        {state === "configuration" && <p role="alert" className="rounded-2xl border border-amber-300 bg-white p-8 text-amber-900">이용 통계 설정을 확인해야 합니다. 저장소와 관리자 접속 설정이 완료되면 실제 집계를 표시합니다.</p>}
        {stats && <>
          <div className="mb-5 flex flex-wrap justify-between gap-2 text-xs leading-5 text-slate-600"><span>{stats.startDate} ~ {stats.endDate} · 한국 표준시(KST)</span><span>갱신 {new Date(stats.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 자동 갱신 없음</span></div>
          <section aria-label="핵심 이용 지표" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">{METRICS.map((metric) => <article key={metric.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="text-sm font-semibold text-slate-600">{metric.label}</h2><p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{number(stats.totals[metric.key])}<span className="ml-1 text-sm font-medium text-slate-600">{metric.key === "visitors" ? "일수" : "회"}</span></p><p className="mt-2 text-xs leading-5 text-slate-600">{metric.description}</p></article>)}</section>
          <p className="mt-4 text-xs leading-6 text-slate-600">{VISITOR_DEFINITION}</p>
          {empty && <p role="status" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">아직 수집된 이용 기록이 없습니다.</p>}
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="trend-title"><h2 id="trend-title" className="text-lg font-bold">이용 추이</h2><p className="mb-6 mt-1 text-sm text-slate-600">{PERIODS.find((item) => item.value === stats.period)?.label} 집계 · 방문과 성공한 분석</p>{stats.series.length ? <Trend rows={stats.series} /> : <p className="py-12 text-center text-sm text-slate-600">표시할 기간별 기록이 없습니다.</p>}</section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="dataset-title"><h2 id="dataset-title" className="text-lg font-bold">많이 분석한 데이터</h2><p className="mt-1 text-sm leading-6 text-slate-600">데이터별 분석 횟수와 전체 데이터 분석 중 비중</p>{stats.datasets.length ? <table className="mt-5 w-full text-sm"><caption className="sr-only">데이터별 분석 횟수와 비중</caption><thead><tr className="border-b border-slate-200 text-xs text-slate-600"><th scope="col" className="pb-3 text-left font-medium">데이터</th><th scope="col" className="pb-3 text-right font-medium">횟수</th><th scope="col" className="pb-3 pl-3 text-right font-medium">비중</th></tr></thead><tbody>{[...stats.datasets].sort((a, b) => b.count - a.count).map((row) => { const share = datasetTotal ? row.count / datasetTotal * 100 : 0; return <tr key={row.id} className="border-b border-slate-100 last:border-0"><th scope="row" className="py-4 pr-3 text-left font-medium"><span className="break-words">{row.label}</span><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><span className="block h-full rounded-full bg-blue-700" style={{ width: `${share}%` }} /></span></th><td className="py-4 text-right tabular-nums">{number(row.count)}</td><td className="py-4 pl-3 text-right tabular-nums text-slate-600">{share.toFixed(1)}%</td></tr>; })}</tbody></table> : <p className="py-12 text-center text-sm text-slate-600">아직 데이터별 분석 기록이 없습니다.</p>}</section>
          </div>
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="table-title"><h2 id="table-title" className="mb-5 text-lg font-bold">기간별 상세</h2><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="기간별 이용 집계 표, 가로로 스크롤 가능"><table className="w-full min-w-[560px] text-sm"><caption className="sr-only">기간별 이용 집계</caption><thead><tr className="border-b border-slate-300 text-slate-600"><th scope="col" className="py-3 text-left font-semibold">기간 시작일</th>{METRICS.map((metric) => <th key={metric.key} scope="col" className="py-3 pl-4 text-right font-semibold">{metric.label}</th>)}</tr></thead><tbody>{stats.series.map((row) => <tr key={row.date} className="border-b border-slate-100"><th scope="row" className="py-3 text-left font-medium">{row.date}</th>{METRICS.map((metric) => <td key={metric.key} className="py-3 pl-4 text-right tabular-nums">{number(row[metric.key])}</td>)}</tr>)}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><th scope="row" className="py-3 text-left">조회 기간 합계</th>{METRICS.map((metric) => <td key={metric.key} className="py-3 pl-4 text-right tabular-nums">{number(stats.totals[metric.key])}</td>)}</tr></tfoot></table></div></section>
          <footer className="mt-6 space-y-2 text-xs leading-6 text-slate-600"><p>분석은 성공한 실행만 집계합니다. 내보내기·공유는 요청 횟수이며 파일 저장이나 상대방 열람을 뜻하지 않습니다.</p><p>익명 이용 집계입니다. IP 주소·브라우저 상세 정보·질문 원문은 수집하지 않습니다. 수집 시작 전 이용이나 차단된 이벤트는 포함되지 않을 수 있습니다.</p></footer>
        </>}
      </>}
    </div>
  </main>;
}
