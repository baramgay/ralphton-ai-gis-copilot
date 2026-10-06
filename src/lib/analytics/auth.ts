import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const ADMIN_COOKIE = 'nurimap_usage_admin';
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export function adminSecret(): string | undefined {
  const value = process.env.NURIMAP_ANALYTICS_ADMIN_SECRET?.trim();
  return value && value.length >= 32 ? value : undefined;
}
function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(`nurimap-admin:${value}`).digest('hex');
}
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function issueAdminSession(secret: string, now = Date.now()): string {
  const payload = `v1.${Math.floor(now / 1000) + ADMIN_SESSION_SECONDS}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${signature(payload, secret)}`;
}
export function validAdminSession(value: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!value || !secret || !/^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return false;
  const parts = value.split('.');
  const expiry = Number(parts[1]);
  if (expiry <= Math.floor(now / 1000)) return false;
  return equalSecret(parts[3], signature(parts.slice(0, 3).join('.'), secret));
}
export function authorizedUsage(request: Request): boolean {
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  return validAdminSession(cookie?.slice(ADMIN_COOKIE.length + 1), adminSecret());
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}
