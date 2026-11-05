# DEPLOYMENT.md — Despliegue en GitHub Pages

## 1. Creación del repositorio

1. `git init` en `/Users/javiergomezpilar/ThesisManager` (pendiente: el directorio no es todavía
   un repositorio Git).
2. Crear el repositorio en GitHub con nombre `ThesisManager`.
3. **Visibilidad: pública.** GitHub Pages solo funciona en repositorios privados con un plan de
   pago (ver `FREE_TIER.md` §1). Consecuencia estricta: **ningún dato real en el repositorio**.
4. Rama principal: `main`.
5. URL resultante: `https://<usuario>.github.io/ThesisManager/`

## 2. Configuración de GitHub Pages

`Settings → Pages → Build and deployment → Source: **GitHub Actions**`

No se usa la rama `gh-pages` ni el despliegue clásico: el artefacto lo publica `deploy.yml`.

## 3. Configuración de Vite

El `base` debe coincidir con el subdirectorio del repositorio, o todos los activos darán 404.

```ts
// vite.config.ts
export default defineConfig({
  // En CI lo inyecta deploy.yml como /ThesisManager/. En local, '/'.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: 'dist',
    sourcemap: false,            // no publicar el código fuente mapeado
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
        },
      },
    },
  },
})
```

Y el router debe conocer el mismo prefijo:

```tsx
<BrowserRouter basename={import.meta.env.BASE_URL}>
```

## 4. Rutas de una SPA en GitHub Pages

Pages es un servidor de ficheros estáticos: no sabe reescribir `/ThesisManager/works/abc` hacia
`index.html`, y devolvería un 404 al recargar o al abrir un enlace directo.

**Solución adoptada**: `cp dist/index.html dist/404.html` en el *build*. Pages sirve `404.html`
cuando no encuentra el fichero, **conservando la URL solicitada**, y React Router resuelve la ruta
en el cliente. El efecto secundario es que la respuesta lleva código HTTP 404 (irrelevante para una
aplicación privada, no indexable).

**Alternativa descartada**: `HashRouter`. Funciona, pero Supabase Auth usa el fragmento de la URL
para devolver tokens en el flujo implícito, y ambos competirían por el `#`. Con `BrowserRouter` +
`404.html` + **flujo PKCE** (`?code=`) el conflicto desaparece.

También se añade `public/.nojekyll` para que Pages no procese el sitio con Jekyll (que ignora los
directorios que empiezan por `_`).

## 5. Configuración de Supabase

1. Crear el proyecto en **región de la UE** (Fráncfort o Irlanda) por RGPD.
2. Guardar la *Project URL* y la clave **anon/publishable**. La clave `service_role` no se usa en
   ningún punto de este proyecto: no copiarla a ninguna parte.
3. Aplicar las migraciones en orden: `supabase/migrations/0001…0004`, y después
   `supabase/seed/0001_catalogs.sql`.
   - Con CLI: `supabase link --project-ref <ref>` y `supabase db push`.
   - O pegando el SQL en el editor del panel, en orden.
4. `Authentication → Providers`: dejar solo *Email*. **Desactivar el registro público**
   (`Allow new users to sign up` = off): las altas son por invitación.
5. `Authentication → URL Configuration`:
   - *Site URL*: `https://<usuario>.github.io/ThesisManager/`
   - *Redirect URLs*: `https://<usuario>.github.io/ThesisManager/**` y `http://localhost:5173/**`
6. `Authentication → SMTP Settings`: **se deja el servicio integrado de Supabase** (decisión D3).
   Tener presente el límite de 2–4 correos/hora, compartido con la recuperación de contraseña.
   Si en el futuro se quiere SMTP institucional, se configura aquí sin tocar código.
7. Comprobar en `Database → Tables` que **todas** las tablas muestran RLS activo.

## 6. Variables y secretos

`Settings → Secrets and variables → Actions → Secrets`:

| Nombre | Valor | Uso |
|---|---|---|
`SUPABASE_URL` | `https://<ref>.supabase.co` | `deploy.yml` y `keepalive.yml` |
`SUPABASE_ANON_KEY` | clave anon/publishable | `deploy.yml` y `keepalive.yml` |

Ambos terminan en el *bundle* público, lo cual es correcto y esperado: la clave anon está diseñada
para ser pública y la protección real la ejerce RLS. Se guardan como *secrets* por higiene, no
porque sean confidenciales.

En local, `.env.local` (ignorado por Git) a partir de `.env.example`.

## 7. Despliegue automático y workflows

Tres workflows, independientes entre sí:

| Workflow | Cuándo | Para qué |
|---|---|---|
`deploy.yml` | *push* a `main` y manual | Construir y publicar el frontend |
`keepalive.yml` | cada 8 h (`17 */8 * * *`) y manual | Evitar que Supabase pause el proyecto |
`repo-activity.yml` | día 3 de cada mes y manual | Evitar que GitHub desactive los *cron* |

`deploy.yml` ignora los cambios en `maintenance/**` y en los `*.md`, de modo que el *commit*
mensual de `repo-activity.yml` no provoca un redespliegue. `repo-activity.yml` es, además, el único
workflow con permiso de escritura sobre el repositorio.

`deploy.yml` se dispara en cada `push` a `main` y en ejecución manual. Pasos: `npm ci` →
`typecheck` → `lint` → `build` → copia de `404.html` → **`scripts/check-no-secrets.sh`** →
`upload-pages-artifact` → `deploy-pages`.

Si la comprobación de secretos encuentra algo, el despliegue se aborta.

## 8. Entorno de desarrollo

```bash
npm install
cp .env.example .env.local      # rellenar con los valores del proyecto
npm run dev                     # http://localhost:5173
```

Opcionalmente, Supabase local (Docker) para no consumir el proyecto de producción ni arriesgar
datos reales:

```bash
supabase start
supabase db reset               # aplica migrations/ y seed/
```

Esto es además lo que compensa el límite de 2 proyectos activos del plan Free: el entorno de
desarrollo es local, no un segundo proyecto en la nube.

## 9. Dominio propio (opcional)

`Settings → Pages → Custom domain`, registro CNAME en el DNS, fichero `public/CNAME`. Al cambiar
el dominio hay que **poner `base: '/'`** en Vite y actualizar las *Redirect URLs* de Supabase Auth.
No es necesario para el funcionamiento.

## 10. Comprobaciones posteriores al primer despliegue

1. La aplicación carga en `https://<usuario>.github.io/ThesisManager/`.
2. Una ruta profunda recargada directamente funciona (`/ThesisManager/works`).
3. El inicio de sesión funciona y la sesión sobrevive a recargar la página.
4. `npm run check:secrets` termina correctamente.
5. Sin sesión, `GET /rest/v1/academic_works` con la clave anon devuelve `[]`.
6. Actions → *Keepalive Supabase* → *Run workflow* termina en verde.
