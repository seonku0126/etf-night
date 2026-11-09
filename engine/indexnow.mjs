// node indexnow.mjs <siteDir> → sitemap의 모든 주소를 IndexNow(네이버·빙 등)에 알림
import fs from 'fs';
import path from 'path';
const siteDir = process.argv[2] || '../_site';
const key = fs.readFileSync(new URL('./indexnow.key', import.meta.url), 'utf8').trim();
const xml = fs.readFileSync(path.join(siteDir, 'sitemap.xml'), 'utf8');
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const host = new URL(urls[0]).host;
const body = { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls };
for (const ep of ['https://searchadvisor.naver.com/indexnow', 'https://api.indexnow.org/indexnow']) {
  try {
    const r = await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    console.log(ep, r.status, urls.length);
  } catch (e) { console.log(ep, 'error', String(e)); }
}
