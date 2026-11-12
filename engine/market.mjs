// node market.mjs → $OUT_DIR/mkt.json  (홈 시장 대시보드용: 지수 선물·환율·원자재·빅테크 프리마켓)
import fs from 'fs';
const SYMS = {
  'NQ=F': '나스닥100 선물', 'ES=F': 'S&P500 선물', 'YM=F': '다우 선물', '^SOX': '필라델피아 반도체',
  'KRW=X': '원/달러', '^VIX': 'VIX 공포지수', '^TNX': '미 10년물 금리', 'GC=F': '금', 'CL=F': 'WTI 원유', 'BTC-USD': '비트코인',
  NVDA: '엔비디아', AAPL: '애플', MSFT: '마이크로소프트', AMZN: '아마존', GOOGL: '알파벳', META: '메타', TSLA: '테슬라', AVGO: '브로드컴',
  AMD: 'AMD', PLTR: '팔란티어', TSM: 'TSMC', MU: '마이크론',
};
const syms = Object.keys(SYMS);
async function spark(list) {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(list.join(','))}&range=1d&interval=5m&includePrePost=true`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) return ((await r.json()).spark || {}).result || [];
    } catch (e) {}
    await new Promise((s) => setTimeout(s, 1500));
  }
  return [];
}
const res = (await spark(syms.slice(0, 11))).concat(await spark(syms.slice(11)));
const out = {};
for (const x of res) {
  const r = x.response && x.response[0]; if (!r || !r.timestamp) continue;
  const m = r.meta || {}, cl = r.indicators.quote[0].close;
  const pts = r.timestamp.map((t, i) => [t, cl[i]]).filter((p) => p[1] != null);
  if (!pts.length) continue;
  const prev = m.chartPreviousClose ?? m.previousClose;
  const last = pts[pts.length - 1][1];
  // 스파크라인: 최대 48개로 줄이기
  const step = Math.max(1, Math.ceil(pts.length / 48));
  const sp = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => +p[1].toPrecision(6));
  const regEnd = m.currentTradingPeriod && m.currentTradingPeriod.regular && m.currentTradingPeriod.regular.end;
  const regStart = m.currentTradingPeriod && m.currentTradingPeriod.regular && m.currentTradingPeriod.regular.start;
  const lt = pts[pts.length - 1][0];
  const ses = regStart && lt < regStart ? 'pre' : regEnd && lt >= regEnd ? 'post' : 'reg';
  out[x.symbol] = { n: SYMS[x.symbol], p: +last.toPrecision(7), pc: prev ? +((last / prev - 1) * 100).toFixed(2) : null, sp, t: lt, ses };
}
const OUT = process.env.OUT_DIR || 'out'; fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + '/mkt.json', JSON.stringify({ at: new Date().toISOString(), q: out }));
console.log(JSON.stringify({ mkt: Object.keys(out).length }));
