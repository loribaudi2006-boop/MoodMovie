// Service worker di MoodMovie: tiene una copia della shell dell'app per
// aprirla subito, anche con rete assente o che non risponde. Il player resta
// sempre in rete. v30: le copertine TMDB (fino a w780) si tengono in una cache
// a tetto fisso: niente riscaricamenti (meno dati mobili) e libreria visibile offline.
const CACHE_NAME = 'moodmovie-shell-v51';
const IMG_CACHE = 'moodmovie-img-v1';
const IMG_MAX_ITEMS = 250;      // ~15-25 MB al massimo, poi si buttano le piu' vecchie
let imgPuts = 0, apiPuts = 0;
const API_CACHE = 'moodmovie-api-v1';
const API_MAX_AGE = 24 * 3600 * 1000;
const API_MAX_ITEMS = 260;
const FONT_CACHE = 'moodmovie-fonts-v1';
const SHELL_ASSETS = [
    './', './index.html', './cloud.js', './realtime.js', './manifest.json', './icon.png',
    './icons/icon-192.png', './icons/logo-96.png', './icons/logo-sign.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const NET_TIMEOUT_MS = 3000;
const DEAD_NET_MS = 15000;
let netDeadUntil = 0;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => Promise.all(SHELL_ASSETS.map((f) => cache.add(f).catch(() => {}))))
            .catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            for (const f of SHELL_ASSETS) {
                if (await cache.match(f)) continue;
                const old = await caches.match(f);
                if (old) await cache.put(f, old);
            }
        } catch (e) { /* best effort */ }
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n !== CACHE_NAME && n !== FONT_CACHE && n !== API_CACHE && n !== IMG_CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

function savedCopy(req) {
    return caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return undefined;
    });
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('/font-awesome/'))) {
        event.respondWith((async () => {
            const cache = await caches.open(FONT_CACHE);
            const cached = await cache.match(req);
            const network = fetch(req).then((res) => {
                if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
                return res;
            });
            if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
            return network;
        })());
        return;
    }
    // TMDB: la risposta salvata arriva subito (avvio istantaneo), quella nuova
    // si scarica in background e sara' pronta la volta dopo
    if (url.hostname === 'api.themoviedb.org') {
        event.respondWith((async () => {
            const cache = await caches.open(API_CACHE);
            const hit = await cache.match(req);
            const fresh = hit && (Date.now() - Number(hit.headers.get('x-mm-time') || 0)) < API_MAX_AGE;
            const net = fetch(req).then(async (res) => {
                if (res && res.ok) {
                    const body = await res.clone().blob();
                    const headers = new Headers(res.headers);
                    headers.set('x-mm-time', String(Date.now()));
                    await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
                    const keys = (++apiPuts % 10) ? [] : await cache.keys();
                    if (keys.length > API_MAX_ITEMS) await Promise.all(keys.slice(0, keys.length - API_MAX_ITEMS).map((k) => cache.delete(k)));
                }
                return res;
            });
            if (fresh) { event.waitUntil(net.catch(() => {})); return hit; }
            try { return await net; } catch (e) { if (hit) return hit; throw e; }
        })());
        return;
    }
    // copertine: prima la copia salvata (le immagini TMDB non cambiano mai)
    if (url.hostname === 'image.tmdb.org') {
        const m = url.pathname.match(/^\/t\/p\/w(\d+)\//);
        if (!m || Number(m[1]) > 780) return; // immagini enormi: solo rete, mai salvate
        event.respondWith((async () => {
            const cache = await caches.open(IMG_CACHE);
            const hit = await cache.match(url.href);
            if (hit) return hit;
            try {
                const res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
                if (res && res.ok && (res.type === 'cors' || res.type === 'basic')) event.waitUntil(cache.put(url.href, res.clone()).then(trimImages).catch(() => {}));
                return res;
            } catch (e) {
                return fetch(req);
            }
        })());
        return;
    }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.endsWith('.mp4')) return;
    event.respondWith((async () => {
        const network = fetch(req).then((res) => {
            netDeadUntil = 0;
            if (res && res.status === 200) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return res;
        });
        event.waitUntil(network.catch(() => {}));
        if ((self.navigator && self.navigator.onLine === false) || Date.now() < netDeadUntil) {
            const cached = await savedCopy(req);
            if (cached) return cached;
        }
        let timer;
        const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), NET_TIMEOUT_MS); });
        const first = await Promise.race([network.catch(() => 'failed'), timedOut]);
        clearTimeout(timer);
        if (first !== 'timeout' && first !== 'failed') return first;
        netDeadUntil = Date.now() + DEAD_NET_MS;
        const cached = await savedCopy(req);
        if (cached) return cached;
        return network.catch(() => Response.error());
    })());
});

async function trimImages() {
    if (++imgPuts % 20) return;
    const cache = await caches.open(IMG_CACHE);
    const keys = await cache.keys();
    if (keys.length > IMG_MAX_ITEMS) await Promise.all(keys.slice(0, keys.length - IMG_MAX_ITEMS).map((k) => cache.delete(k)));
}

// ── NOTIFICHE PUSH "titolo disponibile" ──
// Arriva dalla Edge Function Supabase "check-upcoming" quando un titolo seguito si sblocca
// (vedi supabase/functions/check-upcoming/index.ts). Mostra la notifica di sistema anche ad app chiusa.
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'MoodMovie', body: event.data ? event.data.text() : '' }; }
    const title = data.title || 'MoodMovie';
    // La Edge Function puo' inoltrare i campi cosi' come sono salvati su Supabase (snake_case,
    // es. tmdb_id/media_type) invece che nel formato camelCase usato lato client: normalizziamo
    // qui entrambe le varianti cosi' il click sulla notifica trova sempre l'id giusto.
    const tmdbId = data.tmdbId ?? data.tmdb_id ?? data.id;
    const mode = data.mode ?? data.media_type ?? data.type;
    const options = {
        body: data.body || '',
        icon: './icon.png',
        badge: './icon.png',
        data: { tmdbId, mode },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Click sulla notifica: se l'app è già aperta in una scheda la porta in primo piano e le chiede
// di aprire il titolo (tramite postMessage); altrimenti apre una nuova scheda con un parametro
// che index.html legge all'avvio per aprire subito il modal giusto.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const { tmdbId, mode } = event.notification.data || {};
    const targetUrl = self.registration.scope + 'index.html' + (tmdbId ? `?open=${mode}-${tmdbId}` : '');
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            for (const client of clientsArr) {
                if ('focus' in client) {
                    client.postMessage({ type: 'open-title', tmdbId, mode });
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});
