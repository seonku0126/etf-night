// 개인 코스피 인버스 순매수 vs 다음날 코스피 상승 — 데이터 수집
import fs from 'fs';
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s ?? '').replace(/[,+]/g, '')) || 0;
async function j(url) { const r = await fetch(url, { headers: UA }); const t = await r.text(); try { return JSON.parse(t); } catch (e) { console.log('NOTJSON', url, r.status, t.slice(0, 200)); return null; } }
const out = { inv: {}, kospi: [] };
// 1) 투자자별 매매 (bizdate 페이징 시도)
for (const code of ['114800', '252670', '069500', '122630']) {
  const rows = new Map(); let biz = '';
  for (let k = 0; k < 200; k++) {
    const url = `https://m.stock.naver.com/api/stock/${code}/trend?pageSize=60${biz ? `&bizdate=${biz}` : ''}`;
    const d = await j(url);
    if (k === 0) console.log(code, 'sample', JSON.stringify(d && d[0]));
    if (!Array.isArray(d) || !d.length) { console.log(code, 'stop at', k, biz); break; }
    let added = 0;
    for (const x of d) if (!rows.has(x.bizdate)) { rows.set(x.bizdate, { d: x.bizdate, i: num(x.individualPureBuyQuant), f: num(x.foreignerPureBuyQuant), o: num(x.organPureBuyQuant), px: num(x.closePrice) }); added++; }
    const last = d[d.length - 1].bizdate;
    if (!added || last === biz) { console.log(code, 'no progress', k, last); break; }
    // 다음 페이지: 마지막 날짜 하루 전
    const t = new Date(Date.UTC(+last.slice(0, 4), +last.slice(4, 6) - 1, +last.slice(6, 8)) - 864e5);
    biz = t.toISOString().slice(0, 10).replace(/-/g, '');
    if (last < '20160101') break;
    await sleep(250);
  }
  out.inv[code] = [...rows.values()].sort((a, b) => a.d.localeCompare(b.d));
  console.log(code, out.inv[code].length, out.inv[code][0]?.d, out.inv[code].at(-1)?.d);
}
// 2) 미국 지수·환율 (Yahoo)
out.us = {};
for (const sym of ['%5EGSPC', '%5EIXIC', 'KRW%3DX']) {
  const yy = await j(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=11y&interval=1d`);
  const rr = yy?.chart?.result?.[0];
  if (rr) out.us[decodeURIComponent(sym)] = rr.timestamp.map((t, i) => ({ d: new Date((t + rr.meta.gmtoffset * 1000 / 1000) * 1000).toISOString().slice(0, 10).replace(/-/g, ''), c: rr.indicators.quote[0].close[i] })).filter((x) => x.c != null);
  console.log(sym, out.us[decodeURIComponent(sym)]?.length);
}
// 3) 코스피 일봉 (Yahoo)
const y = await j('https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=11y&interval=1d');
const r = y?.chart?.result?.[0];
if (r) { const ts = r.timestamp, c = r.indicators.quote[0].close, o = r.indicators.quote[0].open;
  out.kospi = ts.map((t, i) => ({ d: new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, ''), o: o[i], c: c[i] })).filter((x) => x.c != null); }
console.log('kospi', out.kospi.length, out.kospi[0]?.d, out.kospi.at(-1)?.d);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/data.json', JSON.stringify(out));
