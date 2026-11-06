/* =============================================================================
 * Service worker mínimo, escrito a mano y a propósito.
 *
 * PARA QUÉ ESTÁ: Chrome en Android solo ofrece «Instalar aplicación» si hay un
 * service worker con manejador de `fetch`. En iPhone no hace falta —«Añadir a
 * pantalla de inicio» funciona solo con el manifest—, pero en Android sin esto
 * no hay instalación.
 *
 * LO QUE **NO** HACE, Y ES LA DECISIÓN IMPORTANTE
 * No precachea la aplicación ni intenta funcionar sin conexión de verdad. Todos
 * los datos de esta plataforma son remotos: una caché offline enseñaría el
 * armazón vacío y un error, que es peor que decir «no hay conexión». Y un
 * service worker que sirve el HTML desde caché deja a la gente clavada en una
 * versión vieja **después** de desplegar, sin forma de saber por qué. Ese es el
 * fallo clásico de los PWA y aquí se evita por construcción:
 *
 *   · Navegaciones (el HTML): SIEMPRE de la red. Si la red falla, se sirve la
 *     última copia buena solo para no dar la pantalla de dinosaurio.
 *   · Ficheros de `assets/`: caché primero. Llevan el hash del contenido en el
 *     nombre, así que un fichero con ese nombre no cambia nunca. Un despliegue
 *     nuevo pide nombres nuevos.
 *   · Todo lo demás (Supabase, Storage, otros dominios): ni se toca. Cachear
 *     respuestas de la API sería servir datos académicos viejos como si fueran
 *     actuales, y además se firman con URL que caducan.
 *
 * Al cambiar VERSION se borran las cachés anteriores. No hace falta tocarlo en
 * cada despliegue: los nombres con hash ya se encargan.
 * ========================================================================== */
const VERSION = 'v1'
const CACHE_ASSETS = `tm-assets-${VERSION}`
const CACHE_SHELL = `tm-shell-${VERSION}`

self.addEventListener('install', () => {
  // Sin precarga: no hay nada que guardar antes de tiempo. `skipWaiting` para
  // que una versión nueva del propio worker no espere a que cierren pestañas.
  self.skipWaiting()
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres
          .filter((n) => n.startsWith('tm-') && n !== CACHE_ASSETS && n !== CACHE_SHELL)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return

  const url = new URL(peticion.url)
  if (url.origin !== self.location.origin) return   // Supabase y cualquier otro: de largo

  // --- El documento: red primero, caché solo como red de seguridad ----------
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(peticion)
          const cache = await caches.open(CACHE_SHELL)
          cache.put('shell', respuesta.clone())
          return respuesta
        } catch {
          const guardada = await caches.match('shell')
          if (guardada) return guardada
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
            '<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">' +
            '<h1>Sin conexión</h1><p>Thesis Manager necesita conexión: todos los datos ' +
            'académicos están en el servidor. Vuelve a intentarlo cuando tengas red.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
          )
        }
      })(),
    )
    return
  }

  // --- Ficheros con hash en el nombre: caché primero ------------------------
  if (url.pathname.includes('/assets/')) {
    evento.respondWith(
      (async () => {
        const guardado = await caches.match(peticion)
        if (guardado) return guardado
        const respuesta = await fetch(peticion)
        if (respuesta.ok) {
          const cache = await caches.open(CACHE_ASSETS)
          cache.put(peticion, respuesta.clone())
        }
        return respuesta
      })(),
    )
  }
})
