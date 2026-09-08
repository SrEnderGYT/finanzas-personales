import { expect, it } from 'vitest';
import { createNativeProof, pkceChallenge } from '../packages/shared/src/native-pkce';

it('matches the RFC 7636 S256 example and rejects invalid verifiers', async () => {
  expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  for (const bad of ['', 'a'.repeat(42), 'a'.repeat(129), ' '.repeat(43), 'é'.repeat(43)])
    await expect(pkceChallenge(bad)).rejects.toThrow('Invalid PKCE');
});

it('creates independent state and verifier and exposes only S256 as the method', async () => {
  const proofs = await Promise.all(Array.from({ length: 20 }, () => createNativeProof()));
  expect(new Set(proofs.flatMap((proof) => [proof.state, proof.verifier])).size).toBe(40);
  for (const proof of proofs) {
    expect(proof.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.challenge).toBe(await pkceChallenge(proof.verifier));
    expect(proof.challenge).not.toBe(proof.verifier);
    expect(proof.method).toBe('S256');
  }
});
