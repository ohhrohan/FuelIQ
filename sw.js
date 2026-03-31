/**
 * FuelIQ Service Worker — sw.js
 *
 * This file runs in the background, separate from the main page.
 * Its job: intercept network requests and serve cached files so
 * the app works even when the user is offline (e.g., at a petrol station).
 *
 * Strategy used: "Cache-First, then Network"
 * 1. When the app first loads, we cache all key assets (INSTALL).
 * 2. On every subsequent request, we check the cache first (FETCH).
 * 3. If the cache is stale and network is available, we update it.
 */

'use strict';

// ── Cache name — bump this version to force a cache refresh ──
const CACHE_NAME = 'fueliq-v1.0.0';

// ── Files to cache on install ──
// These are the minimum assets needed to run the app offline.
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  // Fonts — Google Fonts CDN (cached on first visit)
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Sora:wght@300;400;600;700&display=swap',
];

// ═══════════════════════════════════════════════
// INSTALL EVENT — runs once when SW is first registered
// ═══════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[FuelIQ SW] Installing…');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[FuelIQ SW] Caching core assets');
        // addAll fetches each URL and stores response in cache
        // Note: if any single fetch fails, the whole install fails —
        // so only include reliable URLs here.
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Force this SW to become active immediately,
        // rather than waiting for old tabs to close.
        return self.skipWaiting();
      })
  );
});

// ═══════════════════════════════════════════════
// ACTIVATE EVENT — runs after install, cleans up old caches
// ═══════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[FuelIQ SW] Activating…');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            // Delete any old caches from previous app versions
            console.log('[FuelIQ SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // Take control of all open clients (tabs) immediately
      return self.clients.claim();
    })
  );
});

// ═══════════════════════════════════════════════
// FETCH EVENT — intercepts every network request
// ═══════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  // Only handle GET requests — don't intercept POST, etc.
  if (event.request.method !== 'GET') return;

  // Skip browser-extension and non-http requests
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {

        if (cachedResponse) {
          // ── CACHE HIT: Return immediately, then update in background ──
          // This is the "stale-while-revalidate" pattern:
          // User gets a fast response, and we quietly refresh the cache.
          const networkFetch = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const cloned = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
              }
              return networkResponse;
            })
            .catch(() => { /* offline — that's fine, cache already returned */ });

          return cachedResponse; // Return cache immediately
        }

        // ── CACHE MISS: Fetch from network, cache for next time ──
        return fetch(event.request)
          .then((networkResponse) => {
            // Only cache successful responses
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
              return networkResponse;
            }

            // Clone the response — we need to both cache it AND return it
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cloned);
            });

            return networkResponse;
          })
          .catch(() => {
            // ── OFFLINE + NOT CACHED: Return fallback ──
            // For navigation requests (page loads), return the cached index.html
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // For other resources, just let it fail gracefully
            return new Response('Offline — resource not cached', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            });
          });
      })
  );
});

// ═══════════════════════════════════════════════
// MESSAGE HANDLER — allows the app to send commands to the SW
// ═══════════════════════════════════════════════
self.addEventListener('message', (event) => {
  // App can send { type: 'SKIP_WAITING' } to force immediate update
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
