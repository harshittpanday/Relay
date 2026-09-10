'use client';
import { useEffect, useState } from 'react';

export function usePwa() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [applyUpdate, setApplyUpdate] = useState<() => void>(
    () => () => undefined,
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let isReloading = false;
    let disposed = false;
    let activeRegistration: ServiceWorkerRegistration | undefined;
    let updateFound: (() => void) | undefined;
    const reloadOnUpdate = () => {
      if (isReloading) return;
      isReloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      reloadOnUpdate,
    );

    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (disposed) return;
        activeRegistration = registration;
        const offerUpdate = () => {
          const worker = registration.waiting;
          if (!worker) return;
          setUpdateReady(true);
          setApplyUpdate(
            () => () => worker.postMessage({ type: 'SKIP_WAITING' }),
          );
        };

        offerUpdate();
        updateFound = () => {
          const worker = registration.installing;
          if (!worker) return;
          const stateChanged = () => {
            if (
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              offerUpdate();
            }
            if (worker.state === 'installed' || worker.state === 'redundant')
              worker.removeEventListener('statechange', stateChanged);
          };
          worker.addEventListener('statechange', stateChanged);
        };
        registration.addEventListener('updatefound', updateFound);
      })
      .catch((error) => {
        console.warn('[Relay PWA] Service worker registration failed', error);
      });

    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);

    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);

    return () => {
      disposed = true;
      if (activeRegistration && updateFound)
        activeRegistration.removeEventListener('updatefound', updateFound);
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        reloadOnUpdate,
      );
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return {
    updateReady,
    applyUpdate,
    canInstall: Boolean(installPrompt),
    install,
  };
}
