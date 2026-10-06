import { describe, expect, it } from 'vitest';
import { issueAdminSession, validAdminSession, sameOrigin } from '@/lib/analytics/auth';

const secret = 'test-admin-secret-that-is-at-least-32-characters';
describe('usage admin access', () => {
  it('issues an expiring signed session without exposing the secret', () => {
    const token = issueAdminSession(secret, 1000);
    expect(validAdminSession(token, secret, 1001)).toBe(true);
    expect(token).not.toContain(secret);
    expect(validAdminSession(token, secret, 1000 + 12 * 60 * 60 * 1000)).toBe(false);
  });
  it('rejects missing, malformed, tampered and wrong-secret sessions', () => {
    const token = issueAdminSession(secret, 1000);
    for (const value of [undefined, '', secret, 'v1.bad', token + 'x', token.replace('v1.', 'v2.')]) {
      expect(validAdminSession(value, secret, 1001)).toBe(false);
    }
    expect(validAdminSession(token, 'other-secret', 1001)).toBe(false);
    expect(validAdminSession(token, undefined, 1001)).toBe(false);
  });
  it('only allows mutations from the exact current origin', () => {
    const request = (origin?: string) => new Request('https://gnbc.site/api/usage/access', { headers: origin ? { origin } : {} });
    expect(sameOrigin(request('https://gnbc.site'))).toBe(true);
    for (const origin of [undefined, 'null', 'https://gnbc.site.evil.example', 'http://gnbc.site', 'https://other.example']) expect(sameOrigin(request(origin))).toBe(false);
  });
});
