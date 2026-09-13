/* Service Worker – התקנה למסך הבית ופתיחה גם בלי אינטרנט.
   האתר המתארח הוא קובץ HTML אחד, ולכן במטמון הבסיסי רק הדף, המניפסט והאייקון.
   בגרסה מרובת הקבצים (localhost) שאר הקבצים נכנסים למטמון בפעם הראשונה שהם נטענים. */
const CACHE = 'afula-move-v3';
const CORE = ['./', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  // addAll נכשל כולו אם קובץ אחד חסר – כל קובץ נשמר בנפרד כדי שההתקנה לא תיפול
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
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
  // Firebase, Google ושאר הדומיינים החיצוניים – תמיד ישירות לרשת
  if (url.origin !== location.origin) return;

  // רשת קודם, מטמון כגיבוי: עדכון של האתר נכנס לתוקף מיד,
  // ובלי רשת האפליקציה עדיין נפתחת מהעותק האחרון.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./')))
  );
});
