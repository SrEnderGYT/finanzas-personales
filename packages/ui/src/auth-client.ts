import type { CorrectionApi } from '../../shared/src/correction-queue';
import { nativeGoogleFlow } from '../../shared/src/native-google-flow';
import { nativeAuthHttp } from '../../shared/src/native-auth-http';
import { SyncHttpError, validatePage, type SyncApi } from '../../shared/src/sync-engine';
import type { ManualReceipt } from '../../shared/src/manual-outbox';
import {
  identifier,
  normalizeMovementVersion,
  instant,
  closed,
  currency,
  catalogName,
  type ManualCatalog,
} from '../../domain/src';

export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}
function catalogVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value))
    throw new Error('Versión de catálogo inválida.');
  return value;
}

/** Tokens live only in this instance, never in browser storage or URLs. */
export class AuthClient {
  private verifiedOwner: string | undefined;
  canUseOwner(ownerId: string) {
    return !!this.token && this.verifiedOwner === ownerId;
  }
  expireSession() {
    this.token = undefined;
  }
  private async productRequest(
    ownerId: string,
    path: string,
    method: string,
    signal: AbortSignal,
    body?: unknown,
    allowConflict = false,
  ) {
    if (!this.enabled || !this.token || this.verifiedOwner !== ownerId)
      throw new SyncHttpError(401, 'SESSION_REQUIRED');
    const token = this.token;
    const response = await this.transport(path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    if (token !== this.token || this.verifiedOwner !== ownerId)
      throw new SyncHttpError(401, 'SESSION_CHANGED');
    const data: unknown = await response.json().catch(() => null);
    if (
      !response.ok &&
      !(
        allowConflict &&
        response.status === 409 &&
        data &&
        typeof data === 'object' &&
        'local' in data
      )
    ) {
      const error =
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string' &&
        /^[A-Z_]{1,80}$/.test(data.error)
          ? data.error
          : 'REQUEST_FAILED';
      throw new SyncHttpError(response.status, error);
    }
    return data;
  }
  correctionApi(ownerId: string): CorrectionApi {
    return {
      current: async (rootId, signal) =>
        normalizeMovementVersion(
          await this.productRequest(
            ownerId,
            '/v1/sync/movements/' + identifier(rootId),
            'GET',
            signal,
          ),
          { now: () => new Date() },
        ),
      execute: (command, signal) =>
        this.productRequest(ownerId, '/v1/sync/corrections', 'POST', signal, command, true),
    };
  }
  syncApi(ownerId: string): SyncApi {
    const send = (path: string, method: string, signal: AbortSignal, body?: unknown) =>
      this.productRequest(ownerId, path, method, signal, body);
    return {
      send: async (command, signal) => {
        const data = await send('/v1/sync/commands', 'POST', signal, command);
        closed(data, ['status', 'receipt']);
        if (data['status'] !== 'applied' && data['status'] !== 'already_applied')
          throw new Error('Invalid sync status');
        return { status: data['status'], receipt: data['receipt'] as ManualReceipt };
      },
      pull: async (cursor, signal) =>
        validatePage(
          await send(
            '/v1/sync/changes?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
            'GET',
            signal,
          ),
        ),
    };
  }
  static forNativeServer(apiOrigin: string, transport: typeof fetch = fetch) {
    return new AuthClient(true, nativeAuthHttp(apiOrigin, transport), apiOrigin);
  }
  private sessionToken: string | undefined;
  private readonly localLocks = new Set<() => void>();
  private get token() {
    return this.sessionToken;
  }
  private set token(value: string | undefined) {
    if (value !== this.sessionToken) {
      this.sessionToken = value;
      this.verifiedOwner = undefined;
      for (const lock of this.localLocks) lock();
    }
  }
  onSessionChange(lock: () => void) {
    this.localLocks.add(lock);
    return () => this.localLocks.delete(lock);
  }
  async manualCatalog(): Promise<{ ownerId: string; catalog: ManualCatalog }> {
    const token = this.token;
    if (!this.enabled || !token) throw new Error('Inicia sesión para descargar tus cuentas.');
    const get = async (path: string) => {
      const response = await this.transport(path, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401) this.token = undefined;
      if (!response.ok)
        throw new Error('No se pudo descargar el catálogo. Conservamos la copia anterior.');
      return response.json() as Promise<unknown>;
    };
    const me = await get('/v1/me');
    if (!me || typeof me !== 'object' || !('id' in me)) throw new Error('Identidad inválida.');
    const ownerId = identifier(me.id as string);
    const pages = async (path: string) => {
      const items: Record<string, unknown>[] = [],
        seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const data = await get(
          path + '?state=all&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        closed(data, ['items', 'nextCursor']);
        if (
          !Array.isArray(data['items']) ||
          data['items'].length > 100 ||
          items.length + data['items'].length > 10000
        )
          throw new Error('Catálogo inválido.');
        for (const row of data['items']) {
          if (!row || typeof row !== 'object') throw new Error('Catálogo inválido.');
          items.push(row as Record<string, unknown>);
        }
        cursor = data['nextCursor'] as string | null;
        if (
          cursor !== null &&
          (typeof cursor !== 'string' || cursor.length > 80 || seen.has(cursor))
        )
          throw new Error('Paginación inválida.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    };
    const accounts = (await pages('/v1/accounts')).map<ManualCatalog['accounts'][number]>((a) => {
      if (a['state'] !== 'active' && a['state'] !== 'inactive') throw new Error('Cuenta inválida.');
      return {
        id: identifier(a['id'] as string),
        version: catalogVersion(a['version']),
        name: catalogName(a['name']),
        currency: currency(a['currency']),
        state: a['state'],
      };
    });
    const categories = (await pages('/v1/categories')).map<ManualCatalog['categories'][number]>(
      (c) => {
        if (
          (c['state'] !== 'active' && c['state'] !== 'archived') ||
          (c['kind'] !== 'expense' && c['kind'] !== 'income')
        )
          throw new Error('Categoría inválida.');
        return {
          id: identifier(c['id'] as string),
          version: catalogVersion(c['version']),
          name: catalogName(c['name']),
          kind: c['kind'],
          state: c['state'],
        };
      },
    );
    if (
      new Set(accounts.map((a) => a.id)).size !== accounts.length ||
      new Set(categories.map((c) => c.id)).size !== categories.length
    )
      throw new Error('El catálogo cambió durante la descarga; vuelve a intentar.');
    if (this.token !== token) throw new Error('La sesión cambió durante la descarga.');
    this.verifiedOwner = ownerId;
    return {
      ownerId,
      catalog: { accounts, categories, downloadedAt: instant(new Date().toISOString()) },
    };
  }
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
    readonly catalogEnvironment: string = 'same-origin',
    readonly privateStaging = false,
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
