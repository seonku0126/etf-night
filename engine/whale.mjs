// node whale.mjs → out/whale.json  (큰손 추적: 외국인·기관 순매수, 연속 순매수, 자금 유입, 거래 폭증)
import w, { isinOf } from './worker.mjs';
import { fileKV } from './kv.mjs';
const ENV = { KV: fileKV(process.env.CACHE_DIR || '.cache') };
import fs from 'fs';
const UA = { 'user-agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => +String(s ?? '').replace(/[,+%]/g, '') || 0;
const list = await (await w.fetch(new Request('https://x/api/list'), ENV)).json();

async function getJson(url, headers = UA, tries = 4) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      if (txt.startsWith('<')) throw new Error('html');
      return JSON.parse(txt);
    } catch (e) { if (t === tries - 1) throw e; await sleep([1500, 4000, 8000][t] || 8000); }
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch (e) {} } })); }

// 1) 네이버 투자자별 매매(최근 20거래일): 외국인·기관·개인 순매수 수량 × 종가 = 금액
const inv = {};
await pool(list, 2, async (e) => {
  await sleep(300);
  const d = await getJson(`https://m.stock.naver.com/api/stock/${e.code}/trend?pageSize=20`);
  if (!Array.isArray(d) || !d.length) return;
  inv[e.code] = d.map((x) => { const px = num(x.closePrice); return {
    d: x.bizdate, f: num(x.foreignerPureBuyQuant) * px / 1e8, o: num(x.organPureBuyQuant) * px / 1e8, i: num(x.individualPureBuyQuant) * px / 1e8, v: num(x.accumulatedTradingVolume) }; });
});
const lastDay = Object.values(inv).map((a) => a[0].d).sort().pop();

// 2) FunETF 순자산 추이 → 하루 자금 유입(설정−환매) = 순자산 변화 − 운용 수익
const end = lastDay, st = new Date(Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8)) - 45 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const flow = {};
await pool(list, 2, async (e) => {
  const isin = isinOf(e.code);
  const d = await getJson(`https://www.funetf.co.kr/api/public/product/view/etfchart?itemId=${isin}&gijunYmd=${end}&schIdx=Y&schSuikMode=3M&schSuikStDt=${st}&schSuikEdDt=${end}`,
    { ...UA, 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.funetf.co.kr/product/etf/view/' + isin });
  if (!Array.isArray(d) || d.length < 3) return;
  const out = [];
  for (let k = 1; k < d.length; k++) {
    const a = d[k - 1], b = d[k]; if (!(a.netAssets > 0) || !(b.netAssets > 0)) continue;
    const r = (1 + (b.nav || 0) / 100) / (1 + (a.nav || 0) / 100);
    out.push({ d: b.evalD, fl: b.netAssets - a.netAssets * r, na: b.netAssets });
  }
  flow[e.code] = out.reverse(); // 최신 먼저
  await sleep(500);
});

// 3) 지표 계산
const r1 = (x) => Math.round(x * 10) / 10;
const sum = (a, k, n) => a.slice(0, n).reduce((s, x) => s + x[k], 0);
const streak = (a, k) => { if (!a || !a.length) return 0; const s = Math.sign(a[0][k]); if (!s) return 0; let n = 0; for (const x of a) { if (Math.sign(x[k]) === s) n++; else break; } return s * n; };
const items = {};
for (const e of list) {
  const a = inv[e.code], f = flow[e.code]; if (!a && !f) continue;
  const it = {};
  if (a) {
    Object.assign(it, { d: a[0].d, f1: r1(a[0].f), o1: r1(a[0].o), i1: r1(a[0].i), f5: r1(sum(a, 'f', 5)), o5: r1(sum(a, 'o', 5)), f20: r1(sum(a, 'f', 20)), o20: r1(sum(a, 'o', 20)),
      fs: streak(a, 'f'), os: streak(a, 'o'), fo: a.slice(0, 10).map((x) => [r1(x.f), r1(x.o), r1(x.i)]) });
    const prev = a.slice(1, 21).map((x) => x.v).filter((v) => v > 0), avg = prev.reduce((s, v) => s + v, 0) / (prev.length || 1);
    if (avg > 0) it.vx = Math.round((e.vol || a[0].v) / avg * 10) / 10; // 오늘 거래량 ÷ 20일 평균
  }
  if (f && f.length) {
    Object.assign(it, { fd: f[0].d, fl1: r1(f[0].fl), fl5: r1(sum(f, 'fl', 5)), fl20: r1(sum(f, 'fl', 20)), fls: streak(f, 'fl'), na: Math.round(f[0].na), fh: f.slice(0, 10).map((x) => r1(x.fl)) });
  }
  items[e.code] = it;
}
const OUT = process.env.OUT_DIR || 'out'; fs.mkdirSync(OUT, { recursive: true });
const res = { at: new Date().toISOString(), day: lastDay, n: Object.keys(items).length, nInv: Object.keys(inv).length, nFlow: Object.keys(flow).length, items };
fs.writeFileSync(OUT + '/whale.json', JSON.stringify(res));
console.log(JSON.stringify({ day: lastDay, n: res.n, nInv: res.nInv, nFlow: res.nFlow, bytes: fs.statSync(OUT + '/whale.json').size }));
