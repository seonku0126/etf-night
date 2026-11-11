// node stats.mjs <siteDir>  → 방문자 수(최근 30일)를 data/stats.json 으로 저장
// abacus는 한꺼번에 요청하면 거절하므로 천천히 받고, 실패한 값은 지난번 파일 값을 유지한다.
import fs from 'fs';
import path from 'path';
const siteDir = process.argv[2] || '../_site';
const NS = 'daynnightetf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(k) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://abacus.jasoncameron.dev/get/${NS}/${k}`, { signal: AbortSignal.timeout(5000) });
      if (r.status === 404) return 0;
      if (r.ok) { const j = await r.json(); return j.error ? 0 : +j.value || 0; }
    } catch (e) {}
    await sleep(800 * (t + 1));
  }
  return null; // 못 받음
}
let prev = { days: [] };
try { const r = await fetch('https://daynnightetf.com/data/stats.json', { signal: AbortSignal.timeout(5000) }); if (r.ok) prev = await r.json(); } catch (e) {}
const P = Object.fromEntries((prev.days || []).map((x) => [x.d, x]));
const kst = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const days = [];
for (let i = 0; i < 30; i++) days.push(kst(Date.now() - i * 864e5));
const keep = (v, old) => (v == null ? old || 0 : Math.max(v, old || 0));
const out = { at: new Date().toISOString(), total: keep(await get('pv-total'), prev.total), days: [] };
for (const d of days) {
  const o = P[d] || {};
  // 오래된 날(3일 넘은)은 지난 값이 있으면 다시 안 받음
  const old = days.indexOf(d) > 2 && o.pv != null;
  const pv = old ? o.pv : keep(await get('pv-' + d), o.pv);
  const uv = old ? o.uv : keep(await get('uv-' + d), o.uv);
  out.days.push({ d, pv, uv });
  if (!old) await sleep(200);
}
fs.mkdirSync(path.join(siteDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(siteDir, 'data', 'stats.json'), JSON.stringify(out));
console.log(JSON.stringify({ total: out.total, today: out.days[0] }));
