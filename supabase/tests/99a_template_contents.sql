-- =============================================================================
-- Plantillas completas: tareas con responsable por función y material adjunto
-- (migración 0014)
--
-- QUÉ SE JUEGA AQUÍ
-- El material de plantilla es lo único del sistema que se comparte a propósito
-- entre trabajos distintos: un guion o una rúbrica que leen todos los
-- estudiantes de ese tipo. Eso lo hace cómodo y peligroso a la vez, porque es
-- la primera vez que una fila no pertenece a un trabajo y no puede apoyarse en
-- `app.accessible_work_ids()`. Si la frontera se pone mal, o un estudiante no
-- ve el guion que debe leer, o un director de otra organización ve material
-- ajeno. Las dos cosas se comprueban abajo.
--
-- La prueba [108] no comprueba que algo falle, sino que algo FUNCIONA de una
-- manera peligrosa: borrar una tarea de plantilla deja sin material a las
-- tareas ya creadas desde ella y no da ningún error. Está escrita para que ese
-- comportamiento quede documentado y para que salte si alguien cambia el
-- `on delete set null`; es la razón de que la interfaz avise antes de borrar.
--
-- Datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización
--   investigador = 2222...  director PRINCIPAL de TFG-01, NO administrador
--   estudiante   = 3333...  estudiante de TFG-01
--   TFG-01 = bbbb...0001    organización = aaaa...0001
-- Nadie ejerce CO_SUPERVISOR en TFG-01: es el caso de la prueba [107].
-- =============================================================================

\echo '================ PLANTILLAS COMPLETAS: TAREAS Y MATERIAL ================'

-- Plantilla de partida, creada sin RLS: lo que se prueba es su contenido.
insert into templates (id, organization_id, work_type_id, name)
select 'eeee0001-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
       (select id from work_types where code='TFG'), 'PLANTILLA-COMPLETA'
on conflict (id) do nothing;

-- Una segunda plantilla para comprobar que el material no se puede cruzar.
insert into templates (id, organization_id, name)
values ('eeee0002-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','PLANTILLA-OTRA')
on conflict (id) do nothing;

\echo '[101] La administracion crea una tarea de plantilla COMPLETA y le adjunta material'
do $$
declare v_desc text; v_rol uuid; v_mat int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  insert into template_tasks (id, template_id, title, description, offset_days, duration_days,
                              order_index, assignee_role_id)
  select 'eeef0001-0000-0000-0000-000000000001','eeee0001-0000-0000-0000-000000000001',
         'Revision de la memoria', 'Leer la memoria y rellenar la rubrica.', 30, 7, 0,
         (select id from work_roles where code='PRIMARY_SUPERVISOR');

  insert into template_files (id, template_id, template_task_id, title, storage_path, created_by)
  values ('eeea0001-0000-0000-0000-000000000001','eeee0001-0000-0000-0000-000000000001',
          'eeef0001-0000-0000-0000-000000000001','Rubrica de evaluacion',
          'eeee0001-0000-0000-0000-000000000001/eeea0001-0000-0000-0000-000000000001/rubrica.pdf',
          '11111111-1111-1111-1111-111111111111');
  reset role;

  select description, assignee_role_id into v_desc, v_rol
    from template_tasks where id = 'eeef0001-0000-0000-0000-000000000001';
  select count(*) into v_mat from template_files
   where template_task_id = 'eeef0001-0000-0000-0000-000000000001';
  if v_desc is null or v_rol is null then
    raise exception 'FALLO [101]: la tarea de plantilla no guarda descripcion o responsable';
  end if;
  if v_mat <> 1 then
    raise exception 'FALLO [101]: material adjunto = %, se esperaba 1', v_mat;
  end if;
  raise notice 'CORRECTO: la plantilla guarda en que consiste, quien lo hace y con que material';
end $$;
reset role;

\echo '[102] Un director NO puede adjuntar material a una plantilla'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into template_files (id, template_id, title, external_url)
    values ('eeea0009-0000-0000-0000-000000000009','eeee0001-0000-0000-0000-000000000001',
            'Material colado','https://ejemplo.invalid/colado.pdf');
  exception when others then null;
  end;
  reset role;
  -- Un INSERT que RLS rechaza lanza error, pero se comprueba el ESTADO: si
  -- alguna vez la politica dejara pasar la fila sin error, esto lo veria.
  if exists (select 1 from template_files where id = 'eeea0009-0000-0000-0000-000000000009') then
    raise exception 'FALLO [102]: un director ha adjuntado material a una plantilla';
  end if;
  raise notice 'CORRECTO: el material de plantilla lo pone la administracion';
end $$;
reset role;

\echo '[103] El estudiante SI ve el material: es material de referencia para el'
do $$
declare v int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v from template_files
   where template_id = 'eeee0001-0000-0000-0000-000000000001';
  reset role;
  if v <> 1 then
    raise exception 'FALLO [103]: el estudiante ve % materiales, se esperaba 1', v;
  end if;
  raise notice 'CORRECTO: el estudiante puede leer el guion que debe seguir';
end $$;
reset role;

\echo '[104] anon NO llega al material: ni privilegio de tabla, ni filas'
do $$
declare v int; v_denegado boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  -- Dos barreras, y basta con la que salte primero:
  --  · el privilegio de tabla, que `template_files` NO recibe porque la 0006
  --    canceló el `grant` por defecto de Supabase (y por eso sigue cerrada una
  --    tabla creada ocho migraciones después, sin tocar la 0006);
  --  · la política `tfiles_select`, que exige pertenecer a la organización.
  begin
    select count(*) into v from template_files;
  exception when insufficient_privilege then
    v_denegado := true;
  end;
  reset role;
  if not v_denegado and v <> 0 then
    raise exception 'FALLO [104]: anon ve % materiales', v;
  end if;
  if v_denegado then
    raise notice 'CORRECTO: anon no tiene ni privilegio de tabla sobre template_files';
  else
    raise notice 'CORRECTO: anon tiene privilegio de tabla pero la politica no le da ninguna fila';
  end if;
end $$;
reset role;

\echo '[105] El material no puede vincularse a una tarea de OTRA plantilla'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    insert into template_files (id, template_id, template_task_id, title, external_url)
    values ('eeea0008-0000-0000-0000-000000000008','eeee0002-0000-0000-0000-000000000002',
            'eeef0001-0000-0000-0000-000000000001','Material cruzado',
            'https://ejemplo.invalid/cruzado.pdf');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from template_files where id = 'eeea0008-0000-0000-0000-000000000008') then
    raise exception 'FALLO [105]: una plantilla ha adjuntado el material de otra';
  end if;
  raise notice 'CORRECTO: el disparador impide cruzar plantillas';
end $$;
reset role;

-- Dos tareas mas para la aplicacion: una del estudiante y una de una funcion
-- que NADIE ejerce en TFG-01.
insert into template_tasks (id, template_id, title, offset_days, duration_days, order_index, assignee_role_id)
select 'eeef0001-0000-0000-0000-000000000002','eeee0001-0000-0000-0000-000000000001',
       'Entrega de la memoria', 60, 1, 1, (select id from work_roles where code='STUDENT')
on conflict (id) do nothing;
insert into template_tasks (id, template_id, title, offset_days, duration_days, order_index, assignee_role_id)
select 'eeef0001-0000-0000-0000-000000000003','eeee0001-0000-0000-0000-000000000001',
       'Informe del codirector', 70, 3, 2, (select id from work_roles where code='CO_SUPERVISOR')
on conflict (id) do nothing;

\echo '[106] Al aplicar la plantilla, cada tarea cae en quien ejerce esa funcion'
do $$
declare v_sup uuid; v_est uuid; v_enlace uuid; v_total int;
begin
  delete from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
    and title in ('Revision de la memoria','Entrega de la memoria','Informe del codirector');

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select app.apply_template('bbbbbbbb-0000-0000-0000-000000000001',
                            'eeee0001-0000-0000-0000-000000000001',
                            '2026-01-01') into v_total;
  reset role;

  if v_total <> 3 then
    raise exception 'FALLO [106]: se han creado % tareas, se esperaban 3', v_total;
  end if;
  select assignee_id, template_task_id into v_sup, v_enlace
    from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                 and title = 'Revision de la memoria';
  select assignee_id into v_est
    from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                 and title = 'Entrega de la memoria';
  if v_sup <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'FALLO [106]: la revision no es del director principal (es de %)', v_sup;
  end if;
  if v_est <> '33333333-3333-3333-3333-333333333333' then
    raise exception 'FALLO [106]: la entrega no es del estudiante (es de %)', v_est;
  end if;
  if v_enlace <> 'eeef0001-0000-0000-0000-000000000001' then
    raise exception 'FALLO [106]: la tarea no recuerda de que tarea de plantilla sale';
  end if;
  raise notice 'CORRECTO: responsable resuelto por funcion y material enlazado';
end $$;
reset role;

\echo '[107] Si nadie ejerce esa funcion, la tarea se crea SIN responsable (no falla)'
do $$
declare v_asig uuid; v_hay boolean;
begin
  select assignee_id, true into v_asig, v_hay
    from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                 and title = 'Informe del codirector';
  if not coalesce(v_hay, false) then
    raise exception 'FALLO [107]: la tarea del codirector no se ha creado';
  end if;
  if v_asig is not null then
    raise exception 'FALLO [107]: se ha asignado a % sin ejercer esa funcion', v_asig;
  end if;
  raise notice 'CORRECTO: un plan con una tarea sin asignar es mejor que no tener plan';
end $$;

\echo '[108] PELIGRO DOCUMENTADO: borrar la tarea de plantilla deja la tarea sin material'
do $$
declare v_enlace uuid; v_viva boolean; v_mat int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  delete from template_tasks where id = 'eeef0001-0000-0000-0000-000000000001';
  reset role;

  select template_task_id, true into v_enlace, v_viva
    from tasks where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                 and title = 'Revision de la memoria';
  select count(*) into v_mat from template_files
   where id = 'eeea0001-0000-0000-0000-000000000001';

  if not coalesce(v_viva, false) then
    raise exception 'FALLO [108]: borrar la plantilla se ha llevado la tarea del trabajo';
  end if;
  if v_enlace is not null then
    raise exception 'FALLO [108]: el enlace deberia haber quedado nulo';
  end if;
  if v_mat <> 0 then
    raise exception 'FALLO [108]: la fila de material sigue ahi apuntando a una tarea borrada';
  end if;
  raise notice 'CORRECTO: la tarea sobrevive, pierde el material y NO se avisa (de ahi el aviso en la interfaz)';
end $$;
reset role;

-- Objetos del cubo, insertados sin RLS (como el servicio de Storage).
-- Convencion: <template_id>/<file_id>/<fichero>.
insert into storage.objects (bucket_id, name) values
  ('template-files', 'eeee0001-0000-0000-0000-000000000001/eeea0001-0000-0000-0000-000000000001/rubrica.pdf'),
  ('template-files', 'eeee0009-0000-0000-0000-000000000009/f9/plantilla-inexistente.pdf'),
  ('template-files', 'no-es-un-uuid/f9/colado.pdf')
on conflict do nothing;

\echo '[109] El estudiante DESCARGA el material y no puede subir nada al cubo'
do $$
declare v int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v from storage.objects where bucket_id = 'template-files';
  if v <> 1 then
    raise exception 'FALLO [109]: el estudiante ve % objetos del cubo, se esperaba 1', v;
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('template-files','eeee0001-0000-0000-0000-000000000001/f8/me-cuelo.pdf');
    raise exception 'FALLO [109]: el estudiante ha subido material de plantilla';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: lo lee, no lo escribe';
  end;
end $$;
reset role;

\echo '[110] La administracion sube, y ni ella puede usar una ruta sin plantilla'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into storage.objects (bucket_id, name)
  values ('template-files','eeee0001-0000-0000-0000-000000000001/f7/guion.pdf');
  begin
    insert into storage.objects (bucket_id, name)
    values ('template-files','sin-carpeta.pdf');
    raise exception 'FALLO [110]: se ha aceptado una ruta sin carpeta de plantilla';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: la ruta debe empezar por el uuid de la plantilla';
  end;
end $$;
reset role;
