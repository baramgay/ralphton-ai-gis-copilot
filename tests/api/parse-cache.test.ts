import { describe, expect, it, vi } from 'vitest';
import { createParseIntentCache } from '@/lib/ai/parse-cache';
import type { ParseIntentResult } from '@/lib/ai/parse-intent';

const deps = { apiKey: 'test-private-key', useRemoteRagEmbed: false };
const success: ParseIntentResult = {
  intent: { tool: 'rankHospitalScarcity', filters: {} }, mode: 'live', parser: 'ai',
  diagnostics: { aiAttempted: true, aiUsed: true, failures: [] },
};

describe('successful interpretation cache', () => {
  it('shares simultaneous requests and reuses a validated result without another AI call', async () => {
    let complete!: (result: ParseIntentResult) => void;
    const parse = vi.fn(() => new Promise<ParseIntentResult>(resolve => { complete = resolve; }));
    const cached = createParseIntentCache(parse);
    const first = cached('가기 힘든 지역', deps);
    const second = cached('가기 힘든 지역', deps);
    complete(success);
    expect((await first).diagnostics?.aiAttempted).toBe(true);
    expect((await second).diagnostics).toEqual({ aiAttempted: false, aiUsed: true, failures: [], cache: 'shared' });
    const hit = await cached('가기 힘든 지역', deps);
    expect(hit.intent).toEqual(success.intent);
    expect(hit.diagnostics?.cache).toBe('hit');
    expect(parse).toHaveBeenCalledTimes(1);
    hit.intent!.filters.regions = ['진주시'];
    expect((await cached('가기 힘든 지역', deps)).intent?.filters.regions).toBeUndefined();
    expect(JSON.stringify(hit)).not.toContain(deps.apiKey);
  });

  it('does not cache unsupported, failed or deterministic results', async () => {
    for (const result of [
      { ...success, intent: null },
      { ...success, diagnostics: { aiAttempted: true, aiUsed: false, failures: [] } },
      { ...success, parser: 'rules' as const, diagnostics: { aiAttempted: false, aiUsed: false, failures: [] } },
    ]) {
      const parse = vi.fn(async () => result);
      const cached = createParseIntentCache(parse);
      await cached('질문', deps);
      await cached('질문', deps);
      expect(parse).toHaveBeenCalledTimes(2);
    }
  });

  it('separates exact queries, credentials, models, endpoints and RAG settings', async () => {
    const parse = vi.fn(async () => success);
    const cached = createParseIntentCache(parse);
    await cached('가기 힘든 지역', deps);
    await cached('진주시 가기 힘든 지역', deps);
    for (const changed of [{ apiKey: 'other' }, { primaryModel: 'other' }, { fallbackModel: 'other' }, { baseUrl: 'https://other.example' }, { useRemoteRagEmbed: true }]) {
      await cached('가기 힘든 지역', { ...deps, ...changed });
    }
    expect(parse).toHaveBeenCalledTimes(7);
  });

  it('isolates injected transports and also caches supported private metric interpretations', async () => {
    const hint: ParseIntentResult = { ...success, intent: null, metricHint: {
      layerId: 'nh-consumption', metricKey: 'card_sales', layerLabel: '소비', metricLabel: '카드매출',
    } };
    const parse = vi.fn(async () => hint);
    const cached = createParseIntentCache(parse);
    const first = vi.fn<typeof fetch>();
    const second = vi.fn<typeof fetch>();
    await cached('장사가 잘되는 상권', { ...deps, fetch: first });
    expect((await cached('장사가 잘되는 상권', { ...deps, fetch: first })).diagnostics?.cache).toBe('hit');
    await cached('장사가 잘되는 상권', { ...deps, fetch: second });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('expires after five minutes and evicts old entries at its fixed bound', async () => {
    vi.useFakeTimers();
    try {
      const parse = vi.fn(async () => success);
      const cached = createParseIntentCache(parse);
      await cached('첫 질문', deps);
      vi.advanceTimersByTime(300_000);
      await cached('첫 질문', deps);
      expect(parse).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 100; i++) await cached(`질문 ${i}`, deps);
      await cached('첫 질문', deps);
      expect(parse).toHaveBeenCalledTimes(103);
    } finally { vi.useRealTimers(); }
  });

  it('releases rejected in-flight requests so a later attempt can recover', async () => {
    const parse = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(success);
    const cached = createParseIntentCache(parse);
    await expect(cached('질문', deps)).rejects.toThrow('temporary');
    expect((await cached('질문', deps)).intent).toEqual(success.intent);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
