-- =============================================================================
-- Estados de trabajo y roles académicos administrables (migración 0020)
--
-- QUÉ SE JUEGA AQUÍ
-- `work_roles` tiene cinco columnas que no describen nada: las lee
-- `app.has_work_capability`, que es lo que invocan las políticas de `tasks`,
-- `milestones`, `documents`, `meetings`, `document_comments` y `profiles`. Son
-- EL MODELO DE PERMISOS. Abrir estos catálogos a la administración para que
-- pueda corregir un nombre —que es lo que se pedía— sin abrir esas cinco
-- columnas es justo la parte que puede salir mal.
--
-- La prueba central es la [146]: marcar `can_see_private_notes` en el rol
-- «Estudiante» publicaría, en ese instante y en todos los trabajos, las notas
-- que la dirección escribió creyéndolas privadas, sin aviso y sin rastro. Si
-- alguien «arregla» el disparador algún día, esa prueba es la que debe saltar.
--
-- Y la [143] existe para que la prohibición no sea total: una regla que lo
-- prohibiera todo pasaría la [145] y la [146] y dejaría la pantalla inútil.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion
--   investigador = 2222...  director de TFG-01, NO administrador
--   TFG-01 = bbbb...0001    organizacion = aaaa...0001
-- =============================================================================

\echo '================ ESTADOS Y ROLES ADMINISTRABLES ================'

\echo '[143] La administracion renombra un estado y un rol, y los reordena'
do $$
declare v_estado text; v_rol text; v_orden int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  update work_statuses set name = 'En marcha', display_order = 7
   where code = 'EN_DESARROLLO';
  update work_roles set name = 'Directora o director'
   where code = 'PRIMARY_SUPERVISOR';

  reset role;
  select name, display_order into v_estado, v_orden from work_statuses where code = 'EN_DESARROLLO';
  select name into v_rol from work_roles where code = 'PRIMARY_SUPERVISOR';

  if v_estado is distinct from 'En marcha' or v_orden is distinct from 7 then
    raise exception 'FALLO [143]: la administracion no ha podido renombrar/reordenar el estado (% / %)', v_estado, v_orden;
  end if;
  if v_rol is distinct from 'Directora o director' then
    raise exception 'FALLO [143]: la administracion no ha podido renombrar el rol (%)', v_rol;
  end if;

  -- Se deja como estaba, que los ficheros siguientes leen estos catalogos.
  update work_statuses set name = 'En desarrollo', display_order = 4 where code = 'EN_DESARROLLO';
  update work_roles set name = 'Director' where code = 'PRIMARY_SUPERVISOR';
  raise notice 'CORRECTO [143]';
end $$;

\echo '[144] Un director NO puede renombrar un estado ni un rol'
do $$
declare v_estado text; v_rol text;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  -- Sin politica aplicable, un UPDATE no da error: no encuentra ninguna fila.
  update work_statuses set name = 'NOMBRE-DE-UN-DIRECTOR' where code = 'EN_DESARROLLO';
  update work_roles set name = 'ROL-DE-UN-DIRECTOR' where code = 'PRIMARY_SUPERVISOR';
  reset role;

  select name into v_estado from work_statuses where code = 'EN_DESARROLLO';
  select name into v_rol from work_roles where code = 'PRIMARY_SUPERVISOR';
  if v_estado = 'NOMBRE-DE-UN-DIRECTOR' or v_rol = 'ROL-DE-UN-DIRECTOR' then
    raise exception 'FALLO [144]: un director ha cambiado un catalogo global';
  end if;
  raise notice 'CORRECTO [144]';
end $$;

\echo '[145] El codigo de un estado es inmutable incluso para la administracion'
do $$
declare v_bloqueado boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    update work_statuses set code = 'EN_DESARROLLO_2' where code = 'EN_DESARROLLO';
  exception when others then
    v_bloqueado := position('no se puede cambiar' in sqlerrm) > 0;
  end;
  reset role;

  if not v_bloqueado then
    raise exception 'FALLO [145]: se ha podido cambiar el codigo de un estado; el cronograma colorea por codigo';
  end if;
  if not exists (select 1 from work_statuses where code = 'EN_DESARROLLO') then
    raise exception 'FALLO [145]: el codigo ha cambiado de verdad';
  end if;
  raise notice 'CORRECTO [145]';
end $$;

\echo '[146] Los permisos de un rol NO se pueden cambiar por la API'
do $$
declare v_bloqueado boolean := false; v_ve boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    update work_roles set can_see_private_notes = true where code = 'STUDENT';
  exception when others then
    v_bloqueado := position('solo se pueden cambiar' in sqlerrm) > 0;
  end;
  reset role;

  if not v_bloqueado then
    raise exception 'FALLO [146]: la API ha podido dar can_see_private_notes al rol de estudiante';
  end if;
  select can_see_private_notes into v_ve from work_roles where code = 'STUDENT';
  if coalesce(v_ve, true) then
    raise exception 'FALLO [146]: el rol de estudiante ve notas privadas';
  end if;
  raise notice 'CORRECTO [146]';
end $$;

\echo '[147] Un rol nuevo nace SIN capacidades, y uno en uso no se puede borrar'
do $$
declare v_con boolean := false; v_sin boolean; v_borrado_en_uso boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  -- Con capacidades: rechazado por el disparador.
  begin
    insert into work_roles (code, name, can_see_private_notes)
    values ('ROL_CON_PODER','Rol con poder', true);
    v_con := true;   -- si llega aqui, ha entrado: es el fallo
  exception when others then
    null;            -- cualquier negativa vale: la da la politica roles_insert
  end;

  -- Sin capacidades: aceptado.
  insert into work_roles (code, name, is_supervisory, display_order)
  values ('TUTOR_EXTERNO','Tutor externo', true, 9);

  -- Y el rol de estudiante, que SI esta en uso, no se puede borrar.
  begin
    delete from work_roles where code = 'STUDENT';
  exception when others then
    v_borrado_en_uso := true;
  end;
  reset role;

  if v_con then
    raise exception 'FALLO [147]: se ha creado un rol CON can_see_private_notes desde la API';
  end if;
  select exists (select 1 from work_roles where code = 'TUTOR_EXTERNO') into v_sin;
  if not v_sin then
    raise exception 'FALLO [147]: la administracion no ha podido crear un rol sin capacidades';
  end if;
  if not v_borrado_en_uso or not exists (select 1 from work_roles where code = 'STUDENT') then
    raise exception 'FALLO [147]: se ha borrado un rol en uso; los participantes se quedan sin rol';
  end if;

  delete from work_roles where code = 'TUTOR_EXTERNO';
  raise notice 'CORRECTO [147]';
end $$;

\echo '[148] Un estado EN USO no se puede borrar; retirarlo SI lo conserva en el trabajo'
do $$
declare v_id uuid; v_bloqueado boolean := false; v_sigue boolean;
begin
  select status_id into v_id from academic_works where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    delete from work_statuses where id = v_id;
  exception when others then
    v_bloqueado := true;
  end;
  -- Retirar es lo que se ofrece en su lugar.
  update work_statuses set is_active = false where id = v_id;
  reset role;

  if not v_bloqueado then
    raise exception 'FALLO [148]: se ha borrado un estado en uso; el trabajo se queda sin estado';
  end if;
  select exists (
    select 1 from academic_works w join work_statuses s on s.id = w.status_id
     where w.id = 'bbbbbbbb-0000-0000-0000-000000000001'
  ) into v_sigue;
  if not v_sigue then
    raise exception 'FALLO [148]: retirar el estado lo ha quitado del trabajo que lo tenia';
  end if;

  update work_statuses set is_active = true where id = v_id;
  raise notice 'CORRECTO [148]';
end $$;

\echo '[149] anon no lee ni escribe estos catalogos'
do $$
declare v_n int := -1; v_lee boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  -- Dos desenlaces son correctos y hay que admitir los dos: «permission denied»
  -- (no hay GRANT, migracion 0006) o cero filas (RLS). Exigir uno solo ataria la
  -- prueba a CUAL de las dos barreras actua primero.
  begin
    select count(*) into v_n from work_statuses;
    v_lee := v_n > 0;
  exception when others then
    v_lee := false;
  end;
  begin
    update work_statuses set name = 'ANON' where code = 'EN_DESARROLLO';
  exception when others then null;
  end;
  reset role;

  if v_lee then
    raise exception 'FALLO [149]: anon lee % estado(s)', v_n;
  end if;
  if exists (select 1 from work_statuses where name = 'ANON') then
    raise exception 'FALLO [149]: anon ha renombrado un estado';
  end if;
  raise notice 'CORRECTO [149]';
end $$;
