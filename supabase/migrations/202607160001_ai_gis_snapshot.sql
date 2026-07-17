-- AI GIS Copilot 선택적 스냅샷 캐시
-- 서비스 롤로만 쓰기가 가능하며, 공개된(published=true) demo/live 스냅샷에 대해서만
-- 익명/인증 사용자가 SELECT 할 수 있습니다.

CREATE TABLE IF NOT EXISTS public.data_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 200),
  reference_month TEXT NOT NULL CHECK (reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
  checksum TEXT NOT NULL UNIQUE CHECK (checksum ~ '^[a-fA-F0-9]{64}$'),
  is_published BOOLEAN NOT NULL DEFAULT false,
  months TEXT[] NOT NULL CHECK (cardinality(months) = 13),
  source_notes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_notes) = 'array'),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.region_metrics (
  snapshot_id TEXT NOT NULL REFERENCES public.data_snapshots(id) ON DELETE CASCADE,
  adm_cd2 TEXT NOT NULL CHECK (adm_cd2 ~ '^[0-9]{10}$'),
  adm_nm TEXT NOT NULL CHECK (length(adm_nm) > 0),
  series JSONB NOT NULL CHECK (jsonb_typeof(series) = 'object'),
  PRIMARY KEY (snapshot_id, adm_cd2)
);

CREATE TABLE IF NOT EXISTS public.facilities (
  snapshot_id TEXT NOT NULL REFERENCES public.data_snapshots(id) ON DELETE CASCADE,
  facility_id TEXT NOT NULL CHECK (length(facility_id) > 0),
  adm_cd2 TEXT NOT NULL CHECK (adm_cd2 ~ '^[0-9]{10}$'),
  name TEXT NOT NULL CHECK (length(name) > 0),
  type TEXT NOT NULL CHECK (
    type IN (
      '종합병원',
      '병원',
      '요양병원',
      '의원',
      '치과의원',
      '한의원',
      '보건소',
      '약국'
    )
  ),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  specialties JSONB CHECK (specialties IS NULL OR jsonb_typeof(specialties) = 'array'),
  hours JSONB CHECK (hours IS NULL OR jsonb_typeof(hours) = 'object'),
  address TEXT,
  phone TEXT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (snapshot_id, facility_id)
);

CREATE INDEX IF NOT EXISTS data_snapshots_published_mode_month_idx
  ON public.data_snapshots (mode, reference_month DESC)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS facilities_snapshot_adm_type_idx
  ON public.facilities (snapshot_id, adm_cd2, type);

ALTER TABLE public.data_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.region_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "published snapshots are readable"
  ON public.data_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true AND mode IN ('demo', 'live'));

CREATE POLICY "published region metrics are readable"
  ON public.region_metrics
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.data_snapshots
    WHERE public.data_snapshots.id = public.region_metrics.snapshot_id
      AND public.data_snapshots.is_published = true
  ));

CREATE POLICY "published facilities are readable"
  ON public.facilities
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.data_snapshots
    WHERE public.data_snapshots.id = public.facilities.snapshot_id
      AND public.data_snapshots.is_published = true
  ));

REVOKE ALL ON TABLE public.data_snapshots, public.region_metrics, public.facilities
  FROM public, anon, authenticated;

GRANT SELECT ON TABLE public.data_snapshots, public.region_metrics, public.facilities
  TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.data_snapshots, public.region_metrics, public.facilities
  TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
