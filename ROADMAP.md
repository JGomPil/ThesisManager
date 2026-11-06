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
| ✅ | Dominio puro con 20 pruebas unitarias (capacidades, progreso, estados por tipo) |
| ✅ | Administración del catálogo de tipos de trabajo (crear, editar, desactivar) |
| ✅ | Trabajos: listado con filtros, ficha, alta y edición, cambio de estado |
| ✅ | Participantes con roles múltiples por trabajo |
| ✅ | Tareas: Kanban y lista, con el límite de edición del estudiante respetado |
| ✅ | Dashboard con tarjetas por tipo generadas desde el catálogo |
| ✅ | Aviso de mantenimiento (`last_ping_at`) en el panel de administración |
| ✅ | Comprobación de secretos en el despliegue, con pruebas de detección |
| ✅ | Proyecto de Supabase creado, migraciones `0001`–`0008` aplicadas y privilegios de `anon` y `authenticated` verificados contra el proyecto real |
| ✅ | Datos de demostración ficticios, validados (el usuario con tres papeles incluido) |
| ✅ | Cola de invitaciones con alta automática al aceptar (decisión D3) |
| ✅ | Perfil propio editable y cambio de contraseña |
| ✅ | Despliegue real en GitHub Pages verificado (HTTP 200, rutas profundas y `base` correctos) |
| ✅ | Pantalla de configuración cuando faltan las variables de Supabase |

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

## Fase 2 — Seguimiento académico

Reuniones con acta estructurada · acuerdos con tareas derivadas · **notas privadas** con su RLS
verificada · comentarios contextuales con menciones · notificaciones internas · gestión documental
con versiones y estados de revisión.

**Criterios**: escenarios 3 y 4; un estudiante no ve ninguna nota privada de su propio trabajo;
las notificaciones llegan a quien debe y solo a quien debe.

## Fase 3 — Planificación avanzada

Calendario (mes/semana/agenda) con filtros · Gantt en SVG propio · dependencias entre tareas con
detección de ciclos · plantillas de tareas **por tipo de trabajo** · hitos · alertas de retraso ·
subtareas.

**Criterios**: aplicar una plantilla a un trabajo genera el plan completo con fechas relativas
correctas; cada usuario ve en el calendario solo los eventos de sus trabajos.

## Fase 4 — Informes y analítica

Indicadores · gráficos (Recharts) · informe por estudiante y por trabajo · informe global ·
exportación a PDF y Excel · consultas de exportación documentadas.

**Criterios**: el progreso académico (`progress_override`) y el porcentaje de tareas completadas
aparecen siempre **como dos cifras distintas y etiquetadas**, nunca fundidas en una.

## Fase 5 — Automatización y mantenimiento

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
