import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
// Laguna Nav — dati pubblici preparati dal server e tenuti in cache
// ?tipo=canali  → rete dei canali OpenStreetMap (30 giorni)
// ?tipo=locali  → ristoranti, bar, fast food OpenStreetMap (7 giorni)
// ?tipo=marea   → livello di marea attuale (Comune di Venezia, 5 minuti; se il Comune blocca, stima dalla previsione ufficiale)
// ?tipo=previsione → previsione di marea delle prossime ore (Comune di Venezia, 30 minuti)
// ?tipo=ponti   → ponti sui canali (OpenStreetMap, 30 giorni)
// ?tipo=pontili → pontili pubblici del Comune (lista ufficiale, 30 giorni)
// ?tipo=fondali → profondità dalla mappa del Comune agganciata alle coordinate (preparata una volta)
// Se l'aggiornamento non riesce, restituisce comunque l'ultima copia salvata.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'LagunaNav/0.8 (navigatore laguna di Venezia)';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PONTILI_XLS = 'https://www.comune.venezia.it/sites/default/files/flex/files/D.6f2955060d6230c48a2d/lista_pontili_comunali_per_internet.xls';
const CB = '45.36,12.20,45.53,12.48', PB = '45.38,12.20,45.53,12.45';
const MAREA_URLS = ['https://dati.venezia.it/sites/default/files/dataset/opendata/livello.json'];
const PREV_URLS = ['https://dati.venezia.it/sites/default/files/dataset/opendata/previsione.json'];

type Kind = { days: number; min: number; fetch: (log: string[]) => Promise<any> };

async function overpass(q: string, build: (j: any) => any, min: number, log: string[]) {
  for (const u of MIRRORS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { Accept: '*/*', 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(42000) });
      if (!r.ok) { log.push(u + ' ' + r.status); continue; }
      const pack = build(await r.json());
      if (pack.size >= min) return pack;
      log.push(u + ' pochi dati ' + pack.size);
    } catch (e) { log.push(u + ' ' + String(e)); }
  }
  return null;
}
function num(v: unknown) { const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; }

const KINDS: Record<string, Kind> = {
  canali: {
    days: 30, min: 50,
    fetch: (log) => overpass(`[out:json][timeout:40];(way["waterway"~"^(canal|river|fairway|tidal_channel)$"](${CB});way["seamark:type"="fairway"](${CB}););out tags geom;`, (j) => {
      const n: string[] = [], ni: Record<string, number> = {}, w: unknown[] = [];
      for (const el of j.elements || []) {
        if (!el.geometry || el.geometry.length < 2) continue;
        const t = el.tags || {}, nm = t.name || t['name:it'] || t['seamark:name'] || '';
        if (!(nm in ni)) { ni[nm] = n.length; n.push(nm); }
        const fl: number[] = [];
        for (const p of el.geometry) fl.push(Math.round(p.lat * 1e6), Math.round(p.lon * 1e6));
        w.push([ni[nm], t.waterway === 'fairway' || t['seamark:type'] === 'fairway' ? 1 : 0, fl]);
      }
      return { t: Date.now(), n, w, size: w.length };
    }, 50, log),
  },
  locali: {
    days: 7, min: 20,
    fetch: (log) => overpass(`[out:json][timeout:40];nwr["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$"]["name"](${PB});out center tags;`, (j) => {
      const p: unknown[] = [];
      for (const el of j.elements || []) {
        const t = el.tags || {}, la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
        if (!la || !t.name) continue;
        p.push([t.name, t.amenity, +la.toFixed(6), +lo.toFixed(6), t.brand || '', t.cuisine || '']);
      }
      return { t: Date.now(), p, size: p.length };
    }, 20, log),
  },
  previsione: {
    days: 30 / 1440, min: 1,
    async fetch(log) {
      for (const u of PREV_URLS) {
        try {
          const r = await fetch(u, { headers: { Accept: '*/*', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) { log.push(u + ' ' + r.status); continue; }
          const j = await r.json();
          const rows: any[] = Array.isArray(j) ? j : (j.data || j.previsioni || j.records || []);
          const pts = rows.map((x) => {
            const when = String(x.DATA_ESTREMALE ?? x.data_estremale ?? x.data ?? x.DATA ?? x.date ?? '');
            let v = num(x.VALORE ?? x.valore ?? x.value ?? x.livello);
            if (!isNaN(v) && Math.abs(v) < 3) v = v * 100;
            const tipo = String(x.TIPO_ESTREMALE ?? x.tipo_estremale ?? x.tipo ?? '');
            return { when, cm: Math.round(v), tipo };
          }).filter((p) => p.when && !isNaN(p.cm));
          if (pts.length) return { t: Date.now(), pts, size: pts.length };
          log.push(u + ' formato sconosciuto ' + JSON.stringify(rows[0] ?? j).slice(0, 400));
        } catch (e) { log.push(u + ' ' + String(e)); }
      }
      return null;
    },
  },
  ponti: {
    days: 30, min: 30,
    fetch: (log) => overpass(`[out:json][timeout:40];way["bridge"]["highway"](45.40,12.29,45.47,12.38);out tags center;`, (j) => {
      const p: unknown[] = [];
      for (const el of j.elements || []) {
        const t = el.tags || {}, c = el.center; if (!c) continue;
        const h = num(t['seamark:bridge:clearance_height'] ?? t.maxheight ?? t['clearance']);
        p.push([el.id, t.name || t['bridge:name'] || '', +c.lat.toFixed(6), +c.lon.toFixed(6), isNaN(h) ? null : Math.round(h * 100)]);
      }
      return { t: Date.now(), p, size: p.length };
    }, 30, log),
  },
  pontili: {
    days: 30, min: 5,
    async fetch(log) {
      try {
        const r = await fetch(PONTILI_XLS, { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', Referer: 'https://www.comune.venezia.it/it/content/download' }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) { log.push('xls ' + r.status); return null; }
        const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
        const out: unknown[] = [];
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];
          out.push({ foglio: name, righe: rows.filter((x) => x.some((c) => String(c).trim() !== '')) });
        }
        return { t: Date.now(), fogli: out, size: out.length };
      } catch (e) { log.push('xls ' + String(e)); return null; }
    },
  },
  fondali: { days: 3650, min: 1, async fetch(log) { log.push('i fondali si preparano con la funzione georef'); return null; } },
  fondogrid: { days: 3650, min: 1, async fetch(log) { log.push('la griglia si prepara con la funzione griglia'); return null; } },
  marea: {
    days: 5 / 1440, min: 1,
    async fetch(log) {
      for (const u of MAREA_URLS) {
        try {
          const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) { log.push(u + ' ' + r.status); continue; }
          const j = await r.json();
          const rows: any[] = Array.isArray(j) ? j : (j.data || j.stazioni || j.records || []);
          const st = rows.map((x) => {
            const name = String(x.stazione ?? x.nome ?? x.nome_stazione ?? x.station ?? '');
            let v = num(x.valore ?? x.value ?? x.livello ?? x.Valore);
            const raw = String(x.valore ?? x.value ?? x.livello ?? '');
            if (!isNaN(v) && (/\bm\b/.test(raw) || Math.abs(v) < 3)) v = v * 100; // metri → centimetri
            return { name, cm: Math.round(v), when: x.data ?? x.date ?? x.ora ?? '' };
          }).filter((s) => s.name && !isNaN(s.cm));
          const ps = st.find((s) => /salute/i.test(s.name)) || st[0];
          if (ps) return { t: Date.now(), cm: ps.cm, stazione: ps.name, when: ps.when, size: 1 };
          log.push(u + ' formato sconosciuto ' + JSON.stringify(rows[0] ?? j).slice(0, 300));
        } catch (e) { log.push(u + ' ' + String(e)); }
      }
      return null;
    },
  },
};

// "2026-11-27 11:30:00" ora di Venezia → millisecondi
function romaMs(s: string) {
  const d = new Date(s.replace(' ', 'T') + 'Z'); if (isNaN(+d)) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t: string) => +(parts.find((p) => p.type === t)?.value ?? 0);
  const asRome = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return +d - (asRome - +d);
}
// il sito del Comune a volte blocca i server: la marea di adesso si ricava dalla previsione ufficiale (curva tra massimo e minimo)
async function stimaMarea(url: string, H: Record<string, string>, log: string[]) {
  try {
    const rows = await (await fetch(`${url}/rest/v1/data_cache?key=eq.previsione&select=pack`, { headers: H })).json();
    const pts = ((rows[0] && rows[0].pack && rows[0].pack.pts) || []).map((p: any) => ({ ms: romaMs(String(p.when)), cm: p.cm }))
      .filter((p: any) => !isNaN(p.ms)).sort((a: any, b: any) => a.ms - b.ms);
    const now = Date.now();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.ms <= now && now <= b.ms) {
        const f = (now - a.ms) / (b.ms - a.ms), cm = Math.round(a.cm + (b.cm - a.cm) * (1 - Math.cos(Math.PI * f)) / 2);
        return { t: now, cm, stazione: 'Punta Salute (dalla previsione)', stimata: true, size: 1 };
      }
    }
    log.push('la previsione non copre adesso');
  } catch (e) { log.push('stima ' + String(e)); }
  return null;
}

const json = (b: unknown, s = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json', ...extra } });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const p = new URL(req.url).searchParams, tipo = p.get('tipo') || 'canali', k = KINDS[tipo];
  if (!k) return json({ error: 'tipo_sconosciuto' }, 400);
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const H = { apikey: srv, Authorization: 'Bearer ' + srv, 'content-type': 'application/json' };
  const maxAge = tipo === 'marea' || tipo === 'previsione' ? 'public, max-age=120' : tipo === 'fondogrid' || tipo === 'fondali' ? 'public, max-age=604800' : 'public, max-age=21600';
  try {
    const rows = await (await fetch(`${url}/rest/v1/data_cache?key=eq.${tipo}&select=pack,updated_at`, { headers: H })).json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row && p.get('aggiorna') !== '1' && Date.now() - Date.parse(row.updated_at) < k.days * 864e5)
      return json(row.pack, 200, { 'cache-control': maxAge });
    const log: string[] = [];
    let pack = await k.fetch(log);
    if (!pack && tipo === 'marea') pack = await stimaMarea(url, H, log);
    if (!pack) return row ? json({ ...row.pack, vecchio: true }, 200, { 'cache-control': 'public, max-age=60' }) : json({ error: 'fonte_non_raggiungibile', log }, 502);
    await fetch(`${url}/rest/v1/data_cache`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: tipo, pack, updated_at: new Date().toISOString() }) });
    return json(pack, 200, { 'cache-control': maxAge });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
