import { datasetIdsForLayers, type UsageEvent, type UsageEventKind } from './catalog';

const VISITOR_KEY = 'nurimap-usage-browser-day';
let visitor: { day: string; id: string } | null = null;
let pageVisited = false;
let listenersAdded = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: UsageEvent[] = [];

export function visitorForDay(now = new Date()): string {
  const day = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (visitor?.day === day) return visitor.id;
  try {
    const saved = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null');
    if (saved?.day === day && typeof saved.id === 'string' && /^[a-f0-9-]{36}$/i.test(saved.id)) { visitor = saved; return saved.id; }
  } catch { /* Browser storage can be disabled. */ }
  visitor = { day, id: crypto.randomUUID() };
  try { localStorage.setItem(VISITOR_KEY, JSON.stringify(visitor)); } catch { /* Use this page's in-memory identifier. */ }
  return visitor.id;
}

async function deliver(body: string, retry = true): Promise<void> {
  try {
    const response = await fetch('/api/usage/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' });
    if (!response.ok) throw new Error('usage');
  } catch {
    // A single retry uses exactly the same event IDs so a lost response cannot double-count.
    if (retry && document.visibilityState !== 'hidden') setTimeout(() => { void deliver(body, false); }, 2000);
  }
}

export function flushUsage(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  while (queue.length) {
    const events = queue.splice(0, 20);
    const body = JSON.stringify({ visitorId: visitorForDay(), events });
    void deliver(body);
  }
}

export function recordUsage(kind: UsageEventKind, layerIds: readonly string[] = [], id = crypto.randomUUID()): void {
  if (typeof window === 'undefined' || navigator.doNotTrack === '1') return;
  const datasets = kind === 'analysis' ? datasetIdsForLayers([...layerIds]) : [];
  if (kind === 'analysis' && datasets.length === 0) return;
  queue.push({ id, kind, datasets });
  if (!listenersAdded) {
    listenersAdded = true;
    window.addEventListener('pagehide', flushUsage);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUsage(); });
  }
  if (queue.length >= 20) flushUsage();
  else if (!timer) timer = setTimeout(flushUsage, 1500);
}

export function recordVisit(): void {
  if (pageVisited) return;
  pageVisited = true;
  recordUsage('visit');
}
