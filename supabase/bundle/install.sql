-- =============================================================================
-- INSTALACIÓN COMPLETA DE THESIS MANAGER
--
-- Fichero generado: no se edita a mano. Se regenera con
--   ./scripts/build-install-sql.sh
--
-- Contiene, en orden: las migraciones y los catálogos iniciales.
-- NO contiene los datos de demostración (están en seed/0002_demo_data.sql).
--
-- CÓMO USARLO
--   1. Panel de Supabase → SQL Editor → New query
--   2. Pegar TODO este fichero
--   3. Run
-- =============================================================================



-- #############################################################################
-- ### supabase/migrations/0001_foundation_and_catalogs.sql
-- #############################################################################

-- =============================================================================
-- 0001_foundation_and_catalogs.sql
-- Thesis Manager · Fase 0 (PROPUESTA — no aplicar hasta aprobación)
--
-- Organización, perfiles y CATÁLOGOS CONFIGURABLES.
-- Los tipos de trabajo (TFG / TFM / Tesis / Academia de Alumnos Internos / futuros)
-- son FILAS de `work_types`, no valores de un ENUM: pueden crearse desde la
-- interfaz de administración sin migración ni despliegue.
-- =============================================================================

create extension if not exists "pgcrypto";

-- Esquema para las funciones auxiliares de autorización.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Utilidad: updated_at
-- -----------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organización y grupos
-- -----------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table research_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  acronym         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- Perfil: identidad ÚNICA por persona. 1:1 con auth.users.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  avatar_url  text,
  department  text,
  position    text,
  orcid       text,
  bio         text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Permisos ADMINISTRATIVOS. Independientes de las relaciones académicas.
create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            text not null check (role in ('OWNER','ADMIN','MEMBER')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on organization_members (user_id, is_active);

create table research_group_members (
  id                uuid primary key default gen_random_uuid(),
  research_group_id uuid not null references research_groups(id) on delete cascade,
  user_id           uuid not null references profiles(id) on delete cascade,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (research_group_id, user_id)
);

-- -----------------------------------------------------------------------------
-- CATÁLOGOS
-- -----------------------------------------------------------------------------

create table academic_levels (
  code          text primary key,          -- GRADO | MASTER | DOCTORADO | OTRO
  name          text not null,
  display_order int  not null default 0
);

create table academic_years (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,           -- '2025/2026'
  start_date      date not null,
  end_date        date not null,
  is_current      boolean not null default false,
  unique (organization_id, code),
  check (end_date > start_date)
);
-- Un único curso marcado como actual por organización.
create unique index academic_years_one_current
  on academic_years (organization_id) where is_current;

-- Titulaciones y programas de doctorado. NULLABLE en academic_works:
-- hay tipos de trabajo (p. ej. ACADEMIA) que no cuelgan de una titulación.
create table programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  academic_level  text references academic_levels(code),
  is_active       boolean not null default true,
  unique (organization_id, code)
);

create table research_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  research_group_id uuid references research_groups(id) on delete set null,
  name              text not null,
  description       text,
  is_active         boolean not null default true,
  unique (organization_id, name)
);

-- =============================================================================
-- work_types · EL CATÁLOGO CLAVE
-- Añadir un tipo nuevo = INSERT desde la UI de administración.
-- =============================================================================
create table work_types (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid references organizations(id) on delete cascade, -- NULL = global
  code                     text not null,
  name                     text not null,
  short_name               text not null,
  academic_level           text references academic_levels(code),
  color                    text not null default 'slate',
  icon                     text,
  display_order            int  not null default 0,
  is_active                boolean not null default true,

  -- Reglas declarativas por tipo. Evitan `if (tipo === 'TFG')` en el código.
  default_duration_months  int,
  requires_defense         boolean not null default true,
  requires_deposit         boolean not null default true,
  requires_program         boolean not null default true,
  allows_multiple_students boolean not null default false,
  max_supervisors          int,
  counts_toward_workload   boolean not null default true,
  default_template_id      uuid,          -- FK añadida en 0002 (templates aún no existe)

  notes                    text,
  created_by               uuid references profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (default_duration_months is null or default_duration_months between 1 and 120),
  check (max_supervisors is null or max_supervisors >= 1)
);
-- `code` único por organización, y único entre los globales.
create unique index work_types_code_org  on work_types (organization_id, upper(code))
  where organization_id is not null;
create unique index work_types_code_glob on work_types (upper(code))
  where organization_id is null;

create trigger work_types_updated_at before update on work_types
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Estados del trabajo + ciclo de vida OPCIONAL por tipo
-- -----------------------------------------------------------------------------
create table work_statuses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  color         text not null default 'slate',
  display_order int  not null default 0,
  is_terminal   boolean not null default false,
  is_active     boolean not null default true
);

-- Si un work_type NO tiene filas aquí, le aplican TODOS los estados activos.
-- Si las tiene, solo esos. Permite que ACADEMIA no pase por depósito ni defensa.
create table work_type_statuses (
  work_type_id  uuid not null references work_types(id) on delete cascade,
  status_id     uuid not null references work_statuses(id) on delete cascade,
  display_order int  not null default 0,
  primary key (work_type_id, status_id)
);

-- -----------------------------------------------------------------------------
-- Funciones académicas. Las políticas RLS leen los FLAGS, nunca el `code`:
-- así se puede añadir un rol nuevo sin reescribir seguridad.
-- -----------------------------------------------------------------------------
create table work_roles (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  name                     text not null,
  is_student               boolean not null default false,
  is_supervisory           boolean not null default false,
  can_manage_plan          boolean not null default false,
  can_see_private_notes    boolean not null default false,
  can_validate_deliverables boolean not null default false,
  can_manage_members       boolean not null default false,
  display_order            int  not null default 0,
  is_active                boolean not null default true,
  check (not (is_student and is_supervisory))
);

create table document_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  display_order   int  not null default 0,
  is_active       boolean not null default true
);
create unique index document_types_code on document_types (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(code));

-- -----------------------------------------------------------------------------
-- Ajustes
-- -----------------------------------------------------------------------------
create table system_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key             text not null,
  value           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

-- -----------------------------------------------------------------------------
-- Alta de perfil al crear el usuario en auth.
-- NO crea organization_members: la pertenencia es un acto administrativo
-- explícito. Sin esa fila, el usuario entra y no ve nada.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();


-- #############################################################################
-- ### supabase/migrations/0002_academic_core.sql
-- #############################################################################

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


-- #############################################################################
-- ### supabase/migrations/0003_rls_policies.sql
-- #############################################################################

-- =============================================================================
-- 0003_rls_policies.sql
-- Funciones auxiliares de autorización + Row Level Security.
--
-- El repositorio es PÚBLICO y la clave `anon` es pública por diseño: estas
-- políticas son la ÚNICA frontera de seguridad del sistema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares.
-- SECURITY DEFINER por dos razones, no por comodidad:
--   1) Rompen la recursión infinita de una política sobre work_members que
--      necesita consultar work_members.
--   2) STABLE ⇒ el planificador las evalúa una vez por consulta, no por fila.
-- search_path fijado para que no puedan ser secuestradas.
-- -----------------------------------------------------------------------------

create or replace function app.uid()
returns uuid language sql stable
set search_path = public, pg_temp
as $$ select auth.uid() $$;

create or replace function app.is_org_admin(org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = org
      and m.is_active
      and m.role in ('OWNER','ADMIN')
  );
$$;

-- ¿Es administrador de la organización a la que pertenece ESTE trabajo?
create or replace function app.is_admin_of_work(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from academic_works w
    join organization_members m on m.organization_id = w.organization_id
    where w.id = work
      and m.user_id = auth.uid()
      and m.is_active
      and m.role in ('OWNER','ADMIN')
  );
$$;

create or replace function app.is_work_member(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from work_members wm
    where wm.work_id = work
      and wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
  ) or app.is_admin_of_work(work);
$$;

create or replace function app.is_work_supervisor(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from work_members wm
    join work_roles r on r.id = wm.work_role_id
    where wm.work_id = work
      and wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
      and r.is_supervisory
  );
$$;

-- Unión de capacidades de todas las filas activas (§4 de SECURITY.md),
-- con work_members.permissions como última palabra.
create or replace function app.has_work_capability(work uuid, cap text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    bool_or(
      coalesce(
        (wm.permissions ->> cap)::boolean,          -- excepción explícita
        case cap
          when 'can_manage_plan'           then r.can_manage_plan
          when 'can_see_private_notes'     then r.can_see_private_notes
          when 'can_validate_deliverables' then r.can_validate_deliverables
          when 'can_manage_members'        then r.can_manage_members
          else false
        end
      )
    ), false)
  from work_members wm
  join work_roles r on r.id = wm.work_role_id
  where wm.work_id = work
    and wm.user_id = auth.uid()
    and wm.status = 'ACTIVE'
    and (wm.end_date is null or wm.end_date >= current_date);
$$;

create or replace function app.can_manage_plan(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.has_work_capability(work, 'can_manage_plan') or app.is_admin_of_work(work);
$$;

-- Regla de protección del estudiante: si alguna función activa del usuario en
-- este trabajo es de estudiante, NUNCA ve las notas privadas, aunque otra de
-- sus funciones lo permitiera. Caso real: el doctorando que dirige TFG.
create or replace function app.can_see_private_notes(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from work_members wm
      join work_roles r on r.id = wm.work_role_id
      where wm.work_id = work and wm.user_id = auth.uid()
        and wm.status = 'ACTIVE' and r.is_student
    ) then false
    else app.has_work_capability(work, 'can_see_private_notes') or app.is_admin_of_work(work)
  end;
$$;

-- Conjunto de trabajos accesibles: propios + todos los de la organización
-- donde el usuario sea administrador.
create or replace function app.accessible_work_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select wm.work_id
  from work_members wm
  where wm.user_id = auth.uid()
    and wm.status = 'ACTIVE'
    and (wm.end_date is null or wm.end_date >= current_date)
  union
  select w.id
  from academic_works w
  join organization_members m
    on m.organization_id = w.organization_id
   and m.user_id = auth.uid()
   and m.is_active
   and m.role in ('OWNER','ADMIN');
$$;

create or replace function app.shares_organization(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_members a
    join organization_members b on b.organization_id = a.organization_id
    where a.user_id = auth.uid() and a.is_active
      and b.user_id = target and b.is_active
  );
$$;

create or replace function app.my_org_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select organization_id from organization_members
  where user_id = auth.uid() and is_active;
$$;

revoke all on function app.has_work_capability(uuid, text) from public;

-- =============================================================================
-- RLS: activado en TODAS las tablas. Una tabla sin RLS en Supabase es pública.
-- =============================================================================
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Perfiles y organización
-- -----------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated
  using (id = app.uid() or app.shares_organization(id));
create policy profiles_update_self on profiles for update to authenticated
  using (id = app.uid()) with check (id = app.uid());

create policy orgs_select on organizations for select to authenticated
  using (id in (select app.my_org_ids()));

create policy org_members_select on organization_members for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy org_members_write on organization_members for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy groups_select on research_groups for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy groups_write on research_groups for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy group_members_select on research_group_members for select to authenticated
  using (exists (select 1 from research_groups g
                 where g.id = research_group_id
                   and g.organization_id in (select app.my_org_ids())));

-- -----------------------------------------------------------------------------
-- CATÁLOGOS: lectura para cualquier autenticado de la organización
-- (y de los catálogos globales); escritura SOLO administradores.
-- Así un admin crea "Academia de Alumnos Internos" desde la interfaz.
-- -----------------------------------------------------------------------------
create policy levels_select on academic_levels for select to authenticated using (true);

create policy work_types_select on work_types for select to authenticated
  using (organization_id is null or organization_id in (select app.my_org_ids()));
create policy work_types_write on work_types for all to authenticated
  using (organization_id is not null and app.is_org_admin(organization_id))
  with check (organization_id is not null and app.is_org_admin(organization_id));

create policy work_statuses_select on work_statuses for select to authenticated using (true);
create policy work_type_statuses_select on work_type_statuses for select to authenticated using (true);
create policy work_roles_select on work_roles for select to authenticated using (true);

create policy years_select on academic_years for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy years_write on academic_years for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy programs_select on programs for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy programs_write on programs for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy lines_select on research_lines for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy lines_write on research_lines for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy doctypes_select on document_types for select to authenticated
  using (organization_id is null or organization_id in (select app.my_org_ids()));

create policy settings_select on system_settings for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy settings_write on system_settings for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- Trabajos y participación
-- -----------------------------------------------------------------------------
-- El término `app.is_org_admin(organization_id)` no es redundante con
-- accessible_work_ids(): esa función es STABLE y ve el snapshot del inicio de
-- la sentencia, por lo que en un INSERT ... RETURNING (lo que hace por defecto
-- supabase-js con .insert().select()) la fila nueva todavía no aparece en ella
-- y la política de SELECT fallaría. Al comprobar `organization_id` de la propia
-- fila, la condición no depende del snapshot. De paso evita el auto-JOIN para
-- los administradores.
create policy works_select on academic_works for select to authenticated
  using (
    deleted_at is null
    and (app.is_org_admin(organization_id) or id in (select app.accessible_work_ids()))
  );
create policy works_insert on academic_works for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy works_update on academic_works for update to authenticated
  using (app.is_org_admin(organization_id) or app.is_work_supervisor(id))
  with check (app.is_org_admin(organization_id) or app.is_work_supervisor(id));
create policy works_delete on academic_works for delete to authenticated
  using (app.is_org_admin(organization_id));

create policy wm_select on work_members for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy wm_write on work_members for all to authenticated
  using (app.is_admin_of_work(work_id) or app.has_work_capability(work_id, 'can_manage_members'))
  with check (app.is_admin_of_work(work_id) or app.has_work_capability(work_id, 'can_manage_members'));

-- -----------------------------------------------------------------------------
-- Planificación
-- -----------------------------------------------------------------------------
create policy phases_select on work_phases for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy phases_write on work_phases for all to authenticated
  using (app.can_manage_plan(work_id)) with check (app.can_manage_plan(work_id));

create policy milestones_select on milestones for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy milestones_write on milestones for all to authenticated
  using (app.can_manage_plan(work_id)) with check (app.can_manage_plan(work_id));

create policy tasks_select on tasks for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy tasks_insert on tasks for insert to authenticated
  with check (app.can_manage_plan(work_id));
create policy tasks_delete on tasks for delete to authenticated
  using (app.can_manage_plan(work_id));
-- El estudiante puede actualizar SU tarea; el trigger de abajo limita a qué
-- columnas. RLS decide SI se puede tocar la fila, no QUÉ columnas.
create policy tasks_update on tasks for update to authenticated
  using (app.can_manage_plan(work_id) or assignee_id = app.uid())
  with check (app.can_manage_plan(work_id) or assignee_id = app.uid());

create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  -- Sin can_manage_plan solo se permite mover el estado (y su marca temporal).
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id, new.order_index)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id, old.order_index)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea';
  end if;
  return new;
end;
$$;

create trigger tasks_update_scope before update on tasks
  for each row execute function app.enforce_task_update_scope();

create policy taskdeps_select on task_dependencies for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id
                 and t.work_id in (select app.accessible_work_ids())));
create policy taskdeps_write on task_dependencies for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id)))
  with check (exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id)));

-- -----------------------------------------------------------------------------
-- Reuniones. El acta compartida la ve el estudiante; las notas privadas, no.
-- -----------------------------------------------------------------------------
create policy meetings_select on meetings for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy meetings_write on meetings for all to authenticated
  using (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id))
  with check (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id));

create policy mparts_select on meeting_participants for select to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and m.work_id in (select app.accessible_work_ids())));
create policy mparts_write on meeting_participants for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id and app.is_work_supervisor(m.work_id)))
  with check (exists (select 1 from meetings m where m.id = meeting_id and app.is_work_supervisor(m.work_id)));

create policy agreements_select on meeting_agreements for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy agreements_write on meeting_agreements for all to authenticated
  using (app.is_work_supervisor(work_id)) with check (app.is_work_supervisor(work_id));

-- LA política crítica del sistema.
create policy private_notes_select on meeting_private_notes for select to authenticated
  using (app.can_see_private_notes(work_id));
create policy private_notes_write on meeting_private_notes for all to authenticated
  using (app.can_see_private_notes(work_id) and author_id = app.uid())
  with check (app.can_see_private_notes(work_id) and author_id = app.uid());

-- -----------------------------------------------------------------------------
-- Documentos
-- -----------------------------------------------------------------------------
create policy docs_select on documents for select to authenticated
  using (deleted_at is null and work_id in (select app.accessible_work_ids()));
create policy docs_write on documents for all to authenticated
  using (app.is_work_member(work_id)) with check (app.is_work_member(work_id));

create policy versions_select on document_versions for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy versions_insert on document_versions for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
-- Cambiar el estado de revisión es acto de supervisión.
create policy versions_update on document_versions for update to authenticated
  using (app.has_work_capability(work_id, 'can_validate_deliverables') or app.is_admin_of_work(work_id))
  with check (app.has_work_capability(work_id, 'can_validate_deliverables') or app.is_admin_of_work(work_id));

create policy doccomments_select on document_comments for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy doccomments_insert on document_comments for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
create policy doccomments_modify on document_comments for update to authenticated
  using (author_id = app.uid()) with check (author_id = app.uid());
create policy doccomments_delete on document_comments for delete to authenticated
  using (author_id = app.uid());

-- -----------------------------------------------------------------------------
-- Comunicación
-- -----------------------------------------------------------------------------
create policy comments_select on comments for select to authenticated
  using (deleted_at is null and work_id in (select app.accessible_work_ids()));
create policy comments_insert on comments for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
create policy comments_update on comments for update to authenticated
  using (author_id = app.uid()) with check (author_id = app.uid());
create policy comments_delete on comments for delete to authenticated
  using (author_id = app.uid());

create policy notifs_select on notifications for select to authenticated
  using (user_id = app.uid());
create policy notifs_update on notifications for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

create policy logs_select on activity_logs for select to authenticated
  using (work_id in (select app.accessible_work_ids()));

-- -----------------------------------------------------------------------------
-- Plantillas
-- -----------------------------------------------------------------------------
create policy templates_select on templates for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy templates_write on templates for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy ttasks_select on template_tasks for select to authenticated
  using (exists (select 1 from templates t where t.id = template_id
                 and t.organization_id in (select app.my_org_ids())));
create policy ttasks_write on template_tasks for all to authenticated
  using (exists (select 1 from templates t where t.id = template_id and app.is_org_admin(t.organization_id)))
  with check (exists (select 1 from templates t where t.id = template_id and app.is_org_admin(t.organization_id)));

-- -----------------------------------------------------------------------------
-- Cierre: nada para anon salvo lo que conceda 0004 (keepalive).
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;


-- #############################################################################
-- ### supabase/migrations/0004_keepalive.sql
-- #############################################################################

-- =============================================================================
-- 0004_keepalive.sql
-- Mantenimiento técnico contra la pausa por inactividad del plan Free.
--
-- Supabase pausa los proyectos Free con muy pocas peticiones a la base de datos
-- durante 7 días. GitHub Actions hace un SELECT real a esta tabla cada 8 horas.
--
-- Es la ÚNICA tabla legible sin autenticación de toda la base de datos, y no
-- contiene ningún dato personal ni académico.
-- =============================================================================

create table keepalive (
  id           int primary key default 1 check (id = 1),  -- fila única
  label        text not null default 'keepalive',
  last_ping_at timestamptz,
  note         text not null default
    'Fila tecnica de mantenimiento. Sin datos personales. Lectura publica intencionada.',
  created_at   timestamptz not null default now()
);

insert into keepalive (id, label) values (1, 'keepalive')
  on conflict (id) do nothing;

alter table keepalive enable row level security;

-- Lectura pública deliberada: el workflow usa la clave anon.
create policy keepalive_select on keepalive
  for select to anon, authenticated
  using (true);

-- Sin INSERT, UPDATE ni DELETE para anon ni authenticated: no se definen
-- políticas para esas operaciones, por lo que quedan denegadas.

grant usage on schema public to anon;
grant select on table keepalive to anon;

-- -----------------------------------------------------------------------------
-- OPCIONAL: registrar la marca temporal del último ping para poder mostrarla
-- dentro de la aplicación ("último mantenimiento: hace 3 h").
--
-- Compromiso asumido y documentado: cualquiera con la clave anon (que es
-- pública) puede invocar esta función. Lo único que logra es actualizar una
-- marca de tiempo en una fila técnica. No expone ni modifica ningún dato
-- académico. Si prefieres no asumirlo, basta con no llamarla desde el workflow:
-- el SELECT por sí solo ya cuenta como actividad de base de datos.
-- -----------------------------------------------------------------------------
create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = public, pg_temp
as $$
  update keepalive set last_ping_at = now() where id = 1
  returning last_ping_at;
$$;

grant execute on function public.keepalive_ping() to anon, authenticated;


-- #############################################################################
-- ### supabase/migrations/0005_invitations.sql
-- #############################################################################

-- =============================================================================
-- 0005_invitations.sql · Cola de invitaciones (decisión D3)
--
-- POR QUÉ EXISTE ESTA TABLA, Y POR QUÉ NO ENVÍA CORREOS POR SÍ SOLA:
--
-- Enviar una invitación de Supabase Auth requiere la clave `service_role`, que
-- salta todas las políticas RLS. Esa clave NO puede estar en el frontend, que
-- es código público servido desde un repositorio público. Por tanto la
-- aplicación no puede enviar invitaciones por sí misma.
--
-- Esta tabla es, de momento, una LISTA DE TRABAJO para el administrador:
-- registra a quién hay que invitar, con qué función prevista y si ya se ha
-- hecho. El envío se realiza desde el panel de Supabase.
--
-- Esto es además lo que hace manejable el límite de 2–4 correos/hora del plan
-- gratuito: con 30 altas en septiembre, el administrador necesita saber por
-- dónde iba. Un formulario de envío masivo daría por enviadas 30 invitaciones
-- de las que solo habrían salido tres.
--
-- Camino de automatización futura, dentro de la arquitectura ya elegida y sin
-- coste: una Edge Function de Supabase con la `service_role` en sus secrets,
-- invocada por el administrador autenticado. Esta tabla ya está preparada para
-- ello: solo cambiaría quién pone `status = 'SENT'`.
-- =============================================================================

create table invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email            text not null,
  full_name        text,
  -- Función administrativa prevista al aceptar. Las relaciones académicas se
  -- asignan después, trabajo a trabajo.
  intended_role    text not null default 'MEMBER' check (intended_role in ('OWNER','ADMIN','MEMBER')),
  status           text not null default 'PENDING'
                     check (status in ('PENDING','SENT','ACCEPTED','CANCELLED')),
  notes            text,
  sent_at          timestamptz,
  accepted_at      timestamptz,
  -- Perfil resultante, cuando la persona acepta y entra por primera vez.
  accepted_user_id uuid references profiles(id) on delete set null,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- El correo se normaliza a minúsculas en la aplicación; el índice lo asegura.
  constraint invitations_email_lower check (email = lower(email))
);

-- Una sola invitación viva por correo y organización. Las canceladas no
-- cuentan, para poder reintentar una invitación fallida.
create unique index invitations_unique_live
  on invitations (organization_id, email)
  where status <> 'CANCELLED';

create index on invitations (organization_id, status);

create trigger invitations_updated_at before update on invitations
  for each row execute function app.set_updated_at();

alter table invitations enable row level security;

-- Solo la administración del grupo ve y gestiona las invitaciones: contienen
-- correos de personas que todavía no son usuarias.
create policy invitations_select on invitations for select to authenticated
  using (app.is_org_admin(organization_id));
create policy invitations_write on invitations for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- Cierre automático de la invitación cuando la persona entra por primera vez.
--
-- El trigger de 0001 crea el perfil al crearse el usuario en auth; este cierra
-- la invitación correspondiente y, además, LE DA DE ALTA en la organización
-- con la función prevista. Es el único punto del sistema donde la pertenencia
-- se concede sin intervención manual, y solo porque un administrador la
-- autorizó previamente al crear la invitación.
-- -----------------------------------------------------------------------------
create or replace function app.accept_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv invitations;
begin
  select * into inv
  from invitations
  where email = lower(new.email)
    and status in ('PENDING','SENT')
  order by created_at
  limit 1;

  if not found then
    return new;   -- Sin invitación: la cuenta queda sin organización y sin acceso.
  end if;

  update invitations
  set status = 'ACCEPTED', accepted_at = now(), accepted_user_id = new.id
  where id = inv.id;

  insert into organization_members (organization_id, user_id, role)
  values (inv.organization_id, new.id, inv.intended_role)
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

-- Se ejecuta después del trigger que crea el perfil: el nombre del trigger
-- determina el orden alfabético de ejecución, y 'zz_' lo deja al final.
create trigger zz_on_profile_created
  after insert on profiles
  for each row execute function app.accept_invitation();


-- #############################################################################
-- ### supabase/migrations/0006_harden_anon_grants.sql
-- #############################################################################

-- =============================================================================
-- 0006_harden_anon_grants.sql
--
-- PROBLEMA DETECTADO EN PRODUCCIÓN (5 de noviembre de 2026)
--
-- La migración 0003 termina con `revoke all on all tables in schema public
-- from anon`, pero esa sentencia solo afecta a las tablas que EXISTEN en ese
-- momento. Supabase define privilegios por defecto (ALTER DEFAULT PRIVILEGES)
-- que conceden a `anon` permisos sobre cada tabla nueva del esquema public,
-- así que `invitations` (creada en 0005) acabó con SELECT para `anon`.
--
-- No había fuga de datos: su política RLS exige ser administrador de la
-- organización y devolvía 0 filas. Pero dejaba la seguridad dependiendo de una
-- sola capa. En una tabla que contiene correos de personas que todavía no son
-- usuarias, eso no es aceptable: un error futuro en la política quedaría
-- expuesto directamente a Internet.
--
-- Esta migración hace tres cosas:
--   1. Revoca de nuevo los privilegios de `anon` sobre TODAS las tablas,
--      dejando solo la lectura de `keepalive`. Es idempotente.
--   2. Cambia los privilegios POR DEFECTO para que ninguna tabla futura los
--      herede. Esto es lo que evita que el problema se repita.
--   3. Deja una comprobación que falla si algo se ha escapado.
-- =============================================================================

-- --- 1. Revocar de nuevo, TODAS las tablas sin excepción --------------------
-- `keepalive` incluida: se creó en 0004, también después del revoke de 0003, y
-- por tanto heredó privilegios de escritura que nunca debió tener. RLS los
-- bloqueaba (0 filas afectadas), pero el privilegio de tabla sobraba.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke all on all functions in schema public from anon;

-- Y ahora se concede, de forma mínima y explícita, lo único que `anon` necesita:
--   · leer la fila técnica de mantenimiento,
--   · invocar la RPC que actualiza su marca de tiempo.
grant select on table keepalive to anon;
grant execute on function public.keepalive_ping() to anon;

-- --- 2. Que ninguna tabla futura herede privilegios de anon -----------------
-- Afecta a los objetos que cree en adelante el rol que ejecuta esta migración,
-- que es el mismo con el que se aplican todas las demás.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- --- 3. Comprobación: si queda algo, la migración falla ---------------------
do $$
declare
  leaked text;
begin
  -- Lo único admisible es SELECT sobre keepalive. Cualquier otra combinación
  -- de tabla y privilegio para `anon` hace fallar la migración.
  select string_agg(distinct table_name || ':' || privilege_type, ', ')
  into leaked
  from information_schema.role_table_grants
  where grantee = 'anon'
    and table_schema = 'public'
    and not (table_name = 'keepalive' and privilege_type = 'SELECT');

  if leaked is not null then
    raise exception 'El rol anon conserva privilegios indebidos: %', leaked;
  end if;

  raise notice 'Correcto: anon solo puede hacer SELECT sobre keepalive.';
end $$;

-- --- 4. Y que RLS siga activo en todo, incluidas las tablas nuevas ----------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare
  sin_rls text;
begin
  select string_agg(tablename, ', ')
  into sin_rls
  from pg_tables
  where schemaname = 'public' and not rowsecurity;

  if sin_rls is not null then
    raise exception 'Tablas sin RLS: %', sin_rls;
  end if;

  raise notice 'Correcto: RLS activo en todas las tablas de public.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0007_grant_app_functions.sql
-- #############################################################################

-- =============================================================================
-- 0007 · Permisos explícitos sobre las funciones auxiliares del esquema `app`
--
-- EL FALLO QUE CORRIGE
-- La migración 0003 terminaba con una línea suelta:
--     revoke all on function app.has_work_capability(uuid, text) from public;
-- que quitaba el EXECUTE al pseudo-rol `public` sin devolvérselo a
-- `authenticated`. Como esa función se invoca desde las políticas de RLS de
-- `tasks`, `milestones`, `documents` y `meetings`, cualquier consulta a esas
-- tablas abortaba con «permission denied for function has_work_capability» y
-- la pantalla se quedaba sin datos. Las demás funciones de `app` seguían
-- funcionando porque conservaban el EXECUTE por defecto de `public`, lo que
-- hacía el fallo desconcertante: los catálogos iban bien y el resumen no.
--
-- POR QUÉ NO BASTA CON BORRAR AQUEL `revoke`
-- La intención de aquella línea era buena, solo estaba a medias. Dejar estas
-- funciones ejecutables por `public` significa que también las puede ejecutar
-- `anon`. Hoy no es explotable porque PostgREST solo expone el esquema
-- `public` y estas viven en `app`, pero depender de eso es apoyarse en una
-- configuración que no controlamos. Así que se hace lo contrario: se revoca a
-- `public` y a `anon` en TODAS, y se concede a `authenticated` una por una.
--
-- Son SECURITY DEFINER: se ejecutan con los privilegios de su propietario y
-- con `search_path` fijado. Conceder EXECUTE a `authenticated` no abre nada
-- indebido, porque todas filtran internamente por `auth.uid()`.
--
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- 1. El esquema. Supabase lo concede por su cuenta a los roles de la API, pero
--    no lo documenta como garantía, así que lo dejamos explícito. Sin esto el
--    error sería «permission denied for schema app», distinto y más temprano.
grant usage on schema app to authenticated;

-- 2. Punto de partida limpio: nadie por defecto.
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

-- 3. Y ahora, explícitamente, las que invocan las políticas de RLS.
grant execute on function app.uid()                              to authenticated;
grant execute on function app.is_org_admin(uuid)                 to authenticated;
grant execute on function app.is_admin_of_work(uuid)             to authenticated;
grant execute on function app.is_work_member(uuid)               to authenticated;
grant execute on function app.is_work_supervisor(uuid)           to authenticated;
grant execute on function app.has_work_capability(uuid, text)    to authenticated;
grant execute on function app.can_manage_plan(uuid)              to authenticated;
grant execute on function app.can_see_private_notes(uuid)        to authenticated;
grant execute on function app.accessible_work_ids()              to authenticated;
grant execute on function app.shares_organization(uuid)          to authenticated;
grant execute on function app.my_org_ids()                       to authenticated;

-- Las funciones de disparador (`app.enforce_task_update_scope`,
-- `app.handle_new_user`, `app.accept_invitation`) se quedan SIN conceder a
-- propósito: PostgreSQL no comprueba EXECUTE sobre la función de un trigger
-- cuando se ejecuta el INSERT/UPDATE que lo dispara, así que no hace falta, y
-- no concederlo evita que nadie las llame a mano. Verificado en las pruebas.

-- 4. Que las funciones futuras de `app` nazcan ya sin permisos para `anon`.
alter default privileges in schema app revoke all on functions from public;
alter default privileges in schema app revoke all on functions from anon;

-- =============================================================================
-- 5. Verificación: esta migración falla sola si queda algo mal.
-- =============================================================================
do $$
declare
  faltan text;
  sobran text;
begin
  -- Toda función invocada desde una política debe ser ejecutable por authenticated.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into faltan
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.prorettype <> 'trigger'::regtype
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if faltan is not null then
    raise exception 'authenticated no puede ejecutar: %', faltan;
  end if;

  -- Y anon no debe poder ejecutar ninguna.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into sobran
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and has_function_privilege('anon', p.oid, 'execute');
  if sobran is not null then
    raise exception 'anon puede ejecutar funciones de app: %', sobran;
  end if;

  if not has_schema_privilege('authenticated', 'app', 'usage') then
    raise exception 'authenticated no tiene USAGE sobre el esquema app';
  end if;
  if has_schema_privilege('anon', 'app', 'usage') then
    raise notice 'Aviso: anon tiene USAGE sobre el esquema app; sin EXECUTE no puede hacer nada, pero conviene revisarlo.';
  end if;

  raise notice 'Permisos del esquema app correctos.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0008_soft_delete_scope.sql
-- #############################################################################

-- =============================================================================
-- 0008 · El archivado de un trabajo queda reservado a la administración
--
-- POR QUÉ
-- Archivar un trabajo se implementa como `update academic_works set deleted_at
-- = now()`, y la política `works_update` permite actualizar a los directores
-- del trabajo además de a la administración. Es decir: tal cual, un director
-- podía hacer desaparecer un trabajo de todas las listas.
--
-- La política `works_delete` (borrado físico) sí estaba reservada a la
-- administración, así que las dos vías no coincidían. Este disparador las
-- alinea: tocar `deleted_at` exige ser administrador de la organización.
--
-- Se hace con un disparador y no con una política porque una política no puede
-- distinguir QUÉ columna ha cambiado: `works_update` tendría que negar toda
-- actualización a los directores, y eso les quitaría la edición legítima del
-- trabajo. Es el mismo patrón que `app.enforce_task_update_scope()`, que
-- limita al estudiante a la columna `status` de sus tareas.
--
-- La interfaz esconde además el botón para quien no es administrador, pero eso
-- es comodidad, no seguridad: la frontera real es esta.
-- =============================================================================

create or replace function app.enforce_soft_delete_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and not app.is_org_admin(new.organization_id) then
    raise exception 'Solo la administración puede archivar o restaurar un trabajo'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_soft_delete_scope on academic_works;
create trigger enforce_soft_delete_scope
  before update on academic_works
  for each row execute function app.enforce_soft_delete_scope();

-- Coherente con la 0007: las funciones de `app` no son ejecutables por nadie
-- salvo concesión explícita, y las de disparador no la necesitan.
revoke all on function app.enforce_soft_delete_scope() from public;
revoke all on function app.enforce_soft_delete_scope() from anon;


-- -----------------------------------------------------------------------------
-- SEGUNDA PARTE: la administración debe VER lo archivado
--
-- Al escribir las pruebas apareció un problema de diseño que no era evidente.
-- La política de SELECT era:
--     using (deleted_at is null and (...))
-- y PostgreSQL exige que, tras un UPDATE, la fila resultante siga siendo
-- visible para quien lo ejecuta. Comprobado en PostgreSQL 16.15: el
-- `update academic_works set deleted_at = now()` fallaba con «new row
-- violates row-level security policy», y bastaba quitar `deleted_at is null`
-- de la política de SELECT para que pasara. Es decir: archivar era imposible
-- por construcción, y ninguna prueba lo cubría porque ninguna archivaba.
--
-- La consecuencia era aún peor que el fallo: si se hubiera conseguido
-- archivar, el trabajo habría quedado invisible para TODO EL MUNDO, también
-- para la administración, y por tanto irrecuperable desde la aplicación. Un
-- archivado del que no se puede volver no es un archivado, es un borrado.
--
-- Así que la política pasa a dejar ver lo archivado a la administración y solo
-- a ella. Los listados normales siguen limpios porque el repositorio filtra
-- `deleted_at is null` explícitamente, y la administración gana una vista de
-- archivados desde la que restaurar.
-- -----------------------------------------------------------------------------
alter policy works_select on academic_works
  using (
    app.is_org_admin(organization_id)
    or (deleted_at is null and id in (select app.accessible_work_ids()))
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'enforce_soft_delete_scope'
      and tgrelid = 'public.academic_works'::regclass
  ) then
    raise exception 'El disparador enforce_soft_delete_scope no se ha creado';
  end if;
  raise notice 'Archivado restringido a la administración.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0009_checklist_items.sql
-- #############################################################################

-- =============================================================================
-- 0009 · Quien tiene la tarea puede marcar los puntos de su lista
--
-- EL PROBLEMA
-- Las listas de comprobación se implementan como subtareas reales
-- (`tasks.parent_task_id`), de modo que heredan la seguridad de `tasks` sin
-- añadir políticas nuevas. Pero la política `tasks_update` exige
-- `assignee_id = app.uid()`, y los puntos de una lista no llevan responsable:
-- el responsable es el de la tarea que los contiene.
--
-- Resultado: el estudiante veía su lista y al marcar un punto la operación no
-- afectaba a ninguna fila. Sin error de permisos, sin mensaje: una casilla que
-- parecía funcionar y no hacía nada. Lo detectó la prueba [43] antes de que
-- llegara a la aplicación.
--
-- POR QUÉ NO SE RESUELVE COPIANDO EL RESPONSABLE AL CREAR EL PUNTO
-- Sería más simple, pero quedaría desincronizado: al reasignar la tarea a otra
-- persona, los puntos seguirían apuntando a la anterior y volvería el mismo
-- fallo silencioso. La pertenencia de un punto es la de su tarea, así que es
-- la política la que debe mirar ahí, y no un dato duplicado.
--
-- La consulta va en una función SECURITY DEFINER, como el resto de `app`, por
-- dos razones: evita que una política sobre `tasks` tenga que leer `tasks`
-- pasando otra vez por RLS, y al ser STABLE se evalúa una vez por sentencia en
-- lugar de una por fila.
-- =============================================================================

create or replace function app.is_parent_task_assignee(parent uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select parent is not null
     and exists (
       select 1 from tasks
       where id = parent and assignee_id = auth.uid()
     );
$$;

revoke all on function app.is_parent_task_assignee(uuid) from public;
revoke all on function app.is_parent_task_assignee(uuid) from anon;
grant execute on function app.is_parent_task_assignee(uuid) to authenticated;

-- El disparador `app.enforce_task_update_scope()` sigue limitando a esta
-- persona a la columna `status`: puede marcar el punto, no renombrarlo ni
-- moverlo de tarea. Esta política decide SI puede tocar la fila; el disparador,
-- QUÉ columnas.
alter policy tasks_update on tasks
  using (
    app.can_manage_plan(work_id)
    or assignee_id = app.uid()
    or app.is_parent_task_assignee(parent_task_id)
  )
  with check (
    app.can_manage_plan(work_id)
    or assignee_id = app.uid()
    or app.is_parent_task_assignee(parent_task_id)
  );

do $$
begin
  if not has_function_privilege('authenticated', 'app.is_parent_task_assignee(uuid)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.is_parent_task_assignee';
  end if;
  if has_function_privilege('anon', 'app.is_parent_task_assignee(uuid)', 'execute') then
    raise exception 'anon puede ejecutar app.is_parent_task_assignee';
  end if;
  raise notice 'Listas de comprobacion: el responsable de la tarea puede marcar sus puntos.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0010_documents_and_storage.sql
-- #############################################################################

-- =============================================================================
-- 0010 · Documentos: vínculo opcional con una tarea y almacenamiento de ficheros
--
-- QUÉ YA ESTABA
-- `documents` y `document_versions` existen desde la 0002, con versiones y
-- estados de revisión, y la tabla de versiones ya preveía los dos orígenes:
-- `storage_path` para un fichero alojado aquí y `external_url` para uno que
-- vive fuera (Drive institucional, el repositorio de la universidad), con un
-- `check` de que haya al menos uno de los dos. Esta migración no cambia ese
-- diseño: lo pone en marcha.
--
-- QUÉ AÑADE
--  1. `documents.task_id`: vínculo OPCIONAL con una tarea. Los documentos
--     cuelgan del trabajo, porque una memoria o un artículo pertenecen al
--     trabajo entero y no a una tarea suya; pero poder decir «este borrador es
--     el entregable de esta tarea» es justo lo que se necesita al trabajar.
--     `on delete set null`: borrar una tarea no se lleva por delante el
--     documento.
--  2. El cubo privado de Storage y sus políticas, que son independientes de las
--     de las tablas: `storage.objects` tiene su propia RLS. Sin esto, una fila
--     de `document_versions` protegida apuntaría a un fichero que cualquiera
--     podría descargar.
--  3. El arreglo de `docs_select`, que repetía el fallo de `academic_works`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vínculo opcional con una tarea
-- -----------------------------------------------------------------------------
alter table documents
  add column if not exists task_id uuid references tasks(id) on delete set null;

create index if not exists documents_task_id on documents (task_id) where task_id is not null;

-- Un documento vinculado a una tarea debe pertenecer al MISMO trabajo que ella.
-- Una restricción de integridad referencial no puede expresar esto (son dos
-- caminos distintos hacia `academic_works`), así que va en un disparador.
create or replace function app.enforce_document_task_same_work()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.task_id is not null
     and not exists (select 1 from tasks where id = new.task_id and work_id = new.work_id) then
    raise exception 'La tarea vinculada pertenece a otro trabajo'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_task_same_work on documents;
create trigger documents_task_same_work
  before insert or update on documents
  for each row execute function app.enforce_document_task_same_work();

revoke all on function app.enforce_document_task_same_work() from public;
revoke all on function app.enforce_document_task_same_work() from anon;

-- -----------------------------------------------------------------------------
-- 2. `docs_select` y el mismo fallo que tenía `academic_works`
--
-- La política llevaba `deleted_at is null`, y PostgreSQL exige que la fila
-- resultante de un UPDATE siga siendo visible para quien lo ejecuta: archivar
-- un documento habría fallado igual que fallaba archivar un trabajo (§5.2.quater
-- de SECURITY.md), y si hubiera funcionado habría sido irreversible. Quien
-- valida entregables, y la administración, ven también lo archivado.
-- -----------------------------------------------------------------------------
alter policy docs_select on documents
  using (
    work_id in (select app.accessible_work_ids())
    and (
      deleted_at is null
      -- `created_by` no es un añadido cosmético: sin él, el autor no puede
      -- retirar su propio documento. Al poner `deleted_at`, la fila dejaría de
      -- serle visible y PostgreSQL rechaza el UPDATE. Lo detectó la prueba [57].
      or created_by = app.uid()
      or app.has_work_capability(work_id, 'can_validate_deliverables')
      or app.is_admin_of_work(work_id)
    )
  );

-- REGLA GENERAL, aprendida a base de tropezar tres veces con ella:
-- toda política de SELECT que filtre por `deleted_at` debe dejar ver lo
-- archivado a TODOS los que puedan archivarlo. Si no, el borrado lógico falla
-- con «new row violates row-level security policy», porque PostgreSQL exige
-- que la fila resultante de un UPDATE siga siendo visible para quien lo hace.
-- Y si por algún camino llegara a archivarse, sería irrecuperable.

-- -----------------------------------------------------------------------------
-- 2.bis. `docs_write` era demasiado ancha
--
-- La política original era una sola, `for all`, con `app.is_work_member(work_id)`
-- tanto en `using` como en `with check`. Eso significa que CUALQUIER
-- participante del trabajo podía modificar y BORRAR cualquier documento: un
-- estudiante podía hacer desaparecer la memoria que había subido su director.
-- No es un escenario rebuscado: es un clic en un icono de papelera.
--
-- Se parte en tres, con el reparto que corresponde:
--   · INSERT  cualquier participante (el estudiante debe poder entregar),
--   · UPDATE  su propio autor, quien valida entregables, o la administración,
--   · DELETE  solo quien valida entregables o la administración.
--
-- Que el autor pueda modificar el suyo es a propósito: debe poder retirar o
-- corregir lo que acaba de subir. Lo que no puede es tocar lo de los demás.
-- -----------------------------------------------------------------------------
drop policy if exists docs_write on documents;

create policy docs_insert on documents for insert to authenticated
  with check (app.is_work_member(work_id) or app.is_admin_of_work(work_id));

create policy docs_update on documents for update to authenticated
  using (
    created_by = app.uid()
    or app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  )
  with check (
    created_by = app.uid()
    or app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  );

create policy docs_delete on documents for delete to authenticated
  using (
    app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  );

-- -----------------------------------------------------------------------------
-- 3. Storage
--
-- Convención de ruta: <work_id>/<document_id>/<nombre de fichero>
-- El primer segmento es la llave de autorización: de él se deduce a qué
-- trabajo pertenece el objeto, y con eso basta para reutilizar
-- `app.accessible_work_ids()` sin duplicar ninguna regla.
--
-- El cubo es PRIVADO. Las descargas se hacen con URL firmadas de duración
-- corta, generadas por la aplicación con la clave pública: Storage solo las
-- emite si estas políticas dejan leer el objeto.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (entorno de pruebas): se omite la parte de ficheros.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'work-documents', 'work-documents', false,
    26214400,  -- 25 MB por fichero: de sobra para memorias y artículos, y deja
               -- margen dentro del 1 GB del plan gratuito.
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv', 'text/markdown',
      'image/png', 'image/jpeg',
      'application/zip', 'application/x-tex'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'Cubo work-documents listo (privado, 25 MB por fichero).';
end $$;

-- Función de autorización reutilizada por las cuatro políticas del cubo.
-- Se declara siempre, también en el entorno de pruebas, para poder verificarla.
create or replace function app.can_access_storage_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  w uuid;
begin
  -- El primer segmento de la ruta es el trabajo. Si no es un uuid válido, la
  -- ruta no la ha generado la aplicación: se deniega.
  begin
    w := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return w in (select app.accessible_work_ids());
end;
$$;

revoke all on function app.can_access_storage_object(text) from public;
revoke all on function app.can_access_storage_object(text) from anon;
grant execute on function app.can_access_storage_object(text) to authenticated;

-- Quien puede gestionar el plan del trabajo, o es miembro, puede subir; el
-- detalle de quién sube qué lo marca `document_versions.author_id`, cuya
-- política ya exige `author_id = app.uid()`.
create or replace function app.can_write_storage_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  w uuid;
begin
  begin
    w := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return app.is_work_member(w) or app.is_admin_of_work(w);
end;
$$;

revoke all on function app.can_write_storage_object(text) from public;
revoke all on function app.can_write_storage_object(text) from anon;
grant execute on function app.can_write_storage_object(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists work_documents_select on storage.objects';
  execute 'drop policy if exists work_documents_insert on storage.objects';
  execute 'drop policy if exists work_documents_update on storage.objects';
  execute 'drop policy if exists work_documents_delete on storage.objects';

  execute $p$
    create policy work_documents_select on storage.objects for select to authenticated
      using (bucket_id = 'work-documents' and app.can_access_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_update on storage.objects for update to authenticated
      using (bucket_id = 'work-documents' and app.can_write_storage_object(name))
      with check (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_delete on storage.objects for delete to authenticated
      using (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;

  raise notice 'Politicas del cubo work-documents aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Verificación
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'documents' and column_name = 'task_id'
  ) then
    raise exception 'documents.task_id no existe';
  end if;
  if not has_function_privilege('authenticated', 'app.can_access_storage_object(text)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.can_access_storage_object';
  end if;
  if has_function_privilege('anon', 'app.can_access_storage_object(text)', 'execute') then
    raise exception 'anon puede ejecutar app.can_access_storage_object';
  end if;
  raise notice 'Migracion 0010 correcta.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0011_meetings_and_notifications.sql
-- #############################################################################

-- =============================================================================
-- 0011 · Fase 2: reuniones, comentarios y notificaciones internas
--
-- Las tablas existen desde la 0002 y sus políticas desde la 0003. Esta
-- migración corrige cuatro cosas que aparecieron al ir a construir la interfaz
-- encima, y añade lo único que faltaba de verdad: cómo nacen las
-- notificaciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `comments_select` repetía el fallo del borrado lógico
--
-- Llevaba `deleted_at is null`, así que un autor no podía borrar su propio
-- comentario: al poner `deleted_at` la fila dejaría de serle visible y
-- PostgreSQL rechaza el UPDATE. Es la cuarta aparición del mismo patrón, y la
-- regla ya está escrita en SECURITY.md §5.2.septies: toda política de SELECT
-- que filtre por `deleted_at` debe dejar ver lo archivado a quien pueda
-- archivarlo.
-- -----------------------------------------------------------------------------
alter policy comments_select on comments
  using (
    work_id in (select app.accessible_work_ids())
    and (deleted_at is null or author_id = app.uid())
  );

-- -----------------------------------------------------------------------------
-- 2. La administración quedaba fuera de las reuniones
--
-- `meetings_write` admitía supervisión O administración, pero las políticas de
-- participantes y de acuerdos solo admitían supervisión. Resultado: un
-- administrador podía crear una reunión y después no podía añadirle
-- participantes ni acuerdos. Incoherencia, no decisión.
-- -----------------------------------------------------------------------------
alter policy mparts_write on meeting_participants
  using (exists (
    select 1 from meetings m
    where m.id = meeting_id
      and (app.is_work_supervisor(m.work_id) or app.is_admin_of_work(m.work_id))
  ))
  with check (exists (
    select 1 from meetings m
    where m.id = meeting_id
      and (app.is_work_supervisor(m.work_id) or app.is_admin_of_work(m.work_id))
  ));

alter policy agreements_write on meeting_agreements
  using (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id))
  with check (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id));

-- -----------------------------------------------------------------------------
-- 3. Las notas privadas y el autor
--
-- `private_notes_write` exige `author_id = app.uid()`, lo que está bien para
-- escribir, pero también se aplica al borrado: un director no podía borrar una
-- nota de otro director, que es correcto, pero tampoco podía la
-- administración... y eso no es un problema, es lo que queremos. Se deja como
-- está: cada cual es dueño de sus notas y nadie más las toca.
--
-- Lo que sí se verifica aquí es que la política de lectura sigue siendo la
-- crítica del sistema, con la regla de protección del estudiante dentro de
-- `app.can_see_private_notes`: si alguien es estudiante del trabajo, no ve las
-- notas privadas NI SIENDO ADEMÁS administrador de la organización.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'meeting_private_notes' and policyname = 'private_notes_select'
  ) then
    raise exception 'Falta la politica private_notes_select';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Las notificaciones no podían existir
--
-- `notifications` tenía políticas de SELECT y de UPDATE (para marcar como
-- leída) y NINGUNA de INSERT, así que nadie podía crear una notificación. No
-- se arregla dando permiso de INSERT al cliente: con él, cualquier usuario
-- podría escribir notificaciones en el buzón de cualquier otro, y eso es
-- suplantación. Las notificaciones las crean DISPARADORES, que se ejecutan con
-- los privilegios de su propietario y por tanto no necesitan política.
--
-- Deliberadamente NO hay disparador sobre `meeting_private_notes`: una
-- notificación de que «se ha añadido una nota» revelaría la existencia de la
-- nota a quien no puede leerla. Avisar de algo privado es filtrarlo.
-- -----------------------------------------------------------------------------

create or replace function app.notify(
  target uuid, work uuid, kind text, subject text, body text, link text
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Nadie se notifica a sí mismo: quien hace la acción ya lo sabe.
  if target is null or target = auth.uid() then
    return;
  end if;
  insert into notifications (user_id, work_id, type, title, body, link)
  values (target, work, kind, subject, body, link);
end;
$$;

revoke all on function app.notify(uuid, uuid, text, text, text, text) from public;
revoke all on function app.notify(uuid, uuid, text, text, text, text) from anon;

-- 4.1 Tarea asignada ----------------------------------------------------------
create or replace function app.notify_task_assigned()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare titulo text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  select w.title into titulo from academic_works w where w.id = new.work_id;
  perform app.notify(
    new.assignee_id, new.work_id, 'TASK_ASSIGNED',
    'Tienes una tarea nueva',
    new.title || ' · ' || coalesce(titulo, 'trabajo'),
    '/trabajos/' || new.work_id
  );
  return new;
end;
$$;

drop trigger if exists tasks_notify_assignee on tasks;
create trigger tasks_notify_assignee
  after insert or update of assignee_id on tasks
  for each row execute function app.notify_task_assigned();

-- 4.2 Menciones en comentarios ------------------------------------------------
create or replace function app.notify_comment_mentions()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  titulo text;
  quien text;
begin
  if array_length(new.mentions, 1) is null then return new; end if;

  select w.title into titulo from academic_works w where w.id = new.work_id;
  select p.full_name into quien from profiles p where p.id = new.author_id;

  foreach destinatario in array new.mentions loop
    -- Solo se avisa a quien ya tiene acceso al trabajo. Mencionar a alguien de
    -- fuera no le da acceso ni le dice que el trabajo existe.
    if exists (
      select 1 from work_members m
      where m.work_id = new.work_id and m.user_id = destinatario and m.status = 'ACTIVE'
    ) then
      perform app.notify(
        destinatario, new.work_id, 'MENTION',
        coalesce(quien, 'Alguien') || ' te ha mencionado',
        left(new.content, 140) || case when length(new.content) > 140 then '…' else '' end,
        '/trabajos/' || new.work_id
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists comments_notify_mentions on comments;
create trigger comments_notify_mentions
  after insert on comments
  for each row execute function app.notify_comment_mentions();

-- 4.3 Entrega de una versión de documento -------------------------------------
create or replace function app.notify_document_version()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  nombre text;
begin
  select d.name into nombre from documents d where d.id = new.document_id;

  -- A quien valida entregables en ese trabajo: es quien tiene que revisarlo.
  for destinatario in
    select m.user_id
    from work_members m
    join work_roles r on r.id = m.work_role_id
    where m.work_id = new.work_id
      and m.status = 'ACTIVE'
      and coalesce((m.permissions->>'can_validate_deliverables')::boolean,
                   r.can_validate_deliverables)
  loop
    perform app.notify(
      destinatario, new.work_id, 'DOCUMENT_SUBMITTED',
      'Hay una entrega para revisar',
      coalesce(nombre, 'Documento') || ' · ' || new.version_label,
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists versions_notify on document_versions;
create trigger versions_notify
  after insert on document_versions
  for each row execute function app.notify_document_version();

-- 4.4 Reunión convocada -------------------------------------------------------
create or replace function app.notify_meeting()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare destinatario uuid;
begin
  if tg_op = 'UPDATE' and new.scheduled_at is not distinct from old.scheduled_at then
    return new;
  end if;

  for destinatario in
    select m.user_id from work_members m
    where m.work_id = new.work_id and m.status = 'ACTIVE'
  loop
    perform app.notify(
      destinatario, new.work_id,
      case when tg_op = 'INSERT' then 'MEETING_SCHEDULED' else 'MEETING_MOVED' end,
      case when tg_op = 'INSERT' then 'Reunión convocada' else 'Reunión movida de fecha' end,
      new.title || ' · ' || to_char(new.scheduled_at, 'DD/MM/YYYY HH24:MI'),
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists meetings_notify on meetings;
create trigger meetings_notify
  after insert or update of scheduled_at on meetings
  for each row execute function app.notify_meeting();

-- Las funciones de disparador no necesitan EXECUTE para el usuario que provoca
-- la sentencia, así que se les quita a todo el mundo. Coherente con la 0007.
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'notify%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
  end loop;
end $$;

-- Borrar una notificación propia (vaciar el buzón) no estaba contemplado.
drop policy if exists notifs_delete on notifications;
create policy notifs_delete on notifications for delete to authenticated
  using (user_id = app.uid());

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
  where tgname in ('tasks_notify_assignee','comments_notify_mentions','versions_notify','meetings_notify');
  if n <> 4 then
    raise exception 'Faltan disparadores de notificacion: hay % de 4', n;
  end if;

  if exists (
    select 1 from pg_policies
    where tablename = 'notifications' and cmd = 'INSERT'
  ) then
    raise exception 'notifications tiene politica de INSERT: las notificaciones solo las crean disparadores';
  end if;

  raise notice 'Migracion 0011 correcta: 4 disparadores, sin INSERT para el cliente.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0012_plan_advanced.sql
-- #############################################################################

-- =============================================================================
-- 0012 · Planificación avanzada (Fase 3): integridad del grafo de tareas,
--        hitos y aplicación atómica de plantillas.
--
-- El esquema de la Fase 3 ya estaba en la 0002 (milestones, task_dependencies,
-- templates, template_tasks) y sus políticas en la 0003. Al implementar la fase
-- aparecieron TRES huecos que no son de permisos sino de integridad, y que la
-- interfaz no puede cerrar porque cualquiera puede hablar con PostgREST
-- directamente.
--
-- -----------------------------------------------------------------------------
-- 1. LOS CICLOS SE VALIDABAN «EN APLICACIÓN»
--
-- La 0002 lo dejó escrito en un comentario: `check (task_id <> depends_on_task_id)
-- -- los ciclos se validan en aplicación`. Eso impide A→A, pero no A→B→A ni
-- nada más largo. Y un ciclo no es un dato feo: es un dato que CUELGA a quien lo
-- lea. El recorrido del grafo para ordenar el Gantt, para calcular qué tarea
-- está bloqueada o para propagar una fecha entra en bucle infinito. Da igual lo
-- cuidadosa que sea la interfaz: dos peticiones REST seguidas desde cualquier
-- cliente, o dos personas planificando a la vez, crean el ciclo igual.
--
-- Se valida con un CTE recursivo en un disparador. `cycle` de PostgreSQL corta
-- el recorrido en cuanto repite un nodo, así que la comprobación termina
-- siempre, incluso si por cualquier razón ya hubiera un ciclo en la tabla.
--
-- -----------------------------------------------------------------------------
-- 2. UNA TAREA PODÍA DEPENDER DE UNA TAREA DE OTRO TRABAJO
--
-- `taskdeps_write` comprobaba `app.can_manage_plan` sobre el trabajo de
-- `task_id` y no miraba `depends_on_task_id`. Con dirigir un trabajo bastaba
-- para colgar una dependencia de una tarea de un trabajo ajeno, posiblemente
-- invisible para quien la crea. Consecuencias: el Gantt de un trabajo
-- mostraría un vínculo que apunta a la nada (la fila de la otra tarea no pasa
-- el filtro de RLS), y el estado «bloqueada» de una tarea dependería de algo
-- que su propio equipo no puede ver ni desbloquear.
--
-- Se cierra por los dos lados: la política ahora exige permiso en AMBOS
-- extremos, y un disparador exige además que los dos sean del MISMO trabajo.
-- Son cosas distintas: la política dice quién puede escribir; el disparador,
-- qué es un dato válido. Un administrador de la organización pasa la política
-- para dos trabajos suyos y sigue sin poder cruzarlos.
--
-- -----------------------------------------------------------------------------
-- 3. APLICAR UNA PLANTILLA DESDE EL CLIENTE NO ERA ATÓMICO
--
-- Una plantilla son N tareas con jerarquía. Hacerlo con N inserciones desde el
-- navegador tiene dos problemas: si la quinta falla queda medio plan creado y
-- nadie sabe cuál era el estado bueno; y `template_tasks.parent_index` apunta
-- al `order_index` del padre DENTRO de la plantilla, de modo que el cliente
-- tendría que ir resolviendo identificadores reales a mitad de la secuencia.
--
-- `app.apply_template(...)` lo hace en una sola sentencia, dentro de una sola
-- transacción: o está el plan entero o no está nada.
--
-- OJO A LO QUE **NO** ES: no lleva `security definer`. Se ejecuta con los
-- privilegios de quien llama, así que las políticas de `tasks` siguen
-- decidiendo. Un estudiante que la invoque sobre su propio trabajo es
-- rechazado por `tasks_insert`, igual que si insertara a mano. Ponerle
-- `security definer` para «que funcione» habría convertido una comodidad en un
-- agujero: cualquiera podría llenar de tareas el trabajo de cualquiera.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ciclos en el grafo de dependencias
-- -----------------------------------------------------------------------------
create or replace function app.assert_no_dependency_cycle()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ciclo boolean;
begin
  -- ¿Se puede llegar desde `depends_on_task_id` hasta `task_id` siguiendo las
  -- dependencias? Si se puede, la fila nueva cierra el círculo.
  --
  -- La fila ya está insertada cuando corre el disparador (`after insert`), así
  -- que el recorrido la incluye sin sumarla a mano. La cláusula `cycle` del
  -- estándar deja de expandir un nodo en cuanto se repite, de modo que el
  -- recorrido TERMINA siempre: también si la tabla ya tuviera un ciclo de antes
  -- de esta migración, que es justo el caso en el que un CTE recursivo ingenuo
  -- se quedaría colgado comprobando si puede colgarse.
  with recursive camino(nodo) as (
    select new.depends_on_task_id
    union all
    select d.depends_on_task_id
    from camino c
    join task_dependencies d on d.task_id = c.nodo
  ) cycle nodo set es_ciclo using ruta
  select exists (select 1 from camino where nodo = new.task_id) into v_ciclo;

  if v_ciclo then
    raise exception 'Esa dependencia crearía un ciclo: la tarea acabaría dependiendo de sí misma a través de otras. Revisa el orden del plan.';
  end if;

  return null;
end;
$$;

drop trigger if exists taskdeps_no_cycle on task_dependencies;
create trigger taskdeps_no_cycle
  after insert or update on task_dependencies
  for each row execute function app.assert_no_dependency_cycle();

-- -----------------------------------------------------------------------------
-- 2. Las dos tareas de una dependencia son del mismo trabajo
-- -----------------------------------------------------------------------------
create or replace function app.enforce_dependency_same_work()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  -- Lectura directa de `tasks`, sin pasar por RLS: este disparador comprueba un
  -- invariante del dato, no un permiso. Quién puede escribir lo decide
  -- `taskdeps_write`. Por eso la función es `security definer` aunque la de
  -- plantillas no lo sea: aquí se trata de leer dos `work_id` para compararlos,
  -- no de conceder nada.
  select work_id into v_a from tasks where id = new.task_id;
  select work_id into v_b from tasks where id = new.depends_on_task_id;

  if v_a is null or v_b is null then
    raise exception 'Alguna de las dos tareas de la dependencia no existe.';
  end if;

  if v_a <> v_b then
    raise exception 'Una tarea solo puede depender de otra tarea del MISMO trabajo. Las dependencias entre trabajos distintos crearían vínculos que el equipo no puede ver ni resolver.';
  end if;

  return new;
end;
$$;
alter function app.enforce_dependency_same_work() security definer;

drop trigger if exists taskdeps_same_work on task_dependencies;
create trigger taskdeps_same_work
  before insert or update on task_dependencies
  for each row execute function app.enforce_dependency_same_work();

-- Permiso en AMBOS extremos, no solo en el que se escribe.
alter policy taskdeps_select on task_dependencies
  using (
    exists (select 1 from tasks t where t.id = task_id
            and t.work_id in (select app.accessible_work_ids()))
  );

alter policy taskdeps_write on task_dependencies
  using (
    exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id))
    and exists (select 1 from tasks t where t.id = depends_on_task_id and app.can_manage_plan(t.work_id))
  )
  with check (
    exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id))
    and exists (select 1 from tasks t where t.id = depends_on_task_id and app.can_manage_plan(t.work_id))
  );

-- -----------------------------------------------------------------------------
-- 3. Hitos: `met_at` lo pone la base de datos
--
-- `is_met` y `met_at` son dos columnas que cuentan lo mismo, y dos columnas que
-- cuentan lo mismo se desincronizan en cuanto haya dos sitios que las escriban
-- (la interfaz, un script de importación, una corrección a mano en el panel de
-- Supabase). La fecha de cumplimiento la pone el disparador a partir del
-- booleano, y así no hay forma de tener un hito cumplido sin fecha ni una fecha
-- de cumplimiento en un hito pendiente.
-- -----------------------------------------------------------------------------
create or replace function app.set_milestone_met_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_met and (old is null or not old.is_met) then
    new.met_at := now();
  elsif not new.is_met then
    new.met_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists milestones_met_at on milestones;
create trigger milestones_met_at
  before insert or update on milestones
  for each row execute function app.set_milestone_met_at();

-- -----------------------------------------------------------------------------
-- 4. Aplicación atómica de una plantilla
-- -----------------------------------------------------------------------------
create or replace function app.apply_template(
  p_work     uuid,
  p_template uuid,
  p_start    date default null
)
returns int
language plpgsql
-- SIN `security definer`: ver la cabecera del fichero. Las políticas de `tasks`
-- siguen mandando, de modo que planificar sigue siendo cosa de quien puede
-- planificar.
set search_path = public, pg_temp
as $$
declare
  v_inicio      date;
  v_work_type   uuid;
  v_tpl_type    uuid;
  v_tpl_org     uuid;
  v_work_org    uuid;
  v_fila        record;
  v_nueva       uuid;
  v_padres      jsonb := '{}'::jsonb;   -- order_index de la plantilla -> uuid creado
  v_padre       uuid;
  v_base        int;
  v_total       int := 0;
begin
  -- Se leen trabajo y plantilla a través de RLS a propósito: si quien llama no
  -- puede ver uno de los dos, la función no debe decirle si existe.
  select work_type_id, start_date, organization_id
    into v_work_type, v_inicio, v_work_org
    from academic_works where id = p_work;
  if not found then
    raise exception 'El trabajo no existe o no tienes acceso a él.';
  end if;

  select work_type_id, organization_id into v_tpl_type, v_tpl_org
    from templates where id = p_template and is_active;
  if not found then
    raise exception 'La plantilla no existe, no está activa o no tienes acceso a ella.';
  end if;

  if v_tpl_org <> v_work_org then
    raise exception 'La plantilla pertenece a otra organización.';
  end if;

  -- Una plantilla sin tipo sirve para cualquier trabajo; con tipo, solo para el
  -- suyo. Aplicar la plantilla de un TFG a una tesis daría un plan sin sentido,
  -- y el usuario no tendría forma de saber por qué le ha salido así.
  if v_tpl_type is not null and v_tpl_type <> v_work_type then
    raise exception 'Esa plantilla es de otro tipo de trabajo.';
  end if;

  -- Orden de preferencia para el día cero del plan: lo que pida quien llama,
  -- el inicio real del trabajo, y por último hoy.
  v_inicio := coalesce(p_start, v_inicio, current_date);

  -- `order_index` fija el orden, y `parent_index` apunta al `order_index` del
  -- padre dentro de la MISMA plantilla. Se recorre en orden para que el padre
  -- exista siempre antes que el hijo; si una plantilla apunta hacia adelante,
  -- se dice en vez de dejar la tarea suelta sin avisar.
  select coalesce(max(order_index), -1) + 1 into v_base
    from tasks where work_id = p_work and parent_task_id is null;

  for v_fila in
    select * from template_tasks where template_id = p_template order by order_index
  loop
    v_padre := null;
    if v_fila.parent_index is not null then
      v_padre := (v_padres ->> v_fila.parent_index::text)::uuid;
      if v_padre is null then
        raise exception 'La plantilla está mal formada: la tarea «%» dice depender de la posición % de la plantilla, que todavía no se ha creado. El padre debe ir antes que el hijo.',
          v_fila.title, v_fila.parent_index;
      end if;
    end if;

    insert into tasks (
      work_id, parent_task_id, title, description, priority,
      start_date, due_date, order_index, created_by
    ) values (
      p_work, v_padre, v_fila.title, v_fila.description, v_fila.priority,
      v_inicio + v_fila.offset_days,
      v_inicio + v_fila.offset_days + greatest(v_fila.duration_days, 0),
      v_base + v_fila.order_index, auth.uid()
    )
    returning id into v_nueva;

    v_padres := v_padres || jsonb_build_object(v_fila.order_index::text, v_nueva);
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Esa plantilla no tiene ninguna tarea.';
  end if;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Privilegios de las funciones nuevas
--
-- LA 0007 NO PROTEGE A LAS FUNCIONES FUTURAS, AUNQUE LO PARECÍA. Termina con:
--
--     alter default privileges in schema app revoke all on functions from public;
--
-- que se lee como «y las que vengan, también». No es verdad. Comprobado contra
-- PostgreSQL 16: esa sentencia no deja ninguna fila en `pg_default_acl`, y una
-- función creada después sigue siendo ejecutable por `anon`, que es miembro de
-- PUBLIC. Las tres funciones de disparador de esta migración nacieron abiertas
-- a `anon` por esto mismo.
--
-- No lo descubrí leyendo: lo cazó la prueba estructural [33], que recorre todas
-- las funciones del esquema `app` y exige que `anon` no pueda ejecutar ninguna.
-- Es la segunda vez que una prueba estructural encuentra un agujero de
-- privilegios que la lectura del SQL no veía (la primera, `SECURITY.md`
-- §5.2.ter). De ahí la regla para las migraciones siguientes:
--
--   TODA migración que cree funciones en `app` termina con el `revoke` en
--   bloque de abajo y concede después, una por una, solo las que hagan falta.
--
-- El `revoke` en bloque es inmediato y no toca lo concedido a `authenticated`,
-- así que no deshace los permisos de la 0007: solo cierra lo que PUBLIC abre
-- por su cuenta cada vez que se crea una función. Las de disparador no
-- necesitan permiso alguno —PostgreSQL no comprueba EXECUTE al dispararlas—,
-- de modo que se quedan sin conceder.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Envoltura en `public`, porque PostgREST no ve el esquema `app`
--
-- PostgREST solo expone los esquemas configurados, y en Supabase son `public`,
-- `graphql_public` y `storage`. `app` queda fuera a propósito: es donde viven
-- los ayudantes de las políticas, y no tendría ningún sentido que un cliente
-- pudiera llamarlos. Pero eso significa que `supabase.rpc('apply_template')`
-- NO encontraría la función: aplicar una plantilla desde la interfaz sería
-- imposible.
--
-- De ahí esta envoltura de una línea en `public`. No añade ningún privilegio:
-- tampoco lleva `security definer`, así que la cadena entera —envoltura,
-- función y las inserciones en `tasks`— se ejecuta con los permisos de quien
-- llama. Lo que sí hay que recordar es que todo lo que vive en `public` SÍ lo
-- ve PostgREST, y por tanto también el rol `anon`; de ahí los `revoke`.
-- -----------------------------------------------------------------------------
create or replace function public.apply_template(
  p_work uuid, p_template uuid, p_start date default null
)
returns int language sql
set search_path = public, pg_temp
as $$ select app.apply_template(p_work, p_template, p_start) $$;

revoke all on function public.apply_template(uuid, uuid, date) from public;
revoke all on function public.apply_template(uuid, uuid, date) from anon;
grant execute on function public.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones de la propia migración
-- -----------------------------------------------------------------------------
do $$
declare
  v_disparadores int;
  v_definer      boolean;
  v_anon         boolean;
begin
  select count(*) into v_disparadores from pg_trigger
   where not tgisinternal
     and tgname in ('taskdeps_no_cycle', 'taskdeps_same_work', 'milestones_met_at');
  if v_disparadores <> 3 then
    raise exception 'Faltan disparadores de la 0012: hay %, se esperaban 3.', v_disparadores;
  end if;

  -- Que `apply_template` NO sea security definer es parte del contrato de
  -- seguridad, no una preferencia de estilo. Se comprueba aquí para que nadie
  -- lo cambie «para que funcione» sin que salte nada.
  select prosecdef into v_definer from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'app.apply_template no debe ser SECURITY DEFINER: dejaría planificar a quien no puede.';
  end if;

  select has_function_privilege('anon', p.oid, 'execute') into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_anon then
    raise exception 'anon no debe poder ejecutar app.apply_template.';
  end if;

  select prosecdef into v_definer from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'public.apply_template no debe ser SECURITY DEFINER.';
  end if;
  if has_function_privilege('anon', 'public.apply_template(uuid,uuid,date)', 'execute') then
    raise exception 'anon no debe poder ejecutar public.apply_template.';
  end if;

  -- Que ninguna función del esquema quede abierta a `anon`, no solo las de
  -- esta migración: si la siguiente olvida el `revoke`, salta aquí.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'Alguna función de app es ejecutable por anon.';
  end if;

  raise notice 'Migracion 0012 correcta: 3 disparadores, apply_template con privilegios de quien llama, nada abierto a anon.';
end;
$$;


-- #############################################################################
-- ### supabase/migrations/0013_pending_accounts.sql
-- #############################################################################

-- =============================================================================
-- 0013 · Cuentas creadas a mano: hacerlas visibles para poder autorizarlas
--
-- EL PROBLEMA
-- `profiles_select` dice: «veo mi perfil, y veo los perfiles de quien comparte
-- organización conmigo». Es la invariante correcta y no se toca.
--
-- Pero tiene una consecuencia que no se había pensado. Cuando alguien crea un
-- usuario a mano en Authentication → Users del panel de Supabase, el disparador
-- `on_auth_user_created` le crea su fila en `profiles`, y nada más: la
-- pertenencia a la organización es un acto administrativo explícito y no se
-- deduce del registro (y eso está bien: sin ella, el usuario entra y no ve
-- nada). El resultado es que esa cuenta existe pero **no comparte organización
-- con nadie**, así que NO LA VE NADIE, tampoco la administración. El
-- administrador no puede autorizar desde la aplicación a alguien que la
-- aplicación no le deja ver, y se queda sin más salida que escribir a mano en
-- `organization_members` desde el panel de Supabase.
--
-- La cola de invitaciones (0005) cubre el camino previsto —invitar y que el
-- alta se haga sola al aceptar—, pero no este, que es el que se usa cuando se
-- crea la cuenta directamente.
--
-- LA SOLUCIÓN, Y POR QUÉ NO ES UNA POLÍTICA MÁS AMPLIA
-- La tentación es añadir a `profiles_select` algo como «...o soy administrador
-- y el perfil no tiene organización». Funcionaría, pero ensancha la lectura
-- general de `profiles` para siempre y en todas las consultas: cualquier
-- `select * from profiles` de cualquier pantalla empezaría a devolver cuentas
-- ajenas, y el día que alguien añada un filtro mal puesto no se notaría.
--
-- En su lugar se expone UNA función que devuelve exactamente lo que hace falta
-- y nada más: las cuentas sin ninguna pertenencia activa, solo si quien
-- pregunta es administrador de alguna organización. `profiles_select` sigue
-- igual de estrecha, y la excepción está en un sitio único, con nombre, que se
-- puede leer y probar.
--
-- LIMITACIÓN CONOCIDA, escrita a propósito
-- Si algún día este despliegue alojara VARIAS organizaciones independientes,
-- cualquier administrador vería las cuentas pendientes de todas, porque una
-- cuenta sin organización no tiene nada que la vincule a una. Hoy el
-- despliegue es de un solo grupo y el caso no se da. Si se diera, la forma de
-- acotarlo es cruzar con `invitations` por correo y mostrar solo las cuentas
-- cuyo correo tenga una invitación de esa organización; se deja apuntado aquí
-- para no tener que volver a razonarlo.
-- =============================================================================

create or replace function app.is_any_org_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.is_active
      and m.role in ('OWNER', 'ADMIN')
  );
$$;

/**
 * Cuentas que existen pero no pertenecen a ninguna organización.
 *
 * Va en `public` porque PostgREST no expone el esquema `app` y la interfaz
 * tiene que poder llamarla.
 */
create or replace function public.pending_accounts()
returns table (id uuid, full_name text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Quien no administra nada no recibe un error, recibe una lista vacía. Un
  -- error diría «aquí hay algo que no puedes ver», que es más de lo que hace
  -- falta contar. Y la comprobación va DENTRO de la función porque es
  -- `security definer`: sin ella, el `grant` a `authenticated` dejaría la lista
  -- de correos de las cuentas nuevas al alcance de cualquier usuario.
  if not app.is_any_org_admin() then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.created_at
    from profiles p
    where not exists (
      select 1 from organization_members m
      where m.user_id = p.id and m.is_active
    )
    order by p.created_at desc
    limit 200;
end;
$$;

-- Privilegios: el `revoke` en bloque del esquema `app` (ver la cabecera de la
-- 0012) y, para la función de `public`, uno explícito. Todo lo que vive en
-- `public` lo ve PostgREST, y por tanto también `anon`.
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

revoke all on function public.pending_accounts() from public;
revoke all on function public.pending_accounts() from anon;
grant execute on function public.pending_accounts() to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones de la propia migración
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.pending_accounts()', 'execute') then
    raise exception 'anon no debe poder listar las cuentas pendientes.';
  end if;
  if not has_function_privilege('authenticated', 'public.pending_accounts()', 'execute') then
    raise exception 'authenticated debe poder listar las cuentas pendientes.';
  end if;

  -- `profiles_select` NO debe haberse ensanchado: es el punto de todo esto.
  if pg_get_expr(
       (select polqual from pg_policy where polname = 'profiles_select'),
       (select polrelid from pg_policy where polname = 'profiles_select')
     ) not like '%shares_organization%' then
    raise exception 'profiles_select ha cambiado de forma inesperada.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'Alguna función de app es ejecutable por anon.';
  end if;

  raise notice 'Migracion 0013 correcta: cuentas pendientes visibles solo para la administracion.';
end;
$$;


-- #############################################################################
-- ### supabase/migrations/0014_template_contents.sql
-- #############################################################################

-- =============================================================================
-- 0014 · Plantillas completas: tareas con todo su contenido y material adjunto
--
-- QUÉ FALTABA
-- Una tarea de plantilla solo tenía título, desplazamiento, duración y
-- prioridad. Las tareas reales tienen además descripción, responsable, lista de
-- comprobación y documentos; de todo eso la plantilla solo podía reproducir el
-- esqueleto, así que «aplicar la plantilla» dejaba veinte títulos vacíos que
-- había que rellenar a mano uno por uno. Era la mitad del trabajo que la
-- plantilla venía a ahorrar.
--
-- Lo que se pide es poder dejar preparada la tarea COMPLETA: en qué consiste,
-- quién la hace, y con qué material. El caso concreto: una tarea «revisión de
-- la memoria» con el guion y la rúbrica adjuntos, igual para todos los
-- estudiantes de ese tipo de trabajo.
--
-- LAS CUATRO DECISIONES DE DISEÑO
--
-- 1. LOS FICHEROS SE ENLAZAN, NO SE COPIAN.
--    Al aplicar una plantilla NO se duplica ningún fichero: la tarea creada
--    guarda de qué tarea de plantilla sale (`tasks.template_task_id`) y de ahí
--    cuelga su material. Tres razones, por orden de peso:
--      · Corregir la rúbrica una vez la corrige para todos los trabajos, en
--        curso incluidos. Con copias habría que repasar veinte trabajos, y
--        nadie lo haría: cada estudiante leería una versión distinta.
--      · El plan gratuito da 1 GB de Storage. Una rúbrica de 2 MB copiada en
--        treinta trabajos son 60 MB por un fichero que es el mismo.
--      · Lo que sí es de cada trabajo —el entregable del estudiante— ya tiene
--        su sitio desde la 0010: `documents` con `task_id`. Son dos cosas
--        distintas y conviene que no se confundan: material de referencia que
--        baja de la plantilla, y entregables que suben del trabajo.
--
-- 2. LA LISTA DE COMPROBACIÓN NO NECESITA NADA NUEVO.
--    En las tareas reales los puntos de la lista son subtareas
--    (`tasks.parent_task_id`, ver 0009), y en las plantillas la jerarquía ya
--    existe con `template_tasks.parent_index`. Una tarea de plantilla con hijos
--    produce, al aplicarse, una tarea con su lista de comprobación. No hay
--    tabla nueva ni política nueva: es la misma decisión de la 0009 llevada
--    hasta aquí.
--
-- 3. EL RESPONSABLE SE GUARDA POR FUNCIÓN, NO POR PERSONA.
--    Una plantilla no puede nombrar a nadie: sirve para trabajos que todavía no
--    existen. Pero sí puede decir «esto lo hace quien dirige» o «esto lo hace
--    el estudiante», y eso es justo lo que distingue una tarea de revisión de
--    una de entrega. `template_tasks.assignee_role_id` apunta a `work_roles`, y
--    al aplicar la plantilla se resuelve contra los participantes activos del
--    trabajo. Si nadie tiene esa función, la tarea queda sin responsable: un
--    plan con una tarea sin asignar es mejor que negarse a crear el plan.
--
-- 4. QUIÉN VE EL MATERIAL: toda la organización, y es a propósito.
--    El material de plantilla es lo contrario de un dato personal: son guiones,
--    rúbricas y formatos pensados para que los lean todos los estudiantes de
--    ese perfil. Así que `template_files` se lee como `templates` —cualquier
--    miembro de la organización— y se escribe como ellas —solo la
--    administración—. Nada de esto debe contener datos de ninguna persona
--    concreta; el aviso está también en la interfaz.
--
-- RIESGO ASUMIDO Y DOCUMENTADO
-- `tasks.template_task_id` es `on delete set null`: borrar una tarea de
-- plantilla NO falla y deja sin material a las tareas ya creadas desde ella,
-- sin rastro de cuál era. Es el mismo peligro que las líneas de investigación
-- de la 0013 (prueba [92]), y se trata igual: la base de datos lo permite y la
-- interfaz avisa antes. Lo que no se hace es ponerlo `restrict`, porque
-- entonces una plantilla vieja no se podría limpiar nunca.
--
-- Y al borrar una tarea de plantilla, sus filas de `template_files` caen con
-- ella (`on delete cascade`) pero los OBJETOS de Storage no: eso lo hace la
-- aplicación antes de borrar la fila. Si falla, quedan bytes huérfanos
-- inaccesibles (las políticas del cubo solo dan acceso por plantilla), no un
-- fichero expuesto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- -----------------------------------------------------------------------------
alter table template_tasks
  add column if not exists assignee_role_id uuid references work_roles(id) on delete set null;

alter table tasks
  add column if not exists template_task_id uuid references template_tasks(id) on delete set null;

create index if not exists tasks_template_task_id
  on tasks (template_task_id) where template_task_id is not null;

-- -----------------------------------------------------------------------------
-- 2. El material de la plantilla
--
-- Dos orígenes posibles, como en `document_versions` desde la 0002:
-- `storage_path` para un fichero alojado aquí y `external_url` para uno que
-- vive fuera (Drive institucional, la web del departamento). El `check` exige
-- al menos uno: una fila sin ninguno de los dos no es un material, es un
-- registro roto que la interfaz mostraría como un adjunto que no se puede
-- abrir.
--
-- `template_task_id` nulo = material de la plantilla entera (la guía general
-- del TFG), no de una tarea suya.
-- -----------------------------------------------------------------------------
create table if not exists template_files (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references templates(id) on delete cascade,
  template_task_id uuid references template_tasks(id) on delete cascade,
  title            text not null,
  description      text,
  storage_path     text,
  external_url     text,
  mime_type        text,
  size_bytes       bigint,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);

create index if not exists template_files_template_id on template_files (template_id);
create index if not exists template_files_task_id
  on template_files (template_task_id) where template_task_id is not null;

-- Un material vinculado a una tarea debe ser de la MISMA plantilla que ella.
-- La integridad referencial no puede expresarlo (son dos caminos distintos
-- hacia `templates`), así que va en un disparador, igual que
-- `app.enforce_document_task_same_work()` de la 0010.
create or replace function app.enforce_template_file_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.template_task_id is not null
     and not exists (
       select 1 from template_tasks
       where id = new.template_task_id and template_id = new.template_id
     ) then
    raise exception 'Ese material pertenece a otra plantilla'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists template_files_scope on template_files;
create trigger template_files_scope
  before insert or update on template_files
  for each row execute function app.enforce_template_file_scope();

-- -----------------------------------------------------------------------------
-- 3. Políticas: se lee como `templates`, se escribe como `templates`
-- -----------------------------------------------------------------------------
alter table template_files enable row level security;

drop policy if exists tfiles_select on template_files;
drop policy if exists tfiles_write on template_files;

create policy tfiles_select on template_files for select to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and t.organization_id in (select app.my_org_ids())
  ));

create policy tfiles_write on template_files for all to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ));

-- -----------------------------------------------------------------------------
-- 4. Storage: un cubo propio para el material de plantilla
--
-- No vale reutilizar `work-documents`: sus políticas deducen la autorización
-- del PRIMER SEGMENTO de la ruta, que allí es un `work_id` (0010). Un material
-- de plantilla no pertenece a ningún trabajo, así que su ruta es
-- `<template_id>/<file_id>/<fichero>` y necesita sus propias políticas. Mezclar
-- las dos convenciones en un cubo sería la forma más fácil de abrirlo por error.
--
-- El cubo es PRIVADO también aquí. Podría ser público —es material de
-- referencia— pero público en Supabase significa legible por internet entero
-- sin sesión, y el repositorio de este proyecto es público: la URL del cubo
-- estaría a la vista. Se descarga con URL firmada de duración corta, como todo
-- lo demás.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (entorno de pruebas): se omite el cubo.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'template-files', 'template-files', false,
    10485760,  -- 10 MB: son guiones y rúbricas, no memorias. Y al ser material
               -- compartido por todos los trabajos, conviene que sea ligero.
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv', 'text/markdown',
      'image/png', 'image/jpeg',
      'application/zip', 'application/x-tex'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'Cubo template-files listo (privado, 10 MB por fichero).';
end $$;

-- Leer: cualquier miembro de la organización dueña de la plantilla. Es el mismo
-- criterio que `tfiles_select`, porque de nada sirve proteger la fila si el
-- fichero se descarga igual.
create or replace function app.can_access_template_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  t uuid;
begin
  -- El primer segmento es la plantilla. Si no es un uuid, la ruta no la ha
  -- generado esta aplicación: se deniega.
  begin
    t := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from templates
    where id = t and organization_id in (select app.my_org_ids())
  );
end;
$$;

-- Escribir: solo la administración de la organización, igual que `tfiles_write`.
create or replace function app.can_write_template_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  t uuid;
begin
  begin
    t := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from templates
    where id = t and app.is_org_admin(organization_id)
  );
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists template_files_select on storage.objects';
  execute 'drop policy if exists template_files_insert on storage.objects';
  execute 'drop policy if exists template_files_update on storage.objects';
  execute 'drop policy if exists template_files_delete on storage.objects';

  execute $p$
    create policy template_files_select on storage.objects for select to authenticated
      using (bucket_id = 'template-files' and app.can_access_template_object(name))
  $p$;
  execute $p$
    create policy template_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;
  execute $p$
    create policy template_files_update on storage.objects for update to authenticated
      using (bucket_id = 'template-files' and app.can_write_template_object(name))
      with check (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;
  execute $p$
    create policy template_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;

  raise notice 'Politicas del cubo template-files aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 5. `app.apply_template` aprende a resolver el responsable y a dejar el enlace
--
-- SIGUE SIN SER `security definer`, y sigue siendo a propósito (prueba [88]):
-- las inserciones pasan por las políticas de `tasks`, de modo que aplicar una
-- plantilla solo puede hacerlo quien podría teclear esas tareas a mano. Que la
-- función resuelva responsables no cambia nada de eso: `work_members` se lee
-- también a través de RLS.
-- -----------------------------------------------------------------------------
create or replace function app.apply_template(p_work uuid, p_template uuid, p_start date default null)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inicio      date;
  v_work_type   uuid;
  v_tpl_type    uuid;
  v_tpl_org     uuid;
  v_work_org    uuid;
  v_fila        record;
  v_nueva       uuid;
  v_padres      jsonb := '{}'::jsonb;   -- order_index de la plantilla -> uuid creado
  v_padre       uuid;
  v_asignado    uuid;
  v_base        int;
  v_total       int := 0;
begin
  -- Se leen trabajo y plantilla a través de RLS a propósito: si quien llama no
  -- puede ver uno de los dos, la función no debe decirle si existe.
  select work_type_id, start_date, organization_id
    into v_work_type, v_inicio, v_work_org
    from academic_works where id = p_work;
  if not found then
    raise exception 'El trabajo no existe o no tienes acceso a él.';
  end if;

  select work_type_id, organization_id into v_tpl_type, v_tpl_org
    from templates where id = p_template and is_active;
  if not found then
    raise exception 'La plantilla no existe, no está activa o no tienes acceso a ella.';
  end if;

  if v_tpl_org <> v_work_org then
    raise exception 'La plantilla pertenece a otra organización.';
  end if;

  -- Una plantilla sin tipo sirve para cualquier trabajo; con tipo, solo para el
  -- suyo. Aplicar la plantilla de un TFG a una tesis daría un plan sin sentido,
  -- y el usuario no tendría forma de saber por qué le ha salido así.
  if v_tpl_type is not null and v_tpl_type <> v_work_type then
    raise exception 'Esa plantilla es de otro tipo de trabajo.';
  end if;

  -- Orden de preferencia para el día cero del plan: lo que pida quien llama,
  -- el inicio real del trabajo, y por último hoy.
  v_inicio := coalesce(p_start, v_inicio, current_date);

  -- `order_index` fija el orden, y `parent_index` apunta al `order_index` del
  -- padre dentro de la MISMA plantilla. Se recorre en orden para que el padre
  -- exista siempre antes que el hijo; si una plantilla apunta hacia adelante,
  -- se dice en vez de dejar la tarea suelta sin avisar.
  select coalesce(max(order_index), -1) + 1 into v_base
    from tasks where work_id = p_work and parent_task_id is null;

  for v_fila in
    select * from template_tasks where template_id = p_template order by order_index
  loop
    v_padre := null;
    if v_fila.parent_index is not null then
      v_padre := (v_padres ->> v_fila.parent_index::text)::uuid;
      if v_padre is null then
        raise exception 'La plantilla está mal formada: la tarea «%» dice depender de la posición % de la plantilla, que todavía no se ha creado. El padre debe ir antes que el hijo.',
          v_fila.title, v_fila.parent_index;
      end if;
    end if;

    -- El responsable se guarda en la plantilla como FUNCIÓN y aquí se resuelve
    -- a la persona que la ejerce en ESTE trabajo. `is_primary` primero: si hay
    -- un director principal y un codirector, la tarea de supervisión es del
    -- principal. Si nadie tiene esa función, queda sin responsable a propósito:
    -- negarse a crear el plan por eso sería peor.
    v_asignado := null;
    if v_fila.assignee_role_id is not null then
      select wm.user_id into v_asignado
        from work_members wm
       where wm.work_id = p_work
         and wm.work_role_id = v_fila.assignee_role_id
         and wm.status = 'ACTIVE'
       order by wm.is_primary desc, wm.created_at
       limit 1;
    end if;

    insert into tasks (
      work_id, parent_task_id, title, description, priority,
      start_date, due_date, order_index, assignee_id, template_task_id, created_by
    ) values (
      p_work, v_padre, v_fila.title, v_fila.description, v_fila.priority,
      v_inicio + v_fila.offset_days,
      v_inicio + v_fila.offset_days + greatest(v_fila.duration_days, 0),
      v_base + v_fila.order_index, v_asignado, v_fila.id, auth.uid()
    )
    returning id into v_nueva;

    v_padres := v_padres || jsonb_build_object(v_fila.order_index::text, v_nueva);
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Esa plantilla no tiene ninguna tarea.';
  end if;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privilegios
--
-- El `revoke` en bloque, otra vez: `alter default privileges ... revoke` no
-- protege a las funciones futuras (comprobado contra PostgreSQL 16, ver el
-- apartado 5 de la 0012), así que toda función nueva en `app` nace ejecutable
-- por PUBLIC —y `anon` es miembro de PUBLIC— hasta que se cierre aquí.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;
grant execute on function app.can_access_template_object(text) to authenticated;
grant execute on function app.can_write_template_object(text) to authenticated;
-- `app.enforce_template_file_scope()` no recibe nada: PostgreSQL no comprueba
-- EXECUTE al disparar un trigger.

-- -----------------------------------------------------------------------------
-- 7. Verificación
-- -----------------------------------------------------------------------------
do $$
declare
  v_abiertas text;
  v_definer  boolean;
begin
  if to_regclass('template_files') is null then
    raise exception 'template_files no existe';
  end if;
  if not exists (
    select 1 from pg_class where relname = 'template_files' and relrowsecurity
  ) then
    raise exception 'template_files sin RLS: seria legible por cualquiera';
  end if;
  if not exists (select 1 from pg_policy where polname = 'tfiles_select') then
    raise exception 'falta la politica tfiles_select';
  end if;
  if not exists (select 1 from pg_policy where polname = 'tfiles_write') then
    raise exception 'falta la politica tfiles_write';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'template_tasks' and column_name = 'assignee_role_id'
  ) then
    raise exception 'template_tasks.assignee_role_id no existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'template_task_id'
  ) then
    raise exception 'tasks.template_task_id no existe';
  end if;

  -- Que siga sin ser definer no es un detalle: es lo que mantiene el reparto de
  -- permisos al aplicar una plantilla.
  select p.prosecdef into v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'app.apply_template ha pasado a SECURITY DEFINER: eso salta las politicas de tasks';
  end if;

  if not has_function_privilege('authenticated', 'app.can_access_template_object(text)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.can_access_template_object';
  end if;

  -- La comprobación que cazó el agujero de la 0012: ninguna función de `app`
  -- ejecutable por `anon`, se mire como se mire.
  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0014 correcta: plantillas con tareas completas y material adjunto.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0015_document_comments.sql
-- #############################################################################

-- =============================================================================
-- 0015 · Comentarios sobre la versión de un documento
--
-- QUÉ YA ESTABA Y POR QUÉ NO SERVÍA TAL CUAL
-- `document_comments` existe desde la 0002, con sus cuatro políticas en la
-- 0003, y no se había usado nunca. Al ponerla en marcha aparecen tres cosas que
-- la tabla por sí sola no resuelve.
--
-- 1. EL `work_id` AHORA SE DERIVA, NO SE CREE.
--    La fila lleva `version_id` y `work_id` como dos claves ajenas
--    independientes, así que nada impedía una fila cuya versión perteneciera a
--    un trabajo y cuyo `work_id` dijera otro. Y `work_id` no es un dato
--    cualquiera: es la columna por la que `doccomments_select` decide QUIÉN VE
--    el comentario. Un `work_id` equivocado es un comentario mostrado al grupo
--    de personas equivocado.
--
--    No se valida: se sobrescribe. El disparador BEFORE lo rellena a partir de
--    la versión, y como PostgreSQL aplica el `with check` de RLS DESPUÉS de los
--    disparadores BEFORE, la política acaba decidiendo sobre el trabajo de
--    verdad. Si alguien manda la versión de un trabajo ajeno, el `work_id` pasa
--    a ser el de ese trabajo y la política lo rechaza por no ser miembro. Es
--    mejor que validar y devolver un error: no hay forma de equivocarse.
--
-- 2. `doccomments_insert` EXIGÍA SER MIEMBRO DEL TRABAJO.
--    La administración del grupo no lo es necesariamente, así que no podía
--    comentar una entrega. Es el mismo arreglo que la 0011 hizo con los
--    acuerdos y los participantes de reunión; se añade `app.is_admin_of_work`.
--
-- 3. UN COMENTARIO QUE NADIE VE NO SIRVE DE NADA.
--    Las notificaciones las crean disparadores, nunca el cliente (§5.2.nonies
--    de SECURITY.md), así que hace falta uno. A quién avisa está razonado abajo.
--
-- LO QUE NO SE HACE: anclar el comentario a una página o a un párrafo. Haría
-- falta guardar una posición dentro del fichero, y el fichero puede ser un PDF,
-- un .docx o un enlace a Drive; una posición que no se puede resolver es peor
-- que ninguna. El anclaje es la VERSIÓN, que es la unidad que de verdad existe:
-- «esto, en la v3» se entiende siempre y no se rompe al subir la v4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El trabajo del comentario es el de su versión, sin excepción
-- -----------------------------------------------------------------------------
create or replace function app.enforce_doc_comment_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_work uuid;
begin
  select work_id into v_work from document_versions where id = new.version_id;
  if v_work is null then
    raise exception 'La versión comentada no existe'
      using errcode = 'foreign_key_violation';
  end if;
  -- Se impone, no se comprueba: así un cliente que mande otro `work_id` no
  -- consigue nada, ni siquiera un comentario mal colocado.
  new.work_id := v_work;
  return new;
end;
$$;

drop trigger if exists doccomments_scope on document_comments;
create trigger doccomments_scope
  before insert or update on document_comments
  for each row execute function app.enforce_doc_comment_scope();

-- -----------------------------------------------------------------------------
-- 2. La administración del trabajo también puede comentar
-- -----------------------------------------------------------------------------
alter policy doccomments_insert on document_comments
  with check (
    (app.is_work_member(work_id) or app.is_admin_of_work(work_id))
    and author_id = app.uid()
  );

-- -----------------------------------------------------------------------------
-- 3. A quién avisa un comentario
--
-- A tres grupos, en una sola consulta con UNION (que ya quita duplicados):
--   · quien subió la versión, porque el comentario es sobre su entrega;
--   · quien ya había comentado esa versión, para que el hilo funcione en los
--     dos sentidos: si la dirección comenta y el estudiante responde, la
--     respuesta llega a quien preguntó;
--   · quien valida entregables en ese trabajo, para que un comentario del
--     estudiante no se quede sin leer si la dirección aún no había escrito.
--
-- NO se avisa a todos los participantes del trabajo. En un trabajo con tribunal
-- y codirección, cada comentario sobre un borrador generaría media docena de
-- avisos y el buzón dejaría de significar nada, que es la forma habitual de que
-- las notificaciones se vuelvan invisibles.
--
-- `app.notify` se salta a quien actúa, de modo que nadie se avisa a sí mismo.
-- -----------------------------------------------------------------------------
create or replace function app.notify_doc_comment()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  nombre text;
  etiqueta text;
  quien text;
begin
  select d.name, v.version_label into nombre, etiqueta
    from document_versions v
    join documents d on d.id = v.document_id
   where v.id = new.version_id;

  select p.full_name into quien from profiles p where p.id = new.author_id;

  for destinatario in
        select v.author_id as uid from document_versions v where v.id = new.version_id
    union
        select c.author_id from document_comments c
         where c.version_id = new.version_id and c.id <> new.id
    union
        select m.user_id
          from work_members m
          join work_roles r on r.id = m.work_role_id
         where m.work_id = new.work_id
           and m.status = 'ACTIVE'
           and coalesce((m.permissions->>'can_validate_deliverables')::boolean,
                        r.can_validate_deliverables)
  loop
    perform app.notify(
      destinatario, new.work_id, 'DOCUMENT_COMMENT',
      'Comentario sobre un documento',
      coalesce(quien, 'Alguien') || ' ha comentado ' ||
        coalesce(nombre, 'un documento') || ' · ' || coalesce(etiqueta, 'versión'),
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists doccomments_notify on document_comments;
create trigger doccomments_notify
  after insert on document_comments
  for each row execute function app.notify_doc_comment();

-- -----------------------------------------------------------------------------
-- 4. Privilegios
--
-- El `revoke` en bloque otra vez: `alter default privileges ... revoke` no
-- protege a las funciones futuras (apartado 5 de la 0012), así que las dos
-- funciones nuevas nacen ejecutables por PUBLIC —y `anon` es miembro de
-- PUBLIC— hasta que se cierre aquí. Las de disparador no necesitan EXECUTE:
-- PostgreSQL no lo comprueba al dispararlas, así que no se concede nada.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare
  v_abiertas text;
  n int;
begin
  select count(*) into n from pg_trigger
   where tgname in ('doccomments_scope', 'doccomments_notify');
  if n <> 2 then
    raise exception 'Faltan disparadores de document_comments: hay % de 2', n;
  end if;

  -- La regla de las notificaciones no ha cambiado: las crea la base de datos.
  if exists (
    select 1 from pg_policies where tablename = 'notifications' and cmd = 'INSERT'
  ) then
    raise exception 'notifications tiene politica de INSERT: las notificaciones solo las crean disparadores';
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'document_comments' and policyname = 'doccomments_insert'
      and with_check like '%is_admin_of_work%'
  ) then
    raise exception 'doccomments_insert no admite a la administracion del trabajo';
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0015 correcta: comentarios anclados a la version, con aviso al hilo.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0016_profile_visibility.sql
-- #############################################################################

-- =============================================================================
-- 0016 · Quién puede ver a quién
--
-- EL PROBLEMA
-- `profiles_select` decía: «veo mi perfil y el de cualquiera que comparta
-- organización conmigo». Como este despliegue es UNA organización —el grupo
-- entero—, en la práctica significaba que todo el mundo veía a todo el mundo:
-- nombre, correo, departamento y puesto de los 40 miembros del grupo, también
-- un estudiante de TFG que no tiene relación con nadie salvo su director.
--
-- Eso no es un fallo de pantalla. La pantalla «Personas» era el síntoma; la
-- causa es que la POLÍTICA lo permitía, así que cualquier consulta desde
-- cualquier sitio devolvía lo mismo, y la lista completa de correos del grupo
-- estaba a una petición de distancia de cualquiera con cuenta. Minimizar los
-- datos personales accesibles no se hace ocultando una tabla en el frontend.
--
-- LA REGLA NUEVA: se ve a quien participa en un trabajo que yo puedo ver
--   1. mi propio perfil, siempre;
--   2. quien participa en alguno de los trabajos de `accessible_work_ids()`
--      —los míos, y todos los de la organización si soy administrador—;
--   3. quien pertenece a una organización que yo administro.
--
-- Por qué la 2 se define sobre los TRABAJOS accesibles y no sobre «trabajos
-- donde soy miembro»: porque `wm_select` ya deja leer las filas de
-- `work_members` de esos trabajos. Si `profiles` fuera más estrecho que
-- `work_members`, las pantallas mostrarían participantes sin nombre —filas con
-- un hueco— en lugar de no mostrarlos. Las dos políticas tienen que hablar del
-- mismo conjunto, y ahora lo hacen: una sola expresión, `accessible_work_ids()`.
--
-- POR QUÉ NO SE FILTRA POR `status` DE LA OTRA PERSONA
-- A propósito. Un director que dejó el trabajo el año pasado sigue siendo
-- alguien con quien he trabajado, y su nombre tiene que seguir resolviéndose en
-- las actas, los comentarios y las versiones que firmó. Filtrar por membresía
-- activa convertiría el historial en «Sin nombre», que es peor que inútil:
-- parece un error de datos. Quien SÍ se filtra por actividad es el que mira
-- (dentro de `accessible_work_ids`): si a mí me dieron de baja del trabajo,
-- deja de ser mío y no veo a nadie por esa vía.
--
-- LO QUE ESTO ROMPE, Y CÓMO SE ARREGLA
-- Añadir un participante exige elegir a una persona de una lista, y la lista
-- salía de `profiles`. Un director que no es administrador deja de ver a los
-- codirectores con los que nunca ha coincidido, y no podría añadirlos.
-- La salida NO es devolverle el directorio entero: es
-- `public.find_person_by_email`, que resuelve UN correo exacto. Hay que saber a
-- quién se busca; no se puede pasear por la lista. Es la diferencia entre
-- «localizar a alguien» y «navegar el padrón del grupo».
--
-- `app.shares_organization` se queda, pero ya NO es la regla de visibilidad de
-- perfiles: solo acota la búsqueda por correo al propio grupo.
--
-- LO QUE SIGUE SIENDO VISIBLE PARA CUALQUIERA CON CUENTA (y es correcto)
-- Los catálogos (tipos de trabajo, estados, funciones académicas) y la lista de
-- organizaciones a las que pertenece. No son datos de personas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Los dos predicados de la regla nueva
-- -----------------------------------------------------------------------------

/**
 * ¿`target` participa en algún trabajo que yo pueda ver?
 *
 * SECURITY DEFINER y sin filtro de `status` sobre `target`: ver la cabecera.
 * La recursión no es un problema porque consulta `work_members`, no `profiles`.
 */
create or replace function app.shares_visible_work(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from work_members wm
    where wm.user_id = target
      and wm.work_id in (select app.accessible_work_ids())
  );
$$;

/**
 * ¿Administro alguna organización a la que pertenezca `target`?
 *
 * No vale `is_any_org_admin()`: eso diría «administro algo, luego veo a todo el
 * mundo», y en un despliegue con dos grupos independientes sería falso. Se
 * cruza por organización, que es lo que de verdad autoriza.
 */
create or replace function app.administers_profile(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_members suya
    join organization_members mia on mia.organization_id = suya.organization_id
    where suya.user_id = target
      and mia.user_id = auth.uid()
      and mia.is_active
      and mia.role in ('OWNER', 'ADMIN')
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. La política
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = app.uid()
    or app.shares_visible_work(id)
    or app.administers_profile(id)
  );

-- -----------------------------------------------------------------------------
-- 3. Localizar a una persona por su correo exacto
--
-- Para poder añadir participantes sin abrir el directorio. Tres cautelas:
--
--   a) IGUALDAD, no `like`: con un `%` se enumeraría el grupo entero, que es
--      justo lo que esta migración cierra. Se normaliza a minúsculas y se
--      recortan espacios porque el correo se teclea a mano.
--   b) Solo contesta a quien puede añadir gente a algún trabajo: la
--      administración, o quien tiene `can_manage_members` en algún trabajo
--      activo. A un estudiante le devuelve vacío, no un error: no se le
--      confirma que exista algo que no puede ver.
--   c) Solo encuentra a quien comparte organización con quien pregunta.
--
-- Queda una fuga conocida y asumida: quien puede añadir participantes puede
-- confirmar si una dirección concreta tiene cuenta. Es inevitable para poder
-- buscar, y es muchísimo menos que la lista completa.
-- -----------------------------------------------------------------------------
create or replace function app.can_add_people()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_any_org_admin() or exists (
    select 1
    from work_members wm
    join work_roles r on r.id = wm.work_role_id
    where wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
      and coalesce(
            (wm.permissions ->> 'can_manage_members')::boolean,
            r.can_manage_members
          )
  );
$$;

create or replace function public.find_person_by_email(p_email text)
returns table (id uuid, full_name text, email text, department text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email, p.department
  from profiles p
  where app.can_add_people()
    and p.is_active
    and lower(p.email) = lower(trim(coalesce(p_email, '')))
    and trim(coalesce(p_email, '')) <> ''
    and (p.id = auth.uid() or app.shares_organization(p.id))
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.shares_visible_work(uuid) to authenticated;
grant execute on function app.administers_profile(uuid)  to authenticated;
grant execute on function app.can_add_people()           to authenticated;

revoke all on function public.find_person_by_email(text) from public;
revoke all on function public.find_person_by_email(text) from anon;
grant execute on function public.find_person_by_email(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare v_abiertas text; v_using text;
begin
  v_using := pg_get_expr(
    (select polqual from pg_policy where polname = 'profiles_select'),
    (select polrelid from pg_policy where polname = 'profiles_select')
  );
  if v_using not like '%shares_visible_work%' or v_using not like '%administers_profile%' then
    raise exception 'profiles_select no aplica la regla nueva: %', v_using;
  end if;
  -- La regla antigua no debe quedar como alternativa: con un `or` de sobra,
  -- seguiria viendose todo el grupo y esta migracion no haria nada.
  if v_using like '%shares_organization%' then
    raise exception 'profiles_select sigue dejando ver a toda la organizacion';
  end if;

  if has_function_privilege('anon', 'public.find_person_by_email(text)', 'execute') then
    raise exception 'anon no debe poder buscar personas por correo.';
  end if;
  if not has_function_privilege('authenticated', 'public.find_person_by_email(text)', 'execute') then
    raise exception 'authenticated debe poder buscar personas por correo.';
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0016 correcta: solo se ve a quien participa en un trabajo visible.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0017_avatars.sql
-- #############################################################################

-- =============================================================================
-- 0017 · Fotos de perfil
--
-- QUÉ APORTAN, PARA NO HACERLAS POR DECORACIÓN
-- En un tablero con veinte tarjetas, una cara se reconoce de un vistazo y un
-- nombre hay que leerlo. Es lo único que esto mejora, y basta: `avatar_url` ya
-- existía desde la `0001` y cinco consultas ya la traían; nadie la pintaba.
--
-- LA REGLA DE VISIBILIDAD: LA MISMA QUE LA DEL NOMBRE, LITERALMENTE
-- Una foto es un dato personal más revelador que un nombre, así que proteger la
-- fila y dejar el fichero accesible no protegería nada: se vería la cara de
-- cualquiera con la URL. Por eso la `0016` y esta comparten UNA función,
-- `app.can_see_profile`, que es ahora la única definición de «a quién veo»:
--
--   · mi propio perfil;
--   · quien participa en algún trabajo que yo pueda ver;
--   · quien pertenece a una organización que yo administro.
--
-- `profiles_select` se reescribe para llamarla. No cambia de criterio —es la
-- misma expresión de la `0016` metida en una función con nombre—, y a cambio
-- las dos fronteras (la fila y el fichero) **no pueden** divergir: si algún día
-- se afina la regla, se afina en un sitio. Dos políticas que dicen lo mismo con
-- dos textos distintos son dos políticas que acabarán diciendo cosas distintas.
--
-- EL CUBO ES PRIVADO, y aquí pesa más que en los otros dos. Público en Supabase
-- significa legible por internet entero sin sesión; serían las caras del grupo
-- en una URL abierta, indexable, y este repositorio es público. Se sirven con
-- URL firmada de duración corta.
--
-- POR QUÉ `avatar_url` GUARDA UNA RUTA Y NO UNA URL (pese al nombre)
-- Porque la URL de un cubo privado va firmada y **caduca**: guardarla sería
-- guardar algo que mañana no funciona, y nadie sabría por qué. Se guarda la
-- ruta dentro del cubo y se firma al pintar. La columna no se renombra para no
-- romper cinco consultas y los tipos por un nombre; queda dicho aquí y en el
-- componente. El frontend acepta además una URL `http(s)` por si algún perfil
-- tuviera ya una externa.
--
-- LÍMITE DE 2 MB Y REDIMENSIÓN EN EL NAVEGADOR
-- El plan gratuito da 1 GB de Storage. Una foto de móvil son 4-6 MB: cuarenta
-- personas subiendo la suya se comerían un cuarto del cubo para mostrar
-- círculos de 40 px. El cliente la reduce a 256 px antes de subir (~20 kB) y el
-- cubo rechaza lo que pase de 2 MB, que es el cinturón por si el cliente falla.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La regla de visibilidad, en una sola función
-- -----------------------------------------------------------------------------
create or replace function app.can_see_profile(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select target = auth.uid()
      or app.shares_visible_work(target)
      or app.administers_profile(target);
$$;

-- `profiles_select` pasa a usarla. Mismo criterio que la 0016, un solo sitio.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (app.can_see_profile(id));

-- -----------------------------------------------------------------------------
-- 2. El cubo
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin storage.buckets (entorno de pruebas): se omite el cubo.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars', 'avatars', false,
    2097152,  -- 2 MB. El cliente sube ~20 kB; esto es el tope por si no lo hace.
    array['image/webp', 'image/jpeg', 'image/png']
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'Cubo avatars listo (privado, 2 MB por fichero).';
end $$;

-- -----------------------------------------------------------------------------
-- 3. Autorización de los objetos
--
-- La ruta es `<user_id>/<fichero>`: el primer segmento NO es decorativo, es la
-- llave. Igual que en los cubos de la 0010 y la 0014, cambiar la convención sin
-- cambiar estas funciones abriría el cubo.
-- -----------------------------------------------------------------------------
create or replace function app.avatar_owner(object_name text)
returns uuid language plpgsql immutable
set search_path = public, pg_temp
as $$
declare v uuid;
begin
  -- Si el primer segmento no es un uuid, la ruta no la ha generado esta
  -- aplicación: devuelve null y las dos funciones de abajo deniegan.
  begin
    v := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return null;
  end;
  return v;
end;
$$;

/** Ver la foto de alguien = poder ver su perfil. Una sola regla (apartado 1). */
create or replace function app.can_read_avatar(object_name text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.avatar_owner(object_name) is not null
     and app.can_see_profile(app.avatar_owner(object_name));
$$;

/**
 * Escribir = ser el dueño de la carpeta. Nadie le cambia la foto a nadie.
 *
 * La administración puede BORRAR (abajo, en su propia política) pero no subir:
 * retirar una foto inapropiada es moderación; poner una en nombre de otro no
 * tiene ningún uso legítimo.
 */
create or replace function app.can_write_avatar(object_name text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.avatar_owner(object_name) = auth.uid();
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists avatars_select on storage.objects';
  execute 'drop policy if exists avatars_insert on storage.objects';
  execute 'drop policy if exists avatars_update on storage.objects';
  execute 'drop policy if exists avatars_delete on storage.objects';

  execute $p$
    create policy avatars_select on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and app.can_read_avatar(name))
  $p$;
  execute $p$
    create policy avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and app.can_write_avatar(name))
  $p$;
  execute $p$
    create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and app.can_write_avatar(name))
      with check (bucket_id = 'avatars' and app.can_write_avatar(name))
  $p$;
  -- Borrar: el dueño, o quien administre la organización de ese perfil.
  execute $p$
    create policy avatars_delete on storage.objects for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (
          app.can_write_avatar(name)
          or (app.avatar_owner(name) is not null
              and app.administers_profile(app.avatar_owner(name)))
        )
      )
  $p$;

  raise notice 'Politicas del cubo avatars aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.can_see_profile(uuid)   to authenticated;
grant execute on function app.avatar_owner(text)      to authenticated;
grant execute on function app.can_read_avatar(text)   to authenticated;
grant execute on function app.can_write_avatar(text)  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare v_abiertas text; v_using text; v_publico boolean;
begin
  v_using := pg_get_expr(
    (select polqual from pg_policy where polname = 'profiles_select'),
    (select polrelid from pg_policy where polname = 'profiles_select')
  );
  if v_using not like '%can_see_profile%' then
    raise exception 'profiles_select ya no usa la regla unica: %', v_using;
  end if;

  if to_regclass('storage.buckets') is not null then
    select public into v_publico from storage.buckets where id = 'avatars';
    if v_publico then
      raise exception 'El cubo avatars es PUBLICO: serian las caras del grupo en una URL abierta.';
    end if;
  end if;

  if to_regclass('storage.objects') is not null then
    if (select count(*) from pg_policies
         where tablename = 'objects' and policyname like 'avatars_%') <> 4 then
      raise exception 'Faltan politicas del cubo avatars.';
    end if;
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0017 correcta: la foto se ve exactamente como el nombre.';
end $$;


-- #############################################################################
-- ### supabase/migrations/0018_role_names.sql
-- #############################################################################

-- =============================================================================
-- 0018 · «Director», no «Director principal»
--
-- EL PORQUÉ, que es de lenguaje y no de modelo
-- El catálogo llamaba `Director principal` a la función `PRIMARY_SUPERVISOR`, y
-- ese nombre se pinta tal cual en la pantalla de Personas, en los informes y en
-- los participantes de cada trabajo. En el uso académico real, quien dirige una
-- tesis o un TFG es **el director**, sin apellido: lo de «principal» solo tiene
-- sentido frente a «codirector», y para eso ya está la palabra «codirector».
--
-- LO QUE NO CAMBIA, Y CONVIENE TENERLO CLARO
--   · El `code` sigue siendo `PRIMARY_SUPERVISOR`. Las políticas RLS leen los
--     FLAGS (`is_supervisory`, `can_manage_plan`…), nunca el nombre ni el
--     código, así que esto no toca la seguridad ni por asomo.
--   · `work_members.is_primary` sigue existiendo y significando otra cosa: de
--     entre varias personas con la MISMA función en un trabajo, cuál es la de
--     referencia. Que el nombre de la función ya no diga «principal» no lo
--     vuelve ambiguo; al contrario, deja de competir con él.
--
-- SE ACTUALIZA CON CUIDADO: solo si el nombre sigue siendo el que puso el
-- catálogo inicial. Si alguien lo ha cambiado a mano desde Administración →
-- Catálogos, esta migración no le pisa su decisión. Un `update` incondicional
-- sobre datos que el usuario puede editar es una forma silenciosa de deshacer
-- el trabajo de otro.
-- =============================================================================

update work_roles
   set name = 'Director'
 where code = 'PRIMARY_SUPERVISOR'
   and name = 'Director principal';

do $$
declare v_nombre text;
begin
  select name into v_nombre from work_roles where code = 'PRIMARY_SUPERVISOR';

  if v_nombre is null then
    raise notice 'Migracion 0018: no existe PRIMARY_SUPERVISOR en este despliegue, nada que hacer.';
  elsif v_nombre = 'Director principal' then
    raise exception 'La funcion sigue llamandose «Director principal» y deberia ser «Director».';
  else
    raise notice 'Migracion 0018 correcta: la funcion se llama «%».', v_nombre;
  end if;
end $$;


-- #############################################################################
-- ### supabase/migrations/0019_template_documents.sql
-- #############################################################################

-- =============================================================================
-- 0019 · Documentos previstos en la plantilla
--
-- EL PROBLEMA
-- Una plantilla sabía qué TAREAS hay que hacer y qué material de referencia hay
-- que leer, pero no qué hay que ENTREGAR. Y lo que hay que entregar en un TFG
-- es siempre lo mismo —memoria, anexos, presentación de la defensa— y lo sabe
-- la coordinación, no cada director por su cuenta. Sin esto, cada trabajo
-- empieza con el panel de documentos en blanco y nadie sabe si falta algo hasta
-- que es tarde.
--
-- LA DECISIÓN QUE ESTO REVIERTE, Y CONVIENE LEERLA
-- La 0010 dejó escrito que un documento sin ninguna versión «no significa nada
-- y ensucia el listado», y el formulario de alta llega a borrar la ficha si
-- falla la subida del fichero para no dejarla vacía. A partir de aquí un
-- documento sin versiones SÍ significa algo: «previsto, todavía sin entregar».
-- No es una contradicción, es un significado nuevo: antes solo podía nacer por
-- un error, y ahora nace a propósito. La interfaz tiene que decirlo con esas
-- palabras —«pendiente de entregar»—, porque una ficha vacía sin explicación
-- sigue pareciendo un fallo.
--
-- LO QUE NO SE COPIA
-- El documento del trabajo NO guarda de qué documento previsto salió. El
-- vínculo tarea → plantilla (`tasks.template_task_id`) existe porque de ahí se
-- lee el material de referencia, que vive en la plantilla y se corrige allí. Un
-- documento, en cambio, es del trabajo en cuanto nace: su nombre se cambia, se
-- le suben versiones y se revisa. Guardar el origen solo serviría para sugerir
-- que corregir la plantilla corrige los trabajos ya creados, y no es verdad.
--
-- `is_required` se guarda y se muestra, pero NO bloquea nada: no impide cerrar
-- un trabajo ni mueve ningún indicador. Marcar algo como obligatorio sirve para
-- que se vea que falta, no para que la aplicación se niegue a continuar.
-- =============================================================================

create table if not exists template_documents (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references templates(id) on delete cascade,
  -- El tipo se hereda por el documento creado. Opcional: hay entregables que
  -- no encajan en ninguna categoría del catálogo y obligar a clasificarlos
  -- llenaría el catálogo de categorías de una sola fila.
  document_type_id uuid references document_types(id) on delete set null,
  name             text not null,
  description      text,
  is_required      boolean not null default true,
  order_index      int not null default 0,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  constraint template_documents_name_no_vacio check (length(btrim(name)) > 0)
);

create index if not exists template_documents_template_idx
  on template_documents (template_id, order_index);

-- Dos documentos previstos con el mismo nombre en la misma plantilla crearían
-- uno solo en el trabajo (el alta salta los nombres repetidos), así que el
-- segundo se perdería sin avisar. Mejor no admitirlo.
create unique index if not exists template_documents_nombre_unico
  on template_documents (template_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- Políticas: se lee como `templates`, se escribe como `templates`
--
-- Igual que `template_files` (0014): lo lee cualquier miembro de la
-- organización —es material común, sin datos de nadie— y lo escribe solo quien
-- administra la organización. No hay nada personal aquí: son nombres de
-- entregables.
-- -----------------------------------------------------------------------------
alter table template_documents enable row level security;

drop policy if exists tdocs_select on template_documents;
drop policy if exists tdocs_write on template_documents;

create policy tdocs_select on template_documents for select to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and t.organization_id in (select app.my_org_ids())
  ));

create policy tdocs_write on template_documents for all to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ));

-- -----------------------------------------------------------------------------
-- `app.apply_template` crea también los documentos previstos
--
-- SIGUE SIN SER `security definer`, y sigue siendo el punto importante: la
-- inserción pasa por `docs_insert`, así que los documentos los crea quien
-- podría crearlos a mano. La función no concede nada.
--
-- NO DUPLICA: se salta los nombres que ya existen en el trabajo. Aplicar dos
-- veces una plantilla duplica las tareas —eso ya era así y tiene sentido, son
-- trabajo por hacer— pero no debe duplicar los entregables: «Memoria» es una,
-- y dos fichas con el mismo nombre no se distinguen en el listado.
--
-- El valor devuelto SIGUE SIENDO el número de tareas creadas. Cambiarlo a algo
-- compuesto obligaría a cambiar la firma, el `grant` y la pantalla, y lo único
-- que aporta es un número que la interfaz ya sabe: cuántos documentos tiene la
-- plantilla que acaba de aplicar.
-- -----------------------------------------------------------------------------
create or replace function app.apply_template(p_work uuid, p_template uuid, p_start date default null)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inicio      date;
  v_work_type   uuid;
  v_tpl_type    uuid;
  v_tpl_org     uuid;
  v_work_org    uuid;
  v_fila        record;
  v_nueva       uuid;
  v_padres      jsonb := '{}'::jsonb;   -- order_index de la plantilla -> uuid creado
  v_padre       uuid;
  v_asignado    uuid;
  v_base        int;
  v_total       int := 0;
begin
  -- Se leen trabajo y plantilla a través de RLS a propósito: si quien llama no
  -- puede ver uno de los dos, la función no debe decirle si existe.
  select work_type_id, start_date, organization_id
    into v_work_type, v_inicio, v_work_org
    from academic_works where id = p_work;
  if not found then
    raise exception 'El trabajo no existe o no tienes acceso a él.';
  end if;

  select work_type_id, organization_id into v_tpl_type, v_tpl_org
    from templates where id = p_template and is_active;
  if not found then
    raise exception 'La plantilla no existe, no está activa o no tienes acceso a ella.';
  end if;

  if v_tpl_org <> v_work_org then
    raise exception 'La plantilla pertenece a otra organización.';
  end if;

  -- Una plantilla sin tipo sirve para cualquier trabajo; con tipo, solo para el
  -- suyo. Aplicar la plantilla de un TFG a una tesis daría un plan sin sentido,
  -- y el usuario no tendría forma de saber por qué le ha salido así.
  if v_tpl_type is not null and v_tpl_type <> v_work_type then
    raise exception 'Esa plantilla es de otro tipo de trabajo.';
  end if;

  -- Orden de preferencia para el día cero del plan: lo que pida quien llama,
  -- el inicio real del trabajo, y por último hoy.
  v_inicio := coalesce(p_start, v_inicio, current_date);

  -- `order_index` fija el orden, y `parent_index` apunta al `order_index` del
  -- padre dentro de la MISMA plantilla. Se recorre en orden para que el padre
  -- exista siempre antes que el hijo; si una plantilla apunta hacia adelante,
  -- se dice en vez de dejar la tarea suelta sin avisar.
  select coalesce(max(order_index), -1) + 1 into v_base
    from tasks where work_id = p_work and parent_task_id is null;

  for v_fila in
    select * from template_tasks where template_id = p_template order by order_index
  loop
    v_padre := null;
    if v_fila.parent_index is not null then
      v_padre := (v_padres ->> v_fila.parent_index::text)::uuid;
      if v_padre is null then
        raise exception 'La plantilla está mal formada: la tarea «%» dice depender de la posición % de la plantilla, que todavía no se ha creado. El padre debe ir antes que el hijo.',
          v_fila.title, v_fila.parent_index;
      end if;
    end if;

    -- El responsable se guarda en la plantilla como FUNCIÓN y aquí se resuelve
    -- a la persona que la ejerce en ESTE trabajo. `is_primary` primero: si hay
    -- un director y un codirector, la tarea de supervisión es del primero. Si
    -- nadie tiene esa función, queda sin responsable a propósito: negarse a
    -- crear el plan por eso sería peor.
    v_asignado := null;
    if v_fila.assignee_role_id is not null then
      select wm.user_id into v_asignado
        from work_members wm
       where wm.work_id = p_work
         and wm.work_role_id = v_fila.assignee_role_id
         and wm.status = 'ACTIVE'
       order by wm.is_primary desc, wm.created_at
       limit 1;
    end if;

    insert into tasks (
      work_id, parent_task_id, title, description, priority,
      start_date, due_date, order_index, assignee_id, template_task_id, created_by
    ) values (
      p_work, v_padre, v_fila.title, v_fila.description, v_fila.priority,
      v_inicio + v_fila.offset_days,
      v_inicio + v_fila.offset_days + greatest(v_fila.duration_days, 0),
      v_base + v_fila.order_index, v_asignado, v_fila.id, auth.uid()
    )
    returning id into v_nueva;

    v_padres := v_padres || jsonb_build_object(v_fila.order_index::text, v_nueva);
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Esa plantilla no tiene ninguna tarea.';
  end if;

  -- Los documentos previstos, sin ninguna versión: es la ficha vacía que
  -- significa «pendiente de entregar». La comparación es por nombre
  -- normalizado, y solo ve los documentos NO archivados, porque `docs_select`
  -- filtra `deleted_at is null` y esta función lee a través de RLS. O sea: si
  -- alguien archiva «Memoria» y se vuelve a aplicar la plantilla, «Memoria»
  -- reaparece. Es el precio de no ser `security definer`, y se paga a gusto:
  -- la alternativa es que la función vea filas que quien la llama no ve.
  insert into documents (work_id, document_type_id, name, description, created_by)
  select p_work, td.document_type_id, btrim(td.name), td.description, auth.uid()
    from template_documents td
   where td.template_id = p_template
     and not exists (
       select 1 from documents d
        where d.work_id = p_work
          and lower(btrim(d.name)) = lower(btrim(td.name))
     )
   order by td.order_index;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilegios. El `revoke` en bloque, otra vez: `alter default privileges ...
-- revoke` no protege a las funciones futuras (comprobado contra PostgreSQL 16,
-- apartado 5 de la 0012), y `apply_template` se acaba de recrear.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
do $$
declare
  v_rls      boolean;
  v_pol      int;
  v_cuerpo   text;
  v_definer  boolean;
  v_anon     boolean;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.template_documents'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'template_documents se ha creado SIN row level security.';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname = 'public' and tablename = 'template_documents';
  if v_pol <> 2 then
    raise exception 'template_documents deberia tener 2 politicas y tiene %.', v_pol;
  end if;

  -- El cuerpo para saber QUÉ hace; `prosecdef` para saber CON QUÉ PERMISOS lo
  -- hace. Buscar «security definer» en el texto del cuerpo era el error obvio y
  -- me lo comí: el cuerpo lo menciona en un comentario —justo para explicar que
  -- NO lo es— y la comprobación saltó contra una función correcta.
  select prosrc, prosecdef into v_cuerpo, v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_cuerpo not like '%template_documents%' then
    raise exception 'app.apply_template no crea los documentos previstos.';
  end if;
  if v_definer then
    raise exception 'app.apply_template no debe ser security definer.';
  end if;

  select has_function_privilege('anon', 'app.apply_template(uuid, uuid, date)', 'execute')
    into v_anon;
  if v_anon then
    raise exception 'anon puede ejecutar app.apply_template.';
  end if;

  raise notice 'Migracion 0019 correcta: la plantilla dice tambien que hay que entregar.';
end $$;


-- #############################################################################
-- ### supabase/seed/0001_catalogs.sql
-- #############################################################################

-- =============================================================================
-- seed/0001_catalogs.sql
-- Catálogos iniciales. Ningún dato personal: solo configuración.
-- Todo lo de aquí es editable después desde la interfaz de administración.
-- =============================================================================

insert into academic_levels (code, name, display_order) values
  ('GRADO',     'Grado',     1),
  ('MASTER',    'Máster',    2),
  ('DOCTORADO', 'Doctorado', 3),
  ('OTRO',      'Otro',      4)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de trabajo. Catálogo GLOBAL (organization_id = NULL).
-- Añadir "Prácticas de empresa", "Estancia de investigación", "Beca de
-- colaboración"… es un INSERT desde la UI: ninguna migración, ningún despliegue.
-- -----------------------------------------------------------------------------
insert into work_types (
  organization_id, code, name, short_name, academic_level, color, icon, display_order,
  default_duration_months, requires_defense, requires_deposit, requires_program,
  allows_multiple_students, max_supervisors, counts_toward_workload
) values
  (null, 'TFG',      'Trabajo de Fin de Grado',        'TFG',      'GRADO',     'blue',   'graduation-cap', 1,  9, true,  true,  true,  false, 3, true),
  (null, 'TFM',      'Trabajo de Fin de Máster',       'TFM',      'MASTER',    'violet', 'scroll-text',    2,  9, true,  true,  true,  false, 3, true),
  (null, 'TESIS',    'Tesis doctoral',                 'Tesis',    'DOCTORADO', 'amber',  'book-open',      3, 48, true,  true,  true,  false, 3, true),
  -- Academia de Alumnos Internos (reglas confirmadas por el responsable del
  -- grupo): sin acto de defensa ni depósito oficial, sin titulación asociada,
  -- duración igual que un TFG (9 meses) y una memoria final como entregable
  -- principal, además de entregables opcionales.
  (null, 'ACADEMIA', 'Academia de Alumnos Internos',   'Academia', 'GRADO',     'emerald','users',          4,  9, false, false, false, false, 2, true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Estados del trabajo
-- -----------------------------------------------------------------------------
insert into work_statuses (code, name, color, display_order, is_terminal) values
  ('PROPUESTA',          'Propuesta',             'slate',   1, false),
  ('ASIGNADO',           'Asignado',              'sky',     2, false),
  ('EN_PLANIFICACION',   'En planificación',      'cyan',    3, false),
  ('EN_DESARROLLO',      'En desarrollo',         'blue',    4, false),
  ('EN_REVISION',        'En revisión',           'amber',   5, false),
  ('PENDIENTE_DEPOSITO', 'Pendiente de depósito', 'orange',  6, false),
  ('DEFENDIDO',          'Defendido',             'emerald', 7, false),
  ('FINALIZADO',         'Finalizado',            'green',   8, true),
  ('CANCELADO',          'Cancelado',             'red',     9, true)
on conflict (code) do nothing;

-- Ciclo de vida restringido SOLO para ACADEMIA (sin depósito ni defensa).
-- Los tipos sin filas aquí admiten todos los estados activos.
insert into work_type_statuses (work_type_id, status_id, display_order)
select wt.id, ws.id, ws.display_order
from work_types wt
join work_statuses ws on ws.code in (
  'PROPUESTA','ASIGNADO','EN_PLANIFICACION','EN_DESARROLLO','EN_REVISION','FINALIZADO','CANCELADO'
)
where wt.code = 'ACADEMIA' and wt.organization_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Funciones académicas. Las políticas RLS leen los FLAGS, no el `code`:
-- un rol nuevo funciona correctamente sin reescribir seguridad.
-- -----------------------------------------------------------------------------
insert into work_roles (
  code, name, is_student, is_supervisory,
  can_manage_plan, can_see_private_notes, can_validate_deliverables, can_manage_members,
  display_order
) values
  ('PRIMARY_SUPERVISOR', 'Director',          false, true,  true,  true,  true,  true,  1),
  ('CO_SUPERVISOR',      'Codirector',         false, true,  true,  true,  true,  false, 2),
  ('COLLABORATOR',       'Colaborador',        false, true,  false, false, false, false, 3),
  ('STUDENT',            'Estudiante',         true,  false, false, false, false, false, 4)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de documento (catálogo global)
-- -----------------------------------------------------------------------------
insert into document_types (organization_id, code, name, display_order) values
  (null, 'PROPUESTA',      'Propuesta inicial',            1),
  (null, 'PLAN',           'Plan de trabajo',              2),
  (null, 'ESTADO_ARTE',    'Estado del arte',              3),
  (null, 'MEMORIA',        'Memoria',                      4),
  (null, 'ARTICULO',       'Artículo científico',          5),
  (null, 'PRESENTACION',   'Presentación',                 6),
  (null, 'DATOS',          'Datos y resultados',           7),
  (null, 'ADMINISTRATIVO', 'Documentación administrativa', 8),
  (null, 'OTRO',           'Otros',                        9)
on conflict do nothing;
