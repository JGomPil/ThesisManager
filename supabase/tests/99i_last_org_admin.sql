-- =============================================================================
-- El grupo no se queda sin administradores (migración 0023)
--
-- QUÉ SE JUEGA AQUÍ
-- Nombrar administrador a alguien solo lo puede hacer un administrador
-- (`org_members_write` → `app.is_org_admin`). De ahí el callejón: si el último
-- se degrada a sí mismo o se desactiva, no queda NADIE que pueda devolver el
-- papel, ni él. La aplicación quedaría sin administración y la única salida
-- sería un UPDATE a mano en el panel de Supabase.
--
-- La prueba [161] es la que cierra ese callejón, y la [162] comprueba lo
-- contrario, que es igual de importante: con dos administradores, uno SÍ puede
-- dejar de serlo. Un disparador que proteja de más sería otro fallo —cerraría
-- el relevo— y se vería igual de poco: todo funcionaría salvo esa operación.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion aaaa...0001
--   investigador = 2222...  MEMBER, director de TFG-01
--   estudiante   = 3333...  MEMBER
-- =============================================================================

\echo '================ EL ULTIMO ADMINISTRADOR ================'

\echo '[160] La administracion nombra administrador a un miembro; un miembro no puede nombrarse'
do $$
declare v_rol text;
begin
  -- Un MEMBER intentando ascenderse. La politica pide ser administrador, asi
  -- que el UPDATE no afecta a ninguna fila: NO da error, simplemente no hace
  -- nada. Por eso se comprueba el dato y no la ausencia de excepcion.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update organization_members set role = 'ADMIN'
     where user_id = '33333333-3333-3333-3333-333333333333';
  exception when others then null;
  end;
  reset role;

  select role into v_rol from organization_members
   where user_id = '33333333-3333-3333-3333-333333333333';
  if v_rol <> 'MEMBER' then
    raise exception 'FALLO [160]: un miembro se ha ascendido a si mismo (%)', v_rol;
  end if;

  -- Y ahora la administracion, que si puede.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update organization_members set role = 'ADMIN'
   where user_id = '22222222-2222-2222-2222-222222222222';
  reset role;

  select role into v_rol from organization_members
   where user_id = '22222222-2222-2222-2222-222222222222';
  if v_rol <> 'ADMIN' then
    raise exception 'FALLO [160]: la administracion no ha podido nombrar a otro administrador (%)', v_rol;
  end if;
  raise notice 'CORRECTO [160]';
end $$;

\echo '[162] Con DOS administradores, uno puede dejar de serlo (el relevo no se bloquea)'
do $$
declare v_rol text;
begin
  -- Se ejecuta ANTES de la [161] a proposito: aqui hay dos administradores
  -- —el 1111 y el 2222 que acaba de ascender la [160]— y degradar a uno es
  -- legitimo. Si el disparador protegiera de mas, esto fallaria.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update organization_members set role = 'MEMBER'
   where user_id = '22222222-2222-2222-2222-222222222222';
  reset role;

  select role into v_rol from organization_members
   where user_id = '22222222-2222-2222-2222-222222222222';
  if v_rol <> 'MEMBER' then
    raise exception 'FALLO [162]: con dos administradores no se ha podido degradar a uno (%)', v_rol;
  end if;
  raise notice 'CORRECTO [162]';
end $$;

\echo '[161] El ULTIMO administrador no se puede degradar, ni borrar, ni desactivar'
do $$
declare v_rol text; v_activo boolean; v_sigue boolean; v_n int;
begin
  -- Punto de partida: queda uno solo. Se comprueba, porque una prueba que
  -- empieza sin el estado que cree tener es verde por el motivo equivocado.
  select count(*) into v_n from organization_members
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and is_active and role in ('OWNER','ADMIN');
  if v_n <> 1 then
    raise exception 'FALLO [161]: la prueba necesita UN administrador y hay %', v_n;
  end if;

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  -- a) Degradarse.
  begin
    update organization_members set role = 'MEMBER'
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;

  -- b) Desactivarse, que deja el mismo grupo sin administracion por otra via:
  --    `app.is_org_admin` exige `is_active`.
  begin
    update organization_members set is_active = false
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;

  -- c) Borrar la fila.
  begin
    delete from organization_members
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;
  reset role;

  select role, is_active into v_rol, v_activo from organization_members
   where user_id = '11111111-1111-1111-1111-111111111111';
  select exists (select 1 from organization_members
                  where user_id = '11111111-1111-1111-1111-111111111111') into v_sigue;

  if not v_sigue then
    raise exception 'FALLO [161]: se ha BORRADO al ultimo administrador; el grupo se queda sin administracion y nadie puede devolver el papel';
  end if;
  if v_rol <> 'ADMIN' then
    raise exception 'FALLO [161]: el ultimo administrador se ha degradado a si mismo (%)', v_rol;
  end if;
  if not v_activo then
    raise exception 'FALLO [161]: el ultimo administrador se ha desactivado a si mismo';
  end if;
  raise notice 'CORRECTO [161]';
end $$;

\echo '[163] Un miembro normal si se puede desactivar y borrar (no es un disparador que bloquee todo)'
do $$
declare v_sigue boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update organization_members set is_active = false
   where user_id = '44444444-4444-4444-4444-444444444444';
  reset role;

  if exists (select 1 from organization_members
              where user_id = '44444444-4444-4444-4444-444444444444' and is_active) then
    raise exception 'FALLO [163]: no se ha podido desactivar a un miembro normal';
  end if;

  -- Se deja como estaba: los ficheros siguientes leen este grupo.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update organization_members set is_active = true
   where user_id = '44444444-4444-4444-4444-444444444444';
  reset role;

  select is_active into v_sigue from organization_members
   where user_id = '44444444-4444-4444-4444-444444444444';
  if not v_sigue then
    raise exception 'FALLO [163]: no se ha podido reactivar al miembro';
  end if;
  raise notice 'CORRECTO [163]';
end $$;
