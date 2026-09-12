import { describe, expect, it } from 'vitest';
import {
  GMAIL_READONLY_SCOPE,
  gmailRangeDays,
  normalizeGmailConnection,
  normalizeGmailOAuthStart,
} from '../packages/shared/src/gmail-connection';

describe('Gmail readonly connection contract', () => {
  it('accepts a connected snapshot without email content', () => {
    expect(
      normalizeGmailConnection({
        state: 'connected',
        email: 'reviewer@example.test',
        scope: GMAIL_READONLY_SCOPE,
        rangeDays: 30,
        lastSyncAt: '2026-09-12T02:00:00.000Z',
        coverageFrom: '2026-08-13',
        coverageTo: '2026-09-11',
      }),
    ).toEqual({
      state: 'connected',
      email: 'reviewer@example.test',
      scope: GMAIL_READONLY_SCOPE,
      rangeDays: 30,
      lastSyncAt: '2026-09-12T02:00:00.000Z',
      coverageFrom: '2026-08-13',
      coverageTo: '2026-09-11',
    });
  });

  it('requires the readonly Gmail scope and Google authorization host', () => {
    expect(() =>
      normalizeGmailOAuthStart({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid%20email',
      }),
    ).toThrow('GMAIL_INVALID_SCOPE');
    expect(() =>
      normalizeGmailOAuthStart({
        authorizationUrl: `https://evil.example/o/oauth2/v2/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}`,
      }),
    ).toThrow('GMAIL_INVALID_AUTHORIZATION_URL');
    expect(
      normalizeGmailOAuthStart({
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}`,
      }).authorizationUrl,
    ).toContain('accounts.google.com');
  });

  it('rejects ambiguous or excessive initial ranges', () => {
    expect(gmailRangeDays(30)).toBe(30);
    expect(() => gmailRangeDays(0)).toThrow('GMAIL_INVALID_RANGE');
    expect(() => gmailRangeDays(366)).toThrow('GMAIL_INVALID_RANGE');
    expect(() => gmailRangeDays(30.5)).toThrow('GMAIL_INVALID_RANGE');
  });

  it('rejects unknown fields and incomplete coverage', () => {
    expect(() =>
      normalizeGmailConnection({
        state: 'disconnected',
        scope: GMAIL_READONLY_SCOPE,
        rangeDays: 30,
        refreshToken: 'must-never-reach-client',
      }),
    ).toThrow('GMAIL_INVALID_RESPONSE');
    expect(() =>
      normalizeGmailConnection({
        state: 'connected',
        email: 'reviewer@example.test',
        scope: GMAIL_READONLY_SCOPE,
        rangeDays: 30,
        coverageFrom: '2026-08-13',
      }),
    ).toThrow('GMAIL_INVALID_RESPONSE');
  });
});
