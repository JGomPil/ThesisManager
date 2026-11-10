# Thesis Manager

Plataforma web para la gestión y supervisión de trabajos académicos del
**Grupo de Ingeniería Biomédica de la Universidad de Valladolid (GIB-UVa)**.

Gestiona TFG, TFM, tesis doctorales, **Academia de Alumnos Internos** y cualquier otro tipo de
trabajo que el grupo necesite: los tipos son un **catálogo configurable**, no una lista fija en el
código.

> **Estado: fases 1 a 4 implementadas y en uso.** Fase 0 aprobada el 5 de noviembre de 2026.
>
> - Aplicación publicada en **https://jgompil.github.io/ThesisManager/**, conectada a un proyecto
>   de Supabase real. Sin las variables de entorno, la web explica cuáles faltan en lugar de
>   quedarse en blanco.
>   La **`0028`** (LinkedIn en el perfil), la **`0029`** (comentarios editables) y la **`0030`**
>   (el alumno participa en su trabajo) están probadas contra PostgreSQL 16 y **pendientes de
>   aplicar** en el proyecto real. La `0028` no añade comprobación —es una columna más en
>   `profiles`, y la visibilidad de un perfil es por fila, así que no hay política nueva que
>   verificar—; las otras dos sí, de modo que `supabase/verify.sql` pasa a devolver **21 filas** y
>   las dos últimas dirán `FALLO` hasta que se apliquen.
>   **La `0029` no hace falta para poder editar**: la política `comments_update` que lo permite es
>   de la `0003`. Lo que falta sin ella son sus dos garantías —que la marca de «editado» sea verdad
>   y que un comentario no pueda mudarse al hilo de otro trabajo—, y las dos fallan en silencio,
>   que es justamente por lo que están en la lista de verificación.
>   **La `0030` sí hace falta**, y aquí es al contrario: sin ella la base de datos rechaza lo que
>   la interfaz ya ofrece. Mientras no se aplique, un alumno verá el botón de convocar una reunión,
>   de poner un hito o de escribir el contenido académico de su trabajo, y la base de datos se lo
>   negará.
> - Migraciones `0001…0027` **aplicadas** en el proyecto real y verificadas el 2026-11-08 con
>   `supabase/verify.sql`: **19 comprobaciones, todas `OK`** —RLS en todas las tablas, `anon` sin
>   acceso a ninguna función de `app`, las 18 tablas del núcleo, las políticas y disparadores de la
>   `0020` a la `0027`, que cada organización tenga administración, y el rol de estudiante sin
>   capacidades—. Las dos últimas comprueban lo que no se vería de otra manera: que las columnas
>   del tablero sean del trabajo y sin significado (`0024`), y que archivar una tarea tenga vuelta
>   atrás (`0025`).
>   180 pruebas de seguridad contra PostgreSQL 16 y 238 pruebas unitarias (dominio, y el
>   recorrido de los cubos de Storage contra un cliente simulado).
> - Progreso detallado en [`ROADMAP.md`](ROADMAP.md); decisiones técnicas en
>   [`docs/FASE_0.md`](docs/FASE_0.md).

## Arquitectura

| Capa | Tecnología | Coste |
|---|---|--:|
Frontend | React + TypeScript + Vite + Tailwind + shadcn/ui, en **GitHub Pages** | 0 € |
Backend y datos | **Supabase Free**: PostgreSQL, Auth, REST, Row Level Security | 0 € |
Automatización | **GitHub Actions**: despliegue y mantenimiento periódico | 0 € |

Sin servidor propio, sin SSR, sin servicios de pago. Toda la autorización vive en PostgreSQL
mediante RLS: el frontend es código público y no protege nada por sí mismo.

## Ideas rectoras

- **Una persona, una cuenta.** Los roles no son excluyentes: el mismo investigador puede dirigir
  un TFG, codirigir un TFM y ser doctorando de su propia tesis. Los permisos se definen **por
  trabajo**, en `work_members`, nunca con un rol global.
- **Los tipos de trabajo son datos, no código.** Añadir «Prácticas de empresa» o «Estancia de
  investigación» es una fila nueva desde la interfaz de administración, con sus propias reglas
  (duración, defensa, depósito, plantilla de tareas).
- **RLS es la única frontera de seguridad.** Ocultar un botón es usabilidad, no protección.
- **Honestidad sobre los límites.** Lo que el plan gratuito no garantiza está escrito, no
  escondido: [`FREE_TIER.md`](FREE_TIER.md).

## Documentación

| Documento | Contenido |
|---|---|
[`docs/PUESTA_EN_MARCHA.md`](docs/PUESTA_EN_MARCHA.md) | **Instalación paso a paso**: Supabase, migraciones, primer usuario |
[`docs/FASE_0.md`](docs/FASE_0.md) | Propuesta técnica, decisiones y riesgos |
[`ARCHITECTURE.md`](ARCHITECTURE.md) | Estructura del proyecto y decisiones técnicas |
[`DATABASE.md`](DATABASE.md) | Modelo de datos, catálogos y estimación de volumen |
[`SECURITY.md`](SECURITY.md) | Roles, permisos, RLS, RGPD y pruebas obligatorias |
[`DEPLOYMENT.md`](DEPLOYMENT.md) | Despliegue en GitHub Pages, configuración de Supabase y app instalable |
[`FREE_TIER.md`](FREE_TIER.md) | Límites, condiciones, riesgos y costes reales |
[`BACKUP.md`](BACKUP.md) | Copias de seguridad, restauración y exportación |
[`docs/EXPORTACION.md`](docs/EXPORTACION.md) | Consultas SQL de exportación con los catálogos resueltos |
[`ROADMAP.md`](ROADMAP.md) | Fases y criterios de aceptación |
[`supabase/tests/README.md`](supabase/tests/README.md) | Pruebas de seguridad del modelo de datos |

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar con los datos del proyecto de Supabase
npm run dev
```

Comprobaciones disponibles:

```bash
npm run typecheck        # tipos de todo el proyecto
npm run lint
npm test                 # pruebas unitarias del dominio (permisos, progreso, estados)
npm run test:rls         # pruebas de seguridad en PostgreSQL desechable (requiere Docker)
npm run check:secrets    # verifica que dist/ no publica credenciales privilegiadas
npm run check:embeds     # embeds de PostgREST que necesitan pista explícita
npm run check:export     # ejecuta las consultas de docs/EXPORTACION.md contra el esquema
npm run check:pure       # las pruebas unitarias no importan infraestructura
npm run check:wrap       # el texto libre puede partir palabras (si no, descoloca el móvil)
npm run check:grids      # ninguna rejilla sin columna base (si no, desborda el ancho del móvil)
npm run check:pwa        # manifest, iconos y service worker de la app instalable
npm run icons            # regenera los iconos desde scripts/make-icons.py
npm run drill            # ensaya la restauración de una copia (sin argumento: autoprueba)
```

Base de datos: aplicar `supabase/migrations/0001…0030` y después
`supabase/seed/0001_catalogs.sql`. Detalle en [`DEPLOYMENT.md`](DEPLOYMENT.md) §5.

Pruebas de seguridad del modelo de datos, sin necesidad de proyecto en Supabase (requiere Docker):

```bash
./scripts/test-rls.sh                      # 180 pruebas de RLS, catálogos, storage y keepalive
./scripts/backup-dump.sh                    # vuelca la base real y ensaya la copia seguida
python3 scripts/backup-storage.py <carpeta> # y los ficheros de Storage, que no van en el .sql
./scripts/restore-drill.sh copia.sql       # ¿esta copia se puede restaurar de verdad?
./scripts/check-export-queries.sh          # ¿siguen siendo válidas las consultas documentadas?
```

## Aviso sobre datos

Este repositorio es **público** (requisito de GitHub Pages gratuito). **No debe contener nunca
datos personales ni académicos reales**: ni en *seeds*, ni en capturas, ni en *issues*, ni en
artefactos de Actions. Los datos de demostración son completamente ficticios.
