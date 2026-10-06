import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIntentWithFallbacks } from '@/lib/ai/parse-intent';
import { createChatCompletion, LlmError } from '@/lib/ai/llm';

function completion(value: unknown, finish_reason = 'stop') {
  return { ok: true, json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] }) };
}
const deps = { apiKey: 'test', useRemoteRagEmbed: false };
afterEach(() => { vi.useRealTimers(); });

describe('LLM interpretation constraints', () => {
  it.each(['장사가 잘되는 상권', '진주시 장사가 잘되는 상권'])('preserves catalog paraphrase evidence for a supported commerce question: %s', async (query) => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'privateMetric', layerId: 'nh-consumption', metricKey: 'card_sales' }));
    const result = await parseIntentWithFallbacks(query, { ...deps, fetch });
    expect(result.metricHint).toMatchObject({ layerId: 'nh-consumption', metricKey: 'card_sales' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const system = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    // Retrieval already found the right metric. The model must receive its verified everyday aliases,
    // not just a technical label that makes this supported wording look like an undefined indicator.
    expect(system).toContain('장사가 잘');
    expect(system).toContain('장사 잘되');
    expect(system).toContain('"tool":"privateMetric","layerId":"nh-consumption","metricKey":"card_sales"');
    expect(system).toContain('순이익');
  });
  it('does not turn an explicitly unsupported profit question into a card-revenue result', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'unsupported', filters: {}, reason: '순이익 자료는 제공하지 않습니다.' }));
    const result = await parseIntentWithFallbacks('진주시 상권의 순이익 순위', { ...deps, fetch });
    expect(result.intent).toBeNull();
    expect(result.metricHint).toBeUndefined();
    expect(result.notice).toContain('순이익');
  });
  it('preserves an explicit district even when a model omits it', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'rankHospitalScarcity', filters: {} }));
    const result = await parseIntentWithFallbacks('진주시 가기 힘든 지역', { ...deps, fetch });
    expect(result.intent?.filters.regions).toEqual(['진주시']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves all of Changwon rather than narrowing to a district', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(completion({ tool: 'rankHospitalScarcity', filters: { regions: ['창원시 의창구'] } }))
      .mockResolvedValueOnce(completion({ tool: 'rankHospitalScarcity', filters: { regions: ['창원시'] } }));
    const result = await parseIntentWithFallbacks('창원 가기 힘든 지역', { ...deps, fetch });
    expect(result.intent?.filters.regions).toEqual(['창원시']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetch.mock.calls[1][1].body).messages;
    expect(repair.some((message: { content: string }) => message.content.includes('지역'))).toBe(true);
  });
  it('rejects a district the user never requested', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'rankHospitalScarcity', filters: { regions: ['김해시'] } }));
    const result = await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, fetch });
    expect(result.intent).toBeNull();
    expect(result.diagnostics?.aiUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.diagnostics?.failures).toEqual(['response_invalid', 'response_invalid']);
  });
  it('repairs unsupported schema fields with a bounded corrective instruction', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(completion({ tool: 'rankHospitalScarcity', filters: {}, sql: 'secret-invalid-field' }))
      .mockResolvedValueOnce(completion({ tool: 'rankHospitalScarcity', filters: {} }));
    const result = await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, fetch });
    expect(result.intent?.tool).toBe('rankHospitalScarcity');
    expect(fetch).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetch.mock.calls[1][1].body).messages;
    expect(repair[repair.length - 1].content).toContain('검증');
    expect(JSON.stringify(repair)).not.toContain('secret-invalid-field');
    expect(result.diagnostics?.failures).toEqual(['response_invalid']);
  });
  it('stops configuration faults without repeating them', async () => {
    const fetch = vi.fn();
    const result = await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, baseUrl: 'https://example.com/v1', fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.diagnostics?.failures).toEqual(['endpoint_not_allowed']);
  });
  it('does not switch to a more expensive model after an invalid response', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'invented', filters: {} }));
    await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, primaryModel: 'current-model', fallbackModel: 'expensive-model', fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).model)).toEqual(['current-model', 'current-model']);
  });
  it.each([
    { requireNightHours: true }, { requireWeekendHours: true },
    { facilityTypes: ['약국'], includePharmacy: true }, { radiusKm: 3 },
  ])('rejects a model-invented filter %j', async (filters) => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'rankHospitalScarcity', filters }));
    const result = await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, fetch });
    expect(result.intent).toBeNull();
    expect(result.diagnostics?.failures).toEqual(['response_invalid', 'response_invalid']);
  });
  it('rejects an unrequested district aggregation', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'rankHospitalScarcity', filters: {}, adminLevel: 'sgg' }));
    const result = await parseIntentWithFallbacks('가기 힘든 지역', { ...deps, fetch });
    expect(result.intent).toBeNull();
  });
  it.each([
    { tool: 'privateMetric', layerId: 'nh-consumption', metricKey: 'card_sales', sql: 'invented' },
    { tool: 'unsupported', filters: { regions: ['김해시'] } },
  ])('rejects non-public response fields outside their schema', async (raw) => {
    const fetch = vi.fn().mockResolvedValue(completion(raw));
    const result = await parseIntentWithFallbacks('장사가 잘되는 상권', { ...deps, fetch });
    expect(result.metricHint).toBeUndefined();
    expect(result.diagnostics?.aiUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('limits total upstream waiting to 15 seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const promise = parseIntentWithFallbacks('가기 힘든 지역', { ...deps, fetch });
    await vi.advanceTimersByTimeAsync(15_100);
    const result = await promise;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.intent).toBeNull();
    expect(result.diagnostics?.failures).toEqual(['upstream_timeout', 'upstream_timeout']);
  });
});

describe('short JSON completion transport', () => {
  const options = { model: 'current', messages: [{ role: 'user' as const, content: 'json' }], enableThinking: false };
  it('disables DeepSeek thinking and caps the JSON output', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'unsupported', filters: {} }));
    await createChatCompletion({ apiKey: 'test', fetch }, options);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty('enable_thinking');
  });
  it('rejects truncated JSON even if the partial object happens to parse', async () => {
    const fetch = vi.fn().mockResolvedValue(completion({ tool: 'rankHospitalScarcity', filters: {} }, 'length'));
    await expect(createChatCompletion({ apiKey: 'test', fetch }, options)).rejects.toMatchObject({ code: 'response_not_json' });
  });
  it('normalizes invalid provider response JSON', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('raw-provider-details'); } });
    await expect(createChatCompletion({ apiKey: 'test', fetch }, options)).rejects.toBeInstanceOf(LlmError);
  });
  it('keeps the timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }) }));
    const promise = createChatCompletion({ apiKey: 'test', fetch }, { ...options, timeoutMs: 100 });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'upstream_timeout' });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});
