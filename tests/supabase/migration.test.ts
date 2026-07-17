import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/202607160001_ai_gis_snapshot.sql',
);

let sql = '';

beforeAll(async () => {
  sql = (await readFile(migrationPath, 'utf8')).toLowerCase().replace(/\s+/g, ' ');
});

describe('AI GIS snapshot migration security contract', () => {
  it.each(['data_snapshots', 'region_metrics', 'facilities'])(
    'creates %s with RLS enabled',
    (table) => {
      expect(sql).toMatch(
        new RegExp(`create table (?:if not exists )?public\\.${table}`),
      );
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    },
  );

  it('revokes default access and grants anon/authenticated SELECT only', () => {
    expect(sql).toMatch(
      /revoke all on table public\.data_snapshots, public\.region_metrics, public\.facilities from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant select on table public\.data_snapshots, public\.region_metrics, public\.facilities to anon, authenticated/,
    );
    expect(sql).not.toMatch(/grant all[^;]+to (?:anon|authenticated)/);
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]+to (?:anon|authenticated)/);
  });

  it('allows anon/authenticated reads only through published demo/live parents', () => {
    expect(sql).toContain(
      "create policy \"published snapshots are readable\" on public.data_snapshots for select to anon, authenticated using (is_published = true and mode in ('demo', 'live'))",
    );
    expect(sql).toMatch(
      /create policy "published region metrics are readable" on public\.region_metrics for select to anon, authenticated using \(exists \([^;]+data_snapshots[^;]+is_published[^;]+\)\)/,
    );
    expect(sql).toMatch(
      /create policy "published facilities are readable" on public\.facilities for select to anon, authenticated using \(exists \([^;]+data_snapshots[^;]+is_published[^;]+\)\)/,
    );
  });

  it('reserves explicit write privileges for service_role and defines no public write policy', () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.data_snapshots, public\.region_metrics, public\.facilities to service_role/,
    );
    expect(sql).not.toMatch(/for (?:insert|update|delete) to (?:anon|authenticated)/);
    expect(sql).not.toContain('security definer');
  });

  it('links child rows to snapshots and constrains normalized identifiers', () => {
    expect(sql).toContain('references public.data_snapshots(id) on delete cascade');
    expect(sql).toContain("check (adm_cd2 ~ '^[0-9]{10}$')");
    expect(sql).toContain("check (mode in ('demo', 'live'))");
  });
});
