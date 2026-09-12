(() => {
  const resetKey = 'finanzas-p17-cache-reset-v1';
  if (sessionStorage.getItem(resetKey) === 'done') return;

  window.addEventListener('load', async () => {
    try {
      let controlled = false;
      if ('serviceWorker' in navigator) {
        controlled = Boolean(navigator.serviceWorker.controller);
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => registration.scope.includes('/finanzas-personales/'))
            .map((registration) => registration.unregister()),
        );
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith('ngsw:') || name.includes('finanzas'))
            .map((name) => caches.delete(name)),
        );
      }
      sessionStorage.setItem(resetKey, 'done');
      if (controlled) location.replace(location.pathname + '?fresh=p17' + location.hash);
    } catch {
      sessionStorage.setItem(resetKey, 'done');
    }
  });
})();
