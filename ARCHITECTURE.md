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

**Comprobada, no confiada** (`scripts/check-pure-tests.sh`, en el workflow). Las pruebas
unitarias solo pueden importar de `@/domain/`; los `import type` no cuentan, porque TypeScript los
borra y no ejecutan ningún módulo. Existe por un fallo real: una prueba de cómo se abrevian los
nombres importaba `iniciales` de un componente, el componente importaba `lib/avatars` y este
`lib/supabase`, **que crea el cliente al cargarse**. En local pasó —Node 24 trae WebSocket
nativo—; en Actions, con Node 20, la tanda entera murió con «native WebSocket not found» y el
despliegue se quedó sin hacer. Dos lecciones: si una función merece pruebas, es lógica y su sitio
es `domain/`; y una comprobación local más débil que la de Actions no comprueba nada (ahora las
dos usan Node 22).

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
- **Instalable, pero sin modo sin conexión.** El *service worker* existe por una razón concreta
  —Chrome en Android solo ofrece instalar si hay uno con manejador de `fetch`— y hace lo mínimo:
  las navegaciones van **siempre** a la red (si el HTML se sirviera de caché, un despliegue nuevo
  no llegaría nunca, que es el fallo clásico de los PWA), `assets/` va de caché porque lleva el
  *hash* en el nombre, y Supabase no se cachea jamás. Un modo sin conexión de verdad no tendría
  sentido aquí: todos los datos son remotos, así que enseñaría el armazón vacío con un error.
- **Aviso de «sitio para ordenador»** (`DesktopSiteNotice`). Con ese ajuste del navegador, el
  móvil declara ~980 px de ancho y la página se encoge para caber: todo se ve diminuto y, peor,
  **nada de lo responsive se aplica**, porque las reglas miran el ancho declarado. Es un ajuste
  por sitio que sobrevive a cualquier despliegue, así que la aplicación no puede deshacerlo: solo
  puede decirlo. Se detecta cruzando tres indicios (puntero grueso, ancho declarado ≥ 700 px y
  —pantalla real estrecha **o** escala del viewport < 0,9) para que un iPad no lo vea nunca. Pasó
  de verdad el 6 de noviembre de 2026 y nos costó un rato con el síntoma delante.
- **El ancho de la página lo fija su elemento más ancho**, y por eso un solo texto mal envuelto
  descoloca todo. Una palabra sin espacios —una URL pegada en la descripción de un trabajo, un DOI,
  un nombre de fichero— ensancha su tarjeta más que la pantalla del teléfono, y lo que se nota no es
  esa tarjeta: es la ficha entera corrida hacia un lado. `whitespace-pre-wrap` respeta los saltos de
  línea de quien escribe, que es lo que se quiere, pero **no parte palabras**: su pareja obligatoria
  es `break-words`. Diez sitios la tenían suelta. La regla es mecánica, así que la vigila
  `scripts/check-text-wrap.sh` en Actions, y no la memoria. En el mismo apartado:
  `[&>*]:min-w-0` en el diálogo, porque los hijos de un grid valen `min-width: auto` y no se
  encogen por debajo de su contenido.
- **Lo nuevo degrada; lo que ya estaba no se rompe.** Un *embed* de PostgREST a una tabla que no
  existe no devuelve una lista vacía: responde error y tumba la consulta **entera**. Al añadir
  `documents:template_documents(*)` al `select` de plantillas, la pantalla de Plantillas se quedaba
  en el panel de error mientras la `0019` no estuviese aplicada —sin tareas y sin material, que ya
  funcionaban—. Ahora, si el error habla de esa tabla, se repite la consulta sin ese *embed* y los
  documentos previstos quedan en `[]`. Es el mismo criterio que el recuento de comentarios de la
  `0015`: lo accesorio se cae solo.
- **«Instalar la aplicación» es un botón nuestro** (`InstallButton`) que aparece únicamente cuando
  el navegador dispara `beforeinstallprompt`. En Android, Chrome ofrece instalar por su cuenta; en
  el escritorio cumple exactamente los mismos requisitos pero esconde la opción en el cuadro de
  direcciones o en el menú de tres puntos, así que la aplicación *era* instalable y parecía que no.
  Si el evento no llega, el botón no se dibuja, y su ausencia también informa: ese navegador no la
  instala (Safari no implementa el evento) o ya está instalada.
- **Con más de una política permisiva, `USING` y `WITH CHECK` no se emparejan** (`0021`). En un
  UPDATE, PostgreSQL evalúa el `USING` sobre la fila vieja y el `WITH CHECK` sobre la nueva, y con
  **una** política cuyas dos condiciones piden lo mismo eso cierra las transiciones entre ámbitos.
  Con varias, el motor combina con OR los `USING` entre sí y los `WITH CHECK` entre sí, por
  separado: un tipo de documento propio que pasa a global cumple el `USING` de una política y el
  `WITH CHECK` de la otra. Lo que cierra una transición es un *trigger*, que ve `OLD` y `NEW` a la
  vez. Lo encontró la prueba [152], escrita porque el comentario de la migración afirmaba lo
  contrario.
- **Lo que se puede administrar se decide por lo que una columna ES, no por lo que cuesta
  editarla** (`0020`). Los estados de los trabajos y los roles académicos se administran desde la
  pantalla de catálogos —antes hacía falta una migración para cambiar un nombre—, pero las cuatro
  columnas `can_*` de `work_roles` no se tocan: las lee `app.has_work_capability`, o sea que son el
  modelo de permisos, y un interruptor en un formulario sería un interruptor que edita RLS en
  caliente. El `code` de un estado tampoco: el cronograma colorea por código, así que renombrarlo
  rompe pantallas sin dar ningún error. La prohibición vive en dos *triggers* y una política, no en
  el formulario, porque ocultar un control no protege de quien llama a PostgREST directamente.
- **Una regla que el `seed` no puede cumplir está en el sitio equivocado.** «Un rol nuevo nace sin
  capacidades» empezó siendo un *trigger* y bloqueaba el catálogo inicial, que crea los cuatro
  roles con las suyas: habría roto toda instalación nueva. Es una política, porque el propietario
  de la tabla no sufre RLS y quien entra por la API nunca es el propietario.
- **La plantilla dice qué hay que hacer y qué hay que entregar** (`0019`). Son dos cosas con ciclos
  de vida distintos y por eso se modelan distinto: el *material de referencia* (0014) **no se
  copia** —la tarea guarda `template_task_id` y lee de la plantilla, así una rúbrica corregida se
  corrige para todos los trabajos en curso—, mientras que un *documento previsto* **sí se copia** al
  aplicar la plantilla y deja de depender de ella, porque en cuanto nace es del trabajo: se
  renombra, se le suben versiones y se revisa. El documento creado no guarda su origen a propósito:
  guardarlo sugeriría que corregir la plantilla corrige los trabajos ya creados.
- **Un dato que se muestra se edita donde se muestra.** Vale igual para los **hitos**: antes solo se
  podían escribir al crearlos, y una fecha mal puesta obligaba a borrar el hito y rehacerlo,
  perdiendo su marca de cumplido. En una tarjeta tan estrecha como la de hitos no caben unos
  campos por fila, así que el lápiz carga el hito en el formulario de abajo —el mismo que
  añade—, que cambia de rótulo y dice qué está editando. Las tareas se podían
  crear con fechas y título pero no corregirlos después, que en un plan académico equivale a no
  poder ponerlos: la fecha de una tarea es justamente lo que se mueve. La ficha de la tarea tiene
  ahora «Editar», y abre **el mismo formulario** que el alta (`TaskDialog` con `task`), no uno
  nuevo: dos formularios se habrían separado en los campos y en las validaciones —el de edición
  acabaría sin la regla «la fecha límite no puede ser anterior al inicio», que vive en
  `taskFormSchema`—. El estado se queda fuera del formulario porque es la acción frecuente y se
  cambia desde el tablero. Quién puede tocar qué no lo decide el formulario: lo decide el disparador
  `app.enforce_task_update_scope` (0003), que sin `can_manage_plan` solo admite el cambio de estado.
- **La tarjeta entera abre su ficha**, no solo el título (`propsDeApertura`, hermano de
  `useRowLink` en el mismo fichero: misma lista de controles que se quedan con el clic, pero sin
  `window.open` ni Ctrl/⌘, porque un diálogo no se puede abrir en otra pestaña). El título sigue
  siendo un `<button>`: es la parada del tabulador y lo que anuncia un lector de pantalla.
- **Ficha de persona de solo lectura** (`/personas/:id`). El departamento, el puesto, el ORCID y la
  información académica se guardaban y no había donde leerlos: en una tabla de cuatro columnas no
  caben, y cada cual solo los veía de sí mismo. La fila entera de «Personas» abre la ficha, con el
  nombre como enlace de verdad —el que ve un lector de pantalla y el que se puede copiar—; las
  insignias de trabajo que hay dentro siguen llevando a su trabajo, porque `useRowLink` no navega
  cuando el clic cae sobre un enlace. **La ruta no lleva guarda**: quién tiene ficha lo decide
  `profiles_select`, y una guarda en TypeScript tendría que repetir ese criterio para separarse de
  él en el primer cambio. «No visible» y «no existe» muestran **el mismo mensaje** a propósito:
  distinguirlos convertiría la dirección en un comprobador de existencia de cuentas. Las relaciones
  académicas que lista son las de los trabajos que ve **quien mira**, no todas las de esa persona;
  el pie de la tarjeta lo dice, para que una lista corta no se lea como un dato que falta.
- **El tamaño base NO se toca en móvil.** Se probó subirlo a 17,5 px (+9 %) y en un teléfono real
  se veía demasiado grande: cabía menos en cada pantalla, que en un móvil se paga en
  desplazamiento. La palanca queda documentada en `globals.css` con su resultado, para no repetir
  la prueba.

## 8. Limitaciones asumidas

- Sin servidor: no hay *webhooks*, ni cron de aplicación, ni envío de correo propio en el MVP.
  Las notificaciones son **internas** (tabla `notifications`), como permite el prompt.
- Sin SSR: la primera carga descarga el *bundle*; se mitiga con *code splitting* por ruta.
- Las URL profundas dependen del truco de `404.html` (ver `DEPLOYMENT.md` §4).
- La generación de informes PDF/Excel ocurre en el navegador: limitada por la memoria del cliente,
  suficiente para informes de un grupo de investigación.
