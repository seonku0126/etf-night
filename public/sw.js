// 홈 화면 앱 설치용 최소 서비스워커: 캐시하지 않고 항상 네트워크로 가져옴
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.method === 'GET' && e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });
