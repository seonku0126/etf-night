// node events.mjs → $OUT_DIR/events.json  (다가오는 일정 + 과거 같은 상황의 다음 날 등락 통계)
import fs from 'fs';

const EVENTS = [
  {
    id: 'nvda-earnings', title: '엔비디아 실적 발표', icon: '🟩',
    when: '미국 장 마감 후 발표 → 한국시간 다음 날 새벽 6시쯤',
    next: '2026-11-17', // 회사 공지 기준 (미국 동부 날짜)
    desc: '엔비디아는 미국 장이 끝난 뒤 실적을 발표해요. 그래서 반응은 다음 거래일에 나와요. 한국 시장은 발표 직후 아침에, 미국 시장은 그날 밤에 반응해요.',
    // 과거 실적 발표일 (미국 동부, 모두 장 마감 후)
    past: [
      '2016-02-17', '2016-05-12', '2016-08-11', '2016-11-10', '2017-02-09', '2017-05-09', '2017-08-10', '2017-11-09',
      '2018-02-08', '2018-05-10', '2018-08-16', '2018-11-15', '2019-02-14', '2019-05-16', '2019-08-15', '2019-11-14',
      '2020-02-13', '2020-05-21', '2020-08-19', '2020-11-18', '2021-02-24', '2021-05-26', '2021-08-18', '2021-11-17',
      '2022-02-16', '2022-05-25', '2022-08-24', '2022-11-16', '2023-02-22', '2023-05-24', '2023-08-23', '2023-11-21',
      '2024-02-21', '2024-05-22', '2024-08-28', '2024-11-20', '2025-02-26', '2025-05-28', '2025-08-27', '2025-11-19',
      '2026-02-25', '2026-05-20', '2026-08-26',
    ],
    assets: [
      ['NVDA', '엔비디아', 'us'], ['^NDX', '나스닥100', 'us'], ['^SOX', '필라델피아 반도체', 'us'],
      ['381180.KS', 'TIGER 미국필라델피아반도체나스닥', 'kr'], ['133690.KS', 'TIGER 미국나스닥100', 'kr'],
    ],
  },
];

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
  for (const d of ev.past) {
    const r = {};
    for (const [s, , mk] of ev.assets) {
      const a = series[s]; if (!a.length) continue;
      const i = nextDayAfter(a, d); // 반응한 날: 발표일(미국) 다음 첫 거래일. 한국도 같은 날짜 아침이 첫 반응
      if (i <= 0 || i >= a.length) continue;
      if (mk === 'us' && a[i - 1][0] !== d) continue; // 발표일 종가가 있어야 함
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
  out.push({ id: ev.id, title: ev.title, icon: ev.icon, when: ev.when, next: ev.next, desc: ev.desc, assets: ev.assets.map(([s, n, m]) => [s, n, m]), stats, rows: rows.reverse() });
}
const OUT = process.env.OUT_DIR || 'out'; fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + '/events.json', JSON.stringify({ at: new Date().toISOString(), ev: out }));
console.log(JSON.stringify({ events: out.map((e) => [e.id, e.rows.length, e.stats.NVDA]) }));
