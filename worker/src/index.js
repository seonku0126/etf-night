// 데이앤나잇 홈 대시보드 실시간 시세 중계 (Yahoo spark → 30초 캐시)
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
export default {
  async fetch(req, env, ctx) {
    const o = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const url = new URL(req.url);
    if (url.pathname !== '/mkt') return new Response('ok', { headers: cors });
    const cache = caches.default, key = new Request('https://cache.local/mkt');
    let res = await cache.match(key);
    if (!res) {
      const d = await build();
      if (!Object.keys(d.q).length) return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
      res = new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
