import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

/**
 * Service worker for Rink Reports PWA.
 *
 * Caching strategy:
 *   - Static assets under /_next/static: cache-first, stale-while-revalidate
 *     (handled by Serwist's defaultCache)
 *   - API routes (including Stripe webhook, Supabase, server actions): never cached
 *   - HTML responses: network-first with short timeout, fall back to cache
 *
 * Offline queue sync is NOT run from the service worker in v1 — the client
 * component OfflineQueueBadge mounts startQueueSync() which polls + listens to
 * `online` events. A background sync event listener here could retry without an
 * open tab but isn't universally supported (Safari doesn't implement Background
 * Sync) and the simpler client polling covers 95% of cases.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
})

serwist.addEventListeners()
