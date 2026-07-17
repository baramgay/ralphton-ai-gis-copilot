import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseMocks.createClient,
}));

function emptySupabaseEnv() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
}

describe('lazy optional Supabase clients', () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseMocks.createClient.mockReset();
    emptySupabaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is keyless-safe and does not construct clients during module import', async () => {
    const publicModule = await import('@/lib/supabase/public');
    const serverModule = await import('@/lib/supabase/server');

    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
    expect(publicModule.getPublicSupabaseClient()).toBeNull();
    expect(serverModule.getServiceSupabaseClient()).toBeNull();
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it('lazily creates and reuses an anon client without service credentials', async () => {
    const client = { from: vi.fn() };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://public-project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon-value');
    const publicModule = await import('@/lib/supabase/public');

    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
    expect(publicModule.getPublicSupabaseClient()).toBe(client);
    expect(publicModule.getPublicSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      'https://public-project.supabase.co',
      'fixture-anon-value',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
      }),
    );
  });

  it('lazily creates and reuses the service client only in the server module', async () => {
    const client = { from: vi.fn() };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://server-project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service-value');
    const serverModule = await import('@/lib/supabase/server');

    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
    expect(serverModule.getServiceSupabaseClient()).toBe(client);
    expect(serverModule.getServiceSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      'https://server-project.supabase.co',
      'fixture-service-value',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      }),
    );
  });

  it('keeps the service-role environment variable out of the public module', async () => {
    const publicSource = await readFile(
      path.join(process.cwd(), 'src/lib/supabase/public.ts'),
      'utf8',
    );
    const serverSource = await readFile(
      path.join(process.cwd(), 'src/lib/supabase/server.ts'),
      'utf8',
    );

    expect(publicSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(publicSource).not.toContain('upsertSnapshotWithServiceRole');
    expect(serverSource).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(serverSource).toContain('upsertSnapshotWithServiceRole');
  });
});

describe('Supabase cache operations', () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseMocks.createClient.mockReset();
    emptySupabaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads only explicitly published snapshots through the anon client', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://public-project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon-value');
    const { readPublishedSnapshot } = await import('@/lib/supabase/public');

    await expect(readPublishedSnapshot('live')).resolves.toBeNull();
    expect(client.from).toHaveBeenCalledWith('data_snapshots');
    expect(query.eq).toHaveBeenCalledWith('is_published', true);
    expect(query.eq).toHaveBeenCalledWith('mode', 'live');
  });

  it('rejects malformed cached payloads and recovers from cache query failures', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: { payload: { mode: 'live' } }, error: null })
        .mockRejectedValueOnce(new Error('fixture transport failure')),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://public-project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon-value');
    const { readPublishedSnapshot } = await import('@/lib/supabase/public');

    await expect(readPublishedSnapshot('live')).resolves.toBeNull();
    await expect(readPublishedSnapshot('live')).resolves.toBeNull();
  });

  it('performs snapshot writes only through a configured service client', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ upsert }) };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://server-project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service-value');
    const { upsertSnapshotWithServiceRole } = await import('@/lib/supabase/server');
    const months = Array.from({ length: 13 }, (_, index) =>
      `2025-${String(index + 1).padStart(2, '0')}`,
    );
    months[12] = '2026-01';

    const result = await upsertSnapshotWithServiceRole({
      id: 'snapshot-fixture',
      source: 'fixture',
      checksum: 'a'.repeat(64),
      isPublished: true,
      snapshot: {
        mode: 'live',
        referenceMonth: '2026-01',
        months,
        regions: [],
        facilities: [],
        sourceNotes: ['fixture'],
      },
    });

    expect(result).toBe(true);
    expect(client.from).toHaveBeenCalledWith('data_snapshots');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('declines writes safely when service configuration is absent', async () => {
    const { upsertSnapshotWithServiceRole } = await import('@/lib/supabase/server');

    await expect(
      upsertSnapshotWithServiceRole({
        id: 'snapshot-fixture',
        source: 'fixture',
        checksum: 'a'.repeat(64),
        isPublished: false,
        snapshot: {
          mode: 'demo',
          referenceMonth: '2026-01',
          months: [
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
          ],
          regions: [],
          facilities: [],
          sourceNotes: ['fixture'],
        },
      }),
    ).resolves.toBe(false);
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it('upserts normalized region metrics and facilities with the parent snapshot', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ upsert }) };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://server-project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service-value');
    const { upsertSnapshotWithServiceRole } = await import('@/lib/supabase/server');
    const snapshot = JSON.parse(
      await readFile(path.join(process.cwd(), 'public/data/demo-snapshot.json'), 'utf8'),
    );
    snapshot.regions = snapshot.regions.slice(0, 1);
    snapshot.facilities = snapshot.facilities.slice(0, 1);

    await expect(
      upsertSnapshotWithServiceRole({
        id: 'snapshot-with-children',
        source: 'fixture',
        checksum: 'b'.repeat(64),
        isPublished: false,
        snapshot,
      }),
    ).resolves.toBe(true);

    expect(client.from.mock.calls.map(([table]) => table)).toEqual([
      'data_snapshots',
      'region_metrics',
      'facilities',
    ]);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[1][0][0]).toMatchObject({
      snapshot_id: 'snapshot-with-children',
      adm_cd2: snapshot.regions[0].adm_cd2,
    });
    expect(upsert.mock.calls[2][0][0]).toMatchObject({
      snapshot_id: 'snapshot-with-children',
      facility_id: snapshot.facilities[0].id,
    });
  });
});
