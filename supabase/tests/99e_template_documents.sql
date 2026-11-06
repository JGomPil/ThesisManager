-- =============================================================================
-- Documentos previstos en la plantilla (migración 0019)
--
-- QUÉ SE JUEGA AQUÍ
-- Una fila de `template_documents` no pertenece a ningún trabajo —como el
-- material de plantilla de la 0014— así que no puede apoyarse en
-- `app.accessible_work_ids()`. Y lo que crea al aplicarse SÍ pertenece a un
-- trabajo. O sea: la frontera cambia de naturaleza a mitad de camino, y es ahí
-- donde se cuelan los fallos.
--
-- La prueba central es [138]: los documentos previstos los crea `apply_template`
-- SIN `security definer`, así que los crea quien podría crearlos a mano. Si
-- alguna vez alguien le pone `security definer` para «arreglar» algo, esa
-- prueba y la [85] son las que deben saltar.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion
--   investigador = 2222...  director de TFG-01, NO administrador
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno total  = 5555...  miembro de la organizacion, de ningun trabajo
--   TFG-01 = bbbb...0001    organizacion = aaaa...0001
-- =============================================================================

\echo '================ DOCUMENTOS PREVISTOS EN LA PLANTILLA ================'

-- Plantilla propia, creada sin RLS: lo que se prueba es su contenido y lo que
-- pasa al aplicarla, no quién puede crear plantillas (eso es la [100]).
insert into templates (id, organization_id, work_type_id, name)
select 'eeee0003-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='TFG'), 'PLANTILLA-CON-ENTREGABLES'
on conflict (id) do nothing;

insert into template_tasks (id, template_id, title, offset_days, duration_days, order_index)
values ('eeef0003-0000-0000-0000-000000000003','eeee0003-0000-0000-0000-000000000003',
        'PREV-Tarea unica', 0, 10, 0)
on conflict (id) do nothing;

\echo '[136] La administracion define los documentos previstos; un director NO'
do $$
declare v_admin boolean := false; v_director boolean := false; v_n int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    insert into template_documents (id, template_id, document_type_id, name, description,
                                    is_required, order_index, created_by)
    select 'eeed0001-0000-0000-0000-000000000001','eeee0003-0000-0000-0000-000000000003',
           (select id from document_types order by code limit 1),
           'PREV-Memoria', 'La memoria final, en PDF.', true, 0,
           '11111111-1111-1111-1111-111111111111';
    insert into template_documents (id, template_id, name, is_required, order_index, created_by)
    values ('eeed0002-0000-0000-0000-000000000002','eeee0003-0000-0000-0000-000000000003',
            'PREV-Anexos', false, 1, '11111111-1111-1111-1111-111111111111');
    v_admin := true;
  exception when others then v_admin := false;
  end;

  -- El director del trabajo no administra la organizacion: la plantilla es de
  -- la coordinacion, no de cada director.
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into template_documents (template_id, name)
    values ('eeee0003-0000-0000-0000-000000000003','PREV-Colada');
    v_director := true;
  exception when insufficient_privilege or check_violation then v_director := false;
  end;
  reset role;

  select count(*) into v_n from template_documents
   where template_id = 'eeee0003-0000-0000-0000-000000000003';

  if not v_admin then
    raise exception 'FALLO [136]: la administracion no ha podido definir los entregables';
  end if;
  if v_director then
    raise exception 'FALLO [136]: un director ha podido escribir en la plantilla';
  end if;
  if v_n <> 2 then
    raise exception 'FALLO [136]: la plantilla tiene % entregables, se esperaban 2', v_n;
  end if;
  raise notice 'CORRECTO: los entregables los define quien administra la organizacion';
end $$;
reset role;

\echo '[137] Un estudiante SI los lee: es material comun, sin datos de nadie'
do $$
declare v int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v from template_documents
   where template_id = 'eeee0003-0000-0000-0000-000000000003';
  reset role;

  if v <> 2 then
    raise exception 'FALLO [137]: el estudiante ve % entregables previstos, se esperaban 2', v;
  end if;
  raise notice 'CORRECTO: saber que hay que entregar no es un secreto';
end $$;
reset role;

\echo '[138] Aplicar la plantilla crea los documentos previstos, SIN ninguna version'
do $$
declare v_docs int; v_versiones int; v_tipo uuid; v_tipo_doc uuid;
begin
  delete from documents where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                          and name like 'PREV-%';

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  perform app.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                             'eeee0003-0000-0000-0000-000000000003', date '2027-03-01');
  reset role;

  select count(*) into v_docs from documents
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and name like 'PREV-%';
  select count(*) into v_versiones from document_versions dv
    join documents d on d.id = dv.document_id
   where d.work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and d.name like 'PREV-%';
  select document_type_id into v_tipo from documents
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and name = 'PREV-Memoria';
  select document_type_id into v_tipo_doc from template_documents
   where id = 'eeed0001-0000-0000-0000-000000000001';

  if v_docs <> 2 then
    raise exception 'FALLO [138]: ha creado % documentos, se esperaban 2', v_docs;
  end if;
  -- La ficha vacia es el dato: significa «previsto, todavia sin entregar».
  if v_versiones <> 0 then
    raise exception 'FALLO [138]: los documentos previstos han nacido con % versiones', v_versiones;
  end if;
  if v_tipo is distinct from v_tipo_doc then
    raise exception 'FALLO [138]: el tipo de documento no se ha heredado de la plantilla';
  end if;
  raise notice 'CORRECTO: el trabajo nace sabiendo lo que tiene que entregar';
end $$;
reset role;

\echo '[139] Aplicarla dos veces NO duplica los entregables (aunque si repita tareas)'
do $$
declare v_docs int; v_tareas_antes int; v_tareas_despues int;
begin
  select count(*) into v_tareas_antes from tasks
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and title = 'PREV-Tarea unica';

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  perform app.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                             'eeee0003-0000-0000-0000-000000000003', date '2027-03-01');
  reset role;

  select count(*) into v_docs from documents
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and name like 'PREV-%';
  select count(*) into v_tareas_despues from tasks
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and title = 'PREV-Tarea unica';

  if v_docs <> 2 then
    raise exception 'FALLO [139]: tras aplicarla dos veces hay % documentos, se esperaban 2', v_docs;
  end if;
  -- Esto NO es un descuido: una tarea repetida es trabajo por hacer y se ve;
  -- dos fichas con el mismo nombre en el listado de documentos no se distinguen.
  if v_tareas_despues <= v_tareas_antes then
    raise exception 'FALLO [139]: la segunda aplicacion no ha creado tareas (% -> %)',
      v_tareas_antes, v_tareas_despues;
  end if;
  raise notice 'CORRECTO: los entregables no se duplican, las tareas si';
end $$;
reset role;

\echo '[140] Un documento previsto se cumple: el estudiante le sube su primera version'
do $$
declare v_doc uuid; v_subidas int;
begin
  select id into v_doc from documents
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001' and name = 'PREV-Memoria';

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into document_versions (document_id, work_id, version_label, external_url, author_id)
  values (v_doc, 'bbbbbbbb-0000-0000-0000-000000000001', 'v1',
          'https://ejemplo.invalid/memoria.pdf', '33333333-3333-3333-3333-333333333333');
  get diagnostics v_subidas = row_count;
  reset role;

  if v_subidas <> 1 then
    raise exception 'FALLO [140]: la version no se ha insertado (% filas)', v_subidas;
  end if;
  raise notice 'CORRECTO: la ficha vacia no es un callejon, se rellena entregando';
end $$;
reset role;

\echo '[141] Dos entregables con el mismo nombre en una plantilla: rechazado'
do $$
declare v_repetido boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    -- Con distinta caja y espacios, que es como se cuela de verdad.
    insert into template_documents (template_id, name)
    values ('eeee0003-0000-0000-0000-000000000003','  prev-memoria  ');
    v_repetido := true;
  exception when unique_violation then v_repetido := false;
  end;
  reset role;

  if v_repetido then
    raise exception 'FALLO [141]: se admite un entregable repetido, y el segundo se perderia al aplicar';
  end if;
  raise notice 'CORRECTO: un nombre repetido se rechaza al definirlo, no al aplicarlo';
end $$;
reset role;

\echo '[142] anon no ve ni escribe los entregables de una plantilla'
do $$
declare v int; v_denegado boolean := false; v_escritura boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  begin
    select count(*) into v from template_documents;
  exception when insufficient_privilege then v_denegado := true;
  end;
  begin
    insert into template_documents (template_id, name)
    values ('eeee0003-0000-0000-0000-000000000003','PREV-Anonima');
    v_escritura := true;
  exception when insufficient_privilege or check_violation then v_escritura := false;
  end;
  reset role;

  if not v_denegado and v <> 0 then
    raise exception 'FALLO [142]: anon ve % entregables', v;
  end if;
  if v_escritura then
    raise exception 'FALLO [142]: anon ha escrito en template_documents';
  end if;
  raise notice 'CORRECTO: sin sesion no hay plantilla';
end $$;
reset role;
