# ROADMAP.md — Fases de implementación

Criterio transversal: **ninguna fase se declara terminada sin sus criterios de aceptación
validados contra la base de datos real.** Que algo se vea bien no cuenta.

## Fase 0 — Análisis y arquitectura · **entregada, pendiente de aprobación**

Documentación, modelo de datos, SQL propuesto y workflows propuestos.
Resumen y decisiones pendientes de tu visto bueno: [`docs/FASE_0.md`](docs/FASE_0.md).

Sin código de aplicación. Sin `package.json`. Nada aplicado a Supabase.

## Fase 1 — MVP funcional · **en curso**

Estado a 6 de noviembre de 2026:

| | Elemento |
|---|---|
| ✅ | Andamiaje Vite + React + TS + Tailwind, `base` y `404.html`, build verificado |
| ✅ | Capa de acceso a datos (repositorios) y tipos de la base de datos |
| ✅ | Autenticación PKCE, guardas de ruta, recuperación de contraseña, pantalla de cuenta pendiente |
| ✅ | Dominio puro con pruebas unitarias (capacidades, progreso, estados por tipo; 72 en total hoy) |
| ✅ | Administración del catálogo de tipos de trabajo (crear, editar, desactivar) |
| ✅ | Administración de los catálogos planos: líneas de investigación, titulaciones y cursos académicos, con la diferencia entre **retirar** y **borrar** explicada en pantalla (pruebas `[90]`–`[95]`) |
| ✅ | Trabajos: listado con filtros, ficha, alta y edición, cambio de estado |
| ✅ | Participantes con roles múltiples por trabajo |
| ✅ | Tareas: Kanban y lista, con el límite de edición del estudiante respetado |
| ✅ | Dashboard con tarjetas por tipo generadas desde el catálogo |
| ✅ | Aviso de mantenimiento (`last_ping_at`) en el panel de administración |
| ✅ | Comprobación de secretos en el despliegue, con pruebas de detección |
| ✅ | Proyecto de Supabase creado, migraciones `0001`–`0010` aplicadas y privilegios de `anon` y `authenticated` verificados contra el proyecto real |
| ✅ | Datos de demostración ficticios, validados (el usuario con tres papeles incluido) |
| ✅ | Cola de invitaciones con alta automática al aceptar (decisión D3) |
| ✅ | Perfil propio editable y cambio de contraseña |
| ✅ | Despliegue real en GitHub Pages verificado (HTTP 200, rutas profundas y `base` correctos) |
| ✅ | Pantalla de configuración cuando faltan las variables de Supabase |
| ✅ | **Instalable como aplicación**: manifest, iconos generados (`npm run icons`), *service worker* que **nunca** sirve el HTML de caché —para que un despliegue nuevo llegue siempre— y comprobación propia en Actions (`check:pwa`), porque un icono roto no da ningún error visible |
| ✅ | **Fotos de perfil** (`0017`): cubo privado, visibilidad **idéntica a la del nombre** por una sola función (`app.can_see_profile`), redimensionado a 256 px en el navegador e iniciales de color estable cuando no hay foto. Se ven en participantes, tareas, comentarios, personas y la barra superior |
| ⏳ | **Las migraciones `0017` y `0018` no están aplicadas al proyecto real**: hasta entonces, subir una foto fallará (no existe el cubo) y la función seguirá llamándose «Director principal» |
| ✅ | **Ficha de persona de solo lectura** (`/personas/:id`): foto, departamento, puesto, ORCID, información académica y las relaciones académicas que ve quien mira. La fila entera de «Personas» la abre. Sin guarda de ruta: quién tiene ficha lo decide `profiles_select`, y «no visible» se ve igual que «no existe» para no poder comprobar si una cuenta existe |
| ✅ | **«Director», no «Director principal»** (`0018`): el nombre de la función en el catálogo, con la migración escrita para **no pisar** un nombre editado a mano, y comprobada en las dos direcciones sobre el catálogo ya sembrado |
| ✅ | **Uso desde el móvil**: los cuatro listados principales como tarjetas por debajo de 640 px, calendario que arranca en agenda, diálogos con `dvh` (iOS), cajón lateral con cuenta y salida, y campos de 16 px para que iOS no haga zoom al escribir |
| ✅ | **Visibilidad de personas acotada a la relación académica** (`0016`): compartir organización ya no es ver a nadie. Quien no administra ve a su propio perfil y a quien participa en algún trabajo que puede ver; para añadir a alguien nuevo, búsqueda por **correo exacto**, sin lista que pasear (pruebas `[119]`–`[128]`) |

Alcance original de la fase:


1. Andamiaje Vite + React + TS + Tailwind + shadcn/ui; `base` y `404.html` (`DEPLOYMENT.md` §3–4).
2. Proyecto de Supabase: migraciones `0001`–`0004` + *seed* de catálogos.
3. `lib/supabase.ts`, autenticación con PKCE, guardas de ruta, recuperación de contraseña.
4. Perfiles, organización, grupos de investigación y **alta por invitación en cola**: con el
   correo integrado de Supabase (2–4 envíos/hora) la pantalla debe mostrar enviadas / pendientes /
   fallidas y permitir reintento, además de permitir al administrador fijar una contraseña
   temporal. Requisito derivado de la decisión D3.
5. **Administración de catálogos**: CRUD de tipos de trabajo (con sus reglas), estados, roles,
   titulaciones, líneas y cursos académicos. Es lo que hace que «Academia de Alumnos Internos» y
   cualquier tipo futuro sean configuración y no código.
6. Trabajos académicos: ficha completa, con el selector de tipo alimentado por el catálogo y el
   selector de estado filtrado por `work_type_statuses`.
7. `work_members`: asignación de estudiantes, director principal, codirectores y colaboradores,
   con roles múltiples por persona.
8. Tareas: lista y Kanban, CRUD, asignación, estados, prioridades.
9. Dashboard básico: tarjetas de recuento **generadas desde el catálogo de tipos**, tareas
   atrasadas, próximos vencimientos, selector de contexto.
10. Datos de demostración ficticios (§13 del prompt), incluido el usuario con tres papeles.
11. Despliegue en GitHub Pages.

**Criterios de aceptación**: los escenarios 1, 2 y 5 del prompt funcionan de extremo a extremo;
las 13 pruebas de `SECURITY.md` §9 pasan; un administrador puede crear un tipo de trabajo nuevo
desde la interfaz y usarlo inmediatamente sin desplegar nada.

## Fase 2 — Seguimiento académico · **implementada, pendiente de aplicar la migración `0011`**

Estado a 6 de noviembre de 2026:

| | Elemento |
|---|---|
| ✅ | Reuniones con acta estructurada: temas, acta compartida, modalidad, lugar, duración y próxima reunión |
| ✅ | Asistencia por participante |
| ✅ | Acuerdos, con **generación de la tarea derivada** y vínculo `meeting_agreements.task_id` para que el acta quede trazable |
| ✅ | **Notas privadas de dirección**, en tabla aparte, con consulta separada y la regla de protección del estudiante verificada (`[70]`–`[72]`) |
| ✅ | Comentarios contextuales con menciones elegidas de una lista, en el trabajo, las tareas y las reuniones |
| ✅ | Notificaciones internas creadas por disparadores, buzón con recuento de no leídas en la barra superior |
| ✅ | Gestión documental con versiones y estados de revisión (adelantada a la Fase 1) |
| ⏳ | **La migración `0011` todavía no está aplicada al proyecto real de Supabase**: hasta entonces, reuniones y comentarios funcionan pero no se genera ninguna notificación |
| ⏳ | **Las migraciones `0015` y `0016` están escritas y probadas, pero pendientes de aplicar al proyecto real**: hasta entonces, comentar un documento falla y la visibilidad de personas sigue siendo la antigua (todo el grupo se ve) |
| ✅ | **Comentarios a nivel de documento** (`0015`): anclados a una **versión** concreta —que es donde significan algo para una revisión— sobre `document_comments`, no sobre `comments`. Ficha del documento con su historia de versiones y el hilo de cada una, y aviso a quien subió la versión, a quien ya había comentado y a quien valida |

> **La gestión documental se adelantó a la Fase 1** el 6 de noviembre de 2026, a
> petición del usuario: documentos con versiones, estados de revisión, vínculo
> opcional con una tarea, y ficheros en el cubo privado `work-documents` o como
> enlace externo. Migración `0010`, pruebas `[47]`–`[60]`.

Alcance original de la fase: reuniones con acta estructurada · acuerdos con tareas derivadas ·
**notas privadas** con su RLS verificada · comentarios contextuales con menciones ·
notificaciones internas · gestión documental con versiones y estados de revisión.

**Criterios**: escenarios 3 y 4; un estudiante no ve ninguna nota privada de su propio trabajo;
las notificaciones llegan a quien debe y solo a quien debe.

**Estado de los criterios**: verificados contra PostgreSQL 16 real por las pruebas `[64]`–`[75]`
de `supabase/tests/96_meetings_notifications.sql`. En particular: una nota privada genera **cero**
notificaciones, el estudiante no ve la nota privada de su propia reunión pero sí el acta
compartida, una mención solo alcanza a quien ya es miembro activo del trabajo, y nadie puede
escribir en el buzón de otra persona porque `notifications` no tiene política de `INSERT`
(`SECURITY.md` §5.2.nonies).

## Fase 3 — Planificación avanzada · **implementada**

Estado a 6 de noviembre de 2026:

| | Elemento |
|---|---|
| ✅ | Calendario con vistas de **mes, semana y agenda**, y filtros por tipo de evento y por trabajo |
| ✅ | **Gantt en SVG propio**, con escalas de año/mes/semana, hitos, línea de hoy y líneas de dependencia |
| ✅ | **Dependencias entre tareas con detección de ciclos** en la base de datos (cláusula `CYCLE`), y el desplegable del cliente no ofrece lo que crearía un círculo |
| ✅ | **Plantillas de tareas por tipo de trabajo**, con fechas relativas y jerarquía, aplicables en una sola llamada atómica |
| ✅ | **Hitos** con fecha de cumplimiento escrita por la base de datos |
| ✅ | Alertas de retraso: hitos vencidos y tareas que esperan a otra sin terminar, marcadas en el cronograma |
| ✅ | **Plantillas completas** (`0014`): la tarea de plantilla guarda en qué consiste, quién la hace —por función académica, resuelta al aplicarla— y su **material adjunto** (guiones, rúbricas, formatos), que la tarea real muestra sin copiar ningún fichero |

El **material de plantilla** se enlaza, no se copia: la tarea creada guarda `template_task_id` y
lee el material de la plantilla, de modo que corregir una rúbrica la corrige en todos los
trabajos, también los que ya están en marcha. El precio está escrito y probado: borrar una tarea
de plantilla deja sin material a las tareas ya creadas desde ella y no avisa (prueba `[108]`, de
ahí el aviso con recuento en la interfaz). Añadido a petición del usuario el 6 de noviembre de
2026, junto con poder **entrar en un trabajo pinchando en cualquier parte de su fila** y no solo
en el título.

Las **subtareas** se adelantaron a la Fase 1 al implementar las listas de comprobación
de cada tarea (`tasks.parent_task_id`), a petición del usuario el 6 de noviembre de 2026.

Alcance original de la fase: calendario (mes/semana/agenda) con filtros · Gantt en SVG propio ·
dependencias entre tareas con detección de ciclos · plantillas de tareas **por tipo de trabajo** ·
hitos · alertas de retraso.

**Criterios**: aplicar una plantilla a un trabajo genera el plan completo con fechas relativas
correctas; cada usuario ve en el calendario solo los eventos de sus trabajos.

**Estado de los criterios**: el primero lo verifica la prueba `[84]` contra PostgreSQL real
(tres tareas, desplazamientos de 0 y 60 días aplicados, jerarquía resuelta), más `[87]` para la
atomicidad. El segundo **no lo implementa la pantalla del calendario**, y es a propósito: lo
cumplen `tasks_select`, `meetings_select` y `milestones_select`, que ya filtran por
`app.accessible_work_ids()`. Filtrarlo también en el cliente daría dos reglas que mantener en
paralelo y la del cliente sería la que se quedara atrás. Los filtros de la pantalla son de
comodidad: quitan ruido, no ocultan nada.

La fase añadió 14 pruebas (de 75 a 89) y encontró **tres** huecos que el esquema arrastraba desde
la `0002`: los ciclos de dependencias se «validaban en aplicación», una tarea podía depender de
una tarea de otro trabajo, y el `alter default privileges` de la `0007` no protegía las funciones
futuras (`SECURITY.md` §5.2.decies a §5.2.duodecies).

## Fase 4 — Informes y analítica · **implementada**

Estado a 6 de noviembre de 2026:

| | Elemento |
|---|---|
| ✅ | **Panel de indicadores**: trabajos, en curso, terminados, con retraso y sin planificación, con filtros por tipo, estado, curso y archivados |
| ✅ | **Cuatro gráficos** (Recharts, en un paquete aparte cargado solo al abrir los informes): por tipo, por estado, carga por dirección y progreso de los trabajos en curso |
| ✅ | **Informe trabajo por trabajo** en tabla, y **ficha de seguimiento de un trabajo** pensada para imprimirse: datos académicos, las dos cifras de progreso, hitos, plan, actas y documentos |
| ✅ | **Informe por estudiante y por dirección**, con la misma persona apareciendo en los dos cuando corresponde (roles no excluyentes) |
| ✅ | **Exportación a CSV** (separador `;` y BOM de UTF-8, que es lo que Excel en español necesita) y **a PDF por la impresión del navegador**, sin meter un generador de PDF en el paquete |
| ✅ | **Aviso si el servidor recorta las listas**: un informe con totales incompletos parecería bueno, así que se dice en vez de mostrar la cifra |
| ⏸ | Exportación a `.xlsx` nativo: descartada por ahora. Son unos 400 kB de biblioteca para lo que el CSV ya abre en Excel |

Los indicadores son los de **quien mira**: RLS devuelve a cada cual sus trabajos, así que un
director ve los suyos y la administración ve todos. La pantalla lo dice bajo el título, porque un
panel sin esa frase se leería como un total del grupo.

**Criterios**: el progreso académico (`progress_override`) y el porcentaje de tareas completadas
aparecen siempre **como dos cifras distintas y etiquetadas**, nunca fundidas en una.

**Estado del criterio**: cumplido y con prueba que lo fija (`buildWorkReports` arrastra las dos
cifras separadas hasta el CSV, donde son dos columnas con dos títulos). En la tabla y en la ficha,
una cifra sin dato se escribe con una raya y no con un 0 %: un cero afirma «no ha avanzado nada»,
que es otra cosa.

## Fase 5 — Automatización y mantenimiento · **en curso**

Estado a 6 de noviembre de 2026:

| | Elemento |
|---|---|
| ✅ | `deploy.yml`, `keepalive.yml` y `repo-activity.yml` en marcha, y aviso de `last_ping_at` en Administración (adelantado a la Fase 1, como decía esta misma sección) |
| ✅ | **Ensayo de restauración automático** (`scripts/restore-drill.sh`): restaura una copia en un PostgreSQL desechable y comprueba las tablas del núcleo, que RLS siga activada en todas, que `anon` no ejecute nada de `app` y **que haya usuarios de autenticación**. Sale con código distinto de cero si algo falla |
| ✅ | **Copia de los datos académicos desde la aplicación** (JSON, un clic, sin la CLI), con lo que no incluye escrito en el propio fichero |
| ✅ | **Consultas de exportación documentadas** (`docs/EXPORTACION.md`) y ejecutadas de verdad por `scripts/check-export-queries.sh`, para que no se queden obsoletas en silencio |
| ⏳ | El volcado completo de los datos reales lo tiene que ejecutar la administración: necesita la contraseña de la base de datos y **no puede automatizarse en este repositorio**, que es público (`BACKUP.md`) |

El ensayo dejó un aviso que ningún documento daba: un volcado que no incluya el esquema `auth`
restaura todos los datos académicos y deja la plataforma **sin nadie que pueda entrar**. Ahora lo
dice el propio ensayo, y `BACKUP.md` §5.0 explica cómo arreglarlo.

Alcance original de la fase:

Afinado de `deploy.yml`, `keepalive.yml` y `repo-activity.yml` · panel de administración con
`last_ping_at` y aviso si supera 24 h · documentación de recuperación · procedimiento de copias
probado de verdad.

El aviso de `last_ping_at` **conviene adelantarlo a la Fase 1**: es la única detección del fallo
de los *cron* que no depende de que GitHub siga ejecutando algo, y son unas pocas líneas.

**Criterios**: escenario 6; una copia restaurada en Supabase local arranca y la aplicación
funciona contra ella.

## Fase 6 — Funcionalidades avanzadas (a valorar)

Integración opcional con IA en **Supabase Edge Functions** (no requiere proveedores nuevos ni
coste; ver `docs/FASE_0.md` D4): propuesta de planificación, generación de tareas desde objetivos,
resumen de reuniones, borrador de informe de seguimiento.

Restricciones no negociables: desactivada por defecto · clave de API solo en *secrets* de la
función, nunca en el frontend · toda salida marcada como propuesta y revisada por una persona ·
prohibido generar referencias bibliográficas, resultados o datos.

## Orden de prioridad si hay que recortar

1. Fase 1 completa (sin ella no hay plataforma).
2. Reuniones y actas de la Fase 2 (es el trabajo diario de supervisión).
3. Gestión documental de la Fase 2.
4. `keepalive.yml`, `repo-activity.yml` y el aviso de `last_ping_at`, de la Fase 5 — **en realidad
   van en la Fase 1**: sin ellos, el proyecto se pausa en una semana de vacaciones.
5. El resto, según el uso real.
