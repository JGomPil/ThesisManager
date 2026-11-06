# ARCHITECTURE.md — Thesis Manager

Arquitectura decidida y no negociable: **GitHub Pages** (frontend estático) + **Supabase Free**
(PostgreSQL, Auth, REST, RLS, Storage opcional) + **GitHub Actions** (despliegue y mantenimiento).
Coste recurrente objetivo: **0 €**.

## 1. Visión general

```
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│  GitHub Pages (estático) │        │           Supabase Free              │
│  React + TS + Vite SPA   │──────▶ │  PostgREST  ·  Auth  ·  PostgreSQL   │
│  clave anon (pública)    │  HTTPS │  RLS = única frontera de seguridad   │
└──────────────────────────┘        │  Storage (opcional, uso mínimo)      │
            ▲                       └──────────────────────────────────────┘
            │ deploy                                  ▲
┌───────────┴──────────────┐                          │ SELECT cada 8 h
│      GitHub Actions      │──────────────────────────┘
│  deploy.yml · keepalive  │
└──────────────────────────┘
```

No hay servidor propio. No hay SSR. No hay API Routes. Toda la autorización vive en la base de
datos: el frontend es código público que solo puede hacer lo que RLS le permita.

## 2. Principio rector

> El frontend **no es** una frontera de seguridad. Ocultar un botón es una mejora de usabilidad,
> nunca una medida de protección. Cada operación debe ser imposible a nivel de PostgreSQL para
> quien no tenga derecho a ella.

## 3. Estructura del proyecto (entregable 1)

```
ThesisManager/
├── .github/workflows/
│   ├── deploy.yml              # build + publicación en Pages
│   └── keepalive.yml           # mantenimiento de Supabase cada 8 h
├── supabase/
│   ├── migrations/             # SQL versionado, numerado, inmutable
│   └── seed/                   # catálogos iniciales + datos ficticios de demo
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── router.tsx          # rutas + guardas de ruta
│   │   ├── providers.tsx       # QueryClient, Auth, Theme, Toaster
│   │   └── layout/             # AppShell, Sidebar, Topbar, Breadcrumbs
│   ├── lib/
│   │   ├── supabase.ts         # ÚNICO punto de creación del cliente
│   │   ├── query-keys.ts       # claves de TanStack Query centralizadas
│   │   └── utils.ts
│   ├── domain/                 # lógica de negocio PURA, sin Supabase, testeable
│   │   ├── works/              # progreso, retrasos, reglas por tipo de trabajo
│   │   ├── tasks/
│   │   ├── permissions/        # resolución de capacidades del usuario (espejo de RLS)
│   │   └── reports/
│   ├── data/                   # ACCESO A DATOS. Nada de SQL fuera de aquí.
│   │   ├── repositories/       # works.repo.ts, tasks.repo.ts, catalogs.repo.ts…
│   │   ├── dto/                # tipos de transporte + mapeo a modelos de dominio
│   │   └── types/database.ts   # GENERADO por `supabase gen types typescript`
│   ├── features/               # un directorio por módulo funcional
│   │   ├── auth/ dashboard/ works/ work-types/ students/ tasks/
│   │   ├── meetings/ documents/ comments/ notifications/ calendar/ reports/
│   │   └── admin/              # usuarios, grupos, catálogos, ajustes
│   ├── components/ui/          # shadcn/ui (generado)
│   ├── components/common/       # DataTable, EmptyState, StatusBadge, ConfirmDialog…
│   ├── hooks/
│   └── schemas/                # esquemas Zod, compartidos con los formularios
├── public/
│   ├── .nojekyll
│   └── CNAME                   # solo si se usa dominio propio
├── docs/
└── (ARCHITECTURE|DATABASE|SECURITY|DEPLOYMENT|FREE_TIER|BACKUP|ROADMAP).md
```

### Regla de dependencias (de fuera hacia dentro, nunca al revés)

```
features/ (React)  →  domain/ (puro)  →  —
features/ (React)  →  data/ (Supabase) →  lib/supabase.ts
domain/            ↛  data/            (el dominio NO conoce Supabase)
features/          ↛  lib/supabase.ts  (los componentes NO llaman a Supabase)
```

Esto es lo que hace portable el sistema: si algún día hay que salir de Supabase, se reescribe
`data/`, y `domain/` y la interfaz permanecen intactos.

## 4. Pila técnica

| Capa | Elección | Motivo |
|---|---|---|
| UI | React 18 + TypeScript (`strict`) | Requisito del proyecto |
| Build | Vite 5 | *Build* estático, compatible con Pages |
| Estilos | Tailwind CSS 3 + shadcn/ui + Lucide | Requisito; componentes propios, sin dependencia de versión |
| Rutas | React Router 6 (`BrowserRouter`) | Ver D2 en `docs/FASE_0.md` |
| Datos servidor | TanStack Query 5 | Caché, reintentos, invalidación; evita estado global artificial |
| Formularios | React Hook Form + Zod | Requisito; un esquema Zod por formulario, reutilizado en el dominio |
| Gráficos | Recharts | Requisito |
| Fechas | date-fns (+ `es` locale) | Requisito; sin `moment` |
| Tablas | TanStack Table | Filtros/orden del módulo de trabajos |
| PDF | jsPDF + jspdf-autotable | MIT, 100 % cliente, sin servicio externo |
| Excel | SheetJS (`xlsx`) community | Exportación en cliente |
| Gantt | SVG propio sobre date-fns (Fase 3) | Las librerías Gantt buenas son de pago |
| Tests | Vitest + Testing Library + Playwright (Fase 2) | `domain/` con Vitest; RLS con pgTAP o script SQL |

Sin estado global (Redux/Zustand) salvo sesión y preferencias de interfaz: TanStack Query cubre
el resto y reduce el código a mantener.

## 5. Integración con Supabase (entregable 3)

### 5.1. Cliente único

`src/lib/supabase.ts` es el único lugar donde se llama a `createClient`. Configuración:

```ts
createClient<Database>(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',          // tokens por ?code=, no por #fragment  → no choca con el router
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { headers: { 'x-client-info': 'thesis-manager' } },
})
```

Solo se usa la clave **anon / publishable**. La clave `service_role` **no existe** en el frontend,
ni en el repositorio, ni en los workflows.

### 5.2. Patrón repositorio

Cada tabla relevante tiene su repositorio en `src/data/repositories/`. Los componentes nunca
construyen consultas. Ejemplo de la forma, no del código final:

```ts
// data/repositories/works.repo.ts
export const worksRepo = {
  listForCurrentUser: (f: WorkFilters) =>
    supabase.from('academic_works')
      .select('id,title,start_date,expected_end_date, work_type:work_types(code,name,color), status:work_statuses(code,name), members:work_members(user_id,is_primary,role:work_roles(code,name,is_supervisory))')
      .order('created_at', { ascending: false }),
  // ...
}
```

No se filtra por usuario en el cliente: **RLS ya devuelve solo lo accesible**. Filtrar en el
cliente daría una falsa sensación de seguridad y duplicaría la lógica.

### 5.3. Tipos generados

`npm run types:db` ejecuta `supabase gen types typescript` y escribe `src/data/types/database.ts`.
Un *check* de CI falla si el fichero generado no coincide con las migraciones: así el tipado y la
base de datos no se separan nunca.

### 5.4. Migraciones

SQL versionado en `supabase/migrations/NNNN_descripcion.sql`. Numeración secuencial, ficheros
**inmutables** una vez aplicados a producción: toda corrección es una migración nueva.
Aplicación mediante Supabase CLI (`supabase db push`) o pegando el SQL en el editor del panel.
No se usan funcionalidades exclusivas de planes de pago.

### 5.5. Qué NO se usa (y por qué)

- **Realtime**: no es necesario para 100 usuarios con trabajo asíncrono; añade conexiones y consumo.
- **Storage** como almacén principal: ver `DEPLOYMENT.md` y §5.6 de `FREE_TIER.md`; se prioriza enlazar
  a Drive/OneDrive institucional. Storage queda reservado a avatares y adjuntos pequeños.
- **Edge Functions** en el MVP: se reservan para la Fase 6 (IA) por ser el único lugar de la
  arquitectura donde una clave privada puede vivir con seguridad.

## 6. Modularidad lógica

Módulos (cada uno con su repositorio, sus esquemas Zod y su carpeta en `features/`):
autenticación · usuarios y perfiles · organizaciones y grupos · **catálogos** · trabajos académicos ·
relaciones y permisos · tareas · reuniones · documentos · comentarios · notificaciones · calendario ·
informes · mantenimiento técnico.

El módulo **catálogos** es nuevo respecto al prompt original y es consecuencia directa del requisito
de tipos de trabajo extensibles: concentra `work_types`, `work_statuses`, `work_roles`,
`document_types`, `programs`, `research_lines` y `academic_years`, con su interfaz de administración.

## 7. Decisiones de interfaz con impacto arquitectónico

- **Español** en toda la interfaz. Sin i18n en el MVP; textos centralizados en constantes para
  poder introducir i18n después sin reescribir componentes.
- **Selector de contexto** en la barra superior: «Toda mi actividad» / «Como director» /
  «Como codirector» / «Mis trabajos como estudiante». Es un filtro de presentación sobre datos ya
  autorizados por RLS, no un cambio de permisos.
- **Dashboard generado desde el catálogo**: una tarjeta de recuento por cada tipo de trabajo activo,
  ordenada por `work_types.display_order`. Añadir «Academia de Alumnos Internos» hace aparecer su
  tarjeta sin tocar código.
- **Modo claro/oscuro** con variables CSS de Tailwind y `prefers-color-scheme` + conmutador manual.
- **Móvil: la tabla no se adapta, se sustituye.** Debajo de `sm:` (640 px) los cuatro listados que
  se consultan de verdad desde el teléfono —trabajos, tareas, personas e informes— se renderizan
  como tarjetas, y la tabla queda oculta. Es markup duplicado a propósito: lo derivado de cada
  fila se calcula **una sola vez** y lo consumen las dos vistas, así que no pueden discrepar. La
  alternativa —una tabla con `overflow-x`— no se descarta por fea: en un móvil, la primera columna
  es la que identifica la fila y es la primera que desaparece al desplazar, de modo que se acaba
  leyendo un número sin saber de qué trabajo es.
- **Lo que sí decide JavaScript** está en `useMediaQuery` y es solo lo que una clase CSS no puede
  hacer: *qué* se renderiza (el calendario arranca en agenda en un teléfono) y los números que
  recibe una librería como propiedad (el ancho del eje de los gráficos, la columna de nombres del
  Gantt). Esconder sigue siendo trabajo de las clases.
- **16 px en los campos de formulario por debajo de `sm:`**: Safari en iOS hace zoom al enfocar un
  campo con letra menor y no lo deshace al salir.

## 8. Limitaciones asumidas

- Sin servidor: no hay *webhooks*, ni cron de aplicación, ni envío de correo propio en el MVP.
  Las notificaciones son **internas** (tabla `notifications`), como permite el prompt.
- Sin SSR: la primera carga descarga el *bundle*; se mitiga con *code splitting* por ruta.
- Las URL profundas dependen del truco de `404.html` (ver `DEPLOYMENT.md` §4).
- La generación de informes PDF/Excel ocurre en el navegador: limitada por la memoria del cliente,
  suficiente para informes de un grupo de investigación.
