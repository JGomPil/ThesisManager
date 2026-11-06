-- =============================================================================
-- Fotos de perfil (migración 0017)
--
-- LO QUE SE JUEGA: una foto es un dato personal más revelador que un nombre. Si
-- la fila de `profiles` está protegida y el objeto del cubo no, no hay nada
-- protegido: se ve la cara con la URL. La prueba central es [131]: la foto se ve
-- EXACTAMENTE igual que el nombre, ni más ni menos.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion
--   investigador = 2222...  director de TFG-01
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno total  = 5555...  miembro de la organizacion, de ningun trabajo
-- =============================================================================

\echo '================ FOTOS DE PERFIL ================'

-- Objetos de prueba en el cubo: la ruta es `<user_id>/<fichero>`.
insert into storage.objects (bucket_id, name, owner) values
  ('avatars', '33333333-3333-3333-3333-333333333333/foto.webp', '33333333-3333-3333-3333-333333333333'),
  ('avatars', '55555555-5555-5555-5555-555555555555/foto.webp', '55555555-5555-5555-5555-555555555555'),
  ('avatars', 'no-es-un-uuid/foto.webp', null)
on conflict do nothing;

\echo '[129] El cubo avatars es privado'
do $$
declare v boolean;
begin
  select public into v from storage.buckets where id = 'avatars';
  if v is null then
    raise exception 'FALLO [129]: el cubo avatars no existe';
  end if;
  if v then
    raise exception 'FALLO [129]: el cubo avatars es publico';
  end if;
  raise notice 'CORRECTO: cubo privado, se sirve con URL firmada';
end $$;

\echo '[130] Cada cual sube SOLO en su carpeta'
do $$
declare v_propia boolean := false; v_ajena boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  -- La suya: permitida.
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', '33333333-3333-3333-3333-333333333333/otra.webp');
    v_propia := true;
  exception when others then v_propia := false;
  end;

  -- La de otro: la politica debe rechazarla.
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', '22222222-2222-2222-2222-222222222222/suplantada.webp');
    v_ajena := true;
  exception when insufficient_privilege or check_violation then v_ajena := false;
  end;

  reset role;

  if not v_propia then
    raise exception 'FALLO [130]: no puede subir su propia foto';
  end if;
  if v_ajena then
    raise exception 'FALLO [130]: ha subido una foto en la carpeta de otro';
  end if;
  raise notice 'CORRECTO: nadie le cambia la foto a nadie';
end $$;
reset role;

\echo '[131] La foto se ve EXACTAMENTE como el nombre (la prueba central)'
do $$
declare
  v_fila_estudiante int; v_obj_estudiante int;
  v_fila_ajeno int;      v_obj_ajeno int;
begin
  -- El investigador comparte TFG-01 con el estudiante (3333) y nada con el
  -- ajeno total (5555). Se comparan las dos fronteras: la fila y el fichero.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);

  select count(*) into v_fila_estudiante from profiles
   where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into v_obj_estudiante from storage.objects
   where bucket_id = 'avatars'
     and name = '33333333-3333-3333-3333-333333333333/foto.webp';

  select count(*) into v_fila_ajeno from profiles
   where id = '55555555-5555-5555-5555-555555555555';
  select count(*) into v_obj_ajeno from storage.objects
   where bucket_id = 'avatars'
     and name = '55555555-5555-5555-5555-555555555555/foto.webp';

  reset role;

  if v_fila_estudiante <> 1 or v_obj_estudiante <> 1 then
    raise exception 'FALLO [131]: ve el nombre del estudiante (%) pero no su foto (%)',
      v_fila_estudiante, v_obj_estudiante;
  end if;
  if v_fila_ajeno <> 0 or v_obj_ajeno <> 0 then
    raise exception 'FALLO [131]: del ajeno ve nombre=% y foto=%, y debe ser 0 y 0',
      v_fila_ajeno, v_obj_ajeno;
  end if;
  raise notice 'CORRECTO: las dos fronteras coinciden, fila y fichero';
end $$;
reset role;

\echo '[132] La administracion ve las fotos de su organizacion'
do $$
declare v int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into v from storage.objects
   where bucket_id = 'avatars'
     and name in ('33333333-3333-3333-3333-333333333333/foto.webp',
                  '55555555-5555-5555-5555-555555555555/foto.webp');
  reset role;

  if v <> 2 then
    raise exception 'FALLO [132]: la administracion ve % de 2 fotos', v;
  end if;
  raise notice 'CORRECTO: quien ve a todo el mundo ve las fotos de todo el mundo';
end $$;
reset role;

\echo '[133] Una ruta que no empieza por un uuid no la lee nadie'
do $$
declare v int;
begin
  -- Si el primer segmento no es un uuid, la ruta no la ha generado esta
  -- aplicacion y `app.avatar_owner` devuelve null: se deniega, no se adivina.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into v from storage.objects
   where bucket_id = 'avatars' and name = 'no-es-un-uuid/foto.webp';
  reset role;

  if v <> 0 then
    raise exception 'FALLO [133]: una ruta con formato ajeno es legible';
  end if;
  raise notice 'CORRECTO: ruta con formato desconocido, acceso denegado';
end $$;
reset role;

\echo '[134] La administracion puede RETIRAR una foto, pero no poner una ajena'
do $$
declare v_borrado int; v_subida boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  -- Moderacion: retirar una foto inapropiada. Se cuenta con `get diagnostics`
  -- y NO se da por hecho: un `delete` que no borra nada no da error, asi que
  -- `v_borrado := 1` escrito a mano habria dado verde sin comprobar nada. Es el
  -- mismo fallo de metodo que ya se colo en la prueba 113.
  delete from storage.objects
   where bucket_id = 'avatars'
     and name = '33333333-3333-3333-3333-333333333333/otra.webp';
  get diagnostics v_borrado = row_count;

  -- Pero poner una foto en nombre de otro no tiene uso legitimo.
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', '33333333-3333-3333-3333-333333333333/puesta-por-admin.webp');
    v_subida := true;
  exception when insufficient_privilege or check_violation then v_subida := false;
  end;

  reset role;

  if v_borrado <> 1 then
    raise exception 'FALLO [134]: la administracion no puede retirar una foto';
  end if;
  if v_subida then
    raise exception 'FALLO [134]: la administracion ha subido una foto en nombre de otro';
  end if;
  raise notice 'CORRECTO: moderar es retirar, no suplantar';
end $$;
reset role;

\echo '[135] anon no ve ninguna foto'
do $$
declare v int; v_denegado boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  begin
    select count(*) into v from storage.objects where bucket_id = 'avatars';
  exception when insufficient_privilege then v_denegado := true;
  end;
  reset role;

  if not v_denegado and v <> 0 then
    raise exception 'FALLO [135]: anon ve % fotos', v;
  end if;
  raise notice 'CORRECTO: sin sesion no hay caras';
end $$;
reset role;
