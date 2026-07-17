import { describe, expect, it, vi } from 'vitest';

import {
  buildAgeSexPopulationUrl,
  buildBirthsUrl,
  buildDeathsUrl,
  buildOnePersonHouseholdsUrl,
  buildResidentPopulationUrl,
  fetchAllPublicDataPages,
  fetchPublicDataPage,
} from '@/lib/data/public-api';

const FAKE_SERVICE_KEY = 'fixture+/= credential';

describe('official data.go.kr endpoint builders', () => {
  it.each([
    [buildResidentPopulationUrl, '/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus'],
    [buildAgeSexPopulationUrl, '/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn'],
    [buildOnePersonHouseholdsUrl, '/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh'],
    [buildBirthsUrl, '/1741000/admmBrthRegist/selectAdmmBrthRegist'],
    [buildDeathsUrl, '/1741000/admmDthRegist/selectAdmmDthRegist'],
  ])('builds the official endpoint %s', (builder, expectedPath) => {
    const url = new URL(
      builder({
        serviceKey: FAKE_SERVICE_KEY,
        referenceMonth: '2026-06',
        pageNo: 2,
        numOfRows: 250,
        ctpvCode: '26',
      }),
    );

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('apis.data.go.kr');
    expect(url.pathname).toBe(expectedPath);
    expect(url.searchParams.get('serviceKey')).toBe(FAKE_SERVICE_KEY);
    expect(url.searchParams.get('stdgMtrYm')).toBe('202606');
    expect(url.searchParams.get('pageNo')).toBe('2');
    expect(url.searchParams.get('numOfRows')).toBe('250');
    expect(url.searchParams.get('ctpvCd')).toBe('26');
    expect(url.searchParams.get('type')).toBe('json');
    expect(url.toString()).not.toContain(FAKE_SERVICE_KEY);
  });

  it('normalizes an already encoded service key without double encoding it', () => {
    const encoded = encodeURIComponent(FAKE_SERVICE_KEY);
    const url = new URL(buildResidentPopulationUrl({ serviceKey: encoded }));

    expect(url.searchParams.get('serviceKey')).toBe(FAKE_SERVICE_KEY);
    expect(url.toString()).not.toContain('%252F');
  });
});

describe('public data response adapter', () => {
  it('validates and follows pagination without making a real request', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const pageNo = Number(new URL(String(input)).searchParams.get('pageNo'));

      return {
        ok: true,
        json: async () => ({
          response: {
            header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
            body: {
              pageNo,
              numOfRows: 1,
              totalCount: 2,
              items: { item: [{ id: pageNo }] },
            },
          },
        }),
      };
    });

    const items = await fetchAllPublicDataPages(
      'residentPopulation',
      { serviceKey: FAKE_SERVICE_KEY, numOfRows: 1 },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed provider data without logging or exposing the service key', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: { body: { unexpected: true } } }),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const promise = fetchPublicDataPage(
        'residentPopulation',
        { serviceKey: FAKE_SERVICE_KEY },
        { fetch: fetch as unknown as typeof globalThis.fetch },
      );

      await expect(promise).rejects.toThrow();
      await promise.catch((reason: unknown) => {
        expect(String(reason)).not.toContain(FAKE_SERVICE_KEY);
      });
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
