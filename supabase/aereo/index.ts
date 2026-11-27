// clickVenice · dov'è l'aereo adesso: dal numero di volo (es. "BA592") alla posizione in tempo reale (ADS-B aperti di adsb.lol, ODbL)
// 1) nominativo radio = codice ICAO della compagnia + numero del volo (BAW592)
// 2) se non c'è (Ryanair RYR5KC, Lufthansa DLH02J...): tra gli aerei della compagnia entro ~460 km da Venezia
//    sceglie quello compatibile con l'orario (in arrivo: punta verso il Marco Polo e arriva all'ora prevista; in partenza: si allontana dal tempo giusto)
// ?volo=AF1726&alt=AM6130,DL8435&ora=14:43&verso=arrivi|partenze
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const UA = { 'User-Agent': 'clickVenice/1.0 (+https://clickvenice.com)', 'Accept': 'application/json' };
const VCE = [45.5053, 12.3519];
const ICAO: Record<string, string[]> = {
  FR: ['RYR', 'RUK'], RK: ['RUK'], U2: ['EZY', 'EJU', 'EZS'], EC: ['EJU'], DS: ['EZS'], VY: ['VLG'], W6: ['WZZ'], W4: ['WMT'], W9: ['WUK'], V7: ['VOE'], HV: ['TRA'], TO: ['TVF'],
  AZ: ['ITY'], LH: ['DLH'], EN: ['DLA'], AF: ['AFR'], KL: ['KLM'], BA: ['BAW'], IB: ['IBE'], I2: ['IBS'], LX: ['SWR'], OS: ['AUA'], SN: ['BEL'], TP: ['TAP'], TK: ['THY'], PC: ['PGT'],
  EK: ['UAE'], QR: ['QTR'], EY: ['ETD'], DL: ['DAL'], UA: ['UAL'], AA: ['AAL'], AC: ['ACA'], LS: ['EXS'], DY: ['NOZ'], D8: ['NSZ', 'IBK'], EW: ['EWG'], SK: ['SAS'], A3: ['AEE'], OA: ['OAL'],
  LO: ['LOT'], EI: ['EIN'], BT: ['BTI'], JU: ['ASL'], OU: ['CTN'], AY: ['FIN'], LG: ['LGL'], BJ: ['LBT'], AT: ['RAM'], MS: ['MSR'], LY: ['ELY'], IZ: ['AIZ'], SU: ['AFL'], HY: ['UZB'],
  '4U': ['GWI', 'EWG'], X3: ['TUI'], BY: ['TOM'], OR: ['TFL'], '6B': ['BLX'], MT: ['TCX'], DE: ['CFG'], ZB: ['MON'], BM: ['BMR'], '2L': ['OAW'], WK: ['EDW'], NO: ['NOS'], V3: ['KRP'],
  SM: ['MSC'], FB: ['LZB'], H4: ['HYS'], '5O': ['FPO'], XQ: ['SXS'], PM: ['CNF'], TB: ['JAF'], QS: ['TVS'], RO: ['ROT'], KM: ['KMM'], A9: ['TGZ'], J2: ['AHY'], PS: ['AUI'], '0B': ['BMS'],
  SV: ['SVA'], KU: ['KAC'], ET: ['ETH'], CX: ['CPA'], SQ: ['SIA'], TG: ['THA'], AI: ['AIC'], LA: ['LAN'], AR: ['ARG'], AM: ['AMX'], G3: ['GLO'], WS: ['WJA'], MF: ['CXA'], MU: ['CES'], GA: ['GIA'], LL: ['LLL'] };
const out = (a: any, cs: string, stima = false) => ({ trovato: true, stima, callsign: (a.flight || cs).trim(), lat: a.lat, lng: a.lon, alt_ft: a.alt_baro === 'ground' ? 0 : a.alt_baro ?? a.alt_geom ?? null,
  a_terra: a.alt_baro === 'ground', kn: a.gs ?? null, rotta: a.track ?? a.true_heading ?? null, vs: a.baro_rate ?? a.geom_rate ?? null, reg: a.r || null, tipo: a.t || null, visto_s: a.seen_pos ?? a.seen ?? null, hex: a.hex });
const rad = (d: number) => d * Math.PI / 180;
const km = (a: number, b: number, c: number, d: number) => { const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const brg = (a: number, b: number, c: number, d: number) => { const y = Math.sin(rad(d - b)) * Math.cos(rad(c)), x = Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
const adiff = (a: number, b: number) => Math.abs(((b - a) % 360 + 540) % 360 - 180);
function romeMin() { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; }
function parse(f: string) { f = f.toUpperCase().replace(/[^A-Z0-9]/g, ''); const m = /^([A-Z0-9]{2})([0-9]{1,4}[A-Z]?)$/.exec(f) || /^([A-Z]{3})([0-9]{1,4}[A-Z]?)$/.exec(f); if (!m) return null;
  return { num: m[2].replace(/^0+(?=\d)/, ''), raw: m[2], pre: m[1].length === 3 ? [m[1]] : (ICAO[m[1]] || []) }; }
let MEM: any = null;
async function vicini() {
  if (MEM && Date.now() - MEM.t < 20000) return MEM.ac;
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, H = { apikey: srv, Authorization: 'Bearer ' + srv, 'content-type': 'application/json' };
  try { const c = await (await fetch(`${url}/rest/v1/data_cache?key=eq.aerei_vce&select=pack`, { headers: H })).json();
    if (c[0] && c[0].pack && Date.now() - c[0].pack.t < 20000) { MEM = c[0].pack; return MEM.ac; } } catch (_) {}
  let r: Response | null = null;
  for (let i = 0; i < 2; i++) { r = await fetch(`https://api.adsb.lol/v2/point/${VCE[0]}/${VCE[1]}/250`, { headers: UA, signal: AbortSignal.timeout(15000) }); if (r.status !== 429) break; await new Promise((ok) => setTimeout(ok, 1500)); }
  if (!r || !r.ok) { if (MEM) return MEM.ac; throw new Error('point ' + (r && r.status)); }
  const j = await r.json(), ac = (j.ac || []).filter((a: any) => a.lat != null && a.flight).map((a: any) => ({ flight: String(a.flight).trim(), lat: a.lat, lon: a.lon, alt_baro: a.alt_baro, alt_geom: a.alt_geom, gs: a.gs, track: a.track, baro_rate: a.baro_rate, r: a.r, t: a.t, hex: a.hex, seen_pos: a.seen_pos }));
  MEM = { t: Date.now(), ac };
  fetch(`${url}/rest/v1/data_cache`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'aerei_vce', pack: MEM, updated_at: new Date().toISOString() }) }).catch(() => {});
  return ac;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const q = new URL(req.url).searchParams, voli = [q.get('volo') || ''].concat((q.get('alt') || '').split(',')).filter(Boolean).map(parse).filter(Boolean) as any[];
    if (!voli.length) return json({ errore: 'volo' }, 400);
    const provati: string[] = [];
    for (const v of voli) for (const c of v.pre) for (const cs of new Set([c + v.num, c + v.raw])) if (!provati.includes(cs)) provati.push(cs);
    const pre = new Set(voli.flatMap((v) => v.pre)), ora = /^(\d{1,2}):(\d\d)$/.exec(q.get('ora') || ''), arr = q.get('verso') === 'arrivi';
    let dbg = '';
    // aerei entro ~460 km da Venezia: una sola richiesta, condivisa per 20 secondi tra tutti gli utenti (adsb.lol limita le richieste)
    const AC = await vicini().catch((e) => { dbg = String(e); return null; });
    // aereo già trovato: lo seguo per codice del trasponder (hex), così la stima non salta su un altro
    const hx = (q.get('hex') || '').toLowerCase().replace(/[^0-9a-f~]/g, '');
    if (hx) { const h = AC && AC.find((a: any) => a.hex === hx); if (h) return json(out(h, h.flight, q.get('stima') === '1'));
      try { const r = await fetch(`https://api.adsb.lol/v2/hex/${hx}`, { headers: UA, signal: AbortSignal.timeout(8000) }); if (r.ok){ const a = ((await r.json()).ac || []).find((x: any) => x.lat != null); if (a) return json(out(a, a.flight || '', q.get('stima') === '1')); } } catch (_) {} }
    if (AC) {
      // 1) nominativo esatto tra gli aerei vicini
      const ex = AC.find((a: any) => provati.includes(String(a.flight || '').trim())); if (ex) return json(out(ex, ex.flight));
      // 2) stima: aereo della compagnia compatibile con orario e direzione
      if (pre.size && ora) {
        let delta = (+ora[1] * 60 + +ora[2]) - romeMin(); if (delta > 720) delta -= 1440; if (delta < -720) delta += 1440;   // minuti all'orario (negativo: già passato)
        let best: any = null;
        for (const a of AC) {
          const cs = String(a.flight || '').trim(); if (a.lat == null || !pre.has(cs.slice(0, 3))) continue;
          const d = km(a.lat, a.lon, VCE[0], VCE[1]), gs = Math.max(150, (a.gs || 0) * 1.852), ground = a.alt_baro === 'ground' || (a.gs || 0) < 40;
          let s: number;
          if (arr) {
            if (delta < -20) continue;   // già atterrato
            if (ground) s = d < 6 ? Math.abs(delta) + 5 : 999;
            else { const eta = d / gs * 60 + 6; s = Math.abs(eta - Math.max(0, delta)) + (adiff(a.track ?? 0, brg(a.lat, a.lon, VCE[0], VCE[1])) > 50 ? 40 : 0); }
          } else {
            if (delta > 30) s = ground && d < 6 ? 5 : 999;   // non ancora partito: è al gate
            else if (ground) s = d < 6 && delta > -10 ? 8 : 999;
            else { const t = d / gs * 60 + 6; s = Math.abs(t - Math.max(0, -delta)) + (adiff(a.track ?? 0, brg(VCE[0], VCE[1], a.lat, a.lon)) > 50 ? 40 : 0); }
          }
          if (s < 30 && (!best || s < best.s)) best = { s, a, cs };
        }
        if (best) return json({ ...out(best.a, best.cs, true), scarto_min: Math.round(best.s) });
      }
    }
    // 3) lontano da Venezia: nominativo esatto in tutto il mondo
    for (const cs of provati.slice(0, 4)) {
      try { const r = await fetch(`https://api.adsb.lol/v2/callsign/${cs}`, { headers: UA, signal: AbortSignal.timeout(8000) }); if (!r.ok){ dbg += ' cs ' + r.status; continue; }
        const j = await r.json(), a = (j.ac || []).find((x: any) => x.lat != null); if (a) return json(out(a, cs)); } catch (_) {}
    }
    return json({ trovato: false, provati, dbg });
  } catch (e) { return json({ errore: String(e) }, 500); }
});
