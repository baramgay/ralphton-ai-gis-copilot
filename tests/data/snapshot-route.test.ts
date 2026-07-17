import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  readPublishedSnapshot: vi.fn(),
}));

vi.mock('@/lib/supabase/public', () => ({
  readPublishedSnapshot: cacheMocks.readPublishedSnapshot,
}));

import { GET } from '@/app/api/data/snapshot/route';

function request(mode?: string) {
  const url = new URL('http://localhost/api/data/snapshot');

  if (mode) {
    url.searchParams.set('mode', mode);
  }

  return new Request(url);
}

describe('/api/data/snapshot', () => {
  beforeEach(() => {
    cacheMocks.readPublishedSnapshot.mockReset();
  });

  it('returns the validated static demo without consulting Supabase in demo mode', async () => {
    const response = await GET(request('demo'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('demo');
    expect(body.months).toHaveLength(13);
    expect(body.regions).toHaveLength(206);
    expect(cacheMocks.readPublishedSnapshot).not.toHaveBeenCalled();
  });

  it('falls back to the demo snapshot when optional cache is unavailable', async () => {
    cacheMocks.readPublishedSnapshot.mockResolvedValueOnce(null);

    const response = await GET(request('auto'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-data-source')).toBe('demo-fallback');
    expect(body.mode).toBe('demo');
    expect(cacheMocks.readPublishedSnapshot).toHaveBeenCalledWith('live');
  });

  it('returns a validated published cache hit', async () => {
    const months = [
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ];
    cacheMocks.readPublishedSnapshot.mockResolvedValueOnce({
      mode: 'live',
      referenceMonth: '2026-01',
      months,
      regions: [],
      facilities: [],
      sourceNotes: ['fixture'],
    });

    const response = await GET(request('live'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-data-source')).toBe('supabase-cache');
    expect(body.mode).toBe('live');
    expect(cacheMocks.readPublishedSnapshot).toHaveBeenCalledWith('live');
  });

  it('rejects an unsupported mode without exposing internals', async () => {
    const response = await GET(request('service-role'));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toMatch(/supabase|service.?role|key|stack/i);
    expect(cacheMocks.readPublishedSnapshot).not.toHaveBeenCalled();
  });
});
