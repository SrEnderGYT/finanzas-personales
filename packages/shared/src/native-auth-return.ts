export interface NativeAuthResult {
  state: string;
  code: string;
}

/** Correlates a claimed HTTPS app link. Never accepts a session token from a URL. */
export class NativeAuthReturn {
  private pending: { state: string; expires: number } | undefined;
  private readonly destination: URL;
  constructor(
    redirectUri: string,
    private readonly now: () => number = Date.now,
  ) {
    const url = new URL(redirectUri);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === '/' ||
      url.port
    )
      throw new Error('Native auth requires a fixed HTTPS app link.');
    this.destination = url;
  }

  begin(state: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Invalid auth state.');
    if (this.pending && this.pending.expires > this.now())
      throw new Error('An authentication request is already pending.');
    this.pending = { state, expires: this.now() + 300000 };
  }

  cancel() {
    this.pending = undefined;
  }
  get waiting() {
    return this.pending !== undefined;
  }

  consume(address: string): NativeAuthResult | null {
    const pending = this.pending;
    if (!pending) return null;
    if (this.now() >= pending.expires) {
      this.cancel();
      return null;
    }
    if (address.length > 8192) return null;
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return null;
    }
    if (
      url.origin !== this.destination.origin ||
      url.pathname !== this.destination.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== pending.state
    )
      return null;
    // A correlated response consumes the attempt even if denied/malformed.
    this.cancel();
    if (
      [...url.searchParams.keys()].some((key) => key !== 'state' && key !== 'code') ||
      url.searchParams.getAll('code').length !== 1
    )
      return null;
    const code = url.searchParams.get('code')!;
    if (
      !code.length ||
      code.length > 4096 ||
      [...code].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
    )
      return null;
    return { state: pending.state, code };
  }
}
