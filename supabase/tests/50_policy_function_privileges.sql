-- =============================================================================
-- Privilegios de las funciones que invocan las políticas de RLS
--
-- POR QUÉ EXISTE ESTE FICHERO
-- Un `revoke` suelto al final de la migración 0003 quitaba el EXECUTE de
-- `app.has_work_capability` al pseudo-rol `public` sin devolvérselo a
-- `authenticated`. La política `wm_write` de `work_members` la invoca
-- directamente, y como el resumen y la ficha de trabajo embeben esa tabla, en
-- producción las dos pantallas se quedaron sin datos con
-- «permission denied for function has_work_capability».
--
-- Las 31 pruebas anteriores no lo vieron por DOS razones independientes, y las
-- dos quedan cubiertas aquí:
--
--   1. Los propios ficheros de prueba hacían
--      `grant execute on all functions in schema app to authenticated`,
--      concediendo el permiso que debían estar comprobando. Ya retirado.
--
--   2. Ninguna prueba leía ni escribía `work_members` como `authenticated`.
--      Las llamadas a `has_work_capability` desde DENTRO de otra función
--      SECURITY DEFINER (como `app.can_manage_plan`) se ejecutan con los
--      privilegios del propietario de esa función, así que NO dan error: el
--      fallo solo aparece cuando una política la invoca directamente.
--
-- La prueba [32] es estructural y es la importante: en lugar de comprobar
-- casos uno a uno, lee las políticas reales de `pg_policy`, extrae cada
-- función del esquema `app` que invocan y exige que `authenticated` pueda
-- ejecutarla. Así cubre también las políticas de las fases siguientes
-- (`document_versions` ya depende de esto) sin tener que acordarse de nada.
-- =============================================================================

\echo '================ PRIVILEGIOS DE LAS FUNCIONES DE LAS POLITICAS ================'

\echo '[32] Toda funcion de `app` invocada por una politica es ejecutable por authenticated'
do $$
declare
  faltan text;
begin
  with expresiones as (
    select pg_get_expr(pol.polqual, pol.polrelid) as e from pg_policy pol
    union all
    select pg_get_expr(pol.polwithcheck, pol.polrelid) from pg_policy pol
  ),
  invocadas as (
    select distinct m[1] as fn
    from expresiones, regexp_matches(coalesce(e, ''), 'app\.([a-z_]+)\(', 'g') as m
  )
  select string_agg(distinct p.oid::regprocedure::text, ', ')
    into faltan
  from invocadas i
  join pg_proc p on p.proname = i.fn
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'app'
  where not has_function_privilege('authenticated', p.oid, 'execute');

  if faltan is not null then
    raise exception 'FALLO [32]: las politicas invocan funciones que authenticated no puede ejecutar: %', faltan;
  end if;
  raise notice 'CORRECTO: todas las funciones invocadas por politicas son ejecutables';
end $$;

\echo '[33] ...y ninguna de ellas es ejecutable por anon'
do $$
declare
  sobran text;
begin
  select string_agg(distinct p.oid::regprocedure::text, ', ')
    into sobran
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'app'
  where has_function_privilege('anon', p.oid, 'execute');
  if sobran is not null then
    raise exception 'FALLO [33]: anon puede ejecutar funciones de app: %', sobran;
  end if;
  raise notice 'CORRECTO: anon no puede ejecutar ninguna funcion de app';
end $$;

-- -----------------------------------------------------------------------------
-- Y ahora el caso concreto que rompió en producción, de extremo a extremo:
-- leer y escribir `work_members`, que es lo que hacen el resumen y la ficha.
-- Reutiliza los datos de 10_roles_and_privacy.sql (mismo contenedor).
-- -----------------------------------------------------------------------------

\echo '[34] El director LEE los participantes de su trabajo (lo que embebe la ficha)'
set role authenticated;
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
select count(*) as participantes_visibles
from work_members
where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;

\echo '[35] El director principal AÑADE un participante (politica wm_write)'
set role authenticated;
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
insert into work_members (work_id, user_id, work_role_id)
select 'bbbbbbbb-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444',
       (select id from work_roles where code='COLLABORATOR');
select count(*) as participantes_tras_alta
from work_members
where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;

\echo '[36] El estudiante NO puede anadir participantes (esperado: bloqueado)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into work_members (work_id, user_id, work_role_id)
    select 'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
           (select id from work_roles where code='COLLABORATOR');
    raise exception 'FALLO [36]: el estudiante ha podido anadir un participante';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: RLS impide al estudiante anadir participantes';
  end;
end $$;
reset role;
