// Service worker di MoodMovie: mette in cache solo la shell statica dell'app
// (HTML, manifest, icone, splash) cosi l'app si installa ed e resiliente offline.
// Le chiamate a TMDB, alle immagini dei poster e ai player (vixsrc/vidsrc) restano
// sempre in rete: sono dati dinamici o cross-origin, non ha senso metterli in cache.
const CACHE_NAME = 'moodmovie-shell-v16';
const SHELL_ASSETS = [
    './',
    './index.html',
    './cloud.js',
    './manifest.json',
    './icon.png',
    './splash.mp4',
    './splash_poster.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // lascia passare tutto ciò che non è la shell dell'app

    // Apertura/ricarica dell'app: prova la rete (per avere sempre l'ultima versione),
    // cade sulla shell in cache solo se offline.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Altri asset della shell: cache prima (avvio istantaneo), rete come fallback/aggiornamento in background
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                return res;
            });
        })
    );
});

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
