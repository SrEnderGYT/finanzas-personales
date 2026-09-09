import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export interface GoogleClaims {
  subject: string;
  email: string;
}
export interface GoogleProvider {
  authorization(parameters: {
    state: string;
    nonce: string;
    challenge: string;
    reauthenticate?: boolean;
  }): string;
  exchange(
    code: string,
    verifier: string,
    nonce: string,
    authenticatedAfter?: number,
  ): Promise<GoogleClaims>;
}
export async function verifyGoogleToken(
  token: string,
  nonce: string,
  clientId: string,
  keys: JWTVerifyGetKey,
  authenticatedAfter?: number,
): Promise<GoogleClaims> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'nonce', 'email', 'email_verified'],
      maxTokenAge: '10m',
      clockTolerance: 5,
    });
    if (
      payload['nonce'] !== nonce ||
      payload['email_verified'] !== true ||
      typeof payload['email'] !== 'string' ||
      !payload.sub ||
      payload.sub.length > 255 ||
      (payload['azp'] !== undefined && payload['azp'] !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload['azp'] !== clientId)
    )
      throw new Error();
    if (authenticatedAfter !== undefined) {
      const time = payload['auth_time'];
      if (
        !Number.isSafeInteger(authenticatedAfter) ||
        authenticatedAfter < 0 ||
        typeof time !== 'number' ||
        !Number.isSafeInteger(time) ||
        time < authenticatedAfter - 5 ||
        time > Math.floor(Date.now() / 1000) + 5
      )
        throw new Error();
    }
    return { subject: payload.sub, email: payload['email'].toLowerCase() };
  } catch {
    throw new UnauthorizedException();
  }
}
export class LiveGoogleProvider implements GoogleProvider {
  private readonly keys = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
    { timeoutDuration: 5000, cooldownDuration: 30000 },
  );
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' || url.hash || url.username || url.password)
      throw new Error('HTTPS callback required');
  }
  authorization(parameters: {
    state: string;
    nonce: string;
    challenge: string;
    reauthenticate?: boolean;
  }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state: parameters.state,
      nonce: parameters.nonce,
      code_challenge: parameters.challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(parameters.reauthenticate
        ? { claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }) }
        : {}),
    }).toString();
    return url.toString();
  }
  async exchange(code: string, verifier: string, nonce: string, authenticatedAfter?: number) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          code_verifier: verifier,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('id_token' in result) ||
        typeof result.id_token !== 'string'
      )
        throw new Error();
      // Access/refresh tokens are deliberately neither persisted nor returned.
      return await verifyGoogleToken(
        result.id_token,
        nonce,
        this.clientId,
        this.keys,
        authenticatedAfter,
      );
    } catch {
      throw new UnauthorizedException();
    }
  }
}
