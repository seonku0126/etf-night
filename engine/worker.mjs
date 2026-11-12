// ETF 밤 시세 — Cloudflare Worker 한 파일 (앱 화면 + 데이터 API)
// 배포: Cloudflare 대시보드 > Workers > 새 Worker > 이 파일 전체를 붙여넣고 Deploy.
// 선택: KV 네임스페이스를 "KV" 이름으로 연결하면 구성종목을 캐시해 더 빨라집니다.
//
// 계산: 추정가 = 전일 NAV × (원화 비중 + 달러 비중 × (1 + 구성종목 가중 등락률) × 지금 환율 / NAV에 쓰인 환율)
//   - 구성종목 등락률 = 지금 가격(프리·애프터 포함) / NAV 계산에 쓰인 미국 종가(NAV 날짜 이전 마지막 미국 거래일)
//   - NAV에 쓰인 환율 ≈ NAV 날짜 직전 한국 영업일의 하나은행 최종 고시 매매기준율 (검증: 133690 11/6 오차 −0.04%)
// 데이터: 네이버(ETF 목록·NAV·환율), FunETF(구성종목), Yahoo(미국 시세·야간 환율). 개발·시험용 무료 출처입니다.

const UA = { 'user-agent': 'Mozilla/5.0 (ETF night app)' };
const mem = new Map();

async function cached(env, key, ttlSec, fn) {
  const now = Date.now();
  const m = mem.get(key);
  if (m && m.exp > now) return m.v;
  if (env && env.KV) {
    try { const s = await env.KV.get(key, 'json'); if (s && s.exp > now) { mem.set(key, s); return s.v; } } catch (e) {}
  }
  const v = await fn();
  const rec = { v, exp: now + ttlSec * 1000 };
  mem.set(key, rec);
  if (env && env.KV && ttlSec >= 600) { try { await env.KV.put(key, JSON.stringify(rec), { expirationTtl: ttlSec }); } catch (e) {} }
  return v;
}

async function getText(url, opt = {}) {
  let r = await fetch(url, { headers: { ...UA, ...(opt.headers || {}) } });
  for (const wait of [1500, 4000, 8000]) {
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((ok) => setTimeout(ok, wait));
    r = await fetch(url, { headers: { ...UA, ...(opt.headers || {}) } });
  }
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return opt.buffer ? r.arrayBuffer() : r.text();
}
const getJSON = async (url) => JSON.parse(await getText(url));

// ---------- 종목코드 → ISIN ----------
export function isinOf(code) {
  const body = 'KR7' + code.toUpperCase() + '00';
  let digits = '';
  for (const ch of body) digits += /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  let sum = 0, dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = +digits[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return body + ((10 - (sum % 10)) % 10);
}

// ---------- ETF 목록 (네이버) ----------
async function etfList(env) {
  return cached(env, 'list:v2', 600, async () => {
    const buf = await getText('https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0', { buffer: true });
    let txt, namesOk = true;
    try { txt = new TextDecoder('euc-kr').decode(buf); } catch (e) { txt = new TextDecoder('utf-8').decode(buf); namesOk = false; }
    const arr = JSON.parse(txt).result.etfItemList;
    let names = null;
    if (!namesOk) names = await etfNamesUtf8(env);
    return arr.map((x) => ({
      code: x.itemcode, name: names ? (names[x.itemcode] || x.itemcode) : x.itemname, tab: x.etfTabCode,
      price: x.nowVal, chg: x.changeRate, nav: x.nav, cap: x.marketSum, amt: x.amonut, vol: x.quant,
    }));
  });
}
async function etfNamesUtf8(env) {
  return cached(env, 'names:v1', 86400, async () => {
    const out = {};
    for (let p = 1; p <= 15; p++) {
      const d = await getJSON(`https://m.stock.naver.com/api/stocks/etf?page=${p}&pageSize=100`);
      for (const s of d.stocks || []) out[s.itemCode] = s.stockName;
      if (!d.stocks || d.stocks.length < 100) break;
    }
    return out;
  });
}

// ---------- 원/달러 (네이버 하나은행 일별 + Yahoo 실시간) ----------
async function fxHistory(env) {
  return cached(env, 'fxhist:v1', 1800, async () => {
    const d = await getJSON('https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW&page=1&pageSize=20');
    return (d.result || []).map((x) => ({ d: x.localTradedAt, c: +String(x.closePrice).replace(/,/g, '') }));
  });
}

// ---------- 구성종목·NAV (FunETF 페이지에 들어 있는 데이터) ----------
function sliceArray(s, start) {
  const i = s.indexOf('[', start);
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}
async function holdings(env, code) {
  const sd = new Date(Date.now() + 9 * 3600e3 - 16 * 3600e3).toISOString().slice(0, 10); // 22:40~다음날 16시를 한 '세션'으로 묶어 구성종목은 세션당 1번만 받음
  return cached(env, env && env.KV ? 'hold:v7:' + code + ':' + sd : 'hold:v7:' + code, env && env.KV ? 20 * 3600 : 3600, async () => {
    const isin = isinOf(code);
    const html = await getText(`https://www.funetf.co.kr/product/etf/view/${isin}`);
    const k = html.indexOf('setPdfChart([');
    let rows = [];
    if (k > 0) { const a = sliceArray(html, k); if (a) rows = JSON.parse(a); }
    const m = html.match(/prd-info-top-summary-time">\s*(\d\d)\.(\d\d)\.(\d\d)/);
    const navDate = m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
    const nm = html.match(/id="goNav">기준가\(iNAV\)[\s\S]{0,6000}?<p class="top"><span>([\d,]+(?:\.\d+)?)<\/span>\s*원/);
    const nav = nm ? +nm[1].replace(/,/g, '') : null;
    const gi = html.indexOf('id="goNav"');
    const ch = (gi > 0 ? html.slice(gi, gi + 8000) : '').match(/<p class="top"><span>[\d,.]+<\/span>\s*원<\/p>\s*<p class="bottom">\s*<span class="(plus|minus|zero)?[^"]*">\s*([\d,.]+)/);
    const navChg = ch ? (ch[1] === 'minus' ? -1 : 1) * +ch[2].replace(/,/g, '') : null;
    const pdf = html.match(/let etfPdfYmd = "(\d{8})"/);
    // 한국 장중에는 이 자리에 실시간 iNAV가 나옴 → 확정 NAV = iNAV − 전일 대비 변동
    const hdr = (html.match(/prd-info-top-summary-time">\s*([^<]+)</) || [])[1] || '';
    const intraday = /장중/.test(hdr);
    if (intraday && nav != null && navChg != null) {
      return {
        isin, navDate: null, nav: +(nav - navChg).toFixed(2), navChg: null, inavLive: nav, intraday: true, pdfDate: pdf ? pdf[1] : null,
        rows: rows.filter((x) => x.evP != null && isFinite(+x.evP)).map((x) => ({ ...normTicker(x.ticker), n: x.citmNm || '', w: +x.evP })),
      };
    }
    return {
      isin, navDate, nav, navChg, intraday: false, pdfDate: pdf ? pdf[1] : null,
      rows: rows.filter((x) => x.evP != null && isFinite(+x.evP)).map((x) => ({ ...normTicker(x.ticker), n: x.citmNm || '', w: +x.evP })),
    };
  });
}

// ---------- 미국 시세 (Yahoo spark, 20개씩) ----------
const ysym = (t) => (/\.[A-Z]{1,2}$/.test(t) ? t : t.replace(/\./g, '-'));
async function sparkBatch(syms, range, interval, prepost) {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(syms.join(','))}&range=${range}&interval=${interval}${prepost ? '&includePrePost=true' : ''}`;
  try {
    const d = await getJSON(url);
    return (d.spark && d.spark.result) || [];
  } catch (e) {
    // 한 종목 때문에 묶음 전체가 실패하면 반으로 나눠 다시 시도
    if (syms.length <= 1) return [];
    const h = Math.ceil(syms.length / 2);
    const [a, b] = await Promise.all([sparkBatch(syms.slice(0, h), range, interval, prepost), sparkBatch(syms.slice(h), range, interval, prepost)]);
    return a.concat(b);
  }
}
// 블룸버그식 거래소 코드 → Yahoo 접미사와 지역(마감 시각 기준)
const EXCH = {
  US: ['', 'us'], UW: ['', 'us'], UN: ['', 'us'], UQ: ['', 'us'], UP: ['', 'us'], UA: ['', 'us'], UR: ['', 'us'], UF: ['', 'us'],
  CN: ['.TO', 'us'], CT: ['.TO', 'us'],
  LN: ['.L', 'eu'], GY: ['.DE', 'eu'], GR: ['.DE', 'eu'], FP: ['.PA', 'eu'], NA: ['.AS', 'eu'], SW: ['.SW', 'eu'], SE: ['.SW', 'eu'],
  IM: ['.MI', 'eu'], SM: ['.MC', 'eu'], DC: ['.CO', 'eu'], SS: ['.ST', 'eu'], FH: ['.HE', 'eu'], BB: ['.BR', 'eu'], ID: ['.IR', 'eu'],
  JT: ['.T', 'asia'], JP: ['.T', 'asia'], HK: ['.HK', 'asia'], TT: ['.TW', 'asia'], AU: ['.AX', 'asia'], IN: ['.NS', 'asia'], IB: ['.NS', 'asia'],
  C1: ['.SS', 'asia'], C2: ['.SZ', 'asia'], CH: ['', 'asia'], KS: ['', 'kr'], KQ: ['', 'kr'],
};
function normTicker(t) {
  if (!t) return { t: null, reg: 'kr' };
  t = String(t).trim().toUpperCase();
  const m = t.match(/^(\S+)\s+([A-Z0-9]{2})$/);
  if (m && EXCH[m[2]]) {
    let [suf, reg] = EXCH[m[2]];
    let base = m[1];
    if (m[2] === 'HK') base = base.replace(/^0+/, '').padStart(4, '0');
    if (m[2] === 'CH') suf = /^6/.test(base) ? '.SS' : '.SZ';
    return { t: reg === 'kr' ? base : base + suf, reg };
  }
  if (/^[0-9][0-9A-Z]{5}$/.test(t)) return { t, reg: 'kr' };
  return { t, reg: 'us' };
}
const okTicker = (t) => !!t && /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(t);
const etDate = (ts, off) => new Date((ts + off) * 1000).toISOString().slice(0, 10);
async function quotes(env, syms) {
  // 반환: {SYM: {daily: {YYYY-MM-DD: close}, last, lastTs}}
  const out = {}, need = [];
  for (const s of syms) { const c = mem.get('q:' + s); if (c && c.exp > Date.now()) out[s] = c.v; else need.push(s); }
  const batches = [];
  for (let i = 0; i < need.length; i += 20) batches.push(need.slice(i, i + 20));
  await Promise.all(batches.map(async (b) => {
    const [daily, live] = await Promise.all([sparkBatch(b, '10d', '1d', false), sparkBatch(b, '1d', '5m', true)]);
    const rec = {};
    for (const x of daily) {
      const r = x.response && x.response[0]; if (!r || !r.timestamp) continue;
      const off = (r.meta && r.meta.gmtoffset) || 0, cl = r.indicators.quote[0].close, dd = {};
      r.timestamp.forEach((t, i) => { if (cl[i] != null) dd[etDate(t, off)] = cl[i]; });
      rec[x.symbol] = { daily: dd, reg: r.meta.regularMarketPrice, regTs: r.meta.regularMarketTime, last: r.meta.regularMarketPrice, lastTs: r.meta.regularMarketTime };
    }
    for (const x of live) {
      const r = x.response && x.response[0]; if (!r || !r.timestamp || !rec[x.symbol]) continue;
      const cl = r.indicators.quote[0].close;
      for (let i = cl.length - 1; i >= 0; i--) if (cl[i] != null) {
        if (r.timestamp[i] >= (rec[x.symbol].lastTs || 0)) { rec[x.symbol].last = cl[i]; rec[x.symbol].lastTs = r.timestamp[i]; }
        break;
      }
    }
    for (const s of b) if (rec[s]) { out[s] = rec[s]; mem.set('q:' + s, { v: rec[s], exp: Date.now() + 60000 }); }
  }));
  return out;
}
function refClose(q, navDate, reg) {
  // 아시아 시장은 NAV 날짜 당일 종가, 미국·유럽은 그 전날 종가가 NAV에 반영됨
  const ds = Object.keys(q.daily).filter((d) => (reg === 'asia' ? d <= navDate : d < navDate)).sort();
  return ds.length ? q.daily[ds[ds.length - 1]] : null;
}

// ---------- 한국 장 마감(15:30) 때 원/달러 ----------
async function fxCloseMap(env) {
  return cached(env, 'fxclose:v1', 600, async () => {
    const r = (await sparkBatch(['KRW=X'], '5d', '5m', false))[0];
    const x = r && r.response && r.response[0];
    const out = {};
    if (!x || !x.timestamp) return out;
    const cl = x.indicators.quote[0].close;
    x.timestamp.forEach((t, i) => {
      if (cl[i] == null) return;
      const k = new Date((t + 9 * 3600) * 1000).toISOString();
      const d = k.slice(0, 10), hm = k.slice(11, 16);
      if (hm <= '15:25') out[d] = cl[i]; // 15:25~15:30 봉의 종가 = 15:30 무렵 환율
    });
    return out;
  });
}

// ---------- 미국 동부 시각 ----------
const ETF_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function etParts(ms) {
  const p = Object.fromEntries(ETF_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute, wd: p.weekday };
}
function etEpoch(date, h, m) {
  const [y, mo, d] = date.split('-').map(Number);
  for (const off of [4, 5]) { const t = Date.UTC(y, mo - 1, d, h + off, m); if (etParts(t).min === h * 60 + m) return t; }
  return Date.UTC(y, mo - 1, d, h + 5, m);
}
function usSession(ms) {
  const e = etParts(ms);
  const wk = !['Sat', 'Sun'].includes(e.wd);
  const regular = wk && e.min >= 570 && e.min < 960;
  // 선물 휴장: 금 17:00 ~ 일 18:00 (ET)
  const futClosed = (e.wd === 'Fri' && e.min >= 1020) || e.wd === 'Sat' || (e.wd === 'Sun' && e.min < 1080);
  return { regular, futClosed, et: e };
}
async function futIntraday(env, sym) {
  return cached(env, 'fut:' + sym, 60, async () => {
    const r = (await sparkBatch([sym], '5d', '5m', false))[0];
    const x = r && r.response && r.response[0];
    if (!x || !x.timestamp) return null;
    const cl = x.indicators.quote[0].close, pts = [];
    x.timestamp.forEach((t, i) => { if (cl[i] != null) pts.push([t, cl[i]]); });
    return pts;
  });
}

// ---------- 지수로 대신 계산하는 ETF (선물·스왑·레버리지·인버스) ----------
function indexProxy(name) {
  const n = name.replace(/\s/g, '');
  let sym = null;
  if (/나스닥100|NASDAQ100/i.test(n)) sym = 'NQ=F';
  else if (/S&P500|S&P|SP500/i.test(n)) sym = 'ES=F';
  else if (/필라델피아|반도체/.test(n)) sym = '^SOX';
  else if (/다우존스|다우/.test(n) && !/배당/.test(n)) sym = 'YM=F';
  let mult = 1;
  if (/인버스2X|인버스\(2X|곱버스/.test(n)) mult = -2;
  else if (/인버스/.test(n)) mult = -1;
  else if (/2X|레버리지/.test(n)) mult = 2;
  return sym ? { sym, mult } : null;
}

// ---------- 핵심 계산 ----------
async function inav(env, code) {
  const list = await etfList(env);
  const meta = list.find((x) => x.code === code.toUpperCase());
  if (!meta) throw new Error('ETF를 찾지 못했습니다');
  const [h, fxh, fxc] = await Promise.all([holdings(env, meta.code), fxHistory(env), fxCloseMap(env)]);
  const todayKst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const navDate = h.navDate || fxh.map((x) => x.d).filter((d) => d < todayKst).sort().pop();
  const nav = h.nav || meta.nav;
  if (!navDate || !nav) throw new Error('NAV를 받지 못했습니다');
  const hedged = /\(H\)/.test(meta.name);
  const china = /차이나|중국|홍콩|China|CSI|항셍/i.test(meta.name);
  const sess = usSession(Date.now());
  const closedUS = !sess.regular;

  const rows = h.rows.filter((r) => r.w > 0);
  const totW = rows.reduce((a, r) => a + r.w, 0) || 100;
  for (const r of rows) {
    if (!r.t) { r.kind = 'cash'; r.cands = []; continue; }
    if (r.reg === 'kr') {
      if (/^\d{6}$/.test(r.t)) {
        const cn = r.t + (/^6/.test(r.t) ? '.SS' : '.SZ');
        r.cands = china ? [cn, r.t + '.KS', r.t + '.KQ'] : [r.t + '.KS', r.t + '.KQ', cn];
      } else r.cands = [r.t + '.KS', r.t + '.KQ'];
      r.kind = 'kr?';
    } else if (/^[0-9][0-9A-Z]{3}$/.test(r.t)) {
      const hk = r.t.padStart(4, '0') + '.HK', jp = r.t + '.T';
      r.cands = china ? [hk, jp] : [jp, hk]; r.kind = 'fx'; r.reg = 'asia';
    } else if (okTicker(r.t)) { r.cands = [ysym(r.t)]; r.kind = 'fx'; }
    else { r.cands = []; r.kind = 'fx'; }
  }
  const proxy = indexProxy(meta.name);
  // 미국장이 닫혀 있을 때 쓰는 선물: 지수 ETF는 그 지수, 기술·반도체 계열은 나스닥, 나머지는 S&P
  const futSym = proxy && /=F$/.test(proxy.sym) ? proxy.sym : /나스닥|NASDAQ|테크|반도체|AI|빅테크|양자|우주|필라델피아/i.test(meta.name) ? 'NQ=F' : 'ES=F';
  const want = new Set(['KRW=X', ...(proxy ? [proxy.sym] : [])]);
  for (const r of rows.slice().sort((a, b) => b.w - a.w)) {
    if (!r.cands.length) continue;
    if (want.size + r.cands.length > 300) break;
    r.cands.forEach((c) => want.add(c));
  }
  const idxFut = proxy && /=F$/.test(proxy.sym);
  const [Q, futPts] = await Promise.all([quotes(env, [...want]), closedUS || idxFut ? futIntraday(env, futSym) : null]);
  for (const r of rows) {
    r.sym = r.cands.find((c) => Q[c]);
    if (r.kind === 'kr?') {
      if (r.sym && /\.(SS|SZ)$/.test(r.sym)) { r.kind = 'fx'; r.reg = 'asia'; }
      else { r.kind = 'kr'; r.reg = 'asia'; }
    }
  }

  // 선물 보정값: 마지막 미국 정규장 마감(16:00 ET) 때 선물 가격 → 지금 선물 가격
  let f = 0, futAt = null, futNow = null, lastRegDate = null;
  if (closedUS) {
    for (const r of rows) {
      const q = r.kind === 'fx' && r.reg === 'us' && r.sym && Q[r.sym];
      if (q) { const ds = Object.keys(q.daily).sort(); if (ds.length && (!lastRegDate || ds[ds.length - 1] > lastRegDate)) lastRegDate = ds[ds.length - 1]; }
    }
    if (!lastRegDate && Q[futSym]) lastRegDate = Object.keys(Q[futSym].daily).sort().pop();
    if (futPts && futPts.length && lastRegDate) {
      const anchor = etEpoch(lastRegDate, 16, 0);
      const before = futPts.filter(([t]) => t * 1000 + 300000 <= anchor);
      if (before.length) { futAt = before[before.length - 1][1]; futNow = futPts[futPts.length - 1][1]; f = futNow / futAt - 1; }
    }
  }

  const krDays = fxh.map((x) => x.d).sort();
  const prevKrDate = krDays.filter((d) => d < navDate).pop();
  const prevKr2Date = krDays.filter((d) => d < (prevKrDate || navDate)).pop();
  // NAV(마감 iNAV)에 쓰인 환율 = NAV 날짜 15:30 환율. 없으면 직전 영업일 하나은행 최종 고시로 대신
  const fxHana = (d) => (fxh.find((x) => x.d === d) || {}).c;
  const fxOf = (d) => (d && fxc[d]) || fxHana(krDays.filter((x) => x < d).pop());

  // 세 가지 기준으로 함께 계산: main(선물 보정, 기본) / ah(애프터·프리마켓 가격) / reg(정규장 종가 그대로)
  const V = ['main', 'ah', 'reg'];
  const mk = () => ({ W: 0, cw: 0, accP: 0, cwP: 0, acc: { main: 0, ah: 0, reg: 0 } });
  const B = { fx: mk(), kr: mk() };
  let wCash = 0, lastTs = 0, wPre = 0, wUsC = 0;
  const contrib = [];
  for (const r of rows) {
    if (r.kind === 'cash') { wCash += r.w; continue; }
    const b = B[r.kind]; b.W += r.w;
    const q = r.sym && Q[r.sym];
    const ref = q && refClose(q, navDate, r.reg);
    if (!q || !ref || !q.last) continue;
    let rr;
    if (r.kind === 'fx' && r.reg === 'us' && closedUS) {
      const reg = (q.reg || q.last) / ref - 1, ah = q.last / ref - 1;
      // 프리·애프터마켓 체결이 최근 1시간 안에 있으면 그 종목 가격을 그대로, 없으면 선물로 보정
      const fresh = q.lastTs && q.lastTs > (q.regTs || 0) && Date.now() / 1000 - q.lastTs < 3600;
      if (fresh) wPre += r.w; wUsC += r.w;
      rr = { main: fresh ? ah : (1 + reg) * (1 + f) - 1, ah, reg };
    } else { const x = q.last / ref - 1; rr = { main: x, ah: x, reg: x }; }
    for (const v of V) b.acc[v] += r.w * rr[v];
    b.cw += r.w;
    if (r.kind === 'fx') lastTs = Math.max(lastTs, q.lastTs || 0);
    contrib.push({ t: r.t, n: r.n.split('/')[0], w: +r.w.toFixed(2), r: +(rr.main * 100).toFixed(2), c: +(r.w * rr.main).toFixed(3) });
    const ref2 = prevKrDate && refClose(q, prevKrDate, r.reg);
    if (ref2) { b.accP += r.w * (ref / ref2 - 1); b.cwP += r.w; }
  }
  const F = B.fx, K = B.kr;
  const nonUsW = rows.filter((r) => r.kind === 'fx' && r.reg !== 'us').reduce((a, r) => a + r.w, 0) / totW;
  const coverage = F.W ? F.cw / F.W : 0;

  // 지수
  const pq = proxy && Q[proxy.sym];
  const pRef = pq && refClose(pq, navDate), pRef2 = pq && prevKrDate && refClose(pq, prevKrDate);
  let rIdx = null;
  if (pq && pRef && pq.last) {
    if (/=F$/.test(proxy.sym)) {
      // 장 마감 뒤 기준값(마감 iNAV)은 15:30 선물 가격을 이미 반영 → 기준점을 그때 선물 가격으로
      let base = pRef;
      if (!h.intraday && futPts && futPts.length && proxy.sym === futSym) {
        const cut = Date.parse(navDate + 'T06:30:00Z'); // 15:30 KST
        const b = futPts.filter(([t]) => t * 1000 + 300000 <= cut);
        if (b.length) base = b[b.length - 1][1];
      }
      const atAnchor = closedUS && futAt && proxy.sym === futSym ? futAt : pq.last;
      const now = futPts && futPts.length && proxy.sym === futSym ? futPts[futPts.length - 1][1] : pq.last;
      rIdx = { main: now / base - 1, ah: now / base - 1, reg: (base === pRef ? atAnchor : now) / base - 1 };
    } else {
      const reg = (pq.reg || pq.last) / pRef - 1;
      rIdx = closedUS ? { main: (1 + reg) * (1 + f) - 1, ah: reg, reg } : { main: reg, ah: reg, reg };
    }
  }
  const rIdxPrev = pRef && pRef2 ? pRef / pRef2 - 1 : null;

  const fxQ = Q['KRW=X'];
  const fxNow = fxQ && fxQ.last;
  const fxBase = fxOf(navDate);
  const fxRatio = hedged || !fxNow || !fxBase ? 1 : fxNow / fxBase;
  const fxRatioPrev = hedged || !fxBase || !fxOf(prevKrDate) ? 1 : fxBase / fxOf(prevKrDate);

  let method, estFn, rUsdPrev = null;
  const R = {};
  const indexMode = proxy && rIdx && (proxy.mult !== 1 || ((F.W === 0 || coverage < 0.5) && K.cw <= K.W * 0.5));
  const rK = K.W ? K.acc.main / K.W : 0, rKPrev = K.W && K.cwP ? K.accP / K.W : 0;
  if (indexMode) {
    estFn = (base, r, fr) => base * (1 + proxy.mult * ((1 + r) * fr - 1));
    for (const v of V) R[v] = rIdx[v];
    if (rIdxPrev != null) rUsdPrev = rIdxPrev;
    method = `지수 기반 (${proxy.sym} × ${proxy.mult})`;
    lastTs = Math.max(lastTs, pq.lastTs || 0);
  } else if (F.cw > 0 || K.W > 0) {
    const useIdx = proxy && proxy.mult === 1 && rIdx && coverage < 0.8;
    const restW = F.W - F.cw;
    for (const v of V) R[v] = F.W ? (useIdx ? (F.acc[v] + restW * rIdx[v]) / F.W : F.cw ? F.acc[v] / F.cw : 0) : 0;
    if (F.W === 0 || F.cwP > 0) rUsdPrev = F.W ? (useIdx && rIdxPrev != null ? (F.accP + (F.W - F.cwP) * rIdxPrev) / F.W : F.accP / F.cwP) : 0;
    const wc = wCash / totW, wk = K.W / totW, wf = F.W / totW;
    estFn = (base, r, fr, rk) => base * (wc + wk * (1 + (rk || 0)) + wf * (1 + r) * fr);
    method = (useIdx ? `구성종목 가중 + 나머지 ${proxy.sym}` : '구성종목 가중') + (K.W > 0 ? ' · 국내주식 포함' : '');
  } else throw new Error('구성종목 시세를 받지 못했습니다');
  if (/커버드콜/.test(meta.name)) method += ' · 커버드콜 상승 제한 미반영';
  const E = {}; for (const v of V) E[v] = estFn(nav, R[v], fxRatio, rK);

  let check = null;
  if (h.navChg != null && rUsdPrev != null) {
    const prevNav = nav - h.navChg;
    const guess = estFn(prevNav, rUsdPrev, fxRatioPrev, rKPrev);
    check = { prevNav: +prevNav.toFixed(2), guess: +guess.toFixed(2), errBp: +((guess / nav - 1) * 1e4).toFixed(1) };
  }
  const notes = [];
  if (indexMode) notes.push(`${proxy.sym} 지수 선물 × ${proxy.mult}배로 계산했어요(기준값 이후 선물 ${rIdx.main >= 0 ? '+' : ''}${(rIdx.main * 100).toFixed(2)}%)`);
  else if (closedUS) {
    const fn = futSym === 'NQ=F' ? '나스닥100' : futSym === 'ES=F' ? 'S&P500' : '다우', fp = `${f >= 0 ? '+' : ''}${(f * 100).toFixed(2)}%`;
    const pr = wUsC ? Math.round((wPre / wUsC) * 100) : 0;
    if (pr >= 95) notes.push(`미국 정규장이 닫혀 있어 종목별 프리·애프터마켓 가격으로 계산했어요`);
    else if (pr > 0) notes.push(`종목별 프리·애프터마켓 가격을 반영했고(미국 종목 비중의 ${pr}%), 거래가 없는 종목은 ${fn} 선물(${fp})로 보정했어요`);
    else notes.push(`미국 정규장이 닫혀 있어 ${fn} 선물 움직임(${fp})으로 보정했어요`);
  }
  if (sess.futClosed) notes.push('지금은 선물도 쉬는 시간(미국 동부 금 17시~일 18시)이라 월요일 시가까지 더 움직일 수 있어요');
  if (nonUsW > 0.2) notes.push('미국 외 시장 비중이 커서 아직 정확하지 않아요');

  contrib.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const r2 = (x) => Math.round(x * 100) / 100, pc = (x) => +((x / nav - 1) * 100).toFixed(2);
  return {
    code: meta.code, name: meta.name, isin: h.isin, price: meta.price,
    nav, navDate, est: r2(E.main), pct: pc(E.main),
    estAh: r2(E.ah), pctAh: pc(E.ah), estReg: r2(E.reg), pctReg: pc(E.reg),
    vsPrice: meta.price ? +((E.main / meta.price - 1) * 100).toFixed(2) : null,
    session: sess.regular ? 'regular' : 'closed', futSym: closedUS ? futSym : null, futPct: closedUS ? +(f * 100).toFixed(3) : null,
    rUsd: +(R.main * 100).toFixed(3), fxNow, fxBase, fxDate: navDate, fxBaseSrc: fxc[navDate] ? '15:30' : 'hana', fxPct: +((fxRatio - 1) * 100).toFixed(3), hedged,
    wKrw: +((wCash + K.W) / totW * 100).toFixed(2), coverage: +(coverage * 100).toFixed(1), nHold: rows.length, method, check,
    warn: nonUsW > 0.2 ? '미국 외 시장 비중이 커서 아직 정확하지 않아요' : null, nonUs: +(nonUsW * 100).toFixed(1), notes,
    pricedAt: lastTs ? new Date(lastTs * 1000).toISOString() : null, at: new Date().toISOString(),
    top: contrib.slice(0, 8), pdfDate: h.pdfDate, inavLive: h.inavLive || null,
  };
}

// ---------- 화면 ----------
const MANIFEST = JSON.stringify({
  name: 'ETF 밤 시세', short_name: '밤시세', start_url: '/', display: 'standalone',
  background_color: '#0f1115', theme_color: '#0f1115', lang: 'ko',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
});
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f1115"/><circle cx="330" cy="190" r="86" fill="#f5c542"/><circle cx="372" cy="160" r="78" fill="#0f1115"/><path d="M96 380 L190 300 L262 338 L416 220" fill="none" stroke="#5ab0ff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SW = `const C='night-v1';self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/icon.svg','/manifest.json'])));self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});`;
const PAGE = "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#0f1115\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<meta name=\"apple-mobile-web-app-title\" content=\"밤시세\">\n<link rel=\"manifest\" href=\"/manifest.json\">\n<link rel=\"icon\" href=\"/icon.svg\">\n<link rel=\"apple-touch-icon\" href=\"/icon.svg\">\n<title>ETF 밤 시세</title>\n<style>\n:root{--bg:#0f1115;--card:#181b22;--line:#262a33;--ink:#eef0f4;--mute:#8a919e;--up:#ff5a5f;--down:#4e8cff;--acc:#f5c542}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",\"Pretendard\",\"Noto Sans KR\",sans-serif;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}\nheader{position:sticky;top:0;background:var(--bg);padding:14px 16px 10px;z-index:5;border-bottom:1px solid var(--line)}\nh1{font-size:19px;margin:0 0 2px}\n.sub{color:var(--mute);font-size:12.5px}\n.search{margin-top:10px;position:relative}\n.search input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:15px;outline:none}\n.results{position:absolute;left:0;right:0;top:46px;background:var(--card);border:1px solid var(--line);border-radius:12px;max-height:60vh;overflow:auto;display:none}\n.results div{padding:10px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px}\n.results div:last-child{border-bottom:0}\n.results small{color:var(--mute)}\nmain{padding:12px 16px 40px}\n.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:10px}\n.row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}\n.name{font-weight:600;font-size:15px}\n.code{color:var(--mute);font-size:12px;margin-left:4px}\n.big{font-size:24px;font-weight:700;letter-spacing:-.3px}\n.pct{font-weight:700}\n.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--mute)}\n.meta{color:var(--mute);font-size:12.5px;margin-top:4px}\n.chip{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--mute);margin-top:6px}\nbutton.x{background:none;border:0;color:var(--mute);font-size:13px;padding:4px}\n.detail table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13.5px}\n.detail td{padding:6px 0;border-bottom:1px solid var(--line)}\n.detail td:last-child{text-align:right}\n.kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}\n.kv div{background:#13161c;border-radius:10px;padding:8px 10px}\n.kv b{display:block;font-size:15px}\n.kv span{color:var(--mute);font-size:12px}\n.back{color:var(--acc);background:none;border:0;font-size:14px;padding:0;margin-bottom:8px}\n.empty{color:var(--mute);text-align:center;padding:30px 0}\nfooter{color:var(--mute);font-size:11.5px;padding:0 16px 30px;line-height:1.6}\n.skel{color:var(--mute)}\n</style>\n</head>\n<body>\n<header>\n  <h1>ETF 밤 시세</h1>\n  <div class=\"sub\" id=\"status\">미국장 시세로 계산한 국내상장 해외 ETF의 지금 가치</div>\n  <div class=\"search\"><input id=\"q\" placeholder=\"ETF 이름이나 종목코드 검색 (예: 나스닥, 133690)\" autocomplete=\"off\"><div class=\"results\" id=\"res\"></div></div>\n</header>\n<main id=\"main\"><div class=\"empty\">불러오는 중…</div></main>\n<footer>추정치이며 투자 권유가 아닙니다. 전일 NAV, 구성종목 비중, 미국 시세, 원/달러 환율로 계산합니다. 미국 정규장이 닫혀 있을 때 큰 숫자는 지수 선물 움직임까지 반영한 값이고, 공식 iNAV 방식(정규장 종가 기준) 값도 함께 보여줍니다. 시세는 지연될 수 있고 구성종목은 하루 한 번 바뀝니다. 커버드콜·채권·원자재 ETF는 오차가 클 수 있습니다.</footer>\n<script>\nconst $=s=>document.querySelector(s);\nconst store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};\nlet favs=store.get('favs',['133690','360750','381180']);\nlet LIST=[],DATA={},view={name:'home'},timer=null;\nconst won=v=>v==null?'-':Math.round(v).toLocaleString('ko-KR')+'원';\nconst sign=v=>v==null?'':(v>0?'+':'')+v.toFixed(2)+'%';\nconst cls=v=>v==null?'flat':v>0.005?'up':v<-0.005?'down':'flat';\nconst hm=iso=>{if(!iso)return'-';const d=new Date(iso);return d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})};\nconst esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));\n\nasync function api(p){const r=await fetch(p);const j=await r.json();if(!r.ok||j.error)throw new Error(j.error||r.status);return j}\nasync function loadList(){try{LIST=await api('/api/list')}catch(e){LIST=[]}}\nasync function load(code){try{DATA[code]=await api('/api/inav?code='+code)}catch(e){DATA[code]={error:e.message,code}}render()}\nfunction refresh(){(view.name==='detail'?[view.code]:favs).forEach(load);$('#status').textContent='마지막 갱신 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}\n\nfunction card(code){\n  const d=DATA[code],m=LIST.find(x=>x.code===code)||{};\n  if(!d)return`<div class=\"card\" onclick=\"openD('${code}')\"><div class=\"row\"><span class=\"name\">${esc(m.name||code)}<span class=\"code\">${code}</span></span></div><div class=\"skel\">계산 중…</div></div>`;\n  if(d.error)return`<div class=\"card\"><div class=\"row\"><span class=\"name\">${esc(m.name||code)}<span class=\"code\">${code}</span></span><button class=\"x\" onclick=\"unfav('${code}',event)\">삭제</button></div><div class=\"meta\">계산하지 못했어요: ${esc(d.error)}</div></div>`;\n  return`<div class=\"card\" onclick=\"openD('${code}')\">\n   <div class=\"row\"><span class=\"name\">${esc(d.name)}<span class=\"code\">${code}</span></span><button class=\"x\" onclick=\"unfav('${code}',event)\">삭제</button></div>\n   <div class=\"row\" style=\"margin-top:6px\"><span class=\"big\">${won(d.est)}</span><span class=\"pct ${cls(d.pct)}\">${sign(d.pct)}</span></div>\n   ${d.warn?`<div class=\"chip\" style=\"color:var(--acc);border-color:var(--acc)\">${esc(d.warn)}</div>`:''}\n   <div class=\"meta\">기준값 ${won(d.nav)} (${d.navDate} 마감 iNAV) 대비 · 마지막 종가 ${won(d.price)} 대비 <span class=\"${cls(d.vsPrice)}\">${sign(d.vsPrice)}</span></div>\n   ${d.session==='closed'?`<div class=\"meta\">공식 iNAV 방식(정규장 종가) ${won(d.estReg)} <span class=\"${cls(d.pctReg)}\">${sign(d.pctReg)}</span>${d.inavLive?` · 지금 공식 iNAV ${won(d.inavLive)}`:''}</div>`:''}\n   <div class=\"meta\">미국 시세 ${hm(d.pricedAt)} · ${esc(d.method)}${d.check?` · 어제 추정 오차 ${(d.check.errBp/100>0?'+':'')+(d.check.errBp/100).toFixed(2)}%`:''}</div></div>`;\n}\nfunction detail(code){\n  const d=DATA[code];\n  if(!d)return'<div class=\"empty\">계산 중…</div>';\n  if(d.error)return`<button class=\"back\" onclick=\"home()\">← 목록</button><div class=\"card\">계산하지 못했어요: ${esc(d.error)}</div>`;\n  const rows=(d.top||[]).map(x=>`<tr><td>${esc(x.n||x.t)} <span class=\"code\">${esc(x.t)}</span></td><td>${x.w.toFixed(1)}%</td><td class=\"${cls(x.r)}\">${sign(x.r)}</td></tr>`).join('');\n  return`<button class=\"back\" onclick=\"home()\">← 목록</button>\n  <div class=\"card detail\">\n   <div class=\"name\">${esc(d.name)}<span class=\"code\">${d.code}</span></div>\n   <div class=\"row\" style=\"margin-top:8px\"><span class=\"big\">${won(d.est)}</span><span class=\"pct ${cls(d.pct)}\">${sign(d.pct)}</span></div>\n   <div class=\"meta\">${d.navDate} 마감 iNAV ${won(d.nav)} 대비 추정 등락${d.session==='closed'?' · 선물 움직임 반영(예상 시가에 가까운 값)':''}</div>\n   ${d.session==='closed'?`<div class=\"kv\">\n    <div><span>공식 iNAV 방식(정규장 종가)</span><b>${won(d.estReg)} <small class=\"${cls(d.pctReg)}\">${sign(d.pctReg)}</small></b></div>\n    <div><span>애프터·프리마켓 가격 반영</span><b>${won(d.estAh)} <small class=\"${cls(d.pctAh)}\">${sign(d.pctAh)}</small></b></div>\n    ${d.inavLive?`<div><span>지금 공식 iNAV</span><b>${won(d.inavLive)}</b></div>`:''}\n    <div><span>${d.futSym==='NQ=F'?'나스닥100':d.futSym==='ES=F'?'S&amp;P500':'다우'} 선물(정규장 마감 후)</span><b class=\"${cls(d.futPct)}\">${sign(d.futPct)}</b></div>\n   </div>`:''}\n   ${(d.notes||[]).map(n=>`<div class=\"meta\">· ${esc(n)}</div>`).join('')}\n   <div class=\"kv\">\n    <div><span>미국 자산 등락(달러)</span><b class=\"${cls(d.rUsd)}\">${sign(d.rUsd)}</b></div>\n    <div><span>환율 효과${d.hedged?' (환헤지)':''}</span><b class=\"${cls(d.fxPct)}\">${sign(d.fxPct)}</b></div>\n    <div><span>지금 원/달러</span><b>${d.fxNow?d.fxNow.toFixed(1):'-'}</b></div>\n    <div><span>기준값에 쓰인 환율(${d.fxDate||'-'} 15:30)</span><b>${d.fxBase?d.fxBase.toFixed(1):'-'}</b></div>\n    <div><span>마지막 종가 대비</span><b class=\"${cls(d.vsPrice)}\">${sign(d.vsPrice)}</b></div>\n    <div><span>시세 반영 비중</span><b>${d.method.startsWith('지수')?'지수 사용':d.coverage+'%'}</b></div>\n    <div><span>어제 같은 방식 추정 오차</span><b>${d.check?(d.check.errBp/100>0?'+':'')+(d.check.errBp/100).toFixed(2)+'%':'-'}</b></div>\n    <div><span>어제 추정 / 실제 NAV</span><b>${d.check?won(d.check.guess)+' / '+won(d.nav):'-'}</b></div>\n   </div>\n   <div class=\"chip\">${esc(d.method)} · 구성종목 ${d.nHold}개 · 원화 ${d.wKrw}%</div>\n   <div class=\"chip\">미국 시세 ${hm(d.pricedAt)} · 계산 ${hm(d.at)}</div>\n   ${rows?`<table><tr><td class=\"meta\">많이 움직인 종목</td><td class=\"meta\">비중</td><td class=\"meta\">등락</td></tr>${rows}</table>`:''}\n  </div>`;\n}\nfunction render(){\n  if(view.name==='detail'){$('#main').innerHTML=detail(view.code);return}\n  $('#main').innerHTML=favs.length?favs.map(card).join(''):'<div class=\"empty\">위에서 ETF를 검색해 추가하세요</div>';\n}\nfunction openD(code){view={name:'detail',code};render();load(code);scrollTo(0,0)}\nfunction home(){view={name:'home'};render()}\nfunction unfav(code,e){e.stopPropagation();favs=favs.filter(c=>c!==code);store.set('favs',favs);render()}\nfunction addFav(code){if(!favs.includes(code)){favs.unshift(code);store.set('favs',favs)}$('#q').value='';$('#res').style.display='none';openD(code)}\n$('#q').addEventListener('input',e=>{\n  const q=e.target.value.trim().toLowerCase().replace(/\\s/g,'');const box=$('#res');\n  if(!q){box.style.display='none';return}\n  const hit=LIST.filter(x=>x.code.toLowerCase().includes(q)||x.name.toLowerCase().replace(/\\s/g,'').includes(q)).slice(0,30);\n  box.innerHTML=hit.length?hit.map(x=>`<div onclick=\"addFav('${x.code}')\"><span>${esc(x.name)} <small>${x.code}</small></span><small>${won(x.price)}</small></div>`).join(''):'<div><small>검색 결과가 없어요</small></div>';\n  box.style.display='block';\n});\ndocument.addEventListener('click',e=>{if(!e.target.closest('.search'))$('#res').style.display='none'});\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});\n(async()=>{render();await loadList();render();refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},60000)})();\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});\n</script>\n</body>\n</html>\n"; // build.js가 page.html 내용을 여기에 넣습니다

function json(obj, status = 200, maxAge = 30) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, 'access-control-allow-origin': '*' },
  });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    try {
      if (u.pathname === '/api/list') {
        const l = await etfList(env);
        const all = u.searchParams.get('all') === '1';
        return json(l.filter((x) => all || x.tab === 4).map(({ code, name, price, chg, nav, cap, amt, vol }) => ({ code, name, price, chg, nav, cap, amt, vol })), 200, 300);
      }
      if (u.pathname === '/api/inav') {
        const code = (u.searchParams.get('code') || '').trim();
        if (!/^[0-9A-Z]{6}$/i.test(code)) return json({ error: '종목코드 6자리를 넣어주세요' }, 400);
        return json(await inav(env, code), 200, 30);
      }
      if (u.pathname === '/api/hold') {
        const code = (u.searchParams.get('code') || '').trim().toUpperCase();
        if (!/^[0-9A-Z]{6}$/.test(code)) return json({ error: '종목코드 6자리를 넣어주세요' }, 400);
        return json(await holdings(env, code), 200, 600);
      }
      if (u.pathname === '/manifest.json') return new Response(MANIFEST, { headers: { 'content-type': 'application/manifest+json' } });
      if (u.pathname === '/icon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      if (u.pathname === '/sw.js') return new Response(SW, { headers: { 'content-type': 'text/javascript' } });
      if (u.pathname === '/' || u.pathname === '/index.html') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502, 0);
    }
  },
};
