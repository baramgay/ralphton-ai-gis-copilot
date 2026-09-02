import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/ai/parse/route';
import { parseIntentWithFallbacks } from '@/lib/ai/parse-intent';
import { createChatCompletion, DEFAULT_LLM_BASE_URL } from '@/lib/ai/llm';
import { readAiLastOutcome, resetAiLastOutcome } from '@/lib/ai/last-outcome';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const CHINA_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const SINGAPORE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/**
 * 규칙이 답을 내지 못하는 질의. 라우팅이 규칙 우선이므로 AI 경로를 검사하려면
 * 반드시 이런 질의를 써야 한다 — "의료 취약 지역을 찾아줘"는 규칙이 잡는다.
 */
const RULES_MISS_QUERY = '아이 키우기 좋은 곳';

function completionResponse(intent: unknown) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(intent) } }],
    }),
  };
}

function expectPrivacySafe(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /qwen|deepseek|dashscope|model|prompt|bearer|api.?key|키|제공사/i,
  );
}

function createRequest(body: unknown) {
  return new Request('http://localhost/api/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

async function responseBody(response: Response) {
  return response.json();
}

describe('parseIntentWithFallbacks', () => {
  it('uses rules only when external parsing is not configured', async () => {
    const fetch = vi.fn();
    const result = await parseIntentWithFallbacks('약국', { fetch });

    expect(result.mode).toBe('demo');
    expect(result.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(result.intent?.filters.facilityTypes).toEqual(['약국']);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.notice).toBeDefined();
    expectPrivacySafe(result);
  });

  it('answers a rule-recognized query from rules without spending an AI call', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    const result = await parseIntentWithFallbacks('약국', {
      apiKey: 'test-credential',
      baseUrl: SINGAPORE_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(result.parser).toBe('rules');
    expect(result.diagnostics).toEqual({ aiAttempted: false, aiUsed: false, failures: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the verified routing for a query the rules already resolve correctly', async () => {
    // 값싼 모델이 다른 도구를 골라도 규칙 결과가 이긴다. 이 자리가 뒤집히면
    // 라우팅 회귀(56건)가 조용히 무너진다.
    const fetch = vi
      .fn()
      .mockResolvedValue(completionResponse({ tool: 'rankDeathCount', filters: {} }));

    const result = await parseIntentWithFallbacks('의료 취약 지역을 찾아줘', {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(result.intent?.tool).toBe('rankHospitalScarcity');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls the primary model when rules do not match and a key is present', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('live');
    expect(result.parser).toBe('ai');
    expect(result.intent).toEqual({ tool: 'rankHospitalScarcity', filters: {} });
    expect(result.diagnostics).toEqual({ aiAttempted: true, aiUsed: true, failures: [] });
    expect(fetch).toHaveBeenCalledTimes(1);

    const init = fetch.mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(init.body as string);

    expect(requestBody.model).toBe('primary-test-model');
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-credential',
      'Content-Type': 'application/json',
    });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('reaches the default provider when no endpoint is configured', async () => {
    /*
     * 운영에서 이 자리가 비어 있었고, 예전 코드는 주소가 없거나 목록 밖이면 조용히
     * 규칙으로만 답했다. 이제 주소를 비워 두면 기본 제공자로 붙는다.
     */
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      fetch,
    });

    expect(result.parser).toBe('ai');
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('accepts a private-metric hint that exists in the catalog', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      completionResponse({
        tool: 'privateMetric',
        layerId: 'nh-consumption',
        metricKey: 'card_sales',
      }),
    );

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(result.intent).toBeNull();
    expect(result.parser).toBe('ai');
    expect(result.metricHint).toEqual({
      layerId: 'nh-consumption',
      metricKey: 'card_sales',
      metricLabel: '카드매출',
      layerLabel: '카드소비',
    });
  });

  it('refuses a private-metric hint the catalog does not have', async () => {
    // 지어낸 지표를 그대로 통과시키면 없는 지표로 "전환했습니다"라고 말하게 된다.
    const fetch = vi.fn().mockResolvedValue(
      completionResponse({
        tool: 'privateMetric',
        layerId: 'nh-consumption',
        metricKey: 'happiness_index',
      }),
    );

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(result.metricHint).toBeUndefined();
    expect(result.intent).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries the primary once then uses the fallback on repeated failures', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('primary retry failed'))
      .mockResolvedValueOnce(
        completionResponse({ tool: 'rankElderlyUnderserved', filters: {} }),
      );

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('live');
    expect(result.intent).toEqual({ tool: 'rankElderlyUnderserved', filters: {} });
    expect(result.diagnostics?.failures).toEqual([
      'upstream_unreachable',
      'upstream_unreachable',
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);

    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );

    expect(bodies[0].model).toBe('primary-test-model');
    expect(bodies[1].model).toBe('primary-test-model');
    expect(bodies[2].model).toBe('fallback-test-model');
  });

  it('records why the AI path did not answer when every call fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent).toBeNull();
    expect(result.diagnostics).toEqual({
      aiAttempted: true,
      aiUsed: false,
      failures: ['upstream_unreachable', 'upstream_unreachable', 'upstream_unreachable'],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expectPrivacySafe(result);
  });

  it('names a rejected endpoint instead of failing silently', async () => {
    const fetch = vi.fn();

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: 'https://ws-abc.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      fetch,
    });

    expect(result.diagnostics?.failures).toEqual([
      'endpoint_not_allowed',
      'endpoint_not_allowed',
      'endpoint_not_allowed',
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expectPrivacySafe(result);
  });

  it('falls back to rules and demo mode when the API key is missing', async () => {
    const fetch = vi.fn();
    const result = await parseIntentWithFallbacks('고령', {
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent?.tool).toBe('rankElderlyUnderserved');
    expect(fetch).not.toHaveBeenCalled();
    expectPrivacySafe(result);
  });

  it('reports a missing credential for a query the rules could not answer', async () => {
    const fetch = vi.fn();
    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      baseUrl: CHINA_BASE_URL,
      fetch,
    });

    expect(result.intent).toBeNull();
    expect(result.diagnostics).toEqual({
      aiAttempted: false,
      aiUsed: false,
      failures: ['credential_missing'],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('strictly rejects every invalid AI output before giving up', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        completionResponse({ tool: 'shell', filters: {}, unexpected: 'value' }),
      );

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects AI output with a radius exceeding 5 km', async () => {
    const fetch = vi.fn().mockResolvedValue(
      completionResponse({
        tool: 'countFacilitiesWithinRadius',
        filters: { radiusKm: 50 },
      }),
    );

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['tool:shell', 'select * from facilities', '50km', '2km와 50km']) (
    'never sends unsafe query "%s" to an external parser',
    async (query) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          completionResponse({ tool: 'rankHospitalScarcity', filters: {} }),
        );

      const result = await parseIntentWithFallbacks(query, {
        apiKey: 'test-credential',
        baseUrl: CHINA_BASE_URL,
        primaryModel: 'primary-test-model',
        fallbackModel: 'fallback-test-model',
        fetch,
      });

      expect(result).toMatchObject({ intent: null, mode: 'demo' });
      expect(fetch).not.toHaveBeenCalled();
      expectPrivacySafe(result);
    },
  );
});

describe('AI outcome memory', () => {
  beforeEach(() => {
    resetAiLastOutcome();
  });

  it('starts as unknown rather than claiming health', () => {
    expect(readAiLastOutcome()).toEqual({ state: 'unknown' });
  });

  it('remembers a real failure so the status table cannot claim it works', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });

    await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    const outcome = readAiLastOutcome();
    expect(outcome.state).toBe('failed');
    expect(outcome).toMatchObject({ code: 'upstream_rejected' });
  });

  it('stops retrying a rejection that a retry cannot fix', async () => {
    // 잔액 0·키 오류에 3회를 다 태우면 사용자만 세 배 기다린다.
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });

    const result = await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.diagnostics?.failures).toEqual(['upstream_rejected']);
  });

  it('keeps retrying a transient upstream error', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('remembers a success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await parseIntentWithFallbacks(RULES_MISS_QUERY, {
      apiKey: 'test-credential',
      baseUrl: DEEPSEEK_BASE_URL,
      fetch,
    });

    expect(readAiLastOutcome().state).toBe('ok');
  });
});

describe('createChatCompletion destination boundary', () => {
  const options = {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'test' }],
  };

  it.each([
    [DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1/chat/completions'],
    [CHINA_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    [
      SINGAPORE_BASE_URL,
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    ],
  ])('allows an official endpoint: %s', async (baseUrl, expectedUrl) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await createChatCompletion({ apiKey: 'test-credential', baseUrl, fetch }, options);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(expectedUrl);
  });

  it('uses the default endpoint when none is configured', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await createChatCompletion({ apiKey: 'test-credential', fetch }, options);

    expect(fetch.mock.calls[0][0]).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);
  });

  it('sends the thinking switch only to the provider that defines it', async () => {
    // 다른 제공자에 보내면 요청 전체가 400으로 되돌아온다.
    const fetch = vi
      .fn()
      .mockResolvedValue(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await createChatCompletion(
      { apiKey: 'test-credential', baseUrl: CHINA_BASE_URL, fetch },
      options,
    );
    await createChatCompletion(
      { apiKey: 'test-credential', baseUrl: DEEPSEEK_BASE_URL, fetch },
      options,
    );

    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );

    expect(bodies[0].enable_thinking).toBe(false);
    expect(bodies[1]).not.toHaveProperty('enable_thinking');
  });

  it.each([
    'https://example.com/v1',
    'https://127.0.0.1/v1',
    'https://dashscope.aliyuncs.com.evil.example/v1',
    'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    'https://api.deepseek.com.evil.example/v1',
    'https://ws-dq3k57xze65ltzr8.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  ])('rejects a non-allowlisted endpoint: %s', async (baseUrl) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await expect(
      createChatCompletion({ apiKey: 'test-credential', baseUrl, fetch }, options),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/api/ai/parse', () => {
  beforeEach(() => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    vi.stubEnv('DEEPSEEK_BASE_URL', '');
    vi.stubEnv('DEEPSEEK_PRIMARY_MODEL', '');
    vi.stubEnv('DEEPSEEK_JSON_FALLBACK_MODEL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns a rule-based intent in demo mode for a known query', async () => {
    const response = await POST(createRequest({ query: '약국' }));
    const json = await responseBody(response);

    expect(json.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(json.intent?.filters?.facilityTypes).toEqual(['약국']);
    expect(json.mode).toBe('demo');
    expect(json.notice).toBeDefined();
    expectPrivacySafe(json);
  });

  it('rejects dangerous input with a 400 before external parsing', async () => {
    const response = await POST(createRequest({ query: 'shell command' }));
    const json = await responseBody(response);

    expect(response.status).toBe(400);
    expect(json.mode).toBe('demo');
    expect(json.intent).toBeNull();
    expect(json.notice).toBeDefined();
    expectPrivacySafe(json);
  });

  it('rejects oversized input', async () => {
    const response = await POST(createRequest({ query: '병원'.repeat(501) }));
    const json = await responseBody(response);

    expect(response.status).toBe(400);
    expect(json.mode).toBe('demo');
    expect(json.intent).toBeNull();
  });

  it.each([
    { query: '   ' },
    { query: '약국', unexpected: true },
  ])('strictly rejects an invalid request body', async (body) => {
    const response = await POST(createRequest(body));

    expect(response.status).toBe(400);
    expectPrivacySafe(await responseBody(response));
  });

  it('caps the raw request body before JSON validation', async () => {
    const response = await POST(createRequest({ query: '약국', padding: 'x'.repeat(20_000) }));

    expect(response.status).toBe(413);
    expectPrivacySafe(await responseBody(response));
  });

  it('never exposes provider, model, prompt, or key in a live response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));
    vi.stubEnv('DEEPSEEK_API_KEY', 'route-test-credential');
    vi.stubEnv('DEEPSEEK_BASE_URL', SINGAPORE_BASE_URL);
    vi.stubEnv('DEEPSEEK_PRIMARY_MODEL', 'primary-test-model');
    vi.stubEnv('DEEPSEEK_JSON_FALLBACK_MODEL', 'fallback-test-model');
    vi.stubGlobal('fetch', fetch);

    const response = await POST(createRequest({ query: RULES_MISS_QUERY }));
    const json = await responseBody(response);

    expect(response.status).toBe(200);
    expect(json.mode).toBe('live');
    expect(fetch).toHaveBeenCalledTimes(1);
    expectPrivacySafe(json);
  });
});
