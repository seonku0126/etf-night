// node stats.mjs <siteDir>  → 방문자 수(최근 30일)를 data/stats.json 으로 저장
import fs from 'fs';
import path from 'path';
const siteDir = process.argv[2] || '../_site';
const NS = 'daynnightetf';
const get = async (k) => { try { const r = await fetch(`https://abacus.jasoncameron.dev/get/${NS}/${k}`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) return 0; const j = await r.json(); return +j.value || 0; } catch (e) { return 0; } };
const kst = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const days = [];
for (let i = 0; i < 30; i++) days.push(kst(Date.now() - i * 864e5));
const out = { at: new Date().toISOString(), total: await get('pv-total'), days: [] };
out.days = await Promise.all(days.map(async (d) => ({ d, pv: await get('pv-' + d), uv: await get('uv-' + d) })));
fs.mkdirSync(path.join(siteDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(siteDir, 'data', 'stats.json'), JSON.stringify(out));
const t = out.days[0];
console.log(JSON.stringify({ total: out.total, today: t }));
