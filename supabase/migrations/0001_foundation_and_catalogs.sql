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
