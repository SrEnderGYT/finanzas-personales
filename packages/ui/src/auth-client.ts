import { nativeGoogleFlow } from '../../shared/src/native-google-flow';
import { nativeAuthHttp } from '../../shared/src/native-auth-http';

export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

/** Tokens live only in this instance, never in browser storage or URLs. */
export class AuthClient {
  static forNativeServer(apiOrigin: string, transport: typeof fetch = fetch) {
    return new AuthClient(true, nativeAuthHttp(apiOrigin, transport));
  }
  private token: string | undefined;
  private challenge: string | undefined;
  get mfaPending() {
    return this.challenge !== undefined;
  }
  cancelMfa() {
    this.challenge = undefined;
  }
  constructor(
    readonly enabled: boolean,
    private readonly transport: typeof fetch = (...args) => fetch(...args),
  ) {}
  get signedIn() {
    return this.token !== undefined;
  }
  private async request(
    path: string,
    method: string,
    body?: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.enabled)
      throw new Error('El acceso aún no está habilitado en esta vista de muestra.');
    let response: Response;
    try {
      response = await this.transport(`/v1/auth/${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('No pudimos conectar. Comprueba tu conexión y vuelve a intentarlo.');
    }
    if (!response.ok) {
      if (response.status === 401) this.token = undefined;
      throw new Error(
        response.status === 504
          ? 'No pudimos conectar. Comprueba tu conexión y vuelve a intentarlo.'
          : response.status === 429
            ? 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.'
            : response.status === 409
              ? 'Esta cuenta necesita vincularse desde una sesión ya iniciada.'
              : response.status === 401
                ? 'Los datos no son válidos o la sesión ha caducado.'
                : response.status === 503
                  ? 'El servicio de acceso no está disponible todavía.'
                  : 'No se pudo completar. Revisa los datos e inténtalo de nuevo.',
      );
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new Error('El servicio devolvió una respuesta no válida.');
    }
  }
  private acceptSession(value: unknown) {
    if (
      value &&
      typeof value === 'object' &&
      'mfaRequired' in value &&
      value.mfaRequired === true &&
      'challenge' in value &&
      typeof value.challenge === 'string' &&
      /^fpm_[A-Za-z0-9_-]{43}$/.test(value.challenge)
    ) {
      this.token = undefined;
      this.challenge = value.challenge;
      return;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('token' in value) ||
      typeof value.token !== 'string' ||
      !/^fp_[A-Za-z0-9_-]{43}$/.test(value.token)
    )
      throw new Error('El servicio devolvió una respuesta de acceso no válida.');
    this.token = value.token;
    this.challenge = undefined;
  }
  async beginMfa(password: string): Promise<string> {
    const proof = await this.request('reauthenticate/password', 'POST', { password });
    return this.beginMfaWithProof(proof);
  }
  async beginMfaGoogle(state: string, code: string): Promise<string> {
    if (!this.token) throw new Error('Vuelve a entrar antes de activar el autenticador.');
    const proof = await this.request('google/complete', 'POST', { state, code });
    if (
      !proof ||
      typeof proof !== 'object' ||
      !('reauthenticated' in proof) ||
      proof.reauthenticated !== true
    )
      throw new Error('No se pudo verificar tu identidad.');
    return this.beginMfaWithProof(proof);
  }
  private async beginMfaWithProof(proof: unknown): Promise<string> {
    if (
      !proof ||
      typeof proof !== 'object' ||
      !('grant' in proof) ||
      typeof proof.grant !== 'string' ||
      !/^fpr_[A-Za-z0-9_-]{43}$/.test(proof.grant)
    )
      throw new Error('No se pudo verificar tu identidad.');
    const setup = await this.request('mfa/enrollment/start', 'POST', { grant: proof.grant });
    if (
      !setup ||
      typeof setup !== 'object' ||
      !('secret' in setup) ||
      typeof setup.secret !== 'string' ||
      !/^[A-Z2-7]{32}$/.test(setup.secret)
    )
      throw new Error('No se pudo preparar el autenticador.');
    return setup.secret;
  }
  async confirmMfa(code: string): Promise<string[]> {
    if (!/^[0-9]{6}$/.test(code)) throw new Error('Introduce seis dígitos.');
    const response = await this.request('mfa/enrollment/confirm', 'POST', { code });
    this.token = undefined;
    this.challenge = undefined;
    if (
      !response ||
      typeof response !== 'object' ||
      !('recoveryCodes' in response) ||
      !Array.isArray(response.recoveryCodes) ||
      response.recoveryCodes.length !== 10 ||
      response.recoveryCodes.some(
        (c) => typeof c !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/.test(c),
      )
    )
      throw new Error('No recibimos los códigos. Vuelve a entrar con tu autenticador.');
    return response.recoveryCodes as string[];
  }
  async recoverMfa(code: string) {
    if (!this.challenge || !/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/i.test(code))
      throw new Error('Introduce un código de recuperación completo, con sus guiones.');
    this.acceptSession(
      await this.request('mfa/recover', 'POST', { challenge: this.challenge, code }),
    );
  }
  async completeMfa(code: string) {
    if (!this.challenge || !/^\d{6}$/.test(code))
      throw new Error('Introduce los seis dígitos del autenticador.');
    this.acceptSession(
      await this.request('mfa/complete', 'POST', { challenge: this.challenge, code }),
    );
  }
  async login(email: string, password: string) {
    this.acceptSession(await this.request('login', 'POST', { email, password }));
  }
  async requestEmail(kind: 'register' | 'forgot-password', email: string) {
    await this.request(kind, 'POST', { email });
  }
  async completeEmail(kind: 'verify-email' | 'reset-password', token: string, password: string) {
    await this.request(kind, 'POST', { token, password });
    this.token = undefined;
  }
  async sessions(): Promise<AuthSession[]> {
    const value = await this.request('sessions', 'GET');
    if (
      !Array.isArray(value) ||
      value.length > 10 ||
      value.some((row: unknown) => {
        if (!row || typeof row !== 'object') return true;
        const fields = row as Record<string, unknown>;
        return (
          typeof fields['id'] !== 'string' ||
          !/^[a-f0-9-]{36}$/i.test(fields['id']) ||
          typeof fields['current'] !== 'boolean' ||
          ['createdAt', 'lastSeenAt', 'expiresAt'].some(
            (key) => typeof fields[key] !== 'string' || !Number.isFinite(Date.parse(fields[key])),
          )
        );
      })
    )
      throw new Error('No se pudo leer la lista de sesiones.');
    return value as AuthSession[];
  }
  async revoke(session: AuthSession) {
    await this.request(`sessions/${encodeURIComponent(session.id)}`, 'DELETE');
    if (session.current) this.token = undefined;
  }
  async logout(all = false) {
    // On network failure keep the token so remote revocation can be retried.
    await this.request(all ? 'sessions' : 'logout', all ? 'DELETE' : 'POST');
    this.token = undefined;
  }
  async google(mode: 'login' | 'link' | 'reauthenticate'): Promise<string> {
    if (mode === 'reauthenticate' && !this.token)
      throw new Error('Vuelve a entrar antes de activar el autenticador.');
    const value = await this.request('google/start', 'POST', { mode });
    if (
      !value ||
      typeof value !== 'object' ||
      !('authorizationUrl' in value) ||
      typeof value.authorizationUrl !== 'string'
    )
      throw new Error('No se pudo iniciar Google.');
    const url = new URL(value.authorizationUrl);
    if (
      url.origin !== 'https://accounts.google.com' ||
      url.pathname !== '/o/oauth2/v2/auth' ||
      url.username ||
      url.password
    )
      throw new Error('La dirección de acceso no es válida.');
    return url.href;
  }
  async completeGoogle(state: string, code: string) {
    this.acceptSession(await this.request('google/complete', 'POST', { state, code }));
  }
  async nativeGoogle(options: Omit<Parameters<typeof nativeGoogleFlow>[0], 'transport'>) {
    this.acceptSession(await this.nativeGoogleResult(options, 'start'));
  }
  async linkNativeGoogle(options: Omit<Parameters<typeof nativeGoogleFlow>[0], 'transport'>) {
    const original = this.token;
    if (!original) throw new Error('Vuelve a entrar antes de vincular Google.');
    const result = await this.nativeGoogleResult(options, 'link');
    if (
      this.token !== original ||
      !result ||
      typeof result !== 'object' ||
      !('linked' in result) ||
      result.linked !== true
    )
      throw new Error('No se pudo vincular Google.');
  }
  async beginMfaNativeGoogle(
    options: Omit<Parameters<typeof nativeGoogleFlow>[0], 'transport'>,
  ): Promise<string> {
    const original = this.token;
    if (!original) throw new Error('Vuelve a entrar antes de activar el autenticador.');
    const proof = await this.nativeGoogleResult(options, 'reauthenticate');
    if (
      this.token !== original ||
      !proof ||
      typeof proof !== 'object' ||
      !('reauthenticated' in proof) ||
      proof.reauthenticated !== true
    )
      throw new Error('No se pudo verificar tu identidad.');
    return this.beginMfaWithProof(proof);
  }
  private async nativeGoogleResult(
    options: Omit<Parameters<typeof nativeGoogleFlow>[0], 'transport'>,
    mode: 'start' | 'reauthenticate' | 'link',
  ) {
    if (!this.enabled)
      throw new Error('El acceso aún no está habilitado en esta vista de muestra.');
    return nativeGoogleFlow({
      ...options,
      transport: {
        start: async (input, signal) => {
          const result = await this.request(`google/native/${mode}`, 'POST', input, signal);
          if (
            !result ||
            typeof result !== 'object' ||
            !('authorizationUrl' in result) ||
            typeof result.authorizationUrl !== 'string'
          )
            throw new Error('No se pudo iniciar Google.');
          return result.authorizationUrl;
        },
        complete: (input, signal) => this.request('google/native/complete', 'POST', input, signal),
      },
    });
  }
}
