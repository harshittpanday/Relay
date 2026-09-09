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
    const reloadOnUpdate = () => {
      if (isReloading) return;
      isReloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      reloadOnUpdate,
    );

    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      const offerUpdate = () => {
        const worker = registration.waiting;
        if (!worker) return;
        setUpdateReady(true);
        setApplyUpdate(() => () =>
          worker.postMessage({ type: 'SKIP_WAITING' }),
        );
      };

      offerUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate();
          }
        });
      });
    });

    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);

    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);

    return () => {
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
