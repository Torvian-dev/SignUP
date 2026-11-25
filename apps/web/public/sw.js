// Minimal service worker: enables installability without caching dynamic/authed content.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Pass through to the network. No caching: this app is server-backed and auth-gated.
  event.respondWith(fetch(event.request).catch(() => new Response("Offline", { status: 503 })));
});
