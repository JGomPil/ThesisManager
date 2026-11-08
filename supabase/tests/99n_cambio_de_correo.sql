-- =============================================================================
-- Cambiar de correo (migracion 0027)
--
-- QUE SE JUEGA AQUI
-- La identidad de esta aplicacion es el perfil, no el correo: quien pierde su
-- correo institucional se lo cambia y conserva sus trabajos, sus tareas y su
-- historial. Dos cosas pueden salir mal sin dar ningun error:
--
--   1. Que el perfil no siga a la cuenta: la persona entra con el correo nuevo
--      y el directorio del grupo sigue mostrando el viejo.
--   2. Que el perfil pueda desviarse: `profiles_update_self` deja a cada cual
--      escribir su propia fila entera, asi que sin disparador cualquiera podria
--      poner en su perfil el correo de otra persona. Seguiria entrando con el
--      suyo, y en el directorio apareceria el ajeno.
-- =============================================================================

\echo '================ CAMBIO DE CORREO ================'

\echo '[176] Cambiar el correo de la cuenta arrastra el perfil (y el perfil es el mismo)'
do $$
declare v_perfil text; v_id uuid;
begin
  -- Lo que hace Supabase Auth al confirmarse el enlace, y tambien lo que hace
  -- la administracion desde el panel cuando el enlace no llega.
  update auth.users set email = 'investigador.nuevo@test.invalid'
   where id = '22222222-2222-2222-2222-222222222222';

  select email, id into v_perfil, v_id
    from profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_perfil <> 'investigador.nuevo@test.invalid' then
    raise exception 'FALLO [176]: el perfil sigue diciendo % ', v_perfil;
  end if;
  -- Y el perfil es EL MISMO: si esto cambiara, se romperian las relaciones
  -- academicas, las tareas y el historial, que cuelgan de este identificador.
  if v_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'FALLO [176]: ha cambiado el identificador del perfil';
  end if;

  -- Se deja como estaba, que los ficheros siguientes leen este correo.
  update auth.users set email = 'investigador@test.invalid'
   where id = '22222222-2222-2222-2222-222222222222';
  if (select email from profiles where id = '22222222-2222-2222-2222-222222222222')
     <> 'investigador@test.invalid' then
    raise exception 'FALLO [176]: la vuelta atras no ha llegado al perfil';
  end if;
  raise notice 'CORRECTO [176]';
end $$;

\echo '[177] Nadie pone en su perfil un correo que no es el de su cuenta'
do $$
declare v_colado boolean := false;
begin
  -- El estudiante escribe su propia fila: RLS se lo permite (`profiles_update_self`),
  -- asi que lo unico que lo impide es el disparador de la 0027.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update profiles set email = 'investigador@test.invalid'
     where id = '33333333-3333-3333-3333-333333333333';
    v_colado := true;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if v_colado then
    raise exception 'FALLO DE SEGURIDAD [177]: ha puesto en su perfil el correo de otra persona';
  end if;
  if (select email from profiles where id = '33333333-3333-3333-3333-333333333333')
     <> 'estudiante@test.invalid' then
    raise exception 'FALLO DE SEGURIDAD [177]: el correo del perfil ha cambiado';
  end if;

  -- Y lo demas del perfil se sigue editando: la regla es del correo, no una
  -- prohibicion de tocar la fila.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update profiles set department = 'Teoria de la Senal'
   where id = '33333333-3333-3333-3333-333333333333';
  reset role;
  if (select department from profiles where id = '33333333-3333-3333-3333-333333333333')
     <> 'Teoria de la Senal' then
    raise exception 'FALLO [177]: el disparador bloquea cambios que no son del correo';
  end if;
  raise notice 'CORRECTO [177]';
end $$;
