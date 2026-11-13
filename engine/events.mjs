// node events.mjs → $OUT_DIR/events.json  (다가오는 일정 + 과거 같은 상황의 다음 날 등락 통계)
import fs from 'fs';

const EVENTS = [
  {
    id: 'nvda-earnings', title: '엔비디아 실적 발표', icon: '🟩',
    type: 'next', lab: '다음 날', slug: 'nvda-earnings',
    when: '미국 장 마감 후 발표', kst: '한국시간 다음 날 새벽 6시쯤',
    seo: '엔비디아 실적 발표 후 주가 — 과거 다음 날 등락 통계',
    desc: '엔비디아는 미국 장이 끝난 뒤 실적을 발표해요. 그래서 반응은 다음 거래일에 나와요. 한국 시장은 발표 직후 아침에, 미국 시장은 그날 밤에 반응해요.',
    // 실적 발표일 (미국 동부, 모두 장 마감 후). 지난 날짜는 통계로, 앞으로 날짜는 '다음 일정'으로 자동 사용
    dates: [
      '2016-02-17', '2016-05-12', '2016-08-11', '2016-11-10', '2017-02-09', '2017-05-09', '2017-08-10', '2017-11-09',
      '2018-02-08', '2018-05-10', '2018-08-16', '2018-11-15', '2019-02-14', '2019-05-16', '2019-08-15', '2019-11-14',
      '2020-02-13', '2020-05-21', '2020-08-19', '2020-11-18', '2021-02-24', '2021-05-26', '2021-08-18', '2021-11-17',
      '2022-02-16', '2022-05-25', '2022-08-24', '2022-11-16', '2023-02-22', '2023-05-24', '2023-08-23', '2023-11-21',
      '2024-02-21', '2024-05-22', '2024-08-28', '2024-11-20', '2025-02-26', '2025-05-28', '2025-08-27', '2025-11-19',
      '2026-02-25', '2026-05-20', '2026-08-26', '2026-11-17',
    ],
    assets: [
      ['NVDA', '엔비디아', 'us'], ['^NDX', '나스닥100', 'us'], ['^SOX', '필라델피아 반도체', 'us'],
      ['381180.KS', 'TIGER 미국필라델피아반도체나스닥', 'kr'], ['133690.KS', 'TIGER 미국나스닥100', 'kr'],
    ],
  },
  {
    id: 'fomc', title: 'FOMC 금리 결정', icon: '🏦',
    type: 'same', lab: '발표 당일', slug: 'fomc',
    when: '미국 동부 오후 2시 발표', kst: '한국시간 다음 날 새벽 4시 (서머타임 때 3시)',
    seo: 'FOMC 금리 발표 후 나스닥·S&P500 — 과거 등락 통계',
    desc: '미국 연준이 1년에 8번 기준금리를 정해요. 결과는 미국 장중(오후 2시)에 나와서 미국 시장은 그날 바로, 한국 시장은 다음 날 아침에 반응해요. 정기 회의만 셌고 긴급 회의는 뺐어요.',
    dates: [
      '2016-01-27', '2016-03-16', '2016-04-27', '2016-06-15', '2016-07-27', '2016-09-21', '2016-11-02', '2016-12-14',
      '2017-02-01', '2017-03-15', '2017-05-03', '2017-06-14', '2017-07-26', '2017-09-20', '2017-11-01', '2017-12-13',
      '2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13', '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19',
      '2019-01-30', '2019-03-20', '2019-05-01', '2019-06-19', '2019-07-31', '2019-09-18', '2019-10-30', '2019-12-11',
      '2020-01-29', '2020-04-29', '2020-06-10', '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16',
      '2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16', '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15',
      '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
      '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
      '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
      '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
      '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
    ],
    assets: [
      ['^NDX', '나스닥100', 'us'], ['^GSPC', 'S&P500', 'us'], ['^SOX', '필라델피아 반도체', 'us'],
      ['133690.KS', 'TIGER 미국나스닥100', 'kr'], ['360750.KS', 'TIGER 미국S&P500', 'kr'],
    ],
  },
];
const todayEt = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

async function daily(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=11y&interval=1d`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) {
        const d = (await r.json()).chart.result[0], off = d.meta.gmtoffset || 0, cl = d.indicators.quote[0].close;
        const out = [];
        d.timestamp.forEach((t, k) => { if (cl[k] != null) out.push([new Date((t + off) * 1000).toISOString().slice(0, 10), cl[k]]); });
        return out;
      }
    } catch (e) {}
    await new Promise((s) => setTimeout(s, 1500));
  }
  return [];
}
const nextDayAfter = (arr, d) => arr.findIndex((x) => x[0] > d);

const out = [];
for (const ev of EVENTS) {
  const series = {};
  for (const [s] of ev.assets) { series[s] = await daily(s); await new Promise((r) => setTimeout(r, 500)); }
  const rows = [];
  const past = ev.dates.filter((d) => d < todayEt), next = ev.dates.find((d) => d >= todayEt) || null;
  for (const d of past) {
    const r = {};
    for (const [s, , mk] of ev.assets) {
      const a = series[s]; if (!a.length) continue;
      // 한국장: 발표 다음 날 아침 시작한 첫 거래일. 미국장: 장 마감 후 발표면 다음 거래일, 장중 발표면 그날
      let i = nextDayAfter(a, d);
      if (mk === 'us' && ev.type === 'same') i = a.findIndex((x) => x[0] === d);
      if (i <= 0 || i >= a.length) continue;
      if (mk === 'us' && ev.type === 'next' && a[i - 1][0] !== d) continue; // 발표일 종가가 있어야 함
      r[s] = +((a[i][1] / a[i - 1][1] - 1) * 100).toFixed(2);
    }
    if (Object.keys(r).length) rows.push({ d, r });
  }
  const stats = {};
  for (const [s, n] of ev.assets) {
    const v = rows.map((x) => x.r[s]).filter((x) => x != null);
    if (!v.length) continue;
    const mx = Math.max(...v), mn = Math.min(...v);
    stats[s] = { n: v.length, up: v.filter((x) => x > 0).length, avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), abs: +(v.reduce((a, b) => a + Math.abs(b), 0) / v.length).toFixed(2), max: mx, maxD: rows.find((x) => x.r[s] === mx).d, min: mn, minD: rows.find((x) => x.r[s] === mn).d, last4: rows.filter((x) => x.r[s] != null).slice(-4).map((x) => x.r[s]) };
  }
  out.push({ id: ev.id, title: ev.title, icon: ev.icon, when: ev.when, kst: ev.kst, lab: ev.lab, seo: ev.seo, next, desc: ev.desc, assets: ev.assets.map(([s, n, m]) => [s, n, m]), stats, rows: rows.reverse() });
}
const OUT = process.env.OUT_DIR || 'out'; fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + '/events.json', JSON.stringify({ at: new Date().toISOString(), ev: out }));
console.log(JSON.stringify({ events: out.map((e) => [e.id, e.rows.length, e.next, e.stats[e.assets[0][0]]]) }));
