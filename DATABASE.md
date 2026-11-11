# DATABASE.md — Modelo de datos

PostgreSQL (Supabase Free). Modelo relacional normalizado, con RLS activo en **todas** las tablas.
Migraciones versionadas en `supabase/migrations/`.

Convenciones: claves primarias `uuid` (`gen_random_uuid()`), `created_at`/`updated_at` con
`timestamptz default now()`, borrado lógico mediante `deleted_at` en las entidades con valor
histórico, nombres de tabla en plural e inglés, valores de catálogo (`code`) en MAYÚSCULAS.

## 1. Mapa de entidades

```
organizations ─┬─ research_groups ─── research_group_members ─── profiles ─── auth.users
               ├─ organization_members (permisos ADMINISTRATIVOS)
               ├─ academic_years
               ├─ programs            (titulaciones y programas de doctorado)
               ├─ research_lines
               └─ CATÁLOGOS: work_types · work_statuses · work_roles · document_types
                                   │
                      academic_works (work_type_id ▸ work_types, status_id ▸ work_statuses)
                                   │
   ┌───────────────┬───────────────┼───────────────┬───────────────┬──────────────┐
work_members    work_phases     tasks          meetings        documents      comments
(permisos         │             │ ├ task_dependencies │ ├ meeting_participants │ ├ document_versions
 ACADÉMICOS)   milestones       │ └ task_comments     │ ├ meeting_agreements   │ └ document_comments
                                │                     │ └ meeting_private_notes
                          templates ── template_tasks  (plantillas POR TIPO de trabajo)

transversales: notifications · activity_logs · system_settings · keepalive
```

> **`profiles.email` no es un dato editable** (`0027`): es el reflejo de `auth.users.email`. Un
> *trigger* lo actualiza cuando el correo de la cuenta cambia —desde «Mi perfil» o desde el panel de
> Supabase— y otro rechaza cualquier `UPDATE` que lo deje diciendo algo distinto de lo que dice la
> cuenta. Cambiar de correo **no cambia el perfil**, que es lo que conserva las relaciones
> académicas, las tareas y el historial.

## 2. Separación deliberada de los dos sistemas de permisos

| Tabla | Qué concede | Ámbito |
|---|---|---|
| `organization_members` | Permisos **administrativos**: gestionar usuarios, catálogos, ver todo | Organización completa |
| | `role in ('OWNER','ADMIN','MEMBER')`. Se puede cambiar desde la ficha de la persona, y **nunca puede quedar la organización sin ningún administrador activo**: lo rechaza el *trigger* `org_members_last_admin` (`0023`), que es `security definer` porque cuenta filas y, sin eso, RLS le esconde justo las que lo harían fallar | |
| `research_group_members` | Pertenencia al grupo de investigación, visibilidad agregada | Grupo |
| `work_members` | Permisos **académicos**: director, codirector, estudiante, colaborador | **Un solo trabajo** |

Son independientes por diseño. Ser director de un TFG no otorga nada sobre otro trabajo, y ser
administrador del grupo no convierte a nadie en supervisor académico de nada.

## 3. Catálogos configurables

El requisito «debe poder elegirse como campo nuevo» se resuelve con tablas de catálogo editables
desde la interfaz de administración, no con tipos `ENUM` de PostgreSQL.

### 3.1. `work_types` — tipos de trabajo académico

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK NULL | `NULL` = catálogo global; permite tipos propios por organización. **Inmutable** desde la `0022`: un tipo no se mueve de ámbito |
| `code` | text | `TFG`, `TFM`, `TESIS`, `ACADEMIA`, … Único por organización. **Inmutable** desde la `0022`: el catálogo inicial y las migraciones casan por código |
| `name` | text | «Trabajo de Fin de Grado» |
| `short_name` | text | «TFG» (para tablas y tarjetas) |
| `academic_level` | text FK ▸ `academic_levels` | `GRADO`, `MASTER`, `DOCTORADO`, `OTRO` |
| `color` | text | Token de color para insignias y gráficos |
| `icon` | text | Nombre de icono de Lucide |
| `display_order` | int | Orden en selectores y dashboard |
| `is_active` | bool | Desactivar sin borrar: los trabajos históricos conservan su tipo. Los tipos globales se retiran así, y **no** se borran (`0022`) |
| `default_duration_months` | int NULL | Para proponer la fecha prevista de fin |
| `requires_defense` | bool | Habilita el estado «Defendido» y el evento de defensa |
| `requires_deposit` | bool | Habilita «Pendiente de depósito» |
| `requires_program` | bool | Si exige titulación/programa asociado |
| `allows_multiple_students` | bool | Trabajos compartidos |
| `max_supervisors` | int NULL | Límite de supervisores (validación de aplicación) |
| `default_template_id` | uuid FK NULL ▸ `templates` | Plantilla habitual del tipo. Se marca al editar el tipo y viene PRESELECCIONADA al crear un trabajo de ese tipo; no se aplica sola |
| `counts_toward_workload` | bool | Si computa en los indicadores de carga de supervisión |
| `notes` | text NULL | |

Valores iniciales propuestos:

| code | name | nivel | defensa | depósito | duración | computa carga |
|---|---|---|:-:|:-:|--:|:-:|
| `TFG` | Trabajo de Fin de Grado | GRADO | sí | sí | 9 | sí |
| `TFM` | Trabajo de Fin de Máster | MASTER | sí | sí | 9 | sí |
| `TESIS` | Tesis doctoral | DOCTORADO | sí | sí | 48 | sí |
| `ACADEMIA` | Academia de Alumnos Internos | GRADO | **no** | **no** | 9 | sí |

Reglas de `ACADEMIA` confirmadas por el responsable del grupo: sin acto de defensa ni depósito
oficial, sin titulación asociada (`requires_program = false`), **duración igual que un TFG**
(9 meses) y una **memoria final** como entregable principal, más entregables opcionales. Al no
haber hitos oficiales que cumplir, su plantilla de tareas (Fase 3) será más corta que la de un TFG:
bibliografía, desarrollo, memoria final.

`allows_multiple_students` queda en `false` (trabajo individual, como un TFG). Si alguna edición de
la Academia se plantea por parejas, es una casilla en la pantalla de administración del catálogo.

Añadir un tipo nuevo en el futuro («Prácticas de empresa», «Estancia de investigación», «Beca de
colaboración») es una fila más desde la interfaz: **ninguna migración, ningún despliegue**.

### 3.2. `work_statuses` y `work_type_statuses` — ciclo de vida por tipo

`work_statuses` contiene los estados (`code`, `name`, `display_order`, `is_terminal`, `color`,
`is_active`), precargado con: `PROPUESTA`, `ASIGNADO`, `EN_PLANIFICACION`, `EN_DESARROLLO`,
`EN_REVISION`, `PENDIENTE_DEPOSITO`, `DEFENDIDO`, `FINALIZADO`, `CANCELADO`.

`work_type_statuses` (`work_type_id`, `status_id`, `display_order`) restringe **opcionalmente** qué
estados aplican a cada tipo. Regla: si un tipo no tiene ninguna fila, le aplican todos los estados.
Así, «Academia de Alumnos Internos» puede saltar de `EN_DESARROLLO` a `FINALIZADO` sin pasar por
`PENDIENTE_DEPOSITO` ni `DEFENDIDO`, y el selector de estado de su ficha solo ofrece lo pertinente.

### 3.3. `work_roles` — funciones académicas

| Columna | Notas |
|---|---|
| `code` | `STUDENT`, `PRIMARY_SUPERVISOR`, `CO_SUPERVISOR`, `COLLABORATOR` (ampliable: `TUTOR`, `EXTERNAL`) |
| `name` | Etiqueta en español |
| `is_student` | Marca las funciones del lado del estudiante |
| `is_supervisory` | Marca las funciones de supervisión → **lo que consultan las políticas RLS** |
| `can_manage_plan` | Crear/editar tareas, hitos y fechas |
| `can_see_private_notes` | Acceso a `meeting_private_notes` |
| `can_validate_deliverables` | Validar entregas y versiones de documentos |
| `can_manage_members` | Añadir o retirar participantes del trabajo |
| `display_order`, `is_active` | |

Las políticas RLS se escriben sobre los *flags*, nunca sobre el `code`. Crear una función nueva
(por ejemplo «Tutor académico de la Academia», sin acceso a notas privadas) es una fila más y la
seguridad se comporta correctamente sin reescribir políticas.

### 3.4. Otros catálogos

- `academic_levels`: `GRADO`, `MASTER`, `DOCTORADO`, `OTRO`.
- `programs`: titulaciones y programas de doctorado. `academic_works.program_id` es **nullable**
  porque hay tipos (como la Academia) que no cuelgan de una titulación concreta.
- `document_types`: propuesta inicial, plan de trabajo, estado del arte, memoria, artículo,
  presentación, datos y resultados, documentación administrativa, otros.
- `academic_years`: `2025/2026`, con `is_current`.
- `research_lines`: líneas del grupo.
- `task_priorities`: dado que el prompt las fija y son estables, se implementan como columna
  `text` con `CHECK`, no como tabla.
- `task_statuses` sigue siendo también una columna `text` con `CHECK` —`tasks.status`—, y lo
  seguirá siendo: el dominio casa por valor (`domain/plan`), el cronograma colorea por valor y el
  progreso del trabajo se calcula con él. Lo que la `0024` hace configurable es otra cosa, y no
  es un catálogo del grupo: **las columnas del tablero de cada trabajo** (§6.ter).

## 4. `academic_works`

Campos: `id`, `organization_id`, `research_group_id`, **`work_type_id`** ▸ `work_types`,
`status_id` ▸ `work_statuses`, `program_id` (NULL), `academic_year_id`, `research_line_id` (NULL),
`title`, `description`, `objectives`, `hypothesis`, `methodology`, `keywords text[]`, `notes`,
`start_date`, `expected_end_date`, `actual_end_date`, `defense_date` (NULL),
`progress_override smallint` (NULL, 0–100), `is_archived`, `created_by`, `created_at`,
`updated_at`, `deleted_at`.

Sin columnas `student_id` ni `supervisor_id`: **toda** participación se expresa en `work_members`.
Esto es lo que permite trabajos con varios estudiantes, varios codirectores y relevos de dirección
sin alterar el esquema.

`progress_override` existe para separar explícitamente **progreso académico real** (juicio del
supervisor) de **porcentaje de tareas completadas** (cálculo mecánico). La interfaz muestra ambos
y nunca presenta el segundo como si fuera el primero.

## 5. `work_members` — el núcleo de los roles no excluyentes

| Columna | Notas |
|---|---|
| `id` | uuid PK |
| `work_id` | FK ▸ `academic_works` ON DELETE CASCADE |
| `user_id` | FK ▸ `profiles` ON DELETE RESTRICT |
| `work_role_id` | FK ▸ `work_roles` |
| `is_primary` | Marca el supervisor principal / estudiante principal |
| `permissions` | `jsonb` de excepciones puntuales sobre los *flags* del rol |
| `start_date`, `end_date` | Historial: permite relevos de dirección sin perder trazabilidad |
| `status` | `ACTIVE` / `INACTIVE` (`CHECK`) |

Restricciones:

- `UNIQUE (work_id, user_id, work_role_id)` — una persona **sí puede** tener dos funciones en el
  mismo trabajo (p. ej. codirector y colaborador), pero no la misma dos veces.
- Índice único parcial: un solo `is_primary = true` por `(work_id, work_role_id)`.
- `CHECK (end_date IS NULL OR end_date >= start_date)`.

**Resolución de permisos cuando hay varias funciones en el mismo trabajo**: se aplica la **unión**
de capacidades de las filas con `status = 'ACTIVE'`, con `permissions` como última palabra
(`jsonb` que puede conceder o denegar explícitamente). Decisión documentada para evitar ambigüedad:
tener más funciones nunca quita permisos. Excepción explícita y comprobada en pruebas:
**si alguna función activa es `is_student`, la persona nunca ve `meeting_private_notes` de ese
trabajo, aunque otra de sus funciones conceda `can_see_private_notes`.** Es el caso real del
doctorando que dirige TFG: protege la asimetría cuando alguien es a la vez estudiante y supervisor
del mismo trabajo.

Índices necesarios para que RLS no degrade: `(user_id, status)`, `(work_id)`,
`(work_id, work_role_id) WHERE is_primary`.

## 6. Resto de entidades (resumen)

- `work_phases` (fases del trabajo) y `milestones` (hitos con `due_date`, `is_met`, `met_at`).
- `tasks`: `work_id`, `parent_task_id` (subtareas), `assignee_id`, `title`, `description`,
  `status` (`PENDIENTE`/`EN_CURSO`/`BLOQUEADA`/`EN_REVISION`/`COMPLETADA`), `priority`
  (`BAJA`/`MEDIA`/`ALTA`/`URGENTE`), `start_date`, `due_date`, `completed_at`, `order_index`,
  `milestone_id`, `board_column_id` (▸ `board_columns`, §6.ter), `color`, `deleted_at` y
  `created_by`. **`color`** (`0026`) es la etiqueta de color de Trello: uno de los tonos del
  catálogo o `null`, **sin significado y sin `check`** —el catálogo de tonos vive en
  `src/lib/utils.ts`, un `check` obligaría a una migración para añadir un color, y un tono que ya
  no exista pinta gris en lugar de romper la tarjeta—. Lo pone quien planifica.
  **`deleted_at` es la papelera** (`0025`): borrar una tarea es archivarla, `tasks_select` deja ver
  lo archivado a quien puede planificar —si no, archivar fallaría y lo archivado sería
  irrecuperable— y un *trigger* `security definer` se lleva las subtareas y las devuelve al
  restaurar. `task_dependencies` (`task_id`, `depends_on_task_id`, `CHECK` de no
  autodependencia; los ciclos se validan en la aplicación).
- `meetings` + `meeting_participants` + `meeting_agreements` (acuerdos, con posible `task_id`
  derivada) + `meeting_private_notes` (**tabla aparte, nunca columna**, para que RLS la proteja por
  sí misma).
- `documents` + `document_versions` (`version_label`, `external_url`, `storage_path` NULL,
  `review_status`, `submitted_at`) + `document_comments`. Se prioriza `external_url` a Drive/OneDrive;
  `storage_path` queda para adjuntos pequeños.
- **Una tarea se muda de trabajo** (`0031`): `app.mover_tarea_de_trabajo(tarea, destino)`, con
  envoltura en `public` porque PostgREST no ve el esquema `app`. Exige `can_manage_plan` en el
  origen **y** en el destino —el `using` de `tasks_update` admite la fila por ser el responsable,
  así que la comprobación no puede quedarse en la política—. Mueve en una transacción la tarea,
  los puntos de su lista y su hilo de comentarios; pone a nulo `board_column_id`, `milestone_id`,
  el responsable que no participe en el destino, `documents.task_id` y `meeting_agreements.task_id`,
  y borra las dependencias que cruzarían trabajos. Rechaza mudar un punto suelto, y mudar al mismo
  trabajo no hace nada.
- **Un comentario vive en el trabajo de aquello que comenta** (`0031`, sustituye a la regla de la
  `0029`): `app.enforce_comment_immutable_columns` ya no congela `work_id`; exige que, si cambia,
  coincida con el trabajo de la entidad (`app.trabajo_de_la_entidad`). Cierra el mismo agujero —el
  autor no puede plantar su comentario en un trabajo donde no está la entidad— y deja que el hilo
  siga a su tarea.
- **El alumno participa en su trabajo** (`0030`): `app.is_work_student(work)` —pertenencia activa
  con función de estudiante, en **ese** trabajo— entra en `milestones_write`, en la nueva
  `app.can_manage_meetings(work)` (a la que miran ahora las tres políticas de reuniones, que en la
  `0011` estaban escritas por separado y ya se habían desincronizado una vez) y en `works_update`,
  con `app.enforce_work_update_scope()` limitando por **lista blanca** qué columnas de
  `academic_works` puede escribir: descripción, objetivos, hipótesis, metodología y palabras clave.
  Lista blanca y no negra a propósito: una columna nueva nace protegida. En `tasks`,
  `app.is_checklist_point_of_mine(parent, work)` deja al responsable de una tarea **añadir** puntos
  a su lista, y el disparador de alcance le deja escribirla entera **menos archivar**, porque lo
  archivado solo lo ve quien planifica y la fila dejaría de ser visible para quien la archiva.
- **El alumno apunta sus propias tareas** (`0033`): `tasks_insert` admite una tercera rama,
  `app.is_work_student(work_id) and parent_task_id is null and assignee_id = app.uid() and
  deleted_at is null`. Las cuatro condiciones van juntas porque en un `INSERT` **no hay disparador
  de alcance**: el de las tareas es `before update` y necesita una fila anterior, así que el
  `with check` es lo único que acota el alta. Lo que no cambia: `tasks_delete` sigue pidiendo
  `can_manage_plan`, archivar lo rechaza el disparador, y el responsable de una tarea ya creada
  tampoco se toca. Comprobación 24 de `verify.sql`; pruebas `[196]`–`[199]`.
- **Crear un trabajo es un permiso propio** (`0034`): `organization_members.can_create_works`
  —apagado de serie, lo enciende quien administra— y `app.crear_trabajo(...)`, que inserta el
  trabajo **y su dirección** en una sola operación. Las dos filas van juntas porque `works_select`
  solo enseña los trabajos de los que eres miembro y `wm_write` solo deja añadir participantes a
  quien ya administra ese trabajo: un trabajo sin dirección es invisible para quien lo acaba de
  crear. Quien crea, dirige; solo la administración puede crear a nombre de otra persona. La
  función es `security definer`, así que la puerta es `app.puede_crear_trabajos(org)`, lo primero
  que comprueba. `works_insert` y `works_delete` **no se abren**: el alta directa y el borrado
  siguen siendo de quien administra. Comprobación 25 de `verify.sql`; pruebas `[200]`–`[204]`.
- `comments` polimórfico controlado: `work_id` obligatorio + `entity_type` (`WORK`/`TASK`/`DOCUMENT`/
  `MEETING`) + `entity_id`, `parent_comment_id`, `mentions uuid[]`. `work_id` siempre presente es lo
  que permite una política RLS única y eficiente para todos los comentarios.
  **Un comentario lo edita su autor, y solo el texto** (`0029`): `comments_update` ya exigía
  `author_id = app.uid()` desde la `0003` —ni la dirección ni la administración reescriben lo que
  dijo otro—, pero una política decide *qué filas*, no *qué columnas*. Un disparador congela
  `work_id`, `entity_type`, `entity_id`, `author_id` y `created_at`, porque sin él el autor podía
  mudar su comentario al hilo de un trabajo del que no es miembro; y otro pone `updated_at`, que
  es la marca de «editado» y no puede depender de que el cliente se acuerde de mandarla. Las
  menciones no se repiten al editar: `comments_notify_mentions` es `after insert`.
  El contenido es **texto con marcas** (`**negrita**`, `- punto`), nunca HTML: ver
  `src/domain/comments/markup.ts`.
- `notifications`: `user_id`, `work_id`, `type`, `title`, `body`, `link`, `read_at`, y desde la
  `0032` **`dedupe_key`** (indice unico parcial) y **`pushed_at`**. `dedupe_key` es lo que permite
  ejecutar los recordatorios de fecha cada hora sin repetirlos, y lleva la fecha dentro: si una
  tarea se mueve de dia, el recordatorio vuelve a tener sentido y se manda otro. `pushed_at` lo
  escribe el reparto, no la pantalla: distingue «esta en la campana» de «ha sonado en el movil».
  Sigue **sin politica de INSERT**: los avisos los crean disparadores (`0011`, `0032`) y la funcion
  de fechas, nunca el cliente.
- **Los avisos salen al dispositivo** (`0032`): `push_subscriptions` (una fila **por dispositivo**,
  con el `endpoint` como clave natural y las claves publicas `p256dh`/`auth_key`) y
  `notification_prefs` (`on_dates`, `on_comments`, `days_before` por persona; **la ausencia de fila
  significa «todo encendido»**, porque «no he dicho nada» no es «no quiero»). Los dos avisos nuevos
  son `app.notify_comment_reply()` —alguien comenta en tu tarjeta o en un hilo donde ya escribiste,
  que hasta ahora solo avisaba con mencion explicita— y `app.encolar_avisos_de_fechas()`, que no
  puede ser un disparador porque **el dia que una fecha se acerca no ocurre nada en la base de
  datos**. El reparto lo hace un workflow con un token acotado, nunca `service_role`: ver
  SECURITY.md §5.2.tertricies.
- `activity_logs`: `work_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `diff jsonb`.
  Alimentado por *triggers* en las tablas relevantes.
- `templates` (**`work_type_id`** ▸ `work_types`) + `template_tasks` (`offset_days`,
  `duration_days`, `order_index`, `parent_index`): plantillas de planificación por tipo de trabajo.
- `system_settings`: clave/valor `jsonb` por organización.
- `keepalive`: ver §7.

## 6.bis. `invitations` — alta controlada de usuarios

| Columna | Notas |
|---|---|
| `email` | En minúsculas, con `CHECK (email = lower(email))` para que el índice único no se burle con mayúsculas |
| `intended_role` | Función **administrativa** al aceptar (`MEMBER`/`ADMIN`/`OWNER`). Las académicas se asignan después, trabajo a trabajo |
| `status` | `PENDING` → `SENT` → `ACCEPTED`, o `CANCELLED` |
| `accepted_user_id` | Perfil resultante cuando la persona entra por primera vez |

Índice único parcial `(organization_id, email) WHERE status <> 'CANCELLED'`: una sola invitación
viva por correo, pero se puede reintentar una cancelada.

El trigger `app.accept_invitation()` se dispara al crearse el perfil y hace dos cosas: cierra la
invitación y **da de alta a la persona en la organización** con la función prevista. Es el único
punto del sistema donde la pertenencia se concede sin intervención manual, y solo porque un
administrador la autorizó al crear la invitación. Quien entra sin invitación se queda con una
cuenta sin organización, y por tanto sin ver nada.

**Por qué la aplicación no envía los correos**: enviar una invitación de Supabase Auth requiere la
clave `service_role`, que salta todas las políticas RLS y no puede existir en un frontend público.
La tabla es una lista de trabajo; el envío se hace desde el panel de Supabase. El camino de
automatización, dentro de la arquitectura ya elegida y sin coste, es una Edge Function de Supabase
con esa clave en sus *secrets*: solo cambiaría quién pone `status = 'SENT'`.

## 6.ter. `board_columns` — el tablero de cada trabajo (`0024`)

El tablero de tareas dibujaba una columna por cada valor del `CHECK` de `tasks.status`
—Pendiente, En curso, Bloqueada, En revisión, Completada— y agrupaba las tarjetas por ese estado:
lo decidía el código, y el orden dentro de cada columna no lo decidía nadie. Lo que hace falta se
parece a Trello: un tablero por trabajo, con las listas que quiera quien lo dirige —«Papers»,
«Estudios»— y las tarjetas arrastrándose entre ellas y dentro de ellas.

| Columna | Notas |
|---|---|
| `work_id` | uuid FK **NOT NULL** ▸ `academic_works`, `on delete cascade`. Las columnas son **del trabajo**, no de la organización: un tablero es de un trabajo igual que una lista de Trello es de su tablero. De aquí sale que las administre **quien dirige el trabajo** |
| `name` | Lo único que se ve. Único por trabajo: dos columnas «Papers» en el mismo tablero no se distinguen. Entre 1 y 60 caracteres |
| `color` | Uno de los tonos de la paleta. Nullable |
| `display_order` | El orden de izquierda a derecha |

**Una columna no significa nada.** No hay `maps_to` ni ningún campo de significado: el estado de
la tarea sigue en `tasks.status`, es un dato suyo y se ve y se cambia en la propia tarjeta. Mover
una tarjeta **no** cambia el estado, y cambiar el estado **no** mueve la tarjeta. Son dos
clasificaciones a la vez, que es justo lo que hace falta: «Papers» no es un estado, y una tarjeta
de «Papers» puede estar pendiente o en curso. Por eso el progreso del trabajo, los colores del
cronograma, los bloqueos por dependencia y los informes siguen leyendo `status` y no saben que
estas columnas existen.

Políticas: `board_columns_select` para quien ve el trabajo (`app.accessible_work_ids()`) y
`board_columns_write` con `app.can_manage_plan(work_id)` —la misma frase que los hitos y las
fases de la `0003`—, así que la dirección administra su tablero sin pedírselo a la administración
del grupo.

`tasks.board_column_id` es FK **nullable** con `on delete restrict`:

- `NULL` no es un hueco a rellenar. Es lo que tienen todas las tareas mientras su trabajo no tenga
  columnas —y entonces el tablero agrupa por estado, como siempre—, y también lo que vuelven a
  tener si se borra la suya. Una tarjeta sin columna se dibuja en la primera: trabajo invisible,
  nunca.
- `restrict` y no `set null`: borrar una columna con tarjetas dentro las esparciría sin que nadie
  lo haya pedido. La aplicación solo ofrece borrar las vacías.

Dos *triggers*, los dos en `tasks`:

- `assert_task_board_column_same_work` (`security definer`): la columna tiene que ser del mismo
  trabajo que la tarea. Es lo único que la clave ajena no puede comprobar, y sin él una tarjeta
  podría acabar en el tablero de otro trabajo. Por qué `security definer`, en `SECURITY.md`
  §5.2.sexvicies.
- `sync_task_completed_at`: `completed_at` se pone y se quita según el estado, en un solo sitio.
  Antes lo escribía el cliente al cambiar el estado desde el desplegable, y cualquier otra vía
  dejaba tareas `COMPLETADA` sin fecha —que no dan error y faltan de los recuentos por fechas—.

## 7. `keepalive` — mantenimiento técnico

Tabla deliberadamente trivial, sin relación con ninguna otra y sin dato personal alguno:

| Columna | Tipo | Contenido |
|---|---|---|
| `id` | int PK (= 1) | Fila única, forzada con `CHECK (id = 1)` |
| `label` | text | `'keepalive'` |
| `last_ping_at` | timestamptz | Último *ping* registrado (opcional, vía RPC) |
| `note` | text | Texto técnico fijo |

Política RLS: `SELECT` permitido a `anon` y `authenticated`. Nada más: sin `INSERT`, `UPDATE`
ni `DELETE` para esos roles. Es la única tabla legible sin autenticación de toda la base de datos.

## 8. Estimación de volumen

Con 30 estudiantes nuevos al año, 100 trabajos activos y 15 supervisores:

| Tabla | Filas/año | Bytes/fila aprox. | Año | 5 años |
|---|--:|--:|--:|--:|
| `academic_works` | 40 | 2 KB | 80 KB | 400 KB |
| `work_members` | 120 | 0,2 KB | 24 KB | 120 KB |
| `tasks` | 1.600 | 0,6 KB | ~1 MB | 5 MB |
| `meetings` + actas | 600 | 1,5 KB | ~0,9 MB | 4,5 MB |
| `documents` + versiones | 800 | 0,5 KB | 0,4 MB | 2 MB |
| `comments` | 3.000 | 0,4 KB | 1,2 MB | 6 MB |
| `activity_logs` | 20.000 | 0,3 KB | 6 MB | 30 MB |
| **Total estimado** | | | **~10 MB** | **~48 MB** |

Frente a los 500 MB del plan Free, el margen es amplio. `activity_logs` es el único candidato a
crecer sin control: se define una política de purga a 24 meses, ejecutable manualmente.

## 9. Trazabilidad e integridad

- `updated_at` mantenido por *trigger* `set_updated_at()` en todas las tablas con ese campo.
- `activity_logs` alimentado por *trigger* en `academic_works`, `work_members`, `tasks` y
  `document_versions`.
- Borrado lógico (`deleted_at`) en `academic_works` y `documents`; el resto se borra en cascada.
- `ON DELETE RESTRICT` desde `academic_works` hacia `work_types`: **no se puede borrar un tipo de
  trabajo que esté en uso**; para retirarlo se usa `is_active = false`.
- Claves foráneas con índice explícito en todas las columnas usadas por RLS.
