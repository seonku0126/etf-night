// 파일에 저장하는 아주 단순한 캐시 (GitHub Actions 캐시로 다음 실행에 넘겨줌)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
export function fileKV(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (k) => path.join(dir, crypto.createHash('sha1').update(k).digest('hex') + '.json');
  return {
    async get(k) { try { return JSON.parse(fs.readFileSync(f(k), 'utf8')); } catch (e) { return null; } },
    async put(k, v) { fs.writeFileSync(f(k), v); },
  };
}
