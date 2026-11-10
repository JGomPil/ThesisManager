-- =============================================================================
-- Fase 3: planificación avanzada (migración 0012)
--
-- El criterio de aceptación de la fase es «aplicar una plantilla a un trabajo
-- genera el plan completo con fechas relativas correctas». Aquí se comprueba
-- eso y, sobre todo, las tres cosas que la interfaz NO puede garantizar:
--
--   · que no se puede crear un ciclo de dependencias (que colgaría a cualquiera
--     que recorra el grafo, no solo a esta aplicación);
--   · que una tarea no puede depender de una tarea de otro trabajo;
--   · que aplicar una plantilla sigue siendo cosa de quien puede planificar,
--     porque `app.apply_template` NO es `security definer`.
--
-- Datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización
--   investigador = 2222...  director principal de TFG-01 / doctorando de TESIS-02
--   estudiante   = 3333...  estudiante de TFG-01
--   TFG-01   = bbbb...0001   TESIS-02 = bbbb...0002
-- =============================================================================

\echo '================ FASE 3: PLANIFICACION AVANZADA ================'

-- Tres tareas en TFG-01 y una en TESIS-02 para montar el grafo.
delete from task_dependencies;
delete from tasks where title like 'DEP-%';
insert into tasks (id, work_id, title) values
  ('dddd0001-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','DEP-A'),
  ('dddd0001-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','DEP-B'),
  ('dddd0001-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','DEP-C'),
  ('dddd0002-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','DEP-OTRO');

\echo '[76] Una dependencia normal SI se puede crear (la regla no es excesiva)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into task_dependencies (task_id, depends_on_task_id)
  values ('dddd0001-0000-0000-0000-000000000001','dddd0001-0000-0000-0000-000000000002');
  reset role;
  if not exists (select 1 from task_dependencies
                 where task_id = 'dddd0001-0000-0000-0000-000000000001') then
    raise exception 'FALLO [76]: no se ha creado la dependencia valida';
  end if;
  raise notice 'CORRECTO: A depende de B';
end $$;
reset role;

\echo '[77] El ciclo directo A->B->A es rechazado'
do $$
declare ciclo boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into task_dependencies (task_id, depends_on_task_id)
    values ('dddd0001-0000-0000-0000-000000000002','dddd0001-0000-0000-0000-000000000001');
  exception when others then ciclo := true;
  end;
  reset role;
  -- Se afirma el ESTADO, no la excepción: una fila que no se inserta porque RLS
  -- la filtra tampoco lanza error, y esa confusión ya costó un falso positivo
  -- en la prueba [45].
  if exists (select 1 from task_dependencies
             where task_id = 'dddd0001-0000-0000-0000-000000000002'
               and depends_on_task_id = 'dddd0001-0000-0000-0000-000000000001') then
    raise exception 'FALLO [77]: se ha creado un ciclo A->B->A';
  end if;
  if not ciclo then
    raise exception 'FALLO [77]: el ciclo no ha dado error (habria quedado en silencio)';
  end if;
  raise notice 'CORRECTO: ciclo directo rechazado con error';
end $$;
reset role;

\echo '[78] El ciclo largo A->B->C->A tambien, y el mensaje lo explica'
do $$
declare mensaje text;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  -- B depende de C: cadena A->B->C, todavia sin ciclo.
  insert into task_dependencies (task_id, depends_on_task_id)
  values ('dddd0001-0000-0000-0000-000000000002','dddd0001-0000-0000-0000-000000000003');
  begin
    -- C depende de A: cierra el circulo de tres.
    insert into task_dependencies (task_id, depends_on_task_id)
    values ('dddd0001-0000-0000-0000-000000000003','dddd0001-0000-0000-0000-000000000001');
  exception when others then mensaje := sqlerrm;
  end;
  reset role;
  if exists (select 1 from task_dependencies
             where task_id = 'dddd0001-0000-0000-0000-000000000003') then
    raise exception 'FALLO [78]: se ha creado un ciclo de tres nodos';
  end if;
  if mensaje is null or mensaje not like '%ciclo%' then
    raise exception 'FALLO [78]: mensaje poco claro: %', coalesce(mensaje, '(ninguno)');
  end if;
  raise notice 'CORRECTO: ciclo de tres nodos rechazado';
end $$;
reset role;

\echo '[79] Una tarea NO puede depender de una tarea de otro trabajo'
do $$
declare mensaje text;
begin
  -- Lo intenta la ADMINISTRACION, que puede planificar en los dos trabajos y
  -- por tanto PASA la politica. Si esto se permitiera, el Gantt de un trabajo
  -- mostraria un vinculo hacia una fila que su equipo no puede ver.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    insert into task_dependencies (task_id, depends_on_task_id)
    values ('dddd0001-0000-0000-0000-000000000001','dddd0002-0000-0000-0000-000000000001');
  exception when others then mensaje := sqlerrm;
  end;
  reset role;
  if exists (select 1 from task_dependencies
             where depends_on_task_id = 'dddd0002-0000-0000-0000-000000000001') then
    raise exception 'FALLO [79]: se ha cruzado una dependencia entre trabajos';
  end if;
  if mensaje is null or mensaje not like '%MISMO trabajo%' then
    raise exception 'FALLO [79]: mensaje poco claro: %', coalesce(mensaje, '(ninguno)');
  end if;
  raise notice 'CORRECTO: dependencias entre trabajos distintos rechazadas';
end $$;
reset role;

\echo '[80] El estudiante NO puede crear dependencias (el plan lo ordena la direccion)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into task_dependencies (task_id, depends_on_task_id)
    values ('dddd0001-0000-0000-0000-000000000003','dddd0001-0000-0000-0000-000000000002');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from task_dependencies
             where task_id = 'dddd0001-0000-0000-0000-000000000003'
               and depends_on_task_id = 'dddd0001-0000-0000-0000-000000000002') then
    raise exception 'FALLO [80]: el estudiante ha creado una dependencia';
  end if;
  raise notice 'CORRECTO: el estudiante no ordena el plan';
end $$;
reset role;

\echo '[81] El hito cumplido recibe fecha de la base de datos, y al revertirlo la pierde'
do $$
declare v_met timestamptz; v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Deposito', current_date + 30)
  returning id into v_id;

  -- Se marca cumplido SIN tocar met_at: lo pone el disparador.
  update milestones set is_met = true where id = v_id;
  select met_at into v_met from milestones where id = v_id;
  if v_met is null then
    raise exception 'FALLO [81]: hito cumplido sin fecha de cumplimiento';
  end if;

  update milestones set is_met = false where id = v_id;
  select met_at into v_met from milestones where id = v_id;
  if v_met is not null then
    raise exception 'FALLO [81]: hito pendiente con fecha de cumplimiento';
  end if;
  reset role;
  raise notice 'CORRECTO: is_met y met_at no pueden desincronizarse';
end $$;
reset role;

-- CAMBIO DE DOCTRINA EN LA 0030: antes esta prueba exigia que el estudiante NO
-- escribiese hitos. Un hito es un compromiso de quien hace el trabajo —el
-- deposito, la defensa, el envio del articulo—, y quien lo cumple es quien
-- sabe cuando va a poder cumplirlo. Lo que sigue intacto, y por eso [79]-[81]
-- no se tocan, es el disparador que impide desincronizar `is_met` y `met_at`:
-- el alumno escribe sus hitos, pero no se da uno por cumplido a mano.
\echo '[82] El estudiante VE y ESCRIBE los hitos de su trabajo'
do $$
declare visibles int; v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into visibles from milestones
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Hito del alumno', current_date + 10)
  returning id into v_id;
  update milestones set due_date = current_date + 25 where id = v_id;
  reset role;

  if visibles < 1 then
    raise exception 'FALLO [82]: el estudiante no ve los hitos de su propio trabajo';
  end if;
  if not exists (select 1 from milestones
                  where id = v_id and due_date = current_date + 25) then
    raise exception 'FALLO [82]: el estudiante no ha podido poner ni mover su hito';
  end if;

  -- Y se deja el trabajo como estaba, que es lo que esperan las pruebas de
  -- recuento que vienen detras.
  delete from milestones where id = v_id;
  raise notice 'CORRECTO: los hitos los escribe tambien quien los cumple';
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Plantillas
-- -----------------------------------------------------------------------------
\echo '[83] Solo la administracion crea plantillas'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into templates (id, organization_id, name)
    values ('eeee0000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','De un director');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from templates where id = 'eeee0000-0000-0000-0000-000000000009') then
    raise exception 'FALLO [83]: un director ha creado una plantilla de la organizacion';
  end if;

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into templates (id, organization_id, work_type_id, name)
  select 'eeee0000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
         (select id from work_types where code='TFG'), 'Plan estandar de TFG';
  -- Dos tareas de primer nivel y una subtarea de la primera.
  insert into template_tasks (template_id, title, offset_days, duration_days, order_index, parent_index)
  values
    ('eeee0000-0000-0000-0000-000000000001','Revision bibliografica', 0, 30, 0, null),
    ('eeee0000-0000-0000-0000-000000000001','Leer 10 articulos',      0, 10, 1, 0),
    ('eeee0000-0000-0000-0000-000000000001','Redaccion de la memoria',60, 45, 2, null);
  reset role;
  raise notice 'CORRECTO: la plantilla la crea la administracion';
end $$;
reset role;

\echo '[84] La direccion aplica la plantilla: fechas relativas y jerarquia correctas'
do $$
declare creadas int; v_inicio date := date '2027-01-11'; v_padre uuid; v_hija uuid;
begin
  delete from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                      and title in ('Revision bibliografica','Leer 10 articulos','Redaccion de la memoria');
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select app.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                            'eeee0000-0000-0000-0000-000000000001', v_inicio)
    into creadas;
  reset role;

  if creadas <> 3 then
    raise exception 'FALLO [84]: ha creado % tareas, se esperaban 3', creadas;
  end if;

  select id into v_padre from tasks
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and title = 'Revision bibliografica';
  select id into v_hija from tasks
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and title = 'Leer 10 articulos';

  -- offset_days = 0, duration_days = 30 desde el 11/01/2027.
  if (select start_date from tasks where id = v_padre) <> v_inicio
     or (select due_date from tasks where id = v_padre) <> v_inicio + 30 then
    raise exception 'FALLO [84]: fechas relativas mal calculadas (% a %)',
      (select start_date from tasks where id = v_padre),
      (select due_date   from tasks where id = v_padre);
  end if;

  -- offset_days = 60 en la tercera.
  if (select start_date from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
        and title = 'Redaccion de la memoria') <> v_inicio + 60 then
    raise exception 'FALLO [84]: el desplazamiento de 60 dias no se ha aplicado';
  end if;

  -- `parent_index` apunta al order_index del padre DENTRO de la plantilla y
  -- debe haberse resuelto al uuid real.
  if (select parent_task_id from tasks where id = v_hija) is distinct from v_padre then
    raise exception 'FALLO [84]: la jerarquia de la plantilla no se ha resuelto';
  end if;
  raise notice 'CORRECTO: plan completo, fechas relativas y jerarquia';
end $$;
reset role;

\echo '[85] El ESTUDIANTE no puede aplicar una plantilla (apply_template no es security definer)'
do $$
declare antes int; despues int;
begin
  select count(*) into antes from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    perform app.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                               'eeee0000-0000-0000-0000-000000000001', current_date);
  exception when others then null;
  end;
  reset role;
  select count(*) into despues from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if despues <> antes then
    raise exception 'FALLO [85]: el estudiante ha creado % tareas con la plantilla', despues - antes;
  end if;
  raise notice 'CORRECTO: la plantilla no esquiva las politicas de tasks';
end $$;
reset role;

\echo '[86] Una plantilla de OTRO tipo de trabajo se rechaza'
do $$
declare mensaje text; antes int; despues int;
begin
  select count(*) into antes from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    -- La plantilla es de TFG; TESIS-02 es una tesis.
    perform app.apply_template('bbbbbbbb-0000-0000-0000-000000000002',
                               'eeee0000-0000-0000-0000-000000000001', current_date);
  exception when others then mensaje := sqlerrm;
  end;
  reset role;
  select count(*) into despues from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if despues <> antes then
    raise exception 'FALLO [86]: ha aplicado una plantilla de otro tipo de trabajo';
  end if;
  if mensaje is null or mensaje not like '%otro tipo%' then
    raise exception 'FALLO [86]: mensaje poco claro: %', coalesce(mensaje, '(ninguno)');
  end if;
  raise notice 'CORRECTO: la plantilla respeta el tipo de trabajo';
end $$;
reset role;

\echo '[87] Una plantilla mal formada no deja medio plan creado (es atomica)'
do $$
declare antes int; despues int; mensaje text;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into templates (id, organization_id, name)
  values ('eeee0000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Plantilla rota');
  -- La primera tarea es valida; la segunda apunta a una posicion posterior que
  -- todavia no existe. Si la funcion no fuera atomica, quedaria la primera.
  insert into template_tasks (template_id, title, order_index, parent_index) values
    ('eeee0000-0000-0000-0000-000000000002','Tarea buena', 0, null),
    ('eeee0000-0000-0000-0000-000000000002','Tarea huerfana', 1, 7);
  reset role;

  select count(*) into antes from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000003';
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    perform app.apply_template('bbbbbbbb-0000-0000-0000-000000000003',
                               'eeee0000-0000-0000-0000-000000000002', current_date);
  exception when others then mensaje := sqlerrm;
  end;
  reset role;
  select count(*) into despues from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000003';

  if despues <> antes then
    raise exception 'FALLO [87]: ha quedado medio plan creado (% tareas)', despues - antes;
  end if;
  if mensaje is null or mensaje not like '%mal formada%' then
    raise exception 'FALLO [87]: mensaje poco claro: %', coalesce(mensaje, '(ninguno)');
  end if;
  raise notice 'CORRECTO: o el plan entero o nada';
end $$;
reset role;

\echo '[88] anon no puede ejecutar app.apply_template'
do $$
begin
  if has_function_privilege('anon', 'app.apply_template(uuid,uuid,date)', 'execute') then
    raise exception 'FALLO [88]: anon puede aplicar plantillas';
  end if;
  if not has_function_privilege('authenticated', 'app.apply_template(uuid,uuid,date)', 'execute') then
    raise exception 'FALLO [88]: authenticated NO puede aplicar plantillas';
  end if;
  raise notice 'CORRECTO: solo authenticated';
end $$;
reset role;

\echo '[89] La envoltura public.apply_template funciona y no concede nada extra'
do $$
declare creadas int; antes int; despues int;
begin
  -- Es la que de verdad usa el navegador: PostgREST no ve el esquema `app`.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select public.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                               'eeee0000-0000-0000-0000-000000000001', date '2027-03-01')
    into creadas;
  reset role;
  if creadas <> 3 then
    raise exception 'FALLO [89]: la envoltura ha creado % tareas', creadas;
  end if;

  -- Y el estudiante sigue sin poder, que es lo que importa: la envoltura no
  -- lleva security definer, asi que no es una puerta de atras.
  select count(*) into antes from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    perform public.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                                  'eeee0000-0000-0000-0000-000000000001', current_date);
  exception when others then null;
  end;
  reset role;
  select count(*) into despues from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if despues <> antes then
    raise exception 'FALLO [89]: el estudiante ha aplicado la plantilla por la envoltura';
  end if;
  raise notice 'CORRECTO: la envoltura es solo un reenvio';
end $$;
reset role;
