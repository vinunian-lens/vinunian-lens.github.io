/* Service Worker — VinUni tile proxy
   Pannellum uses 0-based tile coords; the GCS bucket uses 1-based.
   This SW intercepts /vtile/{scene}/{face}/{level}/{y}/{x}.jpg,
   adds +1 to both y and x, and proxies to the real GCS URL.        */

const GCS = "https://storage.googleapis.com/vvt_tileserver/2021/vinuni-7/images/panos";

self.addEventListener("install",  ()  => self.skipWaiting());
self.addEventListener("activate", e   => e.waitUntil(clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Match: /vtile/{scene}/{face}/{level}/{y}/{x}.jpg
  const m = url.pathname.match(
    /\/vtile\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.jpg$/
  );
  if (!m) return; // let everything else pass through normally

  const [, scene, face, level, y0, x0] = m;
  const y = parseInt(y0) + 1;
  const x = parseInt(x0) + 1;
  const gcsUrl = `${GCS}/${scene}/${face}/l${level}/${y}/l${level}_${face}_${y}_${x}.jpg`;

  event.respondWith(fetch(gcsUrl));
});
