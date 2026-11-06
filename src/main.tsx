import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from '@/app/providers'
import { Router } from '@/app/router'
import '@/styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('No se ha encontrado el elemento #root')

createRoot(root).render(
  <StrictMode>
    <Providers>
      <Router />
    </Providers>
  </StrictMode>,
)

/**
 * UN TROZO QUE YA NO EXISTE: recargar una vez, en lugar de dejar la pantalla
 * en blanco.
 *
 * Desde que las pantallas se cargan al entrar en ellas, aparece un caso que
 * antes no existía. Alguien tiene la pestaña abierta, se despliega una versión
 * nueva —GitHub Pages reemplaza la carpeta `assets/` entera, con nombres
 * nuevos por el hash— y esa persona pulsa «Informes». El navegador pide el
 * trozo con el nombre viejo, que ya no está, y el `import()` se rompe. Sin
 * nadie que lo recoja, React desmonta el árbol y lo que queda es una ventana
 * blanca sin explicación: el peor fallo posible, porque no se puede ni contar.
 *
 * `vite:preloadError` es el aviso que Vite emite justo en ese momento.
 * Recargar resuelve el problema de verdad —el HTML viene de la red, trae los
 * nombres nuevos y la navegación continúa—, y se hace una sola vez: si tras
 * recargar vuelve a fallar, el problema es otro (sin conexión, por ejemplo) y
 * una recarga en bucle lo único que haría es impedir leer el error.
 */
window.addEventListener('vite:preloadError', (evento) => {
  const CLAVE = 'tm:recarga-por-trozo-perdido'
  const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0)
  if (Date.now() - ultima < 30_000) return   // ya se intentó: que el error se vea
  evento.preventDefault()
  sessionStorage.setItem(CLAVE, String(Date.now()))
  window.location.reload()
})

/**
 * Registro del service worker: solo en producción.
 *
 * En desarrollo estorba —interceptaría las peticiones del servidor de Vite y
 * la recarga en caliente—, y no aporta nada: lo único que da es que Chrome en
 * Android ofrezca instalar la aplicación.
 *
 * `BASE_URL` por delante porque esto vive en un subdirectorio de GitHub Pages
 * (`/ThesisManager/`): registrar `/sw.js` daría 404 y, peor, un ámbito que no
 * es el de la aplicación.
 *
 * Si el registro falla no pasa nada que haya que contar: la web funciona igual,
 * simplemente no se puede instalar. Por eso se traga el error en lugar de
 * molestar con un aviso que nadie sabría qué hacer con él.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined)
  })
}
