// node pages.mjs <dataDir> <siteDir>
// ETF마다 검색엔진용 개별 페이지(/etf/<코드>/)와 sitemap.xml을 만든다.
import fs from 'fs';
import path from 'path';

const [dataDir = '../.data', siteDir = '../_site'] = process.argv.slice(2);
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { return null; } };
const meta = read('meta.json');
if (!meta) { console.log('meta.json 없음, 건너뜀'); process.exit(0); }
const whale = read('whale.json') || { items: {} };
const det = {};
for (let k = 0; k < 10; k++) { const d = read(`d${k}.json`); if (d && d.items) Object.assign(det, d.items); }

let host = 'daynnightetf.com';
try { host = fs.readFileSync(path.join(siteDir, 'CNAME'), 'utf8').trim() || host; } catch (e) {}
const SITE = `https://${host}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (v) => (v == null ? '-' : Math.round(v).toLocaleString('ko-KR') + '원');
const eok = (v) => (v == null ? '-' : Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(1) + '조' : Math.round(v).toLocaleString('ko-KR') + '억');
const ek = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + (Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(2) + '조' : Math.abs(v) >= 10 ? Math.round(v).toLocaleString('ko-KR') + '억' : v.toFixed(1) + '억'));
const sign = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const cls = (v) => (v == null ? '' : v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
const md = (d) => (d ? `${+d.slice(4, 6)}/${+d.slice(6)}` : '');
const at = new Date(meta.at);
const atKst = new Date(at.getTime() + 9 * 3600e3);
const atTxt = `${atKst.getUTCMonth() + 1}월 ${atKst.getUTCDate()}일 ${String(atKst.getUTCHours()).padStart(2, '0')}:${String(atKst.getUTCMinutes()).padStart(2, '0')}`;

const CSS = `:root{--bg:#0f1115;--card:#181b22;--line:#262a33;--ink:#eef0f4;--mute:#8a919e;--up:#ff5a5f;--down:#4e8cff;--acc:#f5c542}
*{box-sizing:border-box}body{margin:0 auto;max-width:640px;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding:16px}
a{color:var(--acc);text-decoration:none}.top{display:flex;align-items:center;gap:8px;font-weight:700}.top img{width:24px;height:24px;border-radius:6px}
h1{font-size:22px;margin:18px 0 4px;letter-spacing:-.3px}.sub{color:var(--mute);font-size:13px}
.big{font-size:30px;font-weight:800;margin-top:12px;letter-spacing:-.5px}.up{color:var(--up)}.down{color:var(--down)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-top:12px}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:8px}.kv div{background:#13161c;border-radius:10px;padding:9px 11px}.kv>div>span{display:block;color:var(--mute);font-size:12px}.kv b{font-size:15.5px}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:7px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right}
h2{font-size:16px;margin:0 0 8px}.cta{display:block;text-align:center;background:var(--acc);color:#111;font-weight:800;border-radius:14px;padding:14px;margin-top:16px}
.rel a{display:inline-block;margin:4px 6px 0 0;padding:6px 10px;border:1px solid var(--line);border-radius:999px;color:var(--ink);font-size:13px}
p.note{color:var(--mute);font-size:12px;margin-top:18px}`;

const list = meta.list || [];
const byCode = Object.fromEntries(list.map((x) => [x.c, x]));
const words = (n) => n.replace(/^(TIGER|KODEX|ACE|RISE|SOL|TIME|PLUS|KIWOOM|HANARO|KoAct|WON|1Q|에셋플러스|BNK|마이티|파워|UNICORN|VITA|TRUSTON|DAISHIN343|ITF|흥국|HK)\s*/, '');
function related(x) {
  const w = words(x.n).replace(/\(.*\)/, '').slice(0, 6);
  return list.filter((y) => y.c !== x.c && words(y.n).includes(w)).sort((a, b) => (b.cap || 0) - (a.cap || 0)).slice(0, 6);
}

let n = 0;
const urls = [];
for (const x of list) {
  const d = det[x.c] || {};
  const w = whale.items[x.c] || null;
  const name = x.n;
  const hasEst = x.est != null && !d.error;
  const title = `${name} 밤 예상가·실시간 추정 iNAV | 데이앤나잇 ETF`;
  const desc = hasEst
    ? `${name} 밤사이 예상 가격 ${won(x.est)} (${sign(x.pct)}), 오늘 종가 ${won(x.p)}, 거래대금 ${eok((x.amt || 0) / 100)}. 미국장 움직임을 반영한 추정 iNAV와 외국인·기관 큰손 동향.`
    : `${name} 오늘 종가 ${won(x.p)} (${sign(x.ch)}), 거래대금 ${eok((x.amt || 0) / 100)}. 외국인·기관 순매수와 자금 유입 동향을 확인하세요.`;
  const url = `${SITE}/etf/${x.c}/`;
  const top = (d.top || []).slice(0, 6);
  const rel = related(x);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(name)} 밤 예상가 · 데이앤나잇 ETF"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg"><meta name="theme-color" content="#0f1115"><style>${CSS}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a>
<h1>${esc(name)}</h1><div class="sub">국내 상장 해외 ETF · ${atTxt} 계산</div>
${hasEst ? `<div class="big">${won(x.est)} <span class="${cls(x.pct)}" style="font-size:20px">${sign(x.pct)}</span></div><div class="sub">밤사이 예상 가격 (마감 iNAV 대비)</div>`
    : `<div class="big">${won(x.p)} <span class="${cls(x.ch)}" style="font-size:20px">${sign(x.ch)}</span></div><div class="sub">오늘 종가</div>`}
<div class="card kv">
<div><span>오늘 종가</span><b>${won(x.p)} <small class="${cls(x.ch)}">${sign(x.ch)}</small></b></div>
<div><span>오늘 거래대금</span><b>${eok((x.amt || 0) / 100)}</b></div>
${d.nav ? `<div><span>공식 NAV (${esc(d.navDate || '')})</span><b>${won(d.nav)}</b></div>` : ''}
${x.cap ? `<div><span>시가총액</span><b>${eok(x.cap)}</b></div>` : ''}
${d.fxNow ? `<div><span>지금 원/달러</span><b>${d.fxNow}</b></div>` : ''}
${d.hedged != null ? `<div><span>환헤지</span><b>${d.hedged ? '예 (H)' : '아니오'}</b></div>` : ''}
</div>
${w ? `<div class="card"><h2>🐋 큰손 동향 <span class="sub">${md(w.d)} 기준</span></h2><div class="kv">
<div><span>외국인 하루 / 5일</span><b><span class="${cls(w.f1)}">${ek(w.f1)}</span> / <span class="${cls(w.f5)}">${ek(w.f5)}</span></b></div>
<div><span>기관 하루 / 5일</span><b><span class="${cls(w.o1)}">${ek(w.o1)}</span> / <span class="${cls(w.o5)}">${ek(w.o5)}</span></b></div>
<div><span>자금 유입 하루 / 20일</span><b><span class="${cls(w.fl1)}">${ek(w.fl1)}</span> / <span class="${cls(w.fl20)}">${ek(w.fl20)}</span></b></div>
<div><span>연속 매매</span><b>${w.fs >= 2 ? `외인 ${w.fs}일 매수` : w.fs <= -2 ? `외인 ${-w.fs}일 매도` : w.os >= 2 ? `기관 ${w.os}일 매수` : w.os <= -2 ? `기관 ${-w.os}일 매도` : '-'}</b></div>
</div></div>` : ''}
${top.length ? `<div class="card"><h2>많이 담은 종목</h2><table>${top.map((t) => `<tr><td>${esc(t.n || t.t)}</td><td>${t.w}%</td></tr>`).join('')}</table></div>` : ''}
<a class="cta" href="/#etf=${x.c}">실시간 화면에서 보기 →</a>
${rel.length ? `<div class="card rel"><h2>비슷한 ETF</h2>${rel.map((y) => `<a href="/etf/${y.c}/">${esc(y.n)}</a>`).join('')}</div>` : ''}
<p class="note">추정치이며 투자 권유가 아닙니다. 밤 예상 가격은 마감 iNAV, 구성종목 비중, 미국 시세, 원/달러 환율로 계산하며 미국 정규장이 닫혀 있을 때는 지수 선물 움직임을 반영합니다. 외국인·기관 금액은 순매수 수량 × 종가로 계산한 추정치입니다. <a href="/privacy.html">개인정보처리방침</a></p>
</body></html>`;
  const dir = path.join(siteDir, 'etf', x.c);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  urls.push(url); n++;
}

// ETF 전체 목록 페이지 (검색엔진이 개별 페이지를 찾도록)
const all = list.slice().sort((a, b) => (b.cap || 0) - (a.cap || 0));
fs.writeFileSync(path.join(siteDir, 'etf', 'index.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'">
<title>국내 상장 해외 ETF 전체 목록 · 밤 예상가 | 데이앤나잇 ETF</title><meta name="description" content="국내에 상장된 해외 ETF ${all.length}개의 밤사이 예상 가격, 거래대금, 외국인·기관 동향을 한곳에서.">
<link rel="canonical" href="${SITE}/etf/"><link rel="icon" href="/icon.svg"><style>${CSS}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a><h1>국내 상장 해외 ETF 전체 목록</h1><div class="sub">${all.length}개 · ${atTxt} 기준</div>
<div class="card"><table>${all.map((x) => `<tr><td><a href="/etf/${x.c}/" style="color:var(--ink)">${esc(x.n)}</a></td><td class="${cls(x.ch)}">${won(x.p)}</td></tr>`).join('')}</table></div></body></html>`);
urls.push(`${SITE}/etf/`);

const today = atKst.toISOString().slice(0, 10);
fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [`${SITE}/`, ...urls].map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n') + `\n</urlset>\n`);
fs.writeFileSync(path.join(siteDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(JSON.stringify({ pages: n, sitemap: urls.length + 1 }));
