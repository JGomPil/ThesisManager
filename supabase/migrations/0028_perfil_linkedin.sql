-- =============================================================================
-- 0028 · LinkedIn en el perfil
--
-- Un campo mas en `profiles`, al lado de ORCID y por el mismo motivo: en un
-- grupo de investigacion la identidad profesional de cada cual vive fuera, y la
-- ficha de una persona sirve para llegar a ella. ORCID lleva a su produccion
-- cientifica; LinkedIn, a su trayectoria, que es lo que miran los estudiantes
-- que acaban y la gente de fuera del mundo academico.
--
-- SIN `check` DE FORMATO, a proposito. El formato se valida en el formulario
-- (`src/schemas` y la pantalla del perfil), no aqui, por lo mismo que el maximo
-- de directores: un `check` sobre una direccion de un sitio ajeno es una regla
-- que caduca cuando ese sitio cambia de URL, y cambiarla pide una migracion. Lo
-- que si hace la aplicacion es no fabricar enlaces: guarda la direccion
-- completa y la pinta tal cual, asi que un valor raro es un enlace que no
-- lleva a ningun sitio y no una pantalla rota.
--
-- NO HACE FALTA NINGUNA POLITICA NUEVA, y conviene decir por que: la
-- visibilidad de `profiles` es POR FILA (`app.can_see_profile`, 0016 y 0017),
-- de modo que una columna nueva hereda exactamente la misma regla —solo la ve
-- quien tiene relacion academica con esa persona, o quien la administra—. Es la
-- cara buena de lo que la 0027 descubrio por el lado malo: una politica decide
-- que filas, no que columnas. Aqui es justo lo que se quiere; alli hizo falta un
-- disparador porque habia una columna que no debia ser editable.
-- =============================================================================

alter table profiles add column if not exists linkedin_url text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'linkedin_url'
  ) then
    raise exception '0028: falta profiles.linkedin_url';
  end if;
  raise notice 'CORRECTO: 0028 LinkedIn en el perfil';
end $$;
