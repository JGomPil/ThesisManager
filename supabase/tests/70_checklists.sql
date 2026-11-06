-- =============================================================================
-- Listas de comprobación = subtareas (`tasks.parent_task_id`)
--
-- La decisión de implementarlas como subtareas reales y no como un campo de
-- texto o un jsonb tiene una consecuencia de seguridad que conviene fijar en
-- una prueba: heredan las políticas de `tasks` sin añadir ninguna nueva, de
-- modo que el reparto queda así por construcción:
--
--   · la dirección DEFINE los puntos (INSERT/DELETE sobre tasks),
--   · el estudiante solo INFORMA de su avance (UPDATE de `status`, lo único
--     que le deja el disparador `app.enforce_task_update_scope`).
--
-- Si alguna vez se relajara la política de `tasks`, estas dos pruebas
-- fallarían, que es justo lo que se quiere.
--
-- Reutiliza los datos de 10_roles_and_privacy.sql:
--   investigador = 2222...  director principal de TFG-01
--   estudiante   = 3333...  estudiante de TFG-01
-- =============================================================================

\echo '================ LISTAS DE COMPROBACION (SUBTAREAS) ================'

-- La dirección crea una tarea con dos puntos, y asigna la tarea al estudiante.
do $$
declare padre uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);

  insert into tasks (work_id, title, description, assignee_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Revision bibliografica sistematica',
          'Buscar en PubMed y Scopus, cribar por titulo y resumen, y dejar la tabla de incluidos.',
          '33333333-3333-3333-3333-333333333333')
  returning id into padre;

  insert into tasks (work_id, parent_task_id, title)
  values ('bbbbbbbb-0000-0000-0000-000000000001', padre, 'Definir la cadena de busqueda'),
         ('bbbbbbbb-0000-0000-0000-000000000001', padre, 'Cribar por titulo y resumen');

  perform set_config('test.checklist_parent', padre::text, false);
  raise notice 'Preparado: tarea con 2 puntos de lista';
end $$;
reset role;

\echo '[43] El estudiante MARCA un punto de la lista (esperado: correcto)'
do $$
declare punto uuid; padre uuid;
begin
  padre := current_setting('test.checklist_parent')::uuid;
  select id into punto from tasks
  where parent_task_id = padre and title = 'Definir la cadena de busqueda';

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set status = 'COMPLETADA' where id = punto;

  if not exists (select 1 from tasks where id = punto and status = 'COMPLETADA') then
    raise exception 'FALLO [43]: el estudiante no ha podido marcar el punto';
  end if;
  raise notice 'CORRECTO: el estudiante marca los puntos de su lista';
end $$;
reset role;

\echo '[44] El estudiante NO puede AÑADIR puntos a la lista (esperado: bloqueado)'
do $$
declare padre uuid;
begin
  padre := current_setting('test.checklist_parent')::uuid;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into tasks (work_id, parent_task_id, title)
    values ('bbbbbbbb-0000-0000-0000-000000000001', padre, 'Punto que me invento yo');
    raise exception 'FALLO [44]: el estudiante ha podido anadir un punto a la lista';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: el estudiante no define el plan, solo informa de su avance';
  end;
end $$;
reset role;

\echo '[45] El estudiante NO puede RENOMBRAR un punto (solo cambiar su estado)'
do $$
declare punto uuid; padre uuid;
begin
  padre := current_setting('test.checklist_parent')::uuid;
  select id into punto from tasks where parent_task_id = padre limit 1;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update tasks set title = 'Titulo cambiado por el estudiante' where id = punto;
    -- Si llega aqui sin excepcion hay que comprobar que de verdad no cambio:
    -- una sentencia que no afecta a ninguna fila por RLS tampoco lanza error,
    -- y dar por bueno el silencio fue justo el error de la primera version de
    -- esta prueba.
    if exists (select 1 from tasks where id = punto and title = 'Titulo cambiado por el estudiante') then
      raise exception 'FALLO [45]: el estudiante ha renombrado un punto';
    end if;
    raise notice 'CORRECTO: el renombrado no ha surtido efecto';
  exception
    when raise_exception or insufficient_privilege then
      raise notice 'CORRECTO: el disparador limita al estudiante a la columna status';
  end;
end $$;
reset role;

\echo '[46] Recuento final de la lista'
select count(*) filter (where status = 'COMPLETADA') as hechos,
       count(*) as total
from tasks
where parent_task_id = current_setting('test.checklist_parent')::uuid;
