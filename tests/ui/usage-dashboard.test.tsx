import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageDashboard, buildUsageCsv } from "@/components/analytics/usage-dashboard";

const fixture = {
  timezone: "Asia/Seoul", period: "day" as const, days: 30,
  startDate: "2026-09-07", endDate: "2026-10-06", updatedAt: "2026-10-06T04:00:00Z",
  totals: { visits: 12, visitors: 9, analyses: 7, exports: 3, shares: 2 },
  series: [
    { date: "2026-10-05", visits: 5, visitors: 4, analyses: 3, exports: 1, shares: 0 },
    { date: "2026-10-06", visits: 7, visitors: 5, analyses: 4, exports: 2, shares: 2 },
  ],
  datasets: [{ id: "mois", label: "주민등록 인구", count: 5 }, { id: "medical", label: "의료기관", count: 2 }],
};
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("UsageDashboard", () => {
  it("loads actual totals, aggregate trend, and dataset proportions with browser-day definition", async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture));
    vi.stubGlobal("fetch", fetch);
    render(<UsageDashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    await screen.findByRole("heading", { name: "방문 브라우저 일수" });
    expect(fetch.mock.calls[0][0]).toBe("/api/usage/stats?period=day&days=30");
    expect(screen.getByText("71.4%")).toBeInTheDocument();
    expect(screen.getByText(/주간·월간은 일별 값을 합산/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "방문과 분석 추이" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "기간별 이용 집계" })).toBeInTheDocument();
  });

  it("changes aggregation and range, then refreshes only when requested", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(response({ ...fixture, period: url.includes("period=week") ? "week" : "day", days: url.includes("days=90") ? 90 : 30 })));
    vi.stubGlobal("fetch", fetch);
    render(<UsageDashboard />);
    await screen.findByRole("heading", { name: "방문 브라우저 일수" });
    fireEvent.click(screen.getByRole("button", { name: "주간" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toBe("/api/usage/stats?period=week&days=30");
    fireEvent.change(screen.getByLabelText("조회 범위"), { target: { value: "90" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][0]).toBe("/api/usage/stats?period=week&days=90");
    await waitFor(() => expect(screen.getByRole("button", { name: "새로고침" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it("shows no numbers when unauthorized and submits password only to access API", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({}, 200))
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response({}, 200));
    vi.stubGlobal("fetch", fetch);
    render(<UsageDashboard />);
    const password = await screen.findByLabelText("관리자 비밀번호");
    expect(screen.queryByRole("heading", { name: "방문 브라우저 일수" })).not.toBeInTheDocument();
    fireEvent.change(password, { target: { value: "temporary-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "대시보드 열기" }));
    await screen.findByRole("heading", { name: "방문 브라우저 일수" });
    expect(fetch.mock.calls[1][0]).toBe("/api/usage/access");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ password: "temporary-test-password" });
    expect(screen.queryByDisplayValue("temporary-test-password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByLabelText("관리자 비밀번호");
    expect(screen.queryByRole("heading", { name: "방문 브라우저 일수" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)?.[1].method).toBe("DELETE");
  });

  it("keeps an incorrect password private and allows another attempt", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 401));
    vi.stubGlobal("fetch", fetch);
    render(<UsageDashboard />);
    fireEvent.change(await screen.findByLabelText("관리자 비밀번호"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "대시보드 열기" }));
    await screen.findByText("비밀번호를 확인해 주세요.");
    expect(screen.getByLabelText("관리자 비밀번호")).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "방문 브라우저 일수" })).not.toBeInTheDocument();
  });

  it("distinguishes missing configuration from genuinely empty collected data", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 503));
    vi.stubGlobal("fetch", fetch);
    const view = render(<UsageDashboard />);
    await screen.findByText(/이용 통계 설정을 확인해야/);
    expect(screen.queryByRole("heading", { name: "방문 브라우저 일수" })).not.toBeInTheDocument();
    view.unmount();
    fetch.mockResolvedValueOnce(response({ ...fixture, totals: { visits: 0, visitors: 0, analyses: 0, exports: 0, shares: 0 }, series: [], datasets: [] }));
    render(<UsageDashboard />);
    await screen.findByText("아직 수집된 이용 기록이 없습니다.");
    expect(screen.getByRole("heading", { name: "방문 브라우저 일수" })).toBeInTheDocument();
  });

  it("clears stale totals after a failed refresh instead of presenting old data as current", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture)).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    render(<UsageDashboard />);
    await screen.findByRole("heading", { name: "방문 브라우저 일수" });
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(screen.queryByRole("heading", { name: "방문 브라우저 일수" })).not.toBeInTheDocument();
  });

  it("exports aggregates with KST and counting definitions and safely escapes spreadsheet cells", () => {
    const csv = buildUsageCsv({ ...fixture, datasets: [{ id: "x", label: '=SUM(1,2)"', count: 7 }] });
    expect(csv).toContain("Asia/Seoul");
    expect(csv).toContain("방문 브라우저 일수");
    expect(csv).toContain("주간·월간은 일별 값을 합산");
    expect(csv).toContain("2026-10-05");
    expect(csv).toContain('"\'=SUM(1,2)"""');
    expect(csv).not.toContain("temporary-test-password");
  });

  it("keeps chart labels and series themeable and distinguishes series without color", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));
    render(<UsageDashboard />);
    const chart = await screen.findByRole("img", { name: "방문과 분석 추이" });
    for (const label of chart.querySelectorAll("text")) {
      expect(label).not.toHaveAttribute("fill");
      expect(label).toHaveClass("fill-current", "text-slate-600");
    }
    const lines = chart.querySelectorAll("polyline");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toHaveAttribute("stroke");
      expect(line).toHaveClass("stroke-current", "[[data-theme=contrast]_&]:text-white");
    }
    expect(lines[0]).not.toHaveAttribute("stroke-dasharray");
    expect(lines[1]).toHaveAttribute("stroke-dasharray", "7 4");
    expect(chart.querySelector("desc")).toHaveTextContent("정확한 값은 아래 기간별 이용 집계 표");
  });
});
