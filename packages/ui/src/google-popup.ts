const marker = 'finanzas.google-reauth-popup';
const messageType = 'finanzas.google-reauth-return';
export interface GoogleReturn {
  state: string | null;
  code: string | null;
  error: boolean;
}

/** Only a non-sensitive routing marker is stored in the child tab. */
export function relayGoogleReturn(callback: GoogleReturn, host: Window = window): boolean {
  try {
    if (host.sessionStorage.getItem(marker) !== '1') return false;
    host.sessionStorage.removeItem(marker);
  } catch {
    return false;
  }
  if (host.opener) {
    host.opener.postMessage({ type: messageType, ...callback }, host.location.origin);
    host.close();
  }
  return true;
}

/** Call directly from a click handler, before awaiting the authorization URL. */
export function googleReauthentication(
  start: () => Promise<string>,
  signal: AbortSignal,
  host: Window = window,
): Promise<{ state: string; code: string }> {
  if (signal.aborted) return Promise.reject(new Error('La verificación se canceló.'));
  const popup = host.open('about:blank', '_blank', 'popup,width=520,height=720');
  if (!popup)
    return Promise.reject(new Error('Permite la ventana de Google y vuelve a intentarlo.'));
  try {
    popup.sessionStorage.setItem(marker, '1');
  } catch {
    popup.close();
    return Promise.reject(new Error('El navegador no permite abrir esta verificación.'));
  }
  return new Promise((resolve, reject) => {
    let state: string | null = null;
    let finished = false;
    const cleanup = () => {
      finished = true;
      host.removeEventListener('message', receive);
      signal.removeEventListener('abort', cancel);
      host.clearTimeout(timeout);
      host.clearInterval(closed);
      popup.close();
    };
    const fail = (message: string) => {
      if (finished) return;
      cleanup();
      reject(new Error(message));
    };
    const cancel = () => fail('La verificación se canceló.');
    const receive = (event: MessageEvent) => {
      if (event.origin !== host.location.origin || event.source !== popup || !state) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object') return;
      const value = data as Record<string, unknown>;
      if (value['type'] !== messageType || value['state'] !== state) return;
      if (value['error'] === true) return fail('Google no completó la verificación.');
      if (
        value['error'] !== false ||
        typeof value['code'] !== 'string' ||
        !value['code'].length ||
        value['code'].length > 4096
      )
        return fail('El retorno de Google no es válido.');
      cleanup();
      resolve({ state, code: value['code'] });
    };
    const timeout = host.setTimeout(
      () => fail('La verificación caducó. Vuelve a intentarlo.'),
      300000,
    );
    const closed = host.setInterval(() => {
      if (popup.closed) fail('La ventana de Google se cerró. Vuelve a intentarlo.');
    }, 500);
    host.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, { once: true });
    void start()
      .then((address) => {
        if (finished) return;
        const url = new URL(address);
        state = url.searchParams.get('state');
        if (url.origin !== 'https://accounts.google.com' || !state)
          return fail('No se pudo iniciar Google.');
        popup.location.replace(url.href);
      })
      .catch(() => fail('No se pudo iniciar Google. Comprueba tu sesión y vuelve a intentarlo.'));
  });
}
