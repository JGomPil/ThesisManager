\echo '================ ALCANCE DE EDICIÓN DE TAREAS ================'
insert into tasks (id, work_id, title, assignee_id, created_by, due_date)
values ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        'Revisión bibliográfica','33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', current_date + 30);

set role authenticated;
set session "test.uid" = '33333333-3333-3333-3333-333333333333';   -- estudiante

\echo '[19] El estudiante cambia el ESTADO de su tarea (esperado: correcto)'
do $$
begin
  update tasks set status = 'EN_CURSO' where id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice 'CORRECTO: el estudiante puede actualizar el estado';
exception when others then
  raise notice 'FALLO: %', sqlerrm;
end $$;

\echo '[20] El estudiante intenta mover la FECHA LÍMITE (esperado: rechazado)'
do $$
begin
  update tasks set due_date = current_date + 365 where id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice 'FALLO DE SEGURIDAD: el estudiante ha cambiado la fecha limite';
exception when others then
  raise notice 'CORRECTO: %', sqlerrm;
end $$;

\echo '[21] El estudiante intenta reasignar la tarea a otra persona (esperado: rechazado)'
do $$
begin
  update tasks set assignee_id = '22222222-2222-2222-2222-222222222222'
  where id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice 'FALLO DE SEGURIDAD: reasignacion permitida';
exception when others then
  raise notice 'CORRECTO: %', sqlerrm;
end $$;

\echo '[22] El estudiante intenta crear una tarea (esperado: bloqueado por RLS)'
do $$
begin
  insert into tasks (work_id, title) values ('bbbbbbbb-0000-0000-0000-000000000001','Tarea no autorizada');
  raise notice 'FALLO DE SEGURIDAD: el estudiante ha creado una tarea';
exception when insufficient_privilege then
  raise notice 'CORRECTO: RLS impide crear tareas al estudiante';
end $$;

set session "test.uid" = '22222222-2222-2222-2222-222222222222';   -- director
\echo '[23] El director SÍ puede cambiar la fecha límite (esperado: correcto)'
do $$
begin
  update tasks set due_date = current_date + 45 where id = 'dddddddd-0000-0000-0000-000000000001';
  raise notice 'CORRECTO: el director gestiona la planificacion';
exception when others then
  raise notice 'FALLO: %', sqlerrm;
end $$;

\echo '[24] Estado final de la tarea'
select title, status, due_date = current_date + 45 as fecha_actualizada_por_director from tasks;
