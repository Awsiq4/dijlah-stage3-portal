"use client";

import {createContext, useContext, useEffect, useState, type ReactNode} from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<{outcome: "accepted" | "dismissed"}>;
};

const InstallationContext = createContext({
  installed: false,
  canInstall: false,
  install: async () => {},
});

export function usePortalInstallation() {
  return useContext(InstallationContext);
}

export function PortalInstallation({children}: {children: ReactNode}) {
  const [request, setRequest] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [installedHere, setInstalledHere] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const navigatorWithStandalone = navigator as Navigator & {standalone?: boolean};
    const updateDisplayMode = () => setStandalone(displayMode.matches || navigatorWithStandalone.standalone === true);
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setRequest(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalledHere(true);
      setRequest(null);
    };

    updateDisplayMode();
    displayMode.addEventListener("change", updateDisplayMode);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      displayMode.removeEventListener("change", updateDisplayMode);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installed = standalone || installedHere;
  async function install() {
    if (!request || installed) return;
    setRequest(null);
    try {
      await request.prompt();
    } catch {
      // The manual instructions stay available if the browser declines the request.
    }
  }

  return (
    <InstallationContext.Provider value={{installed, canInstall: request !== null && !installed, install}}>
      {children}
    </InstallationContext.Provider>
  );
}
