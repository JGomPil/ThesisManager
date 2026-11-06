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
-- =============================================================================
-- Prueba del núcleo de seguridad: roles no excluyentes + notas privadas.
-- Emula el escenario 5 del prompt.
-- =============================================================================

-- auth.uid() suplantable y los permisos de rol los aporta 00_harness.sql.

-- --- Datos de prueba (ficticios) ---------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@test.invalid'),
  ('22222222-2222-2222-2222-222222222222','investigador@test.invalid'),
  ('33333333-3333-3333-3333-333333333333','estudiante@test.invalid'),
  ('44444444-4444-4444-4444-444444444444','ajeno@test.invalid');

insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001','GIB-UVa','gib-uva');

insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ADMIN'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','MEMBER'),
  ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','MEMBER'),
  ('aaaaaaaa-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','MEMBER');

-- TFG-01 dirigido por el investigador; TESIS-02 donde ESE MISMO investigador
-- es el doctorando (estudiante de su propia tesis).
insert into academic_works (id, organization_id, work_type_id, status_id, title)
select 'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='TFG'),
       (select id from work_statuses where code='EN_DESARROLLO'), 'TFG-01';
insert into academic_works (id, organization_id, work_type_id, status_id, title)
select 'bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='TESIS'),
       (select id from work_statuses where code='EN_DESARROLLO'), 'TESIS-02';
insert into academic_works (id, organization_id, work_type_id, status_id, title)
select 'bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='ACADEMIA'),
       (select id from work_statuses where code='EN_DESARROLLO'), 'ACADEMIA-03';

insert into work_members (work_id, user_id, work_role_id, is_primary)
select 'bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
       (select id from work_roles where code='PRIMARY_SUPERVISOR'), true;
insert into work_members (work_id, user_id, work_role_id, is_primary)
select 'bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
       (select id from work_roles where code='STUDENT'), true;
-- El investigador es ESTUDIANTE (doctorando) de su propia tesis...
insert into work_members (work_id, user_id, work_role_id, is_primary)
select 'bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
       (select id from work_roles where code='STUDENT'), true;
-- ...y a la vez tiene una función de supervisión en ella (caso límite real:
-- co-dirige formalmente un trabajo en el que también figura como estudiante).
insert into work_members (work_id, user_id, work_role_id)
select 'bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
       (select id from work_roles where code='CO_SUPERVISOR');

insert into meetings (id, work_id, title, scheduled_at) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Reunión TFG-01', now()),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Reunión TESIS-02', now());

insert into meeting_private_notes (meeting_id, work_id, author_id, content) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222','Nota privada sobre el estudiante del TFG-01'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111','Nota privada del comité sobre el doctorando');

\echo '================ RESULTADOS ================'

set role authenticated;

-- [1] El investigador ve sus 2 trabajos (uno como director, otro como doctorando)
set session "test.uid" = '22222222-2222-2222-2222-222222222222';
\echo '[1] Investigador: trabajos visibles (esperado: TFG-01, TESIS-02)'
select title from academic_works order by title;

-- [2] Ve la nota privada del TFG que dirige
\echo '[2] Investigador: notas privadas visibles (esperado: SOLO la del TFG-01)'
select w.title, left(n.content, 30) as nota
from meeting_private_notes n join academic_works w on w.id = n.work_id order by w.title;

-- [3] El estudiante del TFG solo ve su trabajo y ninguna nota privada
set session "test.uid" = '33333333-3333-3333-3333-333333333333';
\echo '[3] Estudiante: trabajos visibles (esperado: solo TFG-01)'
select title from academic_works order by title;
\echo '[4] Estudiante: notas privadas (esperado: 0 filas)'
select count(*) as filas from meeting_private_notes;

-- [5] Usuario de la organización sin relación con ningún trabajo
set session "test.uid" = '44444444-4444-4444-4444-444444444444';
\echo '[5] Usuario ajeno: trabajos visibles (esperado: 0 filas)'
select count(*) as filas from academic_works;

-- [6] El administrador ve todo
set session "test.uid" = '11111111-1111-1111-1111-111111111111';
\echo '[6] Administrador: trabajos visibles (esperado: 3)'
select count(*) as filas from academic_works;

-- [7] Sin sesión, con el rol anon: nada
reset role;
set role anon;
set session "test.uid" = '';
\echo '[7] anon: academic_works (esperado: sin acceso)'
-- Se comprueba dentro de un bloque con manejo de excepciones en lugar de
-- dejar que psql escupa el ERROR: así cualquier linea `ERROR:` que aparezca
-- en la salida es un fallo de verdad, y el runner puede abortar por ella.
do $$
declare n bigint;
begin
  begin
    select count(*) into n from academic_works;
    if n > 0 then
      raise exception 'FALLO [7]: anon ve % trabajos', n;
    end if;
    raise notice 'CORRECTO: anon no ve ningun trabajo (RLS, 0 filas)';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: anon no tiene privilegio sobre academic_works';
  end;
end $$;
