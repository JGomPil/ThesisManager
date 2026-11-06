-- =============================================================================
-- Tipos de documento y ciclo de vida por tipo de trabajo (migración 0021)
--
-- QUÉ SE JUEGA AQUÍ
-- Estos dos catálogos no conceden acceso a nada —al contrario que los roles de
-- la 0020—, así que lo que se protege no es un permiso sino un dato histórico.
-- `documents.document_type_id` es `on delete set null`: borrar un tipo **no da
-- error**, deja en blanco el tipo de todos los documentos que lo usaban y no
-- queda rastro de cuál era. La prueba [151] es la que cierra eso para los tipos
-- globales, que los comparten todas las organizaciones.
--
-- Y la [152] comprueba algo que no hace ningún disparador, sino la combinación
-- de USING y WITH CHECK: en un UPDATE el primero se evalúa sobre la fila vieja
-- y el segundo sobre la nueva, así que pidiendo lo mismo en los dos, mover una
-- fila de organización deja de cumplir uno de los dos.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion aaaa...0001
--   investigador = 2222...  director de TFG-01, NO administrador
-- =============================================================================

\echo '================ TIPOS DE DOCUMENTO Y CICLO DE VIDA ================'

\echo '[150] La administracion crea un tipo de documento de SU organizacion; un director no'
do $$
declare v_admin boolean; v_director boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into document_types (organization_id, code, name, display_order)
  values ('aaaaaaaa-0000-0000-0000-000000000001','POSTER_0021','Poster', 50);

  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into document_types (organization_id, code, name, display_order)
    values ('aaaaaaaa-0000-0000-0000-000000000001','ANEXO_0021','Anexo de un director', 51);
  exception when others then null;
  end;
  reset role;

  select exists (select 1 from document_types where code = 'POSTER_0021') into v_admin;
  select exists (select 1 from document_types where code = 'ANEXO_0021') into v_director;
  if not v_admin then raise exception 'FALLO [150]: la administracion no ha podido crear un tipo propio'; end if;
  if v_director then raise exception 'FALLO [150]: un director ha creado un tipo de documento'; end if;
  raise notice 'CORRECTO [150]';
end $$;

\echo '[151] Un tipo GLOBAL se renombra y se retira, pero NO se borra'
do $$
declare v_nombre text; v_activo boolean; v_sigue boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  update document_types set name = 'Memoria final' where code = 'MEMORIA' and organization_id is null;
  update document_types set is_active = false where code = 'MEMORIA' and organization_id is null;
  begin
    delete from document_types where code = 'MEMORIA' and organization_id is null;
  exception when others then null;
  end;
  reset role;

  select name, is_active into v_nombre, v_activo
    from document_types where code = 'MEMORIA' and organization_id is null;
  select exists (select 1 from document_types where code = 'MEMORIA' and organization_id is null) into v_sigue;

  if v_nombre is distinct from 'Memoria final' then
    raise exception 'FALLO [151]: no se ha podido renombrar un tipo global (%)', v_nombre;
  end if;
  if coalesce(v_activo, true) then
    raise exception 'FALLO [151]: no se ha podido retirar un tipo global';
  end if;
  if not v_sigue then
    raise exception 'FALLO [151]: se ha BORRADO un tipo global; los documentos que lo usaban se quedan sin tipo y sin rastro';
  end if;

  -- Se deja como estaba: lo leen los ficheros siguientes.
  set local role authenticated;
  update document_types set name = 'Memoria', is_active = true
   where code = 'MEMORIA' and organization_id is null;
  reset role;
  raise notice 'CORRECTO [151]';
end $$;

\echo '[152] Un tipo de documento no se puede mover de organizacion ni volver global'
do $$
declare v_movido boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    update document_types set organization_id = null where code = 'POSTER_0021';
  exception when others then null;
  end;
  reset role;

  select organization_id is null into v_movido from document_types where code = 'POSTER_0021';
  if coalesce(v_movido, false) then
    raise exception 'FALLO [152]: un tipo propio se ha convertido en global';
  end if;
  raise notice 'CORRECTO [152]';
end $$;

\echo '[153] La administracion define que estados aplican a un tipo de trabajo; un director no'
do $$
declare v_tipo uuid; v_estado uuid; v_admin int; v_director int;
begin
  select id into v_tipo from work_types where code = 'TFG' and organization_id is null;
  select id into v_estado from work_statuses where code = 'EN_DESARROLLO';

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into work_type_statuses (work_type_id, status_id, display_order)
  values (v_tipo, v_estado, 1) on conflict do nothing;

  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into work_type_statuses (work_type_id, status_id, display_order)
    select v_tipo, id, 9 from work_statuses where code = 'CANCELADO';
  exception when others then null;
  end;
  reset role;

  select count(*) into v_admin from work_type_statuses
   where work_type_id = v_tipo and status_id = v_estado;
  select count(*) into v_director from work_type_statuses wts
    join work_statuses s on s.id = wts.status_id
   where wts.work_type_id = v_tipo and s.code = 'CANCELADO';

  if v_admin <> 1 then raise exception 'FALLO [153]: la administracion no ha podido fijar el ciclo de vida'; end if;
  if v_director <> 0 then raise exception 'FALLO [153]: un director ha cambiado el ciclo de vida de un tipo'; end if;
  raise notice 'CORRECTO [153]';
end $$;

\echo '[154] Sin filas, el tipo vuelve a admitir TODOS los estados (regla del modelo)'
do $$
declare v_tipo uuid; v_n int;
begin
  select id into v_tipo from work_types where code = 'TFG' and organization_id is null;
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  delete from work_type_statuses where work_type_id = v_tipo;
  reset role;

  select count(*) into v_n from work_type_statuses where work_type_id = v_tipo;
  if v_n <> 0 then
    raise exception 'FALLO [154]: no se han podido quitar las restricciones del tipo (quedan %)', v_n;
  end if;
  -- La consecuencia —«sin filas, todos los estados»— la comprueba el dominio en
  -- `statusesForWorkType`; aqui se comprueba que la administracion PUEDE volver
  -- a ese estado, que es lo que hace reversible un error en la pantalla.
  raise notice 'CORRECTO [154]';
end $$;

\echo '[155] anon no ve ni escribe tipos de documento ni ciclos de vida'
do $$
declare v_lee boolean := false; v_n int;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  begin
    select count(*) into v_n from document_types;
    v_lee := v_n > 0;
  exception when others then v_lee := false;
  end;
  begin
    update document_types set name = 'ANON' where code = 'MEMORIA';
  exception when others then null;
  end;
  begin
    insert into work_type_statuses (work_type_id, status_id)
    select (select id from work_types limit 1), (select id from work_statuses limit 1);
  exception when others then null;
  end;
  reset role;

  if v_lee then raise exception 'FALLO [155]: anon lee los tipos de documento'; end if;
  if exists (select 1 from document_types where name = 'ANON') then
    raise exception 'FALLO [155]: anon ha renombrado un tipo de documento';
  end if;
  raise notice 'CORRECTO [155]';
end $$;
