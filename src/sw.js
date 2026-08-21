/* Service Worker – עבודה גם בלי אינטרנט */
const CACHE = 'afula-move-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './app.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // בקשות ל-Firebase תמיד ישירות לרשת
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) return;

  // רשת קודם, מטמון כגיבוי.
  // חשוב: כך עדכון של הקוד נכנס לתוקף מיד ולא נתקעים על גרסה ישנה,
  // ובלי רשת האפליקציה עדיין נפתחת מהמטמון.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
