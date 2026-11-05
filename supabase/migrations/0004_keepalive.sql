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
