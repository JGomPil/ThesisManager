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

## 2. Separación deliberada de los dos sistemas de permisos

| Tabla | Qué concede | Ámbito |
|---|---|---|
| `organization_members` | Permisos **administrativos**: gestionar usuarios, catálogos, ver todo | Organización completa |
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
| `default_template_id` | uuid FK NULL ▸ `templates` | Plantilla de tareas por defecto |
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
- `task_statuses` y `task_priorities`: dado que el prompt los fija y son estables, se implementan
  como columnas `text` con `CHECK`, no como tablas. Son el único punto donde renuncio al catálogo,
  porque no hay indicio de que vayan a crecer y las tablas añadirían dos `JOIN` a la vista Kanban.

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
  `milestone_id`, `created_by`. `task_dependencies` (`task_id`, `depends_on_task_id`, `CHECK` de no
  autodependencia; los ciclos se validan en la aplicación).
- `meetings` + `meeting_participants` + `meeting_agreements` (acuerdos, con posible `task_id`
  derivada) + `meeting_private_notes` (**tabla aparte, nunca columna**, para que RLS la proteja por
  sí misma).
- `documents` + `document_versions` (`version_label`, `external_url`, `storage_path` NULL,
  `review_status`, `submitted_at`) + `document_comments`. Se prioriza `external_url` a Drive/OneDrive;
  `storage_path` queda para adjuntos pequeños.
- `comments` polimórfico controlado: `work_id` obligatorio + `entity_type` (`WORK`/`TASK`/`DOCUMENT`/
  `MEETING`) + `entity_id`, `parent_comment_id`, `mentions uuid[]`. `work_id` siempre presente es lo
  que permite una política RLS única y eficiente para todos los comentarios.
- `notifications`: `user_id`, `work_id`, `type`, `title`, `body`, `link`, `read_at`.
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
