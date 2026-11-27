// Service worker: guarda o "casco" da interface para abrir offline.
// Ligações NÃO funcionam offline (precisam de internet): /api e /ws nunca passam pelo cache.
const VERSAO = 'interfone-v3';
const CASCO = [
  '/', '/morador/', '/portaria/',
  '/css/app.css', '/js/interfone.js', '/js/unidades.js', '/js/pwa.js', '/js/morador.js', '/js/portaria.js',
  '/manifest.json', '/manifest-portaria.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  if (req.mode === 'navigate') { // páginas: rede primeiro, cache se estiver offline
    e.respondWith(
      fetch(req).then(r => {
        const copia = r.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/morador/')))
    );
    return;
  }
  // arquivos estáticos: cache primeiro, atualiza em segundo plano
  e.respondWith(
    caches.match(req).then(emCache => {
      const rede = fetch(req).then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
        return r;
      }).catch(() => emCache);
      return emCache || rede;
    })
  );
});

// Clique na notificação de chamada: foca o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    if (cs.length) return cs[0].focus();
    return self.clients.openWindow('/morador/');
  }));
});
