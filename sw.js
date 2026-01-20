self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('pinc-v1').then((cache) => cache.addAll([
      './index.html',
      './app.css',
      './app.js',
      './manifest.webmanifest'
    ]))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  )
})
