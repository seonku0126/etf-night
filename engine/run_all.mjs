// node run_all.mjs [N]  → out/meta.json, out/d0.json.. (시가총액 상위 N개 계산)
import w from './worker.mjs';
import { fileKV } from './kv.mjs';
const ENV = { KV: fileKV(process.env.CACHE_DIR || '.cache') };
import fs from 'fs';
const N = +process.argv[2] || 150, CH = 50;
const call = async (p) => (await w.fetch(new Request('https://x' + p), ENV)).json();
const list = await call('/api/list');
const top = list.slice().sort((a, b) => (b.cap || 0) - (a.cap || 0)).slice(0, N);
const res = {}; let i = 0;
async function wk() { while (i < top.length) { const e = top[i++]; try { res[e.code] = await call('/api/inav?code=' + e.code); } catch (x) { res[e.code] = { error: String(x) }; } await new Promise((ok) => setTimeout(ok, 800)); } }
await Promise.all([wk(), wk(), wk()]);
// 실패한 종목은 한 번 더, 하나씩
for (const e of top) { if (res[e.code] && res[e.code].error) { await new Promise((ok) => setTimeout(ok, 1500)); try { res[e.code] = await call('/api/inav?code=' + e.code); } catch (x) {} } }
// 외국인 순매수는 큰손 데이터(whale.js, 하루 1번)에서 가져옵니다 — 여기서 중복 요청하지 않음
const fr = {};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const compact = (j) => j.error ? { error: j.error } : {
  name: j.name, price: j.price, nav: j.nav, navDate: j.navDate, est: r1(j.est), pct: j.pct, estReg: r1(j.estReg), pctReg: j.pctReg, estAh: r1(j.estAh), pctAh: j.pctAh,
  vsPrice: j.vsPrice, session: j.session, futSym: j.futSym, futPct: j.futPct, rUsd: j.rUsd, fxNow: j.fxNow && +j.fxNow.toFixed(2), fxBase: j.fxBase, fxDate: j.fxDate, fxPct: j.fxPct, hedged: j.hedged,
  wKrw: j.wKrw, coverage: j.coverage, nHold: j.nHold, method: j.method, check: j.check, warn: j.warn, notes: j.notes, pricedAt: j.pricedAt, at: j.at, inavLive: j.inavLive,
  top: (j.top || []).slice(0, 6).map((x) => ({ t: x.t, n: (x.n || '').slice(0, 24), w: x.w, r: x.r })),
};
const OUT = process.env.OUT_DIR || 'out'; fs.mkdirSync(OUT, { recursive: true });
const at = new Date().toISOString();
const meta = { at, n: top.length, list: list.map((e) => { const j = res[e.code]; return { c: e.code, n: e.name, p: e.price, cap: e.cap, ch: e.chg, amt: e.amt, ...(fr[e.code] || {}), ...(j && !j.error ? { est: r1(j.est), pct: j.pct, pr: j.pctReg, w: j.warn ? 1 : 0 } : {}) }; }) };
fs.writeFileSync(OUT + '/meta.json', JSON.stringify(meta));
const codes = top.map((e) => e.code);
const files = [OUT + '/meta.json'];
for (let k = 0; k * CH < codes.length; k++) {
  const items = {}; for (const c of codes.slice(k * CH, (k + 1) * CH)) items[c] = compact(res[c]);
  fs.writeFileSync(`${OUT}/d${k}.json`, JSON.stringify({ at, items })); files.push(`${OUT}/d${k}.json`);
}
const ok = Object.values(res).filter((j) => !j.error).length;
console.log(JSON.stringify({ at, computed: top.length, ok, files: files.map((f) => [f, fs.statSync(f).size]) }));
