import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('privacy-minimal usage client', () => {
  it('keeps one browser marker during a KST day and rotates it at midnight', async () => {
    const { visitorForDay } = await import('@/lib/analytics/client');
    const a = visitorForDay(new Date('2026-10-06T14:59:59Z'));
    expect(visitorForDay(new Date('2026-10-06T14:59:59.500Z'))).toBe(a);
    expect(visitorForDay(new Date('2026-10-06T15:00:00Z'))).not.toBe(a);
  });
  it('batches a single page visit and deduplicates dataset references without query or user metadata', async () => {
    const { recordVisit, recordUsage } = await import('@/lib/analytics/client');
    recordVisit(); recordVisit(); recordUsage('analysis', ['skt-living', 'skt-living', 'unknown']);
    await vi.advanceTimersByTimeAsync(1501);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(request.body as string);
    expect(Object.keys(body).sort()).toEqual(['events', 'visitorId']);
    expect(body.events).toHaveLength(2);
    expect(body.events[1].datasets).toEqual(['skt-living']);
    expect(Object.keys(body.events[1]).sort()).toEqual(['datasets', 'id', 'kind']);
    expect(JSON.stringify(body)).not.toMatch(/query|email|ip|agent|location|region|referrer/i);
  });
  it('does not record an analysis without an allowed dataset', async () => {
    const { recordUsage } = await import('@/lib/analytics/client');
    recordUsage('analysis', ['invented']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses identical event IDs on a bounded retry and never throws into the analysis', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const { recordUsage } = await import('@/lib/analytics/client');
    expect(() => recordUsage('analysis', ['skt-living'])).not.toThrow();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(vi.mocked(fetch).mock.calls[1][1]?.body);
  });
});
