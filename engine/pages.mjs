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

const CATLINKS = ['leverage:레버리지·인버스','covered-call:커버드콜·월배당','nasdaq100:나스닥100','sp500:S&P500','dividend:배당','semiconductor:반도체','power:전력·원자력','space:우주·방산','ai-tech:AI·테크','healthcare:헬스케어','china:중국·홍콩','global:글로벌','commodity:금·원자재'].map((s) => { const [k, v] = s.split(':'); return `<a href="/c/${k}/">${v}</a>`; }).join('');
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
  const faq = [];
  if (hasEst) faq.push([`${name} 밤에 가격을 볼 수 있나요?`, `국내 ETF라 밤에는 거래되지 않지만, 한국 장 마감 후 미국 시세와 환율을 반영해 추정할 수 있어요. ${atTxt} 기준 예상 가격은 ${won(x.est)}으로, 마감 iNAV 대비 ${sign(x.pct)}예요.`]);
  if (hasEst) faq.push([`${name} 내일 시가는 얼마로 시작할까요?`, `밤사이 미국 시장 변화는 다음 날 오전 9시 시가에 반영돼요. 지금 추정으로는 ${won(x.est)} 근처예요. 추정치라 장 시작 직전 뉴스나 호가에 따라 달라질 수 있어요.`]);
  if (d.hedged != null) faq.push([`${name}, 환헤지 상품인가요?`, d.hedged ? `네, 환헤지(H) 상품이라 원/달러 환율 변화의 영향을 거의 받지 않아요.` : `아니요, 환노출 상품이라 미국 자산 수익에 원/달러 환율 변화가 함께 반영돼요.`]);
  if (top.length) faq.push([`${name}에는 어떤 종목이 담겨 있나요?`, `비중이 큰 종목은 ${top.slice(0, 3).map((t) => `${t.n || t.t}(${t.w}%)`).join(', ')} 등이에요.`]);
  const faqLd = faq.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }).replace(/</g, '\\u003c')}</script>` : '';
  const faqHtml = faq.length ? `<div class="card"><h2>자주 묻는 질문</h2>${faq.map(([q, a]) => `<p style="margin:10px 0 2px"><b>Q. ${esc(q)}</b></p><p style="margin:0;color:#c9ced8">${esc(a)}</p>`).join('')}</div>` : '';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(name)} 밤 예상가 · 데이앤나잇 ETF"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg"><meta name="theme-color" content="#0f1115">${faqLd}<style>${CSS}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a>
<h1>${esc(name)}</h1><div class="sub">국내 상장 해외 ETF · ${atTxt} 계산</div>
${hasEst ? `<div class="card" style="text-align:center"><div class="sub">🌙 한국 장 마감 후 지금까지</div><div class="big ${cls(x.pct)}" style="font-size:44px;margin-top:2px">${x.pct > 0.005 ? '▲' : x.pct < -0.005 ? '▼' : ''}${Math.abs(x.pct).toFixed(2)}%</div><div>예상 가격 <b>${won(x.est)}</b> <span class="sub">(오늘 종가 ${won(x.p)})</span></div></div>`
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
${faqHtml}
<div class="card rel"><h2>오늘 밤 시황</h2><a href="/night/">${atKst.getUTCMonth() + 1}월 ${atKst.getUTCDate()}일 해외 ETF 밤 예상 등락 →</a></div>
${rel.length ? `<div class="card rel"><h2>비슷한 ETF</h2>${rel.map((y) => `<a href="/etf/${y.c}/">${esc(y.n)}</a>`).join('')}</div>` : ''}
<div class="card rel"><h2>분류별 보기</h2>__CATLINKS__</div>
<p class="note"><a href="/guide/night-price/">밤에 국내 ETF 가격 보는 법</a> · <a href="/guide/inav/">iNAV란?</a><br>추정치이며 투자 권유가 아닙니다. 밤 예상 가격은 마감 iNAV, 구성종목 비중, 미국 시세, 원/달러 환율로 계산하며 미국 정규장이 닫혀 있을 때는 지수 선물 움직임을 반영합니다. 외국인·기관 금액은 순매수 수량 × 종가로 계산한 추정치입니다. <a href="/privacy.html">개인정보처리방침</a></p>
</body></html>`;
  const html2 = html.replace('__CATLINKS__', CATLINKS);
  const dir = path.join(siteDir, 'etf', x.c);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html2);
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

// ---------- 카테고리 페이지 ----------
const CATS=[
 ['leverage','레버리지·인버스',/레버리지|인버스|2X|곱버스/i,'2배·3배로 움직이는 레버리지, 반대로 움직이는 인버스 ETF'],
 ['covered-call','커버드콜·월배당',/커버드콜|프리미엄|인컴|월배당|타겟데일리/,'매달 분배금을 주는 커버드콜·월배당 ETF'],
 ['nasdaq100','나스닥100',/나스닥100|NASDAQ100|나스닥 100/i,'애플·엔비디아·마이크로소프트 등 나스닥 상위 100개 기업에 투자하는 ETF'],
 ['sp500','S&P500',/S&P500|S&P 500|S&P/,'미국 대표 500개 기업에 투자하는 S&P500 ETF'],
 ['dividend','배당',/배당|다우존스|SCHD|리츠|REIT/i,'미국 배당주·다우존스 배당 ETF'],
 ['semiconductor','반도체',/반도체|HBM|DRAM|메모리|필라델피아/,'필라델피아 반도체·HBM 등 반도체 ETF'],
 ['power','전력·원자력·에너지',/전력|원자력|SMR|에너지|우라늄|인프라|유틸리티/,'AI 전력·원자력·SMR·에너지 ETF'],
 ['space','우주·방산',/우주|방산|항공|조선/,'우주항공·방산 ETF'],
 ['ai-tech','AI·테크',/AI|테크|빅테크|소프트웨어|클라우드|사이버|데이터센터|양자|로봇|휴머노이드|TOP10|TOP7|FANG|나스닥|플랫폼|메타버스|자율주행|전기차|2차전지|리튬|혁신/i,'AI·빅테크·로봇·양자컴퓨팅 ETF'],
 ['healthcare','헬스케어·바이오',/헬스|바이오|의료|비만|제약/,'헬스케어·바이오 ETF'],
 ['china','중국·홍콩',/차이나|중국|항셍|CSI|홍콩/,'중국·홍콩 항셍테크 ETF'],
 ['global','인도·일본·글로벌',/인도|일본|니케이|베트남|대만|유럽|독일|글로벌|선진국|MSCI|신흥|아시아|멕시코|브라질/i,'인도·일본·베트남·글로벌 ETF'],
 ['commodity','금·원자재',/골드|금현물|금선물|국제금|금채굴|은선물|원유|구리|원자재|농산물|천연가스/,'금·원유·원자재 ETF'],
];
const catOf=(n)=>{for(const c of CATS) if(c[2].test(n)) return c; return null};
const catLinks=CATS.map(c=>`<a href="/c/${c[0]}/">${c[1]}</a>`).join('');
for (const c of CATS) {
  const xs=list.filter(x=>catOf(x.n)===c).sort((a,b)=>(b.cap||0)-(a.cap||0));
  if(!xs.length) continue;
  const withEst=xs.filter(x=>x.est!=null);
  const avg=withEst.length?withEst.reduce((s,x)=>s+x.pct,0)/withEst.length:null;
  const t=`${c[1]} ETF 비교 · 밤 예상가 순위 (${xs.length}개) | 데이앤나잇 ETF`;
  const desc=`국내 상장 ${c[3]} ${xs.length}개를 한눈에 비교. 한국 장 마감 후 밤사이 예상 등락, 오늘 종가, 거래대금, 시가총액.${avg!=null?` 지금 평균 ${sign(avg)}.`:''}`;
  const url=`${SITE}/c/${c[0]}/`;
  const rows=xs.map((x,i)=>`<tr><td>${i+1}</td><td><a href="/etf/${x.c}/" style="color:var(--ink)">${esc(x.n)}</a><div class="sub">종가 ${won(x.p)} · 거래대금 ${eok((x.amt||0)/100)}</div></td><td class="${cls(x.est!=null?x.pct:x.ch)}" style="font-weight:800">${x.est!=null?sign(x.pct):`<span class="sub">오늘</span> ${sign(x.ch)}`}</td></tr>`).join('');
  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${esc(t)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(c[1])} ETF 밤 예상가 비교 · 데이앤나잇 ETF"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg"><meta name="theme-color" content="#0f1115"><style>${CSS} td:first-child{color:var(--mute);width:28px} td .sub{font-size:12px}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a>
<h1>${esc(c[1])} ETF 비교</h1><div class="sub">${esc(c[3])} · ${xs.length}개 · ${atTxt} 기준</div>
${avg!=null?`<div class="card" style="text-align:center"><div class="sub">🌙 한국 장 마감 후 지금까지 (평균)</div><div class="big ${cls(avg)}" style="font-size:40px;margin-top:2px">${sign(avg)}</div></div>`:''}
<div class="card"><table>${rows}</table></div>
<a class="cta" href="/">실시간 순위 보기 →</a>
<div class="card rel"><h2>다른 분류</h2>${catLinks}</div>
<p class="note">시가총액 순 정렬 · 마감 후 등락은 마감 iNAV 대비 추정치이며 투자 권유가 아닙니다. <a href="/guide/inav/">iNAV가 뭔가요?</a></p></body></html>`;
  fs.mkdirSync(path.join(siteDir,'c',c[0]),{recursive:true});
  fs.writeFileSync(path.join(siteDir,'c',c[0],'index.html'),html);
  urls.push(url);
}
// ---------- 오늘 밤 시황 (매 갱신마다 새로 씀) ----------
{
  const M = atKst.getUTCMonth() + 1, D = atKst.getUTCDate(), H = atKst.getUTCHours();
  const plain = list.filter((x) => x.est != null && !x.w && !/레버리지|인버스/.test(x.n));
  const avgOf = (k) => { const a = plain.filter((x) => catOf(x.n) && catOf(x.n)[0] === k && !/\(H\)/.test(x.n)); return a.length ? a.reduce((s, x) => s + x.pct, 0) / a.length : null; };
  const nq = avgOf('nasdaq100'), sp = avgOf('sp500'), se = avgOf('semiconductor');
  const up = plain.filter((x) => x.pct > 0.005).length, dn = plain.filter((x) => x.pct < -0.005).length;
  const sorted = plain.slice().sort((a, b) => b.pct - a.pct);
  const tops = sorted.slice(0, 10), bots = sorted.slice(-10).reverse();
  const slot = H >= 18 || H < 3 ? '밤' : H < 7 ? '새벽' : '아침';
  const t = `${M}월 ${D}일 ${slot} 해외 ETF 예상 등락 — 나스닥100 ${sign(nq)} · S&P500 ${sign(sp)}`;
  const desc = `${M}월 ${D}일 ${atTxt.split(' ').pop()} 기준, 한국 장 마감 후 국내 상장 해외 ETF 밤사이 예상 등락. 나스닥100 ETF 평균 ${sign(nq)}, S&P500 ETF ${sign(sp)}, 반도체 ETF ${sign(se)}. 오른 ETF ${up}개, 내린 ETF ${dn}개.`;
  const row = (x, i) => `<tr><td>${i + 1}</td><td><a href="/etf/${x.c}/" style="color:var(--ink)">${esc(x.n)}</a><div class="sub">예상 ${won(x.est)} · 종가 ${won(x.p)}</div></td><td class="${cls(x.pct)}" style="font-weight:800">${sign(x.pct)}</td></tr>`;
  const box = (n, v) => `<div style="text-align:center"><span>${n}</span><b class="${cls(v)}" style="font-size:20px">${sign(v)}</b></div>`;
  const url = `${SITE}/night/`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${esc(t)} | 데이앤나잇 ETF</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: t, datePublished: at.toISOString(), dateModified: at.toISOString(), author: { '@type': 'Organization', name: '데이앤나잇 ETF' }, publisher: { '@type': 'Organization', name: '데이앤나잇 ETF' } }).replace(/</g, '\\u003c')}</script>
<link rel="icon" href="/icon.svg"><meta name="theme-color" content="#0f1115"><style>${CSS} td:first-child{color:var(--mute);width:28px} td .sub{font-size:12px} .kv3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.kv3 div{background:#13161c;border-radius:10px;padding:10px 4px}.kv3 span{display:block;color:var(--mute);font-size:12px}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a>
<h1>${M}월 ${D}일 ${slot} 해외 ETF 예상 등락</h1><div class="sub">${atTxt} 계산 · 한국 장 마감(15:30) 후 지금까지 · 하루 4번 자동 갱신</div>
<div class="card"><div class="sub" style="margin-bottom:8px">🌙 분류별 평균 (레버리지·인버스·환헤지 제외)</div><div class="kv3">${box('나스닥100', nq)}${box('S&amp;P500', sp)}${box('반도체', se)}</div>
<p style="margin:12px 0 0">밤사이 추정 기준으로 해외 ETF <b class="up">${up}개</b>가 오르고 <b class="down">${dn}개</b>가 내렸어요. 가장 많이 오른 ETF는 <b>${esc(tops[0] ? tops[0].n : '-')}</b>(${sign(tops[0] && tops[0].pct)}), 가장 많이 내린 ETF는 <b>${esc(bots[0] ? bots[0].n : '-')}</b>(${sign(bots[0] && bots[0].pct)})예요. 이 변화는 다음 날 오전 9시 한국 장 시가에 반영돼요.</p></div>
<div class="card"><h2>🔺 많이 오를 것으로 보이는 ETF</h2><table>${tops.map(row).join('')}</table></div>
<div class="card"><h2>🔻 많이 내릴 것으로 보이는 ETF</h2><table>${bots.map(row).join('')}</table></div>
<a class="cta" href="/">실시간 순위 전체 보기 →</a>
<div class="card rel"><h2>분류별 보기</h2>${catLinks}</div>
<p class="note">마감 iNAV, 구성종목 비중, 미국 시세, 원/달러 환율로 계산한 추정치이며 투자 권유가 아닙니다. 미국 정규장이 닫혀 있을 때는 지수 선물 움직임을 반영합니다. 밤 추정은 시가총액 상위 150개 대상. <a href="/guide/night-price/">밤에 ETF 가격 보는 법</a> · <a href="/guide/">가이드</a></p></body></html>`;
  fs.mkdirSync(path.join(siteDir, 'night'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'night', 'index.html'), html);
  urls.unshift(url);
}
// ---------- 일정 페이지 (/event/<id>/): 과거 같은 상황 통계, 검색 유입용 ----------
{
  const evd = read('events.json');
  const kday = (d) => { const t = new Date(d + 'T12:00:00Z'); return `${t.getUTCFullYear()}년 ${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일(${'일월화수목금토'[t.getUTCDay()]})`; };
  const evLinks = [];
  for (const e of (evd && evd.ev) || []) {
    const k = e.assets[0][0], m = e.stats[k]; if (!m) continue;
    const url = `${SITE}/event/${e.id}/`;
    const t = `${e.seo}`;
    const desc = `${e.title} ${e.lab} ${e.assets[0][1]}는 과거 ${m.n}번 중 ${m.up}번 상승했어요(평균 ${sign(m.avg)}). ${e.next ? `다음 일정 ${kday(e.next)}.` : ''} 회차별 기록과 국내 ETF 반응까지 정리.`;
    const cards = e.assets.filter((a) => e.stats[a[0]]).map(([s, n, mk]) => { const x = e.stats[s]; return `<div class="card"><h2>${esc(n)}${mk === 'kr' ? ' <span class="sub">(한국장)</span>' : ''}</h2><p style="margin:0"><b style="font-size:22px">${x.up}/${x.n}번 상승</b> · 평균 <b class="${cls(x.avg)}">${sign(x.avg)}</b></p><p class="sub" style="margin:6px 0 0">평균 움직임 ±${x.abs.toFixed(1)}% · 최고 <span class="up">${sign(x.max)}</span>(${x.maxD}) · 최저 <span class="down">${sign(x.min)}</span>(${x.minD})</p></div>`; }).join('');
    const cols = e.assets.filter((a) => e.stats[a[0]]);
    const tbl = `<table><tr><td class="sub">날짜</td>${cols.map((a) => `<td class="sub" style="text-align:right">${esc(a[1].replace('TIGER ', ''))}</td>`).join('')}</tr>${e.rows.map((r) => `<tr><td>${r.d}</td>${cols.map((a) => `<td class="${cls(r.r[a[0]])}" style="text-align:right">${r.r[a[0]] == null ? '-' : sign(r.r[a[0]])}</td>`).join('')}</tr>`).join('')}</table>`;
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${esc(t)} | 데이앤나잇 ETF</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg"><meta name="theme-color" content="#0f1115"><style>${CSS} table{font-size:13px}</style></head><body>
<a class="top" href="/"><img src="/icon.svg" alt="">데이앤나잇 ETF</a>
<h1>${e.icon} ${esc(e.title)}: ${esc(e.lab)} 시장은 어떻게 움직였을까</h1>
<div class="sub">${e.next ? `다음 일정 <b>${kday(e.next)}</b> · ${esc(e.when)} (${esc(e.kst)})` : '다음 일정 발표 전'}</div>
<div class="card"><p style="margin:0;font-size:17px">과거 <b>${m.n}번</b> 중 ${esc(e.lab)} ${esc(e.assets[0][1])}는 <b class="up">${m.up}번 상승</b>, <b class="down">${m.n - m.up}번 하락</b>했어요. 평균 등락은 <b class="${cls(m.avg)}">${sign(m.avg)}</b>, 평균 움직임 폭은 ±${m.abs.toFixed(1)}%예요.</p><p class="sub" style="margin:8px 0 0">${esc(e.desc)}</p></div>
${cards}
<a class="cta" href="/?ev=${e.id}">앱 화면으로 보기 · 실시간 밤 시세 →</a>
<div class="card"><h2>회차별 기록</h2>${tbl}</div>
<p class="note">과거 통계일 뿐 앞으로도 같다는 보장은 없으며 투자 권유가 아닙니다. 미국 지수 종가 기준, 한국 ETF는 발표 다음 날 아침 시작한 거래일 기준이며 상장 이후 기록만 포함합니다. <a href="/night/">오늘 밤 해외 ETF 시황</a> · <a href="/guide/">가이드</a></p></body></html>`;
    fs.mkdirSync(path.join(siteDir, 'event', e.id), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'event', e.id, 'index.html'), html);
    urls.unshift(url); evLinks.push(`<a href="/event/${e.id}/">${esc(e.title)}</a>`);
  }
}
for (const g of ['','inav','night-price','us-market-hours','premium-discount','hedged','futures']) urls.push(`${SITE}/guide/${g}${g?'/':''}`);

const today = atKst.toISOString().slice(0, 10);
fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [`${SITE}/`, ...urls].map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n') + `\n</urlset>\n`);
fs.writeFileSync(path.join(siteDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(JSON.stringify({ pages: n, sitemap: urls.length + 1 }));
