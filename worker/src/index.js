// 데이앤나잇 홈 대시보드 실시간 시세 중계 (Yahoo spark → 5분 캐시)
const SYMS = {
  'NQ=F': '나스닥100 선물', 'ES=F': 'S&P500 선물', 'YM=F': '다우 선물', '^SOX': '필라델피아 반도체',
  'KRW=X': '원/달러', '^VIX': 'VIX 공포지수', '^TNX': '미 10년물 금리', 'GC=F': '금', 'CL=F': 'WTI 원유', 'BTC-USD': '비트코인',
  NVDA: '엔비디아', AAPL: '애플', MSFT: '마이크로소프트', AMZN: '아마존', GOOGL: '알파벳', META: '메타', TSLA: '테슬라', AVGO: '브로드컴',
  AMD: 'AMD', PLTR: '팔란티어', TSM: 'TSMC', MU: '마이크론',
};
const ORIGINS = ['https://daynnightetf.com', 'https://www.daynnightetf.com'];
async function spark(list) {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(list.join(','))}&range=1d&interval=5m&includePrePost=true`;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(url.replace('query1', host), { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36', Accept: 'application/json' } });
      if (r.ok) return ((await r.json()).spark || {}).result || [];
    } catch (e) {}
  }
  return [];
}
async function build() {
  const syms = Object.keys(SYMS);
  const [a, b] = await Promise.all([spark(syms.slice(0, 11)), spark(syms.slice(11))]);
  const q = {};
  for (const x of a.concat(b)) {
    const r = x.response && x.response[0]; if (!r || !r.timestamp) continue;
    const m = r.meta || {}, cl = r.indicators.quote[0].close;
    const pts = r.timestamp.map((t, i) => [t, cl[i]]).filter((p) => p[1] != null);
    if (!pts.length) continue;
    const prev = m.chartPreviousClose ?? m.previousClose, last = pts[pts.length - 1][1];
    const step = Math.max(1, Math.ceil(pts.length / 48));
    const sp = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => +p[1].toPrecision(6));
    const per = (m.currentTradingPeriod || {}).regular || {}, lt = pts[pts.length - 1][0];
    const ses = per.start && lt < per.start ? 'pre' : per.end && lt >= per.end ? 'post' : 'reg';
    q[x.symbol] = { n: SYMS[x.symbol], p: +last.toPrecision(7), pc: prev ? +((last / prev - 1) * 100).toFixed(2) : null, sp, t: lt, ses };
  }
  return { at: new Date().toISOString(), live: 1, q };
}
// /px: 밤 추정 iNAV 실시간 계산용 미국 종목 현재가 (목록은 사이트의 syms.json, 5분 캐시)
async function px() {
  let syms = [];
  try { const r = await fetch('https://daynnightetf.com/data/syms.json', { cf: { cacheTtl: 600, cacheEverything: true } }); if (r.ok) syms = await r.json(); } catch (e) {}
  syms = syms.slice(0, 900);
  const bs = []; for (let i = 0; i < syms.length; i += 20) bs.push(syms.slice(i, i + 20));
  const q = {}; let open = null;
  await Promise.all(bs.map(async (b) => {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(b.join(','))}&range=1d&interval=30m&includePrePost=true`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' } });
      if (!r.ok) return;
      for (const x of ((await r.json()).spark || {}).result || []) {
        const R = x.response && x.response[0]; if (!R) continue;
        const m = R.meta || {}, cl = (R.indicators && R.indicators.quote && R.indicators.quote[0].close) || [];
        const reg = m.regularMarketPrice != null ? +m.regularMarketPrice.toPrecision(7) : null, regTs = m.regularMarketTime || 0;
        let i = cl.length - 1; while (i >= 0 && cl[i] == null) i--;
        if (i >= 0 && R.timestamp) q[x.symbol] = [+cl[i].toPrecision(7), R.timestamp[i], reg, regTs];
        else if (reg != null) q[x.symbol] = [reg, regTs, reg, regTs];
        else continue;
        const per = (m.currentTradingPeriod || {}).regular;
        if (open === null && per && !/[=^]|-USD|\./.test(x.symbol)) { const n = Date.now() / 1000; open = n >= per.start && n < per.end; }
      }
    } catch (e) {}
  }));
  return { at: new Date().toISOString(), open: !!open, n: Object.keys(q).length, q };
}
export default {
  async fetch(req, env, ctx) {
    const o = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const url = new URL(req.url);
    if (url.pathname !== '/mkt' && url.pathname !== '/px') return new Response('ok', { headers: cors });
    const isPx = url.pathname === '/px';
    const cache = caches.default, key = new Request('https://cache.local' + url.pathname);
    let res = await cache.match(key);
    if (!res) {
      const d = isPx ? await px() : await build();
      if (!Object.keys(d.q).length) return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
      res = new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
