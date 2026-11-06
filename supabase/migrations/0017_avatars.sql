-- =============================================================================
-- 0017 · Fotos de perfil
--
-- QUÉ APORTAN, PARA NO HACERLAS POR DECORACIÓN
-- En un tablero con veinte tarjetas, una cara se reconoce de un vistazo y un
-- nombre hay que leerlo. Es lo único que esto mejora, y basta: `avatar_url` ya
-- existía desde la `0001` y cinco consultas ya la traían; nadie la pintaba.
--
-- LA REGLA DE VISIBILIDAD: LA MISMA QUE LA DEL NOMBRE, LITERALMENTE
-- Una foto es un dato personal más revelador que un nombre, así que proteger la
-- fila y dejar el fichero accesible no protegería nada: se vería la cara de
-- cualquiera con la URL. Por eso la `0016` y esta comparten UNA función,
-- `app.can_see_profile`, que es ahora la única definición de «a quién veo»:
--
--   · mi propio perfil;
--   · quien participa en algún trabajo que yo pueda ver;
--   · quien pertenece a una organización que yo administro.
--
-- `profiles_select` se reescribe para llamarla. No cambia de criterio —es la
-- misma expresión de la `0016` metida en una función con nombre—, y a cambio
-- las dos fronteras (la fila y el fichero) **no pueden** divergir: si algún día
-- se afina la regla, se afina en un sitio. Dos políticas que dicen lo mismo con
-- dos textos distintos son dos políticas que acabarán diciendo cosas distintas.
--
-- EL CUBO ES PRIVADO, y aquí pesa más que en los otros dos. Público en Supabase
-- significa legible por internet entero sin sesión; serían las caras del grupo
-- en una URL abierta, indexable, y este repositorio es público. Se sirven con
-- URL firmada de duración corta.
--
-- POR QUÉ `avatar_url` GUARDA UNA RUTA Y NO UNA URL (pese al nombre)
-- Porque la URL de un cubo privado va firmada y **caduca**: guardarla sería
-- guardar algo que mañana no funciona, y nadie sabría por qué. Se guarda la
-- ruta dentro del cubo y se firma al pintar. La columna no se renombra para no
-- romper cinco consultas y los tipos por un nombre; queda dicho aquí y en el
-- componente. El frontend acepta además una URL `http(s)` por si algún perfil
-- tuviera ya una externa.
--
-- LÍMITE DE 2 MB Y REDIMENSIÓN EN EL NAVEGADOR
-- El plan gratuito da 1 GB de Storage. Una foto de móvil son 4-6 MB: cuarenta
-- personas subiendo la suya se comerían un cuarto del cubo para mostrar
-- círculos de 40 px. El cliente la reduce a 256 px antes de subir (~20 kB) y el
-- cubo rechaza lo que pase de 2 MB, que es el cinturón por si el cliente falla.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La regla de visibilidad, en una sola función
-- -----------------------------------------------------------------------------
create or replace function app.can_see_profile(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select target = auth.uid()
      or app.shares_visible_work(target)
      or app.administers_profile(target);
$$;

-- `profiles_select` pasa a usarla. Mismo criterio que la 0016, un solo sitio.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (app.can_see_profile(id));

-- -----------------------------------------------------------------------------
-- 2. El cubo
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin storage.buckets (entorno de pruebas): se omite el cubo.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars', 'avatars', false,
    2097152,  -- 2 MB. El cliente sube ~20 kB; esto es el tope por si no lo hace.
    array['image/webp', 'image/jpeg', 'image/png']
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'Cubo avatars listo (privado, 2 MB por fichero).';
end $$;

-- -----------------------------------------------------------------------------
-- 3. Autorización de los objetos
--
-- La ruta es `<user_id>/<fichero>`: el primer segmento NO es decorativo, es la
-- llave. Igual que en los cubos de la 0010 y la 0014, cambiar la convención sin
-- cambiar estas funciones abriría el cubo.
-- -----------------------------------------------------------------------------
create or replace function app.avatar_owner(object_name text)
returns uuid language plpgsql immutable
set search_path = public, pg_temp
as $$
declare v uuid;
begin
  -- Si el primer segmento no es un uuid, la ruta no la ha generado esta
  -- aplicación: devuelve null y las dos funciones de abajo deniegan.
  begin
    v := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return null;
  end;
  return v;
end;
$$;

/** Ver la foto de alguien = poder ver su perfil. Una sola regla (apartado 1). */
create or replace function app.can_read_avatar(object_name text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.avatar_owner(object_name) is not null
     and app.can_see_profile(app.avatar_owner(object_name));
$$;

/**
 * Escribir = ser el dueño de la carpeta. Nadie le cambia la foto a nadie.
 *
 * La administración puede BORRAR (abajo, en su propia política) pero no subir:
 * retirar una foto inapropiada es moderación; poner una en nombre de otro no
 * tiene ningún uso legítimo.
 */
create or replace function app.can_write_avatar(object_name text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.avatar_owner(object_name) = auth.uid();
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists avatars_select on storage.objects';
  execute 'drop policy if exists avatars_insert on storage.objects';
  execute 'drop policy if exists avatars_update on storage.objects';
  execute 'drop policy if exists avatars_delete on storage.objects';

  execute $p$
    create policy avatars_select on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and app.can_read_avatar(name))
  $p$;
  execute $p$
    create policy avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and app.can_write_avatar(name))
  $p$;
  execute $p$
    create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and app.can_write_avatar(name))
      with check (bucket_id = 'avatars' and app.can_write_avatar(name))
  $p$;
  -- Borrar: el dueño, o quien administre la organización de ese perfil.
  execute $p$
    create policy avatars_delete on storage.objects for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (
          app.can_write_avatar(name)
          or (app.avatar_owner(name) is not null
              and app.administers_profile(app.avatar_owner(name)))
        )
      )
  $p$;

  raise notice 'Politicas del cubo avatars aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.can_see_profile(uuid)   to authenticated;
grant execute on function app.avatar_owner(text)      to authenticated;
grant execute on function app.can_read_avatar(text)   to authenticated;
grant execute on function app.can_write_avatar(text)  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare v_abiertas text; v_using text; v_publico boolean;
begin
  v_using := pg_get_expr(
    (select polqual from pg_policy where polname = 'profiles_select'),
    (select polrelid from pg_policy where polname = 'profiles_select')
  );
  if v_using not like '%can_see_profile%' then
    raise exception 'profiles_select ya no usa la regla unica: %', v_using;
  end if;

  if to_regclass('storage.buckets') is not null then
    select public into v_publico from storage.buckets where id = 'avatars';
    if v_publico then
      raise exception 'El cubo avatars es PUBLICO: serian las caras del grupo en una URL abierta.';
    end if;
  end if;

  if to_regclass('storage.objects') is not null then
    if (select count(*) from pg_policies
         where tablename = 'objects' and policyname like 'avatars_%') <> 4 then
      raise exception 'Faltan politicas del cubo avatars.';
    end if;
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0017 correcta: la foto se ve exactamente como el nombre.';
end $$;
