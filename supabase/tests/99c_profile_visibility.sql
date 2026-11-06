-- =============================================================================
-- Quién ve a quién (migración 0016)
--
-- LO QUE SE JUEGA: la lista de nombres y correos del grupo entero. Antes la veía
-- cualquiera con cuenta, porque `profiles_select` solo exigía compartir
-- organización y el despliegue es UNA organización.
--
-- Datos de 10_roles_and_privacy.sql y posteriores:
--   admin        = 1111...  ADMIN de la organizacion, miembro de NINGUN trabajo
--   investigador = 2222...  director principal de TFG-01, doctorando de TESIS-02
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno        = 4444...  la prueba [35] lo hizo COLABORADOR de TFG-01
--   ajeno total  = 5555...  miembro de la organizacion y de ningun trabajo
--   intruso      = 6666...  miembro de la organizacion y de ningun trabajo ([31])
--
-- El par que importa es estudiante(3333) ↔ ajeno total(5555): comparten grupo y
-- no comparten nada mas. Antes se veian; ahora no.
-- =============================================================================

\echo '================ VISIBILIDAD DE PERSONAS ================'

\echo '[119] Un estudiante NO ve a quien no comparte ningun trabajo con el'
do $$
declare v_total int; v_ajeno int; v_nombres text;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_total from profiles;
  select count(*) into v_ajeno from profiles
   where id in ('55555555-5555-5555-5555-555555555555',
                '66666666-6666-6666-6666-666666666666');
  select string_agg(full_name, ', ' order by full_name) into v_nombres from profiles;
  reset role;

  if v_ajeno <> 0 then
    raise exception 'FALLO [119]: el estudiante ve % perfiles sin relacion alguna', v_ajeno;
  end if;
  raise notice 'CORRECTO: el estudiante ve % perfiles y ninguno es un desconocido (%)', v_total, v_nombres;
end $$;
reset role;

\echo '[120] ...pero SI ve a su director y a si mismo'
do $$
declare v_yo int; v_director int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_yo from profiles where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into v_director from profiles where id = '22222222-2222-2222-2222-222222222222';
  reset role;

  if v_yo <> 1 then
    raise exception 'FALLO [120]: el estudiante no ve su propio perfil';
  end if;
  if v_director <> 1 then
    raise exception 'FALLO [120]: el estudiante no ve a su director';
  end if;
  raise notice 'CORRECTO: se ve a si mismo y a la direccion de su trabajo';
end $$;
reset role;

\echo '[121] La relacion es SIMETRICA: el director ve al estudiante y no al ajeno'
do $$
declare v_estudiante int; v_ajeno int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_estudiante from profiles where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into v_ajeno from profiles where id = '55555555-5555-5555-5555-555555555555';
  reset role;

  if v_estudiante <> 1 then
    raise exception 'FALLO [121]: el director no ve a su estudiante';
  end if;
  if v_ajeno <> 0 then
    raise exception 'FALLO [121]: el director ve a alguien sin relacion con el';
  end if;
  raise notice 'CORRECTO: dirigir un trabajo da acceso a sus participantes, no al grupo';
end $$;
reset role;

\echo '[122] La administracion SI ve a todo el mundo de su organizacion'
do $$
declare v_total int; v_miembros int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_total from profiles;
  reset role;

  -- Cuantos perteneces de verdad a la organizacion (sin RLS, como `postgres`).
  select count(distinct user_id) into v_miembros from organization_members
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' and is_active;

  if v_total < v_miembros then
    raise exception 'FALLO [122]: la administracion ve % de % miembros', v_total, v_miembros;
  end if;
  raise notice 'CORRECTO: la administracion ve los % miembros de la organizacion', v_miembros;
end $$;
reset role;

\echo '[123] `work_members` y `profiles` hablan del mismo conjunto: ningun participante sin nombre'
do $$
declare v_sin_nombre int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  -- Participantes de los trabajos que el director puede leer cuyo perfil NO
  -- puede leer. Si sale alguno, las pantallas mostrarian huecos.
  select count(*) into v_sin_nombre
    from work_members wm
   where not exists (select 1 from profiles p where p.id = wm.user_id);
  reset role;

  if v_sin_nombre <> 0 then
    raise exception 'FALLO [123]: % participantes visibles sin perfil visible', v_sin_nombre;
  end if;
  raise notice 'CORRECTO: todo participante legible tiene nombre legible';
end $$;
reset role;

\echo '[124] Buscar por correo: la direccion localiza a alguien que no ve en el directorio'
do $$
declare v_encontrado int; v_visible int; v_correo text;
begin
  -- El correo se lee ANTES de suplantar a nadie, como `postgres`: leerlo ya
  -- dentro de la sesion del director devolvia NULL —RLS le oculta ese perfil,
  -- que es justo lo que se esta probando— y la prueba fallaba por su propio
  -- montaje, no por la funcion. Es el mismo error de siempre: construir el
  -- dato de entrada con los permisos que se quieren comprobar.
  select email into v_correo from profiles
   where id = '55555555-5555-5555-5555-555555555555';

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_visible from profiles
   where id = '55555555-5555-5555-5555-555555555555';
  select count(*) into v_encontrado from public.find_person_by_email(v_correo);
  reset role;

  if v_visible <> 0 then
    raise exception 'FALLO [124]: el ajeno era visible, la prueba no comprueba nada';
  end if;
  if v_encontrado <> 1 then
    raise exception 'FALLO [124]: la direccion no puede localizar a nadie por correo (% filas)', v_encontrado;
  end if;
  raise notice 'CORRECTO: se puede localizar a quien se busca por su correo exacto';
end $$;
reset role;

\echo '[125] La busqueda por correo NO sirve para enumerar: ni comodines ni vacio'
do $$
declare v_comodin int; v_vacio int; v_nulo int; v_parcial int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_comodin from public.find_person_by_email('%');
  select count(*) into v_vacio   from public.find_person_by_email('');
  select count(*) into v_nulo    from public.find_person_by_email(null);
  select count(*) into v_parcial from public.find_person_by_email('@test.invalid');
  reset role;

  if v_comodin + v_vacio + v_nulo + v_parcial <> 0 then
    raise exception 'FALLO [125]: la busqueda devuelve filas con comodin/%%vacio (%, %, %, %)',
      v_comodin, v_vacio, v_nulo, v_parcial;
  end if;
  raise notice 'CORRECTO: igualdad exacta; no hay forma de pasear la lista';
end $$;
reset role;

\echo '[126] Un estudiante no puede buscar personas por correo'
do $$
declare v int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v from public.find_person_by_email(
    (select email from profiles where id = '33333333-3333-3333-3333-333333333333'));
  reset role;

  -- Devuelve VACIO, no error: no se le confirma que exista lo que no ve.
  if v <> 0 then
    raise exception 'FALLO [126]: un estudiante localiza personas por correo (% filas)', v;
  end if;
  raise notice 'CORRECTO: solo busca quien puede anadir participantes';
end $$;
reset role;

\echo '[127] anon no ve ningun perfil ni puede buscar'
do $$
declare v int; v_denegado boolean := false; v_busqueda boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  begin
    select count(*) into v from profiles;
  exception when insufficient_privilege then v_denegado := true;
  end;
  begin
    select count(*) into v from public.find_person_by_email('ajeno-total@test.invalid');
  exception when insufficient_privilege then v_busqueda := true;
  end;
  reset role;

  if not v_denegado and v <> 0 then
    raise exception 'FALLO [127]: anon ve % perfiles', v;
  end if;
  if not v_busqueda then
    raise exception 'FALLO [127]: anon puede ejecutar la busqueda por correo';
  end if;
  raise notice 'CORRECTO: anon no llega ni a la tabla ni a la funcion';
end $$;
reset role;

\echo '[128] Una baja en el trabajo no borra el nombre del historial'
do $$
declare v_nombre int;
begin
  -- Se da de baja al colaborador 4444 de TFG-01 (sin RLS, como lo haria la
  -- direccion) y se comprueba que el estudiante del trabajo sigue pudiendo
  -- resolver su nombre: sus comentarios y entregas antiguas siguen ahi.
  update work_members set status = 'INACTIVE'
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     and user_id = '44444444-4444-4444-4444-444444444444';

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_nombre from profiles
   where id = '44444444-4444-4444-4444-444444444444';
  reset role;

  if v_nombre <> 1 then
    raise exception 'FALLO [128]: quien se dio de baja deja el historial sin nombre';
  end if;
  raise notice 'CORRECTO: el historial no se queda con huecos';
end $$;
reset role;
