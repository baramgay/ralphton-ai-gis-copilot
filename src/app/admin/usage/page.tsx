import type { Metadata } from 'next';
import { UsageDashboard } from '@/components/analytics/usage-dashboard';

export const metadata: Metadata = { title: '사용 통계', robots: { index: false, follow: false } };
export default function UsagePage() { return <UsageDashboard />; }
