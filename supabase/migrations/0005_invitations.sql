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
