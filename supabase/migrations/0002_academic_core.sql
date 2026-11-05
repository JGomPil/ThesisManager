-- =============================================================================
-- 0002_academic_core.sql
-- Trabajos académicos, relaciones usuario↔trabajo, planificación, reuniones,
-- documentos, comunicación y plantillas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- academic_works
-- Sin student_id ni supervisor_id: TODA participación vive en work_members.
-- -----------------------------------------------------------------------------
create table academic_works (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  research_group_id   uuid references research_groups(id) on delete set null,
  work_type_id        uuid not null references work_types(id) on delete restrict,
  status_id           uuid not null references work_statuses(id) on delete restrict,
  program_id          uuid references programs(id) on delete set null,
  academic_year_id    uuid references academic_years(id) on delete set null,
  research_line_id    uuid references research_lines(id) on delete set null,

  title               text not null,
  description         text,
  objectives          text,
  hypothesis          text,
  methodology         text,
  keywords            text[] not null default '{}',
  notes               text,

  start_date          date,
  expected_end_date   date,
  actual_end_date     date,
  defense_date        date,

  -- Progreso académico REAL, a juicio del supervisor. Distinto del % de tareas
  -- completadas, que se calcula y se muestra aparte. Nunca se confunden.
  progress_override   smallint check (progress_override between 0 and 100),

  is_archived         boolean not null default false,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (expected_end_date is null or start_date is null or expected_end_date >= start_date)
);
create index on academic_works (organization_id) where deleted_at is null;
create index on academic_works (work_type_id);
create index on academic_works (status_id);
create index on academic_works (academic_year_id);

create trigger academic_works_updated_at before update on academic_works
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- work_members · roles NO excluyentes, por trabajo
-- Una persona puede tener varias filas en el mismo trabajo (p. ej. codirector
-- y colaborador): los permisos se resuelven como UNIÓN de capacidades.
-- -----------------------------------------------------------------------------
create table work_members (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references academic_works(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete restrict,
  work_role_id  uuid not null references work_roles(id) on delete restrict,
  is_primary    boolean not null default false,
  permissions   jsonb   not null default '{}'::jsonb,   -- excepciones puntuales
  start_date    date,
  end_date      date,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (work_id, user_id, work_role_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
-- Un solo "principal" por función y trabajo (un supervisor principal, etc.).
create unique index work_members_one_primary
  on work_members (work_id, work_role_id) where is_primary;
-- Índices que sostienen el rendimiento de RLS.
create index on work_members (user_id, status);
create index on work_members (work_id, status);

create trigger work_members_updated_at before update on work_members
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Fases e hitos
-- -----------------------------------------------------------------------------
create table work_phases (
  id          uuid primary key default gen_random_uuid(),
  work_id     uuid not null references academic_works(id) on delete cascade,
  name        text not null,
  start_date  date,
  end_date    date,
  order_index int  not null default 0
);
create index on work_phases (work_id);

create table milestones (
  id          uuid primary key default gen_random_uuid(),
  work_id     uuid not null references academic_works(id) on delete cascade,
  phase_id    uuid references work_phases(id) on delete set null,
  name        text not null,
  description text,
  due_date    date not null,
  is_met      boolean not null default false,
  met_at      timestamptz,
  order_index int  not null default 0,
  created_at  timestamptz not null default now()
);
create index on milestones (work_id, due_date);

-- -----------------------------------------------------------------------------
-- Tareas
-- task_statuses / task_priorities van como CHECK y no como catálogo: el prompt
-- los fija, son estables, y dos JOIN más penalizarían la vista Kanban.
-- -----------------------------------------------------------------------------
create table tasks (
  id              uuid primary key default gen_random_uuid(),
  work_id         uuid not null references academic_works(id) on delete cascade,
  parent_task_id  uuid references tasks(id) on delete cascade,
  milestone_id    uuid references milestones(id) on delete set null,
  title           text not null,
  description     text,
  assignee_id     uuid references profiles(id) on delete set null,
  status          text not null default 'PENDIENTE'
                    check (status in ('PENDIENTE','EN_CURSO','BLOQUEADA','EN_REVISION','COMPLETADA')),
  priority        text not null default 'MEDIA'
                    check (priority in ('BAJA','MEDIA','ALTA','URGENTE')),
  start_date      date,
  due_date        date,
  completed_at    timestamptz,
  order_index     int  not null default 0,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index on tasks (work_id, status);
create index on tasks (assignee_id, status);
create index on tasks (due_date) where status <> 'COMPLETADA';

create trigger tasks_updated_at before update on tasks
  for each row execute function app.set_updated_at();

create table task_dependencies (
  task_id            uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)   -- los ciclos se validan en aplicación
);

-- -----------------------------------------------------------------------------
-- Reuniones
-- -----------------------------------------------------------------------------
create table meetings (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references academic_works(id) on delete cascade,
  title         text not null,
  scheduled_at  timestamptz not null,
  duration_min  int,
  modality      text not null default 'PRESENCIAL'
                  check (modality in ('PRESENCIAL','ONLINE','HIBRIDA')),
  location      text,
  topics        text,
  summary       text,          -- acta COMPARTIDA con el estudiante
  next_meeting_at timestamptz,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on meetings (work_id, scheduled_at desc);

create table meeting_participants (
  meeting_id  uuid not null references meetings(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  attended    boolean,
  primary key (meeting_id, user_id)
);

create table meeting_agreements (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  work_id     uuid not null references academic_works(id) on delete cascade, -- desnormalizado para RLS
  description text not null,
  task_id     uuid references tasks(id) on delete set null,  -- tarea derivada
  order_index int not null default 0
);
create index on meeting_agreements (work_id);

-- TABLA APARTE, no columna de `meetings`: así RLS la protege por sí misma y
-- es imposible que se filtre en un SELECT * del acta.
create table meeting_private_notes (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  work_id     uuid not null references academic_works(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on meeting_private_notes (work_id);

-- -----------------------------------------------------------------------------
-- Documentos. Se prioriza enlazar a Drive/OneDrive institucional (external_url)
-- sobre subir a Supabase Storage (storage_path), por límites del plan Free.
-- -----------------------------------------------------------------------------
create table documents (
  id               uuid primary key default gen_random_uuid(),
  work_id          uuid not null references academic_works(id) on delete cascade,
  document_type_id uuid references document_types(id) on delete set null,
  name             text not null,
  description      text,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on documents (work_id) where deleted_at is null;

create table document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  work_id       uuid not null references academic_works(id) on delete cascade,
  version_label text not null,
  external_url  text,
  storage_path  text,
  author_id     uuid references profiles(id) on delete set null,
  review_status text not null default 'ENTREGADO'
                  check (review_status in ('BORRADOR','ENTREGADO','EN_REVISION','REVISADO','APROBADO','RECHAZADO')),
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewer_id   uuid references profiles(id) on delete set null,
  notes         text,
  check (external_url is not null or storage_path is not null)
);
create index on document_versions (document_id, submitted_at desc);
create index on document_versions (work_id);

create table document_comments (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references document_versions(id) on delete cascade,
  work_id     uuid not null references academic_works(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index on document_comments (work_id);

-- -----------------------------------------------------------------------------
-- Comunicación. `work_id` siempre presente: permite UNA política RLS eficiente
-- para todos los comentarios, sea cual sea la entidad comentada.
-- -----------------------------------------------------------------------------
create table comments (
  id                uuid primary key default gen_random_uuid(),
  work_id           uuid not null references academic_works(id) on delete cascade,
  entity_type       text not null check (entity_type in ('WORK','TASK','DOCUMENT','MEETING')),
  entity_id         uuid,
  parent_comment_id uuid references comments(id) on delete cascade,
  author_id         uuid not null references profiles(id) on delete cascade,
  content           text not null,
  mentions          uuid[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index on comments (work_id, created_at desc);
create index on comments (entity_type, entity_id);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  work_id     uuid references academic_works(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);

create table activity_logs (
  id          uuid primary key default gen_random_uuid(),
  work_id     uuid references academic_works(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  diff        jsonb,
  created_at  timestamptz not null default now()
);
create index on activity_logs (work_id, created_at desc);
create index on activity_logs (created_at);   -- purga a 24 meses

-- -----------------------------------------------------------------------------
-- Plantillas de planificación POR TIPO DE TRABAJO
-- -----------------------------------------------------------------------------
create table templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_type_id    uuid references work_types(id) on delete cascade,
  name            text not null,
  description     text,
  is_active       boolean not null default true,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index on templates (work_type_id);

create table template_tasks (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references templates(id) on delete cascade,
  title         text not null,
  description   text,
  offset_days   int  not null default 0,     -- desde el inicio del trabajo
  duration_days int  not null default 7,
  priority      text not null default 'MEDIA'
                  check (priority in ('BAJA','MEDIA','ALTA','URGENTE')),
  order_index   int  not null default 0,
  parent_index  int                           -- jerarquía dentro de la plantilla
);
create index on template_tasks (template_id, order_index);

-- FK diferida de 0001: ya existe `templates`.
alter table work_types
  add constraint work_types_default_template_fk
  foreign key (default_template_id) references templates(id) on delete set null;
