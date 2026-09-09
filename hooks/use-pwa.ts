'use client';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePwa() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [applyUpdate, setApplyUpdate] = useState<() => void>(
    () => () => undefined,
  );
  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateReady(true),
    });
    setApplyUpdate(() => () => void update(true));
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);
  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };
  return {
    updateReady,
    applyUpdate,
    canInstall: Boolean(installPrompt),
    install,
  };
}
