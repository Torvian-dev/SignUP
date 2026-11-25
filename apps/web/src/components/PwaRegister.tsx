"use client";
import { useEffect } from "react";

/** Registers the service worker (only works over https or localhost). Harmless where unsupported. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
