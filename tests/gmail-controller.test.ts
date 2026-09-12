import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  GmailController,
  type GmailConnectionService,
} from '../backend/api/src/gmail-controller';
import { GMAIL_READONLY_SCOPE } from '../packages/shared/src/gmail-connection';
import type { IdentityVerifier } from '../backend/api/src/auth';

const USER = '10000000-0000-4000-8000-000000000001';

function identity(): IdentityVerifier {
  return {
    verify: vi.fn(async (authorization: string | undefined) => {
      if (authorization !== 'Bearer session') throw new Error('unauthorized');
      return USER;
    }),
  };
}

function service(): GmailConnectionService {
  return {
    connection: vi.fn(async (userId: string) => ({
      state: 'connected',
      email: userId === USER ? 'reviewer@example.test' : 'wrong@example.test',
      scope: GMAIL_READONLY_SCOPE,
      rangeDays: 30,
    })),
    start: vi.fn(async (_userId: string, _rangeDays: number) => ({
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}`,
    })),
    sync: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
}

describe('GmailController', () => {
  it('binds every operation to the authenticated user', async () => {
    const gmail = service();
    const controller = new GmailController(identity(), gmail);
    const connection = await controller.connection('Bearer session');
    expect(connection.email).toBe('reviewer@example.test');
    expect(gmail.connection).toHaveBeenCalledWith(USER);

    await controller.sync('Bearer session');
    expect(gmail.sync).toHaveBeenCalledWith(USER);
    await controller.disconnect('Bearer session');
    expect(gmail.disconnect).toHaveBeenCalledWith(USER);
  });

  it('accepts only a closed start payload and validates the provider URL', async () => {
    const gmail = service();
    const controller = new GmailController(identity(), gmail);
    await controller.start('Bearer session', { rangeDays: 30 });
    expect(gmail.start).toHaveBeenCalledWith(USER, 30);

    await expect(
      controller.start('Bearer session', { rangeDays: 30, redirect: 'https://evil.example' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const unsafe = service();
    unsafe.start = vi.fn(async () => ({
      authorizationUrl: `https://evil.example/o/oauth2/v2/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}`,
    }));
    await expect(
      new GmailController(identity(), unsafe).start('Bearer session', { rangeDays: 30 }),
    ).rejects.toThrow('GMAIL_INVALID_AUTHORIZATION_URL');
  });

  it('returns unavailable until the server implementation is explicitly supplied', async () => {
    const controller = new GmailController(identity(), null);
    await expect(controller.connection('Bearer session')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
