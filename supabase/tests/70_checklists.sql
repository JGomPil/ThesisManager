-- =============================================================================
-- Listas de comprobación = subtareas (`tasks.parent_task_id`)
--
-- La decisión de implementarlas como subtareas reales y no como un campo de
-- texto o un jsonb tiene una consecuencia de seguridad que conviene fijar en
-- una prueba: heredan las políticas de `tasks` sin añadir ninguna nueva, de
-- modo que el reparto queda así por construcción:
--
--   · cualquiera con `can_manage_plan` define lo que quiera,
--   · y DESDE LA 0030, el responsable de la tarea escribe y renombra los
--     puntos de SU lista: una lista de comprobación se piensa escribiéndola, y
--     pedir turno para añadir un punto la inutiliza. QUITAR un punto, no: eso
--     es archivarlo, y lo archivado solo lo ve quien planifica (0025), así que
--     sería una acción sin vuelta atrás para quien la hace. Una errata se
--     arregla renombrando.
--
-- LO QUE NO CAMBIÓ, y es lo que vigilan [44] y [45]: eso vale para los puntos
-- de una tarea PROPIA. En la tarea de otro, el estudiante sigue pudiendo solo
-- lo de antes. El límite no es «ser estudiante», es de quién es la tarea.
--
-- Si alguna vez se relajara la política de `tasks` más allá de eso, estas
-- pruebas fallarían, que es justo lo que se quiere.
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

-- CAMBIO DE DOCTRINA EN LA 0030: antes esto estaba prohibido.
\echo '[44] El estudiante ANADE un punto a la lista de SU tarea, y no a la de otro'
do $$
declare padre uuid; ajena uuid; v_colado boolean := false;
begin
  padre := current_setting('test.checklist_parent')::uuid;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into tasks (work_id, parent_task_id, title)
  values ('bbbbbbbb-0000-0000-0000-000000000001', padre, 'Punto que escribo yo');
  reset role;

  if not exists (
    select 1 from tasks where parent_task_id = padre and title = 'Punto que escribo yo'
  ) then
    raise exception 'FALLO [44]: el estudiante no ha podido escribir su lista';
  end if;

  -- Y ahora el limite: una tarea del mismo trabajo que NO es suya. Sin la
  -- comprobacion del responsable en `app.is_checklist_point_of_mine`, bastaria
  -- con ser miembro para colgar puntos de la tarea de cualquiera.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into tasks (id, work_id, title, assignee_id)
  values ('dddddddd-0000-0000-0000-000000000044','bbbbbbbb-0000-0000-0000-000000000001',
          'Tarea del director', '22222222-2222-2222-2222-222222222222')
  returning id into ajena;
  reset role;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into tasks (work_id, parent_task_id, title)
    values ('bbbbbbbb-0000-0000-0000-000000000001', ajena, 'Punto en tarea ajena');
    v_colado := true;
  exception
    when insufficient_privilege then null;
  end;
  reset role;

  if v_colado then
    raise exception 'FALLO DE SEGURIDAD [44]: ha colgado un punto de la tarea de otro';
  end if;
  raise notice 'CORRECTO [44]: escribe su lista, y solo la suya';
end $$;
reset role;

-- CAMBIO DE DOCTRINA EN LA 0030, y de paso se arregla la prueba: la version
-- anterior capturaba `raise_exception`, que es justo el codigo con el que ella
-- misma levantaba su propio «FALLO [45]». Es decir, se tragaba su propio fallo
-- y decia CORRECTO pasara lo que pasara. Aqui no hay captura alrededor de la
-- afirmacion: lo que se comprueba es el DATO.
\echo '[45] El estudiante RENOMBRA un punto de su lista, y no lo quita'
do $$
declare punto uuid; padre uuid; v_quito boolean := false;
begin
  padre := current_setting('test.checklist_parent')::uuid;
  select id into punto from tasks
   where parent_task_id = padre and title = 'Punto que escribo yo';

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set title = 'Punto con el titulo corregido' where id = punto;
  reset role;

  if not exists (select 1 from tasks where id = punto and title = 'Punto con el titulo corregido') then
    raise exception 'FALLO [45]: el estudiante no ha podido corregir un punto suyo';
  end if;

  -- Y EL LIMITE, que lo encontro la propia base de datos. Quitar un punto es
  -- ARCHIVARLO (0025), y `tasks_select` solo ensena lo archivado a quien tiene
  -- `can_manage_plan`. Asi que la fila resultante deja de ser visible para el
  -- estudiante y PostgreSQL rechaza el UPDATE por su cuenta: «new row violates
  -- row-level security policy». No se deja asi por no poder arreglarlo, sino
  -- porque arreglarlo seria darle una papelera que no es suya o un borrado
  -- irreversible. El disparador lo dice ahora en voz alta, con su mensaje.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update tasks set deleted_at = now() where id = punto;
    v_quito := true;
  exception when others then null;
  end;
  reset role;

  if v_quito or (select deleted_at from tasks where id = punto) is not null then
    raise exception 'FALLO [45]: el estudiante ha archivado un punto que no podra recuperar';
  end if;
  raise notice 'CORRECTO [45]: corrige los puntos de su lista, y no los archiva';
end $$;
reset role;

\echo '[46] Recuento final de la lista'
select count(*) filter (where status = 'COMPLETADA') as hechos,
       count(*) as total
from tasks
where parent_task_id = current_setting('test.checklist_parent')::uuid;
