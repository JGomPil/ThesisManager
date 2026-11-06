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
