-- =============================================================================
-- Cuentas creadas a mano, sin pertenencia a ninguna organización (migración 0013)
--
-- El caso: se crea el usuario en Authentication → Users y el disparador le hace
-- su `profiles`, pero nadie lo ve porque no comparte organización con nadie.
-- Lo importante aquí es que la solución NO ha ensanchado `profiles_select`: la
-- prueba [97] comprueba justamente que el administrador sigue sin ver ese
-- perfil por la vía normal, y que solo lo ve a través de la función.
--
-- Datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización
--   investigador = 2222...  NO administrador
--   estudiante   = 3333...
-- =============================================================================

\echo '================ CUENTAS PENDIENTES DE AUTORIZAR ================'

-- Una cuenta recién creada a mano: perfil sí, pertenencia no.
insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999999', 'nuevo@example.invalid')
on conflict do nothing;
insert into profiles (id, full_name, email) values
  ('99999999-9999-9999-9999-999999999999', 'Persona Nueva', 'nuevo@example.invalid')
on conflict (id) do nothing;

\echo '[96] La administracion VE la cuenta pendiente'
do $$
declare v_total int; v_correo text;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_total from public.pending_accounts();
  select email into v_correo from public.pending_accounts()
   where id = '99999999-9999-9999-9999-999999999999';
  reset role;

  if v_correo is distinct from 'nuevo@example.invalid' then
    raise exception 'FALLO [96]: la administracion no ve la cuenta pendiente (total: %)', v_total;
  end if;
  raise notice 'CORRECTO: la cuenta pendiente aparece para la administracion';
end $$;
reset role;

\echo '[97] ...pero `profiles_select` NO se ha ensanchado'
do $$
declare v_visible int;
begin
  -- Esta es la prueba que justifica haber hecho una funcion en lugar de ampliar
  -- la politica: por la via normal, el perfil sigue siendo invisible.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_visible from profiles
   where id = '99999999-9999-9999-9999-999999999999';
  reset role;

  if v_visible <> 0 then
    raise exception 'FALLO [97]: profiles_select deja ver el perfil pendiente (% filas)', v_visible;
  end if;
  raise notice 'CORRECTO: la excepcion vive en la funcion, no en la politica';
end $$;
reset role;

\echo '[98] Quien no administra nada recibe una lista VACIA, no un error'
do $$
declare v_total int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  -- Un director no es administrador de la organizacion.
  select count(*) into v_total from public.pending_accounts();
  reset role;

  if v_total <> 0 then
    raise exception 'FALLO [98]: un director ve % cuentas pendientes', v_total;
  end if;
  raise notice 'CORRECTO: lista vacia, sin revelar que hay algo que no puede ver';
end $$;
reset role;

\echo '[99] Al autorizar la cuenta, deja de estar pendiente y ya es visible'
do $$
declare v_pendientes int; v_visible int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  -- Autorizar es exactamente esto: una fila en organization_members. No hacia
  -- falta ninguna politica nueva, `org_members_write` ya lo permitia.
  insert into organization_members (organization_id, user_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','MEMBER');

  select count(*) into v_pendientes from public.pending_accounts()
   where id = '99999999-9999-9999-9999-999999999999';
  select count(*) into v_visible from profiles
   where id = '99999999-9999-9999-9999-999999999999';
  reset role;

  if v_pendientes <> 0 then
    raise exception 'FALLO [99]: sigue apareciendo como pendiente tras autorizarla';
  end if;
  if v_visible <> 1 then
    raise exception 'FALLO [99]: tras autorizarla no aparece en el directorio (% filas)', v_visible;
  end if;
  raise notice 'CORRECTO: autorizar la saca de la cola y la mete en el directorio';
end $$;
reset role;

\echo '[100] anon no puede listar cuentas pendientes'
do $$
begin
  if has_function_privilege('anon', 'public.pending_accounts()', 'execute') then
    raise exception 'FALLO [100]: anon puede listar las cuentas pendientes';
  end if;
  raise notice 'CORRECTO: solo authenticated, y dentro solo la administracion';
end $$;
reset role;
