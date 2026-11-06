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
  ('PRIMARY_SUPERVISOR', 'Director principal', false, true,  true,  true,  true,  true,  1),
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
