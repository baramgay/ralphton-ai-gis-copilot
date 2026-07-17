import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/ai/parse/route';
import { parseIntentWithFallbacks } from '@/lib/ai/parse-intent';
import { createQwenCompletion } from '@/lib/ai/qwen';

const CHINA_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const SINGAPORE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

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
    /qwen|dashscope|model|prompt|bearer|api.?key|\uD0A4|\uC81C\uACF5\uC0AC/i,
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

  it('calls the primary parser before rules even for a rule-recognized query', async () => {
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

    expect(result.intent).toEqual({ tool: 'rankHospitalScarcity', filters: {} });
    expect(result.mode).toBe('live');
    expect(result.parser).toBe('ai');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('calls the primary model when rules do not match and a key is present', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    const result = await parseIntentWithFallbacks('의료 취약 지역을 찾아줘', {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('live');
    expect(result.intent).toEqual({ tool: 'rankHospitalScarcity', filters: {} });
    expect(fetch).toHaveBeenCalledTimes(1);

    const init = fetch.mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(init.body as string);

    expect(requestBody.model).toBe('primary-test-model');
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    expect(requestBody.enable_thinking).toBe(false);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-credential',
      'Content-Type': 'application/json',
    });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('retries the primary once then uses the fallback on repeated failures', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('primary retry failed'))
      .mockResolvedValueOnce(
        completionResponse({ tool: 'rankElderlyUnderserved', filters: {} }),
      );

    const result = await parseIntentWithFallbacks('의료 취약 지역을 찾아줘', {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('live');
    expect(result.intent).toEqual({ tool: 'rankElderlyUnderserved', filters: {} });
    expect(fetch).toHaveBeenCalledTimes(3);

    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );

    expect(bodies[0].model).toBe('primary-test-model');
    expect(bodies[1].model).toBe('primary-test-model');
    expect(bodies[2].model).toBe('fallback-test-model');
  });

  it('falls back to rules and demo mode when all AI calls fail', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await parseIntentWithFallbacks('약국', {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(result.intent?.filters.facilityTypes).toEqual(['약국']);
    expect(fetch).toHaveBeenCalledTimes(3);
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

  it('strictly rejects every invalid AI output before falling back to rules', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        completionResponse({ tool: 'shell', filters: {}, unexpected: 'value' }),
      );

    const result = await parseIntentWithFallbacks('약국', {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(result.intent?.filters.facilityTypes).toEqual(['약국']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects AI output with a radius exceeding 5 km and falls back to rules', async () => {
    const fetch = vi.fn().mockResolvedValue(
      completionResponse({
        tool: 'countFacilitiesWithinRadius',
        filters: { radiusKm: 50 },
      }),
    );

    const result = await parseIntentWithFallbacks('약국', {
      apiKey: 'test-credential',
      baseUrl: CHINA_BASE_URL,
      primaryModel: 'primary-test-model',
      fallbackModel: 'fallback-test-model',
      fetch,
    });

    expect(result.mode).toBe('demo');
    expect(result.intent?.tool).toBe('filterFacilitiesByTypeAndHours');
    expect(result.intent?.filters.facilityTypes).toEqual(['약국']);
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

describe('createQwenCompletion destination boundary', () => {
  const options = {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'test' }],
  };

  it.each([
    [CHINA_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    [
      SINGAPORE_BASE_URL,
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    ],
  ])('allows an official endpoint: %s', async (baseUrl, expectedUrl) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await createQwenCompletion({ apiKey: 'test-credential', baseUrl, fetch }, options);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(expectedUrl);
  });

  it.each([
    'https://example.com/v1',
    'https://127.0.0.1/v1',
    'https://dashscope.aliyuncs.com.evil.example/v1',
    'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  ])('rejects a non-allowlisted endpoint: %s', async (baseUrl) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completionResponse({ tool: 'rankHospitalScarcity', filters: {} }));

    await expect(
      createQwenCompletion({ apiKey: 'test-credential', baseUrl, fetch }, options),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/api/ai/parse', () => {
  beforeEach(() => {
    vi.stubEnv('QWEN_API_KEY', '');
    vi.stubEnv('QWEN_BASE_URL', '');
    vi.stubEnv('QWEN_PRIMARY_MODEL', '');
    vi.stubEnv('QWEN_JSON_FALLBACK_MODEL', '');
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
    vi.stubEnv('QWEN_API_KEY', 'route-test-credential');
    vi.stubEnv('QWEN_BASE_URL', SINGAPORE_BASE_URL);
    vi.stubEnv('QWEN_PRIMARY_MODEL', 'primary-test-model');
    vi.stubEnv('QWEN_JSON_FALLBACK_MODEL', 'fallback-test-model');
    vi.stubGlobal('fetch', fetch);

    const response = await POST(createRequest({ query: '종합병원' }));
    const json = await responseBody(response);

    expect(response.status).toBe(200);
    expect(json.mode).toBe('live');
    expect(fetch).toHaveBeenCalledTimes(1);
    expectPrivacySafe(json);
  });
});
