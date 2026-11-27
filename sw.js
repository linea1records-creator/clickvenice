// ClickVenice: rende l'app installabile, la apre subito dalla memoria del telefono e tiene salvato ciò che a Venezia cambia di rado
// - app (index.html, immagini, dati fissi): dalla memoria; ogni nuova versione dell'app li riscarica tutti (cambia C)
// - libreria della mappa e mappa di base (OpenFreeMap): dalla memoria, scaricate una volta sola
// - dati lenti (canali, ponti, fondali, pontili, bricole, locali, negozi, civici): subito dalla memoria, aggiornati in sottofondo
// - tutto il resto (tabelloni, marea, voli, posizioni, ordini): sempre dalla rete
const C = "unclick-v205", LIB = "cv-lib-1", MAP = "cv-map-1", DATA = "cv-data-1";
const SHELL = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "logo.webp", "logo-mark.webp", "barketplace.webp", "logo-tab.png", "food-tab.png", "food-smoke.png", "food-logo.webp", "srv-phone.png", "srv-hand.png", "logo-word.webp", "ta-logo.webp", "catalogo-barche.json", "splash.jpg", "apple-touch-icon.png", "icon-maskable.png", "assist.json", "fermate.json", "velox.json", "cantieri.json", "stadio.json", "rotte-lavoro.json", "rive-diporto.json", "civici.json"];
const KEEP = [C, LIB, MAP, DATA];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => !KEEP.includes(x)).map(x => caches.delete(x)))).then(() => self.clients.claim())); });

const SLOW_DATI = /[?&]tipo=(canali|ponti|pontili|fondali|fondogrid|bricole|locali)\b/;
async function cacheFirst(cache, req){
  const c = await caches.open(cache), hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()).catch(() => {}); return r;
}
async function staleWhileRevalidate(cache, req, ev){
  const c = await caches.open(cache), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()).catch(() => {}); return r; });
  if (hit){ ev.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === location.origin){
    // l'app stessa: dalla memoria (nuova versione = nuovo service worker che riscarica tutto)
    if (req.mode === "navigate") { e.respondWith(caches.match("index.html", { cacheName: C }).then(r => r || fetch(req))); return; }
    const name = u.pathname.split("/").pop();
    if (SHELL.includes(name)) { e.respondWith(caches.open(C).then(c => c.match(name)).then(r => r || fetch(req))); return; }
    // altre pagine (es. strumenti): sempre la versione nuova se c'è rete
    if (/\.html$/.test(name)) { e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(DATA).then(c => c.put(req, cp)); return r; }).catch(() => caches.match(req))); return; }
    e.respondWith(staleWhileRevalidate(DATA, req, e)); return;
  }
  // libreria della mappa (MapLibre) da unpkg / cdnjs: la versione è nell'indirizzo, non cambia mai
  if (/^(unpkg\.com|cdnjs\.cloudflare\.com)$/.test(u.hostname) && /maplibre/.test(u.pathname)) { e.respondWith(cacheFirst(LIB, req)); return; }
  // mappa di base: stile e indice si aggiornano in sottofondo, tessere caratteri e icone restano salvate
  if (u.hostname === "tiles.openfreemap.org") {
    if (/\/styles\/|\/planet$|\.json$/.test(u.pathname)) e.respondWith(staleWhileRevalidate(MAP, req, e));
    else e.respondWith(cacheFirst(MAP, req));
    return;
  }
  // dati che cambiano di rado dal nostro server
  if (/supabase\.co$/.test(u.hostname) && ((/\/functions\/v1\/dati$/.test(u.pathname) && SLOW_DATI.test(u.search)) || /\/functions\/v1\/negozi$/.test(u.pathname))) { e.respondWith(staleWhileRevalidate(DATA, req, e)); return; }
});

// mappa di Venezia e della laguna salvata in anticipo (chiesta dall'app, di solito solo col Wi-Fi)
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const AREE = [
  { z: [8, 13], b: [11.95, 45.12, 12.80, 45.68] },   // tutta la laguna e dintorni
  { z: [14, 14], b: [12.15, 45.18, 12.62, 45.56] },
  { z: [15, 16], b: [12.28, 45.395, 12.45, 45.50] }  // centro storico, Giudecca, Lido nord, Murano, San Michele
];
let PRE = null;
async function tell(msg){ (await self.clients.matchAll({ includeUncontrolled: true })).forEach(c => c.postMessage(msg)); }
async function precacheMap(style){
  if (PRE) return; PRE = { fatte: 0, tot: 0 };
  try{
    const c = await caches.open(MAP), urls = new Set([style]);
    const st = await (await cacheFirst(MAP, new Request(style))).clone().json();
    if (st.sprite) [".json", ".png", "@2x.json", "@2x.png"].forEach(x => urls.add(st.sprite + x));
    if (st.glyphs) { const fonts = new Set(); (st.layers || []).forEach(l => ((l.layout || {})["text-font"] || []).forEach(f => typeof f === "string" && fonts.add(f)));
      fonts.forEach(f => ["0-255", "256-511", "8192-8447"].forEach(r => urls.add(st.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r)))); }
    for (const s of Object.values(st.sources || {})) {
      let tiles = s.tiles; if (!tiles && s.url) { const tj = await (await cacheFirst(MAP, new Request(s.url))).clone().json(); tiles = tj.tiles; urls.add(s.url); }
      if (!tiles || !tiles[0]) continue; const t = tiles[0], maxz = s.maxzoom || 14;
      AREE.forEach(a => { for (let z = a.z[0]; z <= Math.min(a.z[1], maxz); z++) {
        for (let x = lon2x(a.b[0], z); x <= lon2x(a.b[2], z); x++) for (let y = lat2y(a.b[3], z); y <= lat2y(a.b[1], z); y++) urls.add(t.replace("{z}", z).replace("{x}", x).replace("{y}", y)); } });
    }
    const L = [...urls]; PRE.tot = L.length; let i = 0, ultimo = 0;
    const lavora = async () => { while (i < L.length) { const u = L[i++];
      try { if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) await c.put(u, r); } } catch (_) {}
      PRE.fatte++; if (Date.now() - ultimo > 1500) { ultimo = Date.now(); tell({ t: "precache", fatte: PRE.fatte, tot: PRE.tot }); } } };
    await Promise.all(Array.from({ length: 6 }, lavora));
    tell({ t: "precache", fatte: PRE.tot, tot: PRE.tot, fine: true });
  } catch (err) { tell({ t: "precache", errore: String(err) }); }
  PRE = null;
}
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.t === "precache" && d.style) e.waitUntil(precacheMap(d.style));
  if (d.t === "precache-data" && Array.isArray(d.urls)) e.waitUntil(caches.open(DATA).then(c => Promise.all(d.urls.map(u => c.match(u).then(h => h || fetch(u).then(r => r.ok && c.put(u, r))).catch(() => {})))));
  if (d.t === "svuota") e.waitUntil(Promise.all([LIB, MAP, DATA].map(n => caches.delete(n))).then(() => tell({ t: "svuotato" })));
});

self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "clickVenice", {
    body: d.body || "", tag: d.tag || "unclick", renotify: true,
    icon: "icon-192.png", badge: "icon-192.png",
    data: { url: d.url || "./index.html" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const u = (e.notification.data && e.notification.data.url) || "./index.html";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { c.navigate && c.navigate(u); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(u);
  }));
});
