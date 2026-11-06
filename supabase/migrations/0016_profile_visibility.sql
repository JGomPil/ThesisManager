-- =============================================================================
-- 0016 · Quién puede ver a quién
--
-- EL PROBLEMA
-- `profiles_select` decía: «veo mi perfil y el de cualquiera que comparta
-- organización conmigo». Como este despliegue es UNA organización —el grupo
-- entero—, en la práctica significaba que todo el mundo veía a todo el mundo:
-- nombre, correo, departamento y puesto de los 40 miembros del grupo, también
-- un estudiante de TFG que no tiene relación con nadie salvo su director.
--
-- Eso no es un fallo de pantalla. La pantalla «Personas» era el síntoma; la
-- causa es que la POLÍTICA lo permitía, así que cualquier consulta desde
-- cualquier sitio devolvía lo mismo, y la lista completa de correos del grupo
-- estaba a una petición de distancia de cualquiera con cuenta. Minimizar los
-- datos personales accesibles no se hace ocultando una tabla en el frontend.
--
-- LA REGLA NUEVA: se ve a quien participa en un trabajo que yo puedo ver
--   1. mi propio perfil, siempre;
--   2. quien participa en alguno de los trabajos de `accessible_work_ids()`
--      —los míos, y todos los de la organización si soy administrador—;
--   3. quien pertenece a una organización que yo administro.
--
-- Por qué la 2 se define sobre los TRABAJOS accesibles y no sobre «trabajos
-- donde soy miembro»: porque `wm_select` ya deja leer las filas de
-- `work_members` de esos trabajos. Si `profiles` fuera más estrecho que
-- `work_members`, las pantallas mostrarían participantes sin nombre —filas con
-- un hueco— en lugar de no mostrarlos. Las dos políticas tienen que hablar del
-- mismo conjunto, y ahora lo hacen: una sola expresión, `accessible_work_ids()`.
--
-- POR QUÉ NO SE FILTRA POR `status` DE LA OTRA PERSONA
-- A propósito. Un director que dejó el trabajo el año pasado sigue siendo
-- alguien con quien he trabajado, y su nombre tiene que seguir resolviéndose en
-- las actas, los comentarios y las versiones que firmó. Filtrar por membresía
-- activa convertiría el historial en «Sin nombre», que es peor que inútil:
-- parece un error de datos. Quien SÍ se filtra por actividad es el que mira
-- (dentro de `accessible_work_ids`): si a mí me dieron de baja del trabajo,
-- deja de ser mío y no veo a nadie por esa vía.
--
-- LO QUE ESTO ROMPE, Y CÓMO SE ARREGLA
-- Añadir un participante exige elegir a una persona de una lista, y la lista
-- salía de `profiles`. Un director que no es administrador deja de ver a los
-- codirectores con los que nunca ha coincidido, y no podría añadirlos.
-- La salida NO es devolverle el directorio entero: es
-- `public.find_person_by_email`, que resuelve UN correo exacto. Hay que saber a
-- quién se busca; no se puede pasear por la lista. Es la diferencia entre
-- «localizar a alguien» y «navegar el padrón del grupo».
--
-- `app.shares_organization` se queda, pero ya NO es la regla de visibilidad de
-- perfiles: solo acota la búsqueda por correo al propio grupo.
--
-- LO QUE SIGUE SIENDO VISIBLE PARA CUALQUIERA CON CUENTA (y es correcto)
-- Los catálogos (tipos de trabajo, estados, funciones académicas) y la lista de
-- organizaciones a las que pertenece. No son datos de personas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Los dos predicados de la regla nueva
-- -----------------------------------------------------------------------------

/**
 * ¿`target` participa en algún trabajo que yo pueda ver?
 *
 * SECURITY DEFINER y sin filtro de `status` sobre `target`: ver la cabecera.
 * La recursión no es un problema porque consulta `work_members`, no `profiles`.
 */
create or replace function app.shares_visible_work(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from work_members wm
    where wm.user_id = target
      and wm.work_id in (select app.accessible_work_ids())
  );
$$;

/**
 * ¿Administro alguna organización a la que pertenezca `target`?
 *
 * No vale `is_any_org_admin()`: eso diría «administro algo, luego veo a todo el
 * mundo», y en un despliegue con dos grupos independientes sería falso. Se
 * cruza por organización, que es lo que de verdad autoriza.
 */
create or replace function app.administers_profile(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_members suya
    join organization_members mia on mia.organization_id = suya.organization_id
    where suya.user_id = target
      and mia.user_id = auth.uid()
      and mia.is_active
      and mia.role in ('OWNER', 'ADMIN')
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. La política
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = app.uid()
    or app.shares_visible_work(id)
    or app.administers_profile(id)
  );

-- -----------------------------------------------------------------------------
-- 3. Localizar a una persona por su correo exacto
--
-- Para poder añadir participantes sin abrir el directorio. Tres cautelas:
--
--   a) IGUALDAD, no `like`: con un `%` se enumeraría el grupo entero, que es
--      justo lo que esta migración cierra. Se normaliza a minúsculas y se
--      recortan espacios porque el correo se teclea a mano.
--   b) Solo contesta a quien puede añadir gente a algún trabajo: la
--      administración, o quien tiene `can_manage_members` en algún trabajo
--      activo. A un estudiante le devuelve vacío, no un error: no se le
--      confirma que exista algo que no puede ver.
--   c) Solo encuentra a quien comparte organización con quien pregunta.
--
-- Queda una fuga conocida y asumida: quien puede añadir participantes puede
-- confirmar si una dirección concreta tiene cuenta. Es inevitable para poder
-- buscar, y es muchísimo menos que la lista completa.
-- -----------------------------------------------------------------------------
create or replace function app.can_add_people()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_any_org_admin() or exists (
    select 1
    from work_members wm
    join work_roles r on r.id = wm.work_role_id
    where wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
      and coalesce(
            (wm.permissions ->> 'can_manage_members')::boolean,
            r.can_manage_members
          )
  );
$$;

create or replace function public.find_person_by_email(p_email text)
returns table (id uuid, full_name text, email text, department text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email, p.department
  from profiles p
  where app.can_add_people()
    and p.is_active
    and lower(p.email) = lower(trim(coalesce(p_email, '')))
    and trim(coalesce(p_email, '')) <> ''
    and (p.id = auth.uid() or app.shares_organization(p.id))
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.shares_visible_work(uuid) to authenticated;
grant execute on function app.administers_profile(uuid)  to authenticated;
grant execute on function app.can_add_people()           to authenticated;

revoke all on function public.find_person_by_email(text) from public;
revoke all on function public.find_person_by_email(text) from anon;
grant execute on function public.find_person_by_email(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare v_abiertas text; v_using text;
begin
  v_using := pg_get_expr(
    (select polqual from pg_policy where polname = 'profiles_select'),
    (select polrelid from pg_policy where polname = 'profiles_select')
  );
  if v_using not like '%shares_visible_work%' or v_using not like '%administers_profile%' then
    raise exception 'profiles_select no aplica la regla nueva: %', v_using;
  end if;
  -- La regla antigua no debe quedar como alternativa: con un `or` de sobra,
  -- seguiria viendose todo el grupo y esta migracion no haria nada.
  if v_using like '%shares_organization%' then
    raise exception 'profiles_select sigue dejando ver a toda la organizacion';
  end if;

  if has_function_privilege('anon', 'public.find_person_by_email(text)', 'execute') then
    raise exception 'anon no debe poder buscar personas por correo.';
  end if;
  if not has_function_privilege('authenticated', 'public.find_person_by_email(text)', 'execute') then
    raise exception 'authenticated debe poder buscar personas por correo.';
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0016 correcta: solo se ve a quien participa en un trabajo visible.';
end $$;
