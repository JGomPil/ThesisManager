-- =============================================================================
-- Quien puede crear un trabajo (migracion 0034)
--
-- QUE SE JUEGA AQUI
-- El alta de un trabajo pasa por una funcion `security definer`, o sea que SE
-- SALTA RLS ENTERA: dentro de ella no hay politica que la pare. Toda la
-- seguridad es lo que la funcion comprueba en sus primeras lineas, y por eso
-- cuatro de las cinco pruebas atacan la funcion y no las politicas.
--
-- Y hay un fallo peor que el de dejar crear a quien no debe: dejar crear un
-- trabajo SIN DIRECCION. `works_select` solo ensena los trabajos de los que
-- eres miembro, asi que un trabajo sin participantes es invisible para quien lo
-- acaba de crear -una fila huerfana que solo un administrador puede rescatar-.
-- La [201] comprueba las dos mitades: que el trabajo entra y que entra con su
-- directora.
--
--   1111... administrador del grupo
--   2222... miembro normal del grupo (dirige TFG-01), SIN la casilla
--   3333... estudiante de TFG-01
--   4444... miembro del grupo al que se le enciende la casilla
--   aaaa...0001 = GIB-UVa    ·    aaaa...0009 = otro grupo, sin miembros
-- =============================================================================

\echo '================ QUIEN PUEDE CREAR UN TRABAJO ================'

-- Un segundo grupo, para la [204]: el permiso es DEL GRUPO, y eso solo se
-- puede comprobar con dos.
--
-- Y SE LE PONE ADMINISTRACION a proposito, aunque para la prueba no haga
-- falta: `verify.sql` vigila que toda organizacion tenga al menos un
-- administrador activo -sin el, nadie podria recuperar el grupo desde la
-- aplicacion-, asi que un grupo de pruebas sin administracion haria fallar esa
-- comprobacion sobre una base recien construida.
insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000009','Grupo ajeno','grupo-ajeno')
  on conflict do nothing;
insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','ADMIN')
  on conflict do nothing;

-- Una cuenta con perfil y SIN pertenencia a ningun grupo. No se reutiliza la
-- `9999...` de las cuentas pendientes: la prueba [98] la autoriza como miembro
-- del grupo, de modo que a estas alturas de la tanda ya pertenece.
insert into auth.users (id, email) values
  ('77777777-0034-0000-0000-000000000204','defuera@test.invalid')
  on conflict do nothing;

\echo '[200] Sin la casilla no se crea un trabajo, ni por la funcion ni a mano'
do $$
declare v_colada text := ''; v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);

  -- Por la puerta nueva.
  begin
    v_id := public.crear_trabajo(
      p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000001',
      p_title           => 'TFG colado sin permiso',
      p_work_type_id    => (select id from work_types where code = 'TFG'),
      p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'));
    v_colada := v_colada || 'por la funcion; ';
  exception when others then null;
  end;

  -- Y por el camino directo, que esta migracion NO abre.
  begin
    insert into academic_works (organization_id, work_type_id, status_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            (select id from work_types where code = 'TFG'),
            (select id from work_statuses where code = 'EN_DESARROLLO'),
            'TFG colado a mano');
    v_colada := v_colada || 'por insert directo; ';
  exception when others then null;
  end;
  reset role;

  if exists (select 1 from academic_works where title like 'TFG colado%') or v_colada <> '' then
    raise exception 'FALLO DE SEGURIDAD [200]: un miembro sin permiso ha creado un trabajo (%)', v_colada;
  end if;
  raise notice 'CORRECTO [200]';
end $$;
reset role;

\echo '[201] Con la casilla crea el trabajo, queda como directora y lo ve'
do $$
declare v_id uuid; v_visibles int;
begin
  -- La casilla la enciende la ADMINISTRACION, y se hace desde su sesion para
  -- comprobar de paso que `org_members_write` se lo permite.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update organization_members set can_create_works = true
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '44444444-4444-4444-4444-444444444444';
  reset role;

  if not exists (
    select 1 from organization_members
     where user_id = '44444444-4444-4444-4444-444444444444' and can_create_works
  ) then
    raise exception 'FALLO [201]: la administracion no ha podido encender la casilla';
  end if;

  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  v_id := public.crear_trabajo(
    p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000001',
    p_title           => 'TFG-04 de la profesora nueva',
    p_work_type_id    => (select id from work_types where code = 'TFG'),
    p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'),
    p_start_date      => current_date,
    p_keywords        => array['eeg','conectividad'],
    p_student_id      => '33333333-3333-3333-3333-333333333333');

  -- LO QUE DE VERDAD IMPORTA: que lo vea. Un trabajo sin direccion entra en la
  -- tabla y desaparece de la pantalla de quien lo acaba de crear.
  select count(*) into v_visibles from academic_works where id = v_id;
  reset role;

  if v_visibles <> 1 then
    raise exception 'FALLO [201]: la profesora no ve el trabajo que acaba de crear: ha nacido huerfano';
  end if;

  if not exists (
    select 1 from work_members wm join work_roles r on r.id = wm.work_role_id
     where wm.work_id = v_id and wm.user_id = '44444444-4444-4444-4444-444444444444'
       and r.is_supervisory and r.can_manage_members and wm.is_primary
  ) then
    raise exception 'FALLO [201]: quien ha creado el trabajo no ha quedado como direccion';
  end if;

  if not exists (
    select 1 from work_members wm join work_roles r on r.id = wm.work_role_id
     where wm.work_id = v_id and wm.user_id = '33333333-3333-3333-3333-333333333333'
       and r.is_student
  ) then
    raise exception 'FALLO [201]: el alumno indicado no ha entrado en el trabajo';
  end if;

  if (select created_by from academic_works where id = v_id)
     <> '44444444-4444-4444-4444-444444444444' then
    raise exception 'FALLO [201]: el trabajo no guarda quien lo creo';
  end if;

  -- Y lo gestiona: `works_update` admite a la direccion del trabajo.
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  update academic_works set objectives = 'Replicar el analisis de 2019' where id = v_id;
  reset role;

  if (select objectives from academic_works where id = v_id) is null then
    raise exception 'FALLO [201]: la directora no puede editar su propio trabajo';
  end if;
  raise notice 'CORRECTO [201]';
end $$;
reset role;

\echo '[202] La casilla no se la pone uno mismo'
do $$
begin
  -- RLS no levanta excepcion en un UPDATE que filtra a cero filas: lo da por
  -- bueno y devuelve cero. Hay que mirar la fila, no el error.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update organization_members set can_create_works = true
   where user_id = '22222222-2222-2222-2222-222222222222';
  reset role;

  if exists (
    select 1 from organization_members
     where user_id = '22222222-2222-2222-2222-222222222222' and can_create_works
  ) then
    raise exception 'FALLO DE SEGURIDAD [202]: un miembro se ha dado permiso para crear trabajos';
  end if;
  raise notice 'CORRECTO [202]';
end $$;
reset role;

\echo '[203] Quien crea, dirige: nadie adjudica la direccion a un tercero (y la administracion si)'
do $$
declare v_colado boolean := false; v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  begin
    v_id := public.crear_trabajo(
      p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000001',
      p_title           => 'TFG a nombre de otro',
      p_work_type_id    => (select id from work_types where code = 'TFG'),
      p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'),
      p_supervisor_id   => '22222222-2222-2222-2222-222222222222');
    v_colado := true;
  exception when others then null;
  end;
  reset role;

  if v_colado or exists (select 1 from academic_works where title = 'TFG a nombre de otro') then
    raise exception 'FALLO DE SEGURIDAD [203]: ha adjudicado la direccion de un trabajo a otra persona';
  end if;

  -- La administracion si: es lo que permite seguir dando de alta los trabajos
  -- de los demas cuando toca.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  v_id := public.crear_trabajo(
    p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000001',
    p_title           => 'TESIS-05 creada por la administracion',
    p_work_type_id    => (select id from work_types where code = 'TESIS'),
    p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'),
    p_supervisor_id   => '22222222-2222-2222-2222-222222222222');
  reset role;

  if not exists (
    select 1 from work_members
     where work_id = v_id and user_id = '22222222-2222-2222-2222-222222222222' and is_primary
  ) then
    raise exception 'FALLO [203]: la administracion no ha podido crear un trabajo para otra persona';
  end if;
  raise notice 'CORRECTO [203]';
end $$;
reset role;

\echo '[204] Ni en un grupo al que no perteneces, ni con gente de fuera'
do $$
declare v_colado text := ''; v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);

  -- El permiso es DEL GRUPO: la casilla de uno no vale en el de al lado.
  begin
    v_id := public.crear_trabajo(
      p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000009',
      p_title           => 'Trabajo en el grupo ajeno',
      p_work_type_id    => (select id from work_types where code = 'TFG'),
      p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'));
    v_colado := v_colado || 'en otro grupo; ';
  exception when others then null;
  end;
  reset role;

  -- Y un alumno que no pertenece al grupo no se mete en un trabajo.
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  begin
    v_id := public.crear_trabajo(
      p_organization_id => 'aaaaaaaa-0000-0000-0000-000000000001',
      p_title           => 'Trabajo con alumno de fuera',
      p_work_type_id    => (select id from work_types where code = 'TFG'),
      p_status_id       => (select id from work_statuses where code = 'EN_DESARROLLO'),
      p_student_id      => '77777777-0034-0000-0000-000000000204');
    v_colado := v_colado || 'con un alumno de fuera; ';
  exception when others then null;
  end;
  reset role;

  if v_colado <> '' or exists (
    select 1 from academic_works
     where title in ('Trabajo en el grupo ajeno','Trabajo con alumno de fuera')
  ) then
    raise exception 'FALLO DE SEGURIDAD [204]: %', v_colado;
  end if;
  raise notice 'CORRECTO [204]';
end $$;
reset role;
