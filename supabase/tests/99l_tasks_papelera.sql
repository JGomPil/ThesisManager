-- =============================================================================
-- La papelera de tareas (migracion 0025)
--
-- QUE SE JUEGA AQUI
-- Borrar una tarea era `delete from tasks`: definitivo, en cascada sobre sus
-- subtareas y de un clic. Ahora es archivar, y lo que hay que fijar son las dos
-- formas de que un archivado deje de serlo sin que nadie se entere:
--
--   1. Que lo archivado no lo vea NADIE, ni quien lo archivo. Entonces no hay
--      vuelta atras y es un borrado con otro nombre. Es ademas lo que haria
--      fallar el propio UPDATE: PostgreSQL exige que la fila resultante siga
--      siendo visible para quien lo ejecuta.
--   2. Que archivar una tarea deje sus subtareas sueltas: sin padre visible no
--      las ve nadie, pero siguen contando en cualquier consulta que las sume.
--
-- Datos de los ficheros anteriores:
--   investigador = 2222...  director de TFG-01 (puede planificar)
--   estudiante   = 3333...  estudiante de TFG-01, responsable de la tarea
--   tarea        = dddd...0001 en TFG-01
-- =============================================================================

-- Una subtarea de la tarea de siempre, para la cascada.
insert into tasks (id, work_id, parent_task_id, title, created_by)
values ('dddddddd-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001','Punto de la lista',
        '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

\echo '================ PAPELERA DE TAREAS ================'

\echo '[172] Quien planifica archiva una tarea, la SIGUE VIENDO y la restaura'
do $$
declare v_visible int; v_sub timestamptz;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set deleted_at = now() where id = 'dddddddd-0000-0000-0000-000000000001';

  -- La ve: si no la viera, no podria restaurarla —y el propio UPDATE de arriba
  -- habria fallado con «new row violates row-level security policy».
  select count(*) into v_visible from tasks
   where id = 'dddddddd-0000-0000-0000-000000000001' and deleted_at is not null;
  reset role;
  if v_visible <> 1 then
    raise exception 'FALLO [172]: quien archiva no ve lo archivado: no hay vuelta atras';
  end if;

  -- Y se lleva la subtarea, que si no se queda suelta.
  select deleted_at into v_sub from tasks where id = 'dddddddd-0000-0000-0000-00000000000a';
  if v_sub is null then
    raise exception 'FALLO [172]: la subtarea se ha quedado suelta';
  end if;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set deleted_at = null where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  if (select deleted_at from tasks where id = 'dddddddd-0000-0000-0000-000000000001') is not null then
    raise exception 'FALLO [172]: no se ha podido restaurar';
  end if;
  if (select deleted_at from tasks where id = 'dddddddd-0000-0000-0000-00000000000a') is not null then
    raise exception 'FALLO [172]: la subtarea no ha vuelto con su tarea';
  end if;
  raise notice 'CORRECTO [172]';
end $$;

\echo '[173] El estudiante NO archiva su tarea, y tampoco ve la que esta archivada'
do $$
declare v_archivada boolean := false; v_ve int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update tasks set deleted_at = now() where id = 'dddddddd-0000-0000-0000-000000000001';
    v_archivada := true;
  exception when others then null;
  end;
  reset role;
  if v_archivada or (select deleted_at from tasks where id = 'dddddddd-0000-0000-0000-000000000001') is not null then
    raise exception 'FALLO DE SEGURIDAD [173]: el estudiante ha archivado una tarea del plan';
  end if;

  -- Y lo que esta en la papelera es cosa de quien planifica: el estudiante ni
  -- la ve, para que no le aparezcan tareas fantasma en su lista.
  --
  -- Lo archiva el DIRECTOR, no el rol por defecto: `enforce_task_update_scope`
  -- es un disparador, asi que tambien se aplica a una sesion que no pasa por
  -- RLS, y sin nadie identificado `app.can_manage_plan` es falso. Es decir: una
  -- sesion administrativa sin usuario tampoco puede archivar, que es correcto y
  -- conviene saberlo antes de escribir un guion de mantenimiento.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set deleted_at = now() where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_ve from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  if v_ve <> 0 then
    raise exception 'FALLO [173]: el estudiante ve una tarea archivada';
  end if;
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set deleted_at = null where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  raise notice 'CORRECTO [173]';
end $$;

\echo '[174] El borrado definitivo sigue ahi, y sigue siendo de quien planifica'
do $$
declare v_borrado boolean := false;
begin
  -- Una tarea de usar y tirar: la de siempre la leen las pruebas de abajo.
  insert into tasks (id, work_id, title, created_by)
  values ('dddddddd-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000001',
          'Tarea de la papelera','22222222-2222-2222-2222-222222222222');

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  delete from tasks where id = 'dddddddd-0000-0000-0000-00000000000b';
  reset role;
  if (select count(*) from tasks where id = 'dddddddd-0000-0000-0000-00000000000b') = 0 then
    raise exception 'FALLO DE SEGURIDAD [174]: el estudiante ha borrado una tarea';
  end if;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  delete from tasks where id = 'dddddddd-0000-0000-0000-00000000000b';
  v_borrado := (select count(*) from tasks where id = 'dddddddd-0000-0000-0000-00000000000b') = 0;
  reset role;
  if not v_borrado then
    raise exception 'FALLO [174]: quien planifica no ha podido vaciar la papelera';
  end if;

  -- Se deja el plan como estaba.
  delete from tasks where id = 'dddddddd-0000-0000-0000-00000000000a';
  raise notice 'CORRECTO [174]';
end $$;
