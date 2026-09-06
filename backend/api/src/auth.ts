import { UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface IdentityVerifier {
  verify(authorization: string | undefined): Promise<string>;
}
/** Trust only a configured issuer, audience, key and algorithm; never an HTTP user_id. */
export class JwtIdentityVerifier implements IdentityVerifier {
  private readonly keys;
  constructor(
    jwks: JSONWebKeySet,
    private readonly issuer: string,
    private readonly audience: string,
  ) {
    if (!jwks.keys.length || jwks.keys.some((key) => key['d'] || key['k']))
      throw new Error('Public asymmetric verification keys required');
    this.keys = createLocalJWKSet(jwks);
  }
  async verify(authorization: string | undefined): Promise<string> {
    try {
      if (!authorization || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) throw new Error();
      const { payload } = await jwtVerify(authorization.slice(7), this.keys, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'iat', 'exp'],
        maxTokenAge: '5m',
        clockTolerance: 5,
      });
      if (!payload.sub || !UUID.test(payload.sub)) throw new Error();
      return payload.sub;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
export const denyIdentity: IdentityVerifier = {
  verify: async () => {
    throw new UnauthorizedException();
  },
};
