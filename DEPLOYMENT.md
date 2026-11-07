# DEPLOYMENT.md — Despliegue en GitHub Pages

## 1. Creación del repositorio

1. `git init` en `/Users/javiergomezpilar/ThesisManager` (pendiente: el directorio no es todavía
   un repositorio Git).
2. Crear el repositorio en GitHub con nombre `ThesisManager`.
3. **Visibilidad: pública.** GitHub Pages solo funciona en repositorios privados con un plan de
   pago (ver `FREE_TIER.md` §1). Consecuencia estricta: **ningún dato real en el repositorio**.
4. Rama principal: `main`.
5. URL resultante: `https://jgompil.github.io/ThesisManager/`

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
3. Aplicar las migraciones en orden: `supabase/migrations/0001…0021`, y después
   `supabase/seed/0001_catalogs.sql`.
   - Con CLI: `supabase link --project-ref <ref>` y `supabase db push`.
   - O pegando el SQL en el editor del panel, en orden.
   - **En el editor del panel, «Success. No rows returned» es el resultado bueno.** Todas las
     migraciones de este proyecto terminan con comprobaciones que escriben `raise notice
     'CORRECTO: …'`, y ese editor **descarta los avisos**: no se ve ninguna. Un fallo sí saldría
     en rojo, porque es un `raise exception`, así que «Success» significa que ninguna comprobación
     falló. Lo que no contesta es «¿y qué estado tengo ahora?», y para eso está el punto siguiente.
3. bis. **Verificar el estado**: pegar `supabase/verify.sql` en el editor y mirar la tabla que
   devuelve. Son trece comprobaciones —RLS en todas las tablas, que `anon` no ejecute nada del
   esquema `app`, las tablas del núcleo, las migraciones reconocibles por lo que dejan y que el rol
   de estudiante no tenga capacidades— y devuelve FILAS, que es lo único que ese editor muestra.
   No cambia nada: solo lee catálogos del sistema. Si alguna fila dice `FALLO`, ahí está el
   problema. La propia consulta se comprueba en `scripts/test-rls.sh`, que exige las trece en OK
   sobre una base recién construida y falla si falta cualquiera.
4. `Authentication → Providers`: dejar solo *Email*. **Desactivar el registro público**
   (`Allow new users to sign up` = off): las altas son por invitación.
5. `Authentication → URL Configuration`:
   - *Site URL*: `https://jgompil.github.io/ThesisManager/`
   - *Redirect URLs*: `https://jgompil.github.io/ThesisManager/**` y `http://localhost:5173/**`
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

1. La aplicación carga en `https://jgompil.github.io/ThesisManager/`.
2. Una ruta profunda recargada directamente funciona (`/ThesisManager/works`).
3. El inicio de sesión funciona y la sesión sobrevive a recargar la página.
4. `npm run check:secrets` termina correctamente.
5. Sin sesión, `GET /rest/v1/academic_works` con la clave anon devuelve `[]`.
6. Actions → *Keepalive Supabase* → *Run workflow* termina en verde.

## 11. Cuando el despliegue falla sin que falle el código

Caso real del 6 de noviembre de 2026, documentado porque cuesta un rato
entenderlo la primera vez y porque la comprobación «obvia» engaña.

### El síntoma

El trabajo `build` termina correcto y el artefacto se genera; falla el paso
`actions/deploy-pages@v4`:

```
Current status: updating_pages      (repetido ~10 minutos)
##[error]Timeout reached, aborting!
Canceling Pages deployment...
```

Es la infraestructura de Pages, no el proyecto: ni el *build*, ni Vite, ni la
`base`. Se comprueba en <https://www.githubstatus.com> (componente **Pages**) y
con `gh api repos/<owner>/<repo>/pages`.

### Relanzar el trabajo fallido NO sirve

Es lo primero que se intenta y falla en cinco segundos:

```
Created deployment for a4ab112…, ID: a4ab112…
##[error]Deployment cancelled.
```

**El identificador del despliegue de Pages es el SHA del commit.** Si ese
despliegue quedó cancelado, volver a lanzar el mismo trabajo intenta crear uno
con el mismo identificador y nace cancelado. Por eso `gh run rerun --failed` no
arregla este fallo concreto: hace falta un SHA distinto.

Y aquí está la trampa, porque se cayó en ella: **un commit de solo documentación
no vale**. Este workflow tiene `paths-ignore: ['maintenance/**', '**/*.md']`, así
que un commit que solo toca `.md` no lanza nada y se queda esperando un
despliegue que nunca iba a existir. Las dos salidas correctas son:

```bash
# a) lanzarlo a mano sobre el commit actual (lo normal en este caso)
gh workflow run "Deploy to GitHub Pages" --ref main

# b) o un commit que toque de verdad el frontend
```

Sobre (a): el comentario de la cabecera de `deploy.yml` advierte de no usar
`workflow_dispatch` sobre un commit que **acabas de empujar**, porque se crearían
dos despliegues del mismo SHA. Aquí no aplica: el *push* no había lanzado nada.

### Lo importante: un `200` no prueba nada

Al fallar la publicación, la web **sigue sirviendo la versión anterior**, así que
responde `HTTP 200` con normalidad. Comprobar un despliegue con un código de
estado es comprobar que GitHub Pages está vivo, no que tu versión esté arriba.

Lo que sí lo prueba es **qué contiene** el paquete publicado. El nombre lleva el
*hash* del contenido, así que lo primero es ver si ha cambiado respecto al de
antes del despliegue:

```bash
curl -s https://jgompil.github.io/ThesisManager/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Cuidado con la comparación «fácil»: **el nombre publicado no tiene por qué
coincidir con el de tu `dist/` local**, aunque el código sea idéntico. El de
Actions se construye con `npm ci` en otra máquina y otra versión de Node, y eso
basta para cambiar el *hash*. Compararlos y ver que difieren no demuestra nada.

La comprobación que sí vale es buscar en el paquete publicado algo que solo
exista en la versión nueva —un texto de la interfaz recién añadido—:

```bash
curl -s https://jgompil.github.io/ThesisManager/assets/index-XXXX.js \
  | grep -c 'Cerrar el menú'      # 1 = la versión nueva está arriba
```

Un texto visible sirve de testigo porque el minificador no lo toca: renombra
variables, no cadenas.

## 12. Instalable como aplicación (PWA)

Desde el 6 de noviembre de 2026 la web se puede añadir a la pantalla de inicio y
abrirse sin la barra del navegador. No es una aplicación nativa ni la sustituye:
es la misma web, en su propia ventana y con su icono.

### Qué la hace instalable

| Pieza | Dónde | Para qué |
|---|---|---|
| `manifest.webmanifest` | `public/` | nombre, icono, colores y `display: standalone` |
| `icon-192`, `icon-512`, `icon-maskable-512` | `public/` | Android. El *maskable* es obligatorio si no se quiere que el sistema recorte el dibujo |
| `apple-touch-icon.png` | `public/` | iOS **no** usa el manifest para el icono |
| `sw.js` | `public/` | Chrome en Android solo ofrece instalar si hay *service worker* con manejador de `fetch` |
| `<meta theme-color>` y las etiquetas `apple-mobile-web-app-*` | `index.html` | color de la barra y apertura sin Safari |

Los iconos **se generan**, no se dibujan a mano: `npm run icons`
(`scripts/make-icons.py`). Cinco tamaños y dos recortes hechos a mano se
desincronizan en cuanto cambia el color de la marca.

### Las dos trampas, las dos invisibles

**1. Las rutas absolutas.** Esto se publica en `/ThesisManager/`, no en la raíz
del dominio. Un `"start_url": "/"` o un icono `"/icon-512.png"` funcionan en
local y en producción apuntan a un sitio donde no hay nada. **No da error**: el
navegador pone su icono genérico y la aplicación se instala igual, mal.

**2. El *service worker* que deja a la gente en una versión vieja.** Es el fallo
clásico de los PWA. Aquí se evita por construcción, y conviene no «mejorarlo»
sin entender esto:

- **Las navegaciones (el HTML) van siempre a la red.** Solo si la red falla se
  sirve la última copia, y únicamente para no dar la pantalla de error del
  navegador. Si el HTML se sirviera de caché, un despliegue nuevo no llegaría.
- **`assets/` va de caché primero**, porque esos ficheros llevan el *hash* del
  contenido en el nombre y por tanto nunca cambian. Un despliegue nuevo pide
  nombres nuevos.
- **Supabase no se cachea jamás.** Serían datos académicos viejos presentados
  como actuales, y además sus URL van firmadas y caducan.

No hay modo sin conexión de verdad, y es deliberado: todos los datos son
remotos, así que una caché offline enseñaría el armazón vacío con un error, que
es peor que decir «no hay conexión».

### Comprobarlo

```bash
npm run build && npm run check:pwa     # también corre en Actions tras el build
```

Verifica sobre `dist/` —lo que de verdad se publica— que el manifest tiene lo
que tiene que tener, que **todos los iconos declarados existen**, que ninguna
ruta es absoluta y que el *service worker* distingue las navegaciones.

### Instalarla

- **Android/Chrome**: menú ⋮ → «Instalar aplicación» (o el aviso que sale solo).
- **iPhone/Safari**: Compartir → «Añadir a pantalla de inicio». En iOS no hay
  aviso automático: hay que decírselo a la gente.
