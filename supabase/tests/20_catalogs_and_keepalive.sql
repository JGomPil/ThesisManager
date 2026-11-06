-- NO SE CONCEDEN PERMISOS AQUÍ A PROPÓSITO.
--
-- Antes este fichero hacía:
--     grant usage on schema public, app to authenticated, anon;
--     grant select, insert, update, delete on all tables in schema public to authenticated;
--     grant execute on all functions in schema app to authenticated;
--
-- Es decir: las pruebas concedían exactamente los permisos que tenían que
-- estar verificando, y por tanto no verificaban nada. Así se escapó el fallo
-- real de `app.has_work_capability`, cuyo EXECUTE la migración 0003 revocaba a
-- `public` sin devolvérselo a `authenticated`. En producción dejó el resumen y
-- la ficha de trabajo sin datos; aquí las 31 pruebas seguían en verde.
--
-- Ahora el estado de permisos lo fijan solo dos cosas, las mismas que en
-- producción: los ALTER DEFAULT PRIVILEGES de Supabase que emula el harness
-- (00_harness.sql) y lo que concedan las propias migraciones (0004, 0006, 0007).

\echo '================ CATÁLOGO DE TIPOS ================'
\echo '[8] Tipos precargados'
select code, short_name, academic_level, requires_defense as defensa,
       requires_deposit as deposito, default_duration_months as meses
from work_types order by display_order;

\echo '[9] Estados permitidos para ACADEMIA (sin deposito ni defensa)'
select s.code from work_type_statuses ts
join work_statuses s on s.id = ts.status_id
join work_types t on t.id = ts.work_type_id
where t.code = 'ACADEMIA' order by ts.display_order;

\echo '[10] Estados para TFG (sin filas en work_type_statuses => todos aplican)'
select count(*) as filas_restriccion from work_type_statuses ts
join work_types t on t.id = ts.work_type_id where t.code = 'TFG';

-- Un ADMINISTRADOR crea un tipo nuevo desde la interfaz, sin migración.
set role authenticated;
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
\echo '[11] Un ADMIN crea el tipo "PRACTICAS" (esperado: 1 fila insertada)'
insert into work_types (organization_id, code, name, short_name, academic_level,
                        display_order, default_duration_months, requires_defense,
                        requires_deposit, requires_program)
values ('aaaaaaaa-0000-0000-0000-000000000001','PRACTICAS','Prácticas de empresa',
        'Prácticas','GRADO', 5, 6, false, false, false)
returning code, name;

\echo '[12] Un ADMIN lo usa inmediatamente en un trabajo nuevo'
insert into academic_works (organization_id, work_type_id, status_id, title)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='PRACTICAS'),
       (select id from work_statuses where code='PROPUESTA'),
       'Prácticas en empresa — estudiante ficticio'
returning title;

-- Un usuario SIN rol administrativo no puede tocar el catálogo.
set session "test.uid" = '33333333-3333-3333-3333-333333333333';
\echo '[13] Un ESTUDIANTE intenta crear un tipo (esperado: violación de RLS)'
do $$
begin
  insert into work_types (organization_id, code, name, short_name, display_order)
  values ('aaaaaaaa-0000-0000-0000-000000000001','FALSO','Tipo no autorizado','X', 99);
  raise notice 'FALLO DE SEGURIDAD: el estudiante ha podido crear un tipo';
exception when insufficient_privilege then
  raise notice 'CORRECTO: RLS ha bloqueado la insercion del estudiante';
end $$;

\echo '[14] El estudiante SI puede leer el catalogo (lo necesita en los selectores)'
select count(*) as tipos_visibles from work_types;

-- No se puede borrar un tipo en uso.
reset role;
\echo '[15] Borrar un tipo en uso (esperado: error de clave foránea)'
do $$
begin
  delete from work_types where code = 'TFG';
  raise notice 'FALLO: se ha podido borrar un tipo en uso';
exception when foreign_key_violation then
  raise notice 'CORRECTO: ON DELETE RESTRICT protege los trabajos historicos';
end $$;

\echo '================ KEEPALIVE ================'
set role anon;
set session "test.uid" = '';
\echo '[16] anon puede leer keepalive (esperado: 1 fila)'
select id, label from keepalive;
\echo '[17] anon NO puede modificar keepalive (esperado: violación de RLS)'
do $$
begin
  update keepalive set note = 'manipulado' where id = 1;
  if not found then raise notice 'CORRECTO: 0 filas afectadas, RLS bloquea el UPDATE'; end if;
exception when insufficient_privilege then
  raise notice 'CORRECTO: sin privilegio de UPDATE para anon';
end $$;
\echo '[18] anon NO puede leer ninguna otra tabla (esperado: error)'
do $$
begin
  perform count(*) from profiles;
  raise notice 'FALLO DE SEGURIDAD: anon ha leido profiles';
exception when insufficient_privilege then
  raise notice 'CORRECTO: anon no tiene acceso a profiles';
end $$;
