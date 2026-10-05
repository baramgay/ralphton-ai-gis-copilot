import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  readPublishedSnapshotMeta: vi.fn(),
}));

vi.mock('@/lib/supabase/public', () => ({
  readPublishedSnapshotMeta: cacheMocks.readPublishedSnapshotMeta,
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
    cacheMocks.readPublishedSnapshotMeta.mockReset();
  });

  it('returns the validated static demo without consulting Supabase in demo mode', async () => {
    const response = await GET(request('demo'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('demo');
    expect(body.months).toHaveLength(13);
    expect(body.regions.length).toBe(305);
    expect(cacheMocks.readPublishedSnapshotMeta).not.toHaveBeenCalled();
  });

  it('serves all official population months and bundled HIRA facilities when cache is unavailable', async () => {
    cacheMocks.readPublishedSnapshotMeta.mockResolvedValueOnce(null);

    const response = await GET(request('auto'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-data-source')).toBe('official-residents');
    expect(body.mode).toBe('live');
    expect(body.referenceMonth).toBe('2026-09');
    expect(body.facilities).toHaveLength(4254);
    expect(body.regions.find((r: { adm_cd2: string }) => r.adm_cd2 === '4833025300').population.at(-1)).toBe(117251);
    expect(cacheMocks.readPublishedSnapshotMeta).toHaveBeenCalledWith('live');
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
    cacheMocks.readPublishedSnapshotMeta.mockResolvedValueOnce({
      snapshot: {
        mode: 'live',
        referenceMonth: '2026-01',
        months,
        regions: [],
        facilities: [],
        sourceNotes: ['fixture'],
      },
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
      source: 'fixture',
      checksum: 'a'.repeat(64),
    });

    const response = await GET(request('live'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-data-source')).toBe('supabase-cache');
    expect(response.headers.get('x-published-at')).toBe('2026-09-07T00:00:00.000Z');
    expect(response.headers.get('x-snapshot-created-at')).toBe('2026-07-17T00:00:00.000Z');
    expect(body.mode).toBe('live');
    expect(body.referenceMonth).toBe('2026-09');
    expect(body.regions).toHaveLength(305);
    expect(cacheMocks.readPublishedSnapshotMeta).toHaveBeenCalledWith('live');
  });

  it('rejects an unsupported mode without exposing internals', async () => {
    const response = await GET(request('service-role'));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toMatch(/supabase|service.?role|key|stack/i);
    expect(cacheMocks.readPublishedSnapshotMeta).not.toHaveBeenCalled();
  });
});
