-- =============================================================================
-- 0023 · El grupo no se puede quedar sin administradores
--
-- QUÉ SE AÑADE Y POR QUÉ HACE FALTA UNA REGLA
-- Hasta ahora el papel administrativo de una persona (`organization_members.
-- role`) se fijaba al entrar —al autorizar una cuenta pendiente o al invitar— y
-- no había ninguna pantalla para cambiarlo después. La `0023` acompaña a esa
-- pantalla nueva, y con ella aparece un riesgo que antes no existía: quitarse
-- el propio papel.
--
-- PORQUE ESTO NO TIENE VUELTA DESDE LA APLICACIÓN. Conceder el papel de
-- administrador lo permite `org_members_write`, que exige ser administrador
-- (`app.is_org_admin`). Es decir: el único que puede nombrar administradores es
-- un administrador. Si el último se degrada a sí mismo —o se desactiva—, no
-- queda nadie que pueda devolver el papel a nadie: ni él, ni el resto del
-- grupo. La única salida sería un UPDATE a mano en el panel de Supabase.
--
-- Es exactamente la misma trampa que el botón «Retirar» de los tipos de trabajo
-- (7 de noviembre de 2026): una acción de un clic, sin aviso, cuya vuelta atrás
-- no está en la aplicación. Allí la solución fue añadir la vuelta; aquí no se
-- puede, porque el que tendría que deshacerlo es justamente el que se ha
-- quedado sin permiso. Así que lo que se hace es impedirlo.
--
-- -----------------------------------------------------------------------------
-- Y VA EN UN DISPARADOR, NO EN LA PANTALLA
-- Un formulario que no ofrece la opción no protege nada: cualquiera con sesión
-- puede llamar a PostgREST directamente, que es la razón por la que
-- `work-capabilities.ts` no es una medida de seguridad (SECURITY.md §5.2.quater).
-- Tampoco puede ser una política de RLS: una política decide si una fila se deja
-- tocar, mirando esa fila; esto es una condición sobre el CONJUNTO —cuántos
-- administradores quedan— que solo se puede evaluar después del cambio.
--
-- POR ESO ES `AFTER`. Un disparador `BEFORE` tendría que simular el resultado
-- («si esta fila deja de ser administradora, ¿cuántas quedan?»), y simular es
-- justo donde se cuelan los errores. Un `AFTER` cuenta sobre la tabla ya
-- cambiada y deshace la transacción si el resultado no vale. Además, PostgreSQL
-- encola los disparadores `AFTER ... FOR EACH ROW` hasta el final de la
-- sentencia, así que un solo UPDATE que degrade a los dos administradores de
-- golpe también queda cazado: no hay ventana entre fila y fila.
--
-- LO QUE NO SE IMPIDE, a propósito:
--   · INSERT, que nunca puede dejar el grupo sin administradores;
--   · el borrado de la organización entera: sus filas se van en cascada y el
--     disparador se aparta si la organización ya no existe. Protegerlo haría
--     imposible borrar una organización, que es otra cosa;
--   · nombrar a varios administradores, que es justo lo que se pretende.
--
-- La salida para una migración futura es la de la 0020: `set local
-- app.migracion_catalogos = 'on'` dentro de su transacción. Queda escrito en un
-- fichero revisable y no viaja en una petición REST.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Y ES `SECURITY DEFINER`, A DIFERENCIA DE LOS DISPARADORES DE LA 0020 Y LA 0021
--
-- Aquellos solo comparan OLD y NEW, así que no necesitan privilegios. Este LEE
-- la tabla para contar, y eso cambia todo: sin `security definer`, la consulta
-- del disparador pasa por RLS con los permisos de quien hizo el cambio.
--
-- La primera versión no lo era y la prueba [161] la tumbó. El caso exacto:
-- el último administrador se desactiva a sí mismo (`is_active = false`).
-- `app.my_org_ids()` solo devuelve las organizaciones donde la pertenencia está
-- ACTIVA, de modo que, en el instante siguiente al cambio, su propia
-- organización ya no era visible para él. La guarda de abajo —«si la
-- organización ya no existe, no hay nada que proteger», puesta para no impedir
-- el borrado de una organización— se cumplía por el motivo equivocado: la
-- organización existía; él había dejado de poder verla. El disparador se
-- apartaba y dejaba pasar justo la operación que venía a impedir.
--
-- Es decir: fallaba ABIERTO, y en silencio. Una comprobación de seguridad que
-- se desactiva sola en el único caso que importa es peor que no tenerla, porque
-- ocupa su sitio. Las comprobaciones que leen tablas van con los privilegios del
-- propietario, como el resto de `app.*`.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_last_org_admin()
returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_admins int;
begin
  if coalesce(current_setting('app.migracion_catalogos', true), '') = 'on' then
    return null;
  end if;

  -- En un DELETE no hay NEW; en un UPDATE, las dos existen. La organización es
  -- inmutable en la práctica, pero se toma de OLD primero por si no lo fuera.
  v_org := coalesce(old.organization_id, new.organization_id);

  -- La organización entera puede haberse ido en cascada. Entonces no hay nada
  -- que proteger: exigir un administrador aquí impediría borrarla.
  if not exists (select 1 from organizations where id = v_org) then
    return null;
  end if;

  select count(*) into v_admins
    from organization_members
   where organization_id = v_org
     and is_active
     and role in ('OWNER','ADMIN');

  if v_admins = 0 then
    raise exception 'El grupo se quedaria sin ningun administrador. Nombra antes a otra persona: el papel de administrador solo lo puede conceder un administrador, asi que sin ninguno no habria forma de recuperarlo desde la aplicacion.';
  end if;

  return null;
end;
$$;

revoke all on function app.enforce_last_org_admin() from public;
revoke all on function app.enforce_last_org_admin() from anon;

drop trigger if exists org_members_last_admin on organization_members;
create trigger org_members_last_admin
  after update or delete on organization_members
  for each row execute function app.enforce_last_org_admin();

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_org   uuid;
  v_admin uuid;
begin
  -- 1. El disparador está, y en las dos operaciones que importan.
  select count(*) into v_n from pg_trigger
   where tgname = 'org_members_last_admin' and not tgisinternal;
  if v_n <> 1 then
    raise exception '0023: falta el disparador org_members_last_admin';
  end if;

  -- 1.bis Y es `security definer`. No es un detalle de estilo: sin eso, la
  --       consulta que cuenta administradores pasa por RLS con los permisos de
  --       quien hizo el cambio, y un administrador que se desactiva deja de ver
  --       su propia organizacion. La comprobacion se apartaria sola justo en el
  --       caso que debe impedir. Lo cazo la prueba [161].
  if not (select prosecdef from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname = 'enforce_last_org_admin') then
    raise exception '0023: app.enforce_last_org_admin debe ser security definer o falla ABIERTO';
  end if;

  -- 2. Y MUERDE, probado de verdad: se busca una organizacion con UN solo
  --    administrador y se intenta degradarlo. Con los privilegios del
  --    propietario, que es el caso mas favorable: si aqui no salta, no salta
  --    nunca. Si no hay datos todavia (migracion aplicada antes del seed), se
  --    dice y no se finge que se ha comprobado.
  select organization_id into v_org
    from organization_members
   where is_active and role in ('OWNER','ADMIN')
   group by organization_id
  having count(*) = 1
   limit 1;

  if v_org is null then
    raise notice '0023: sin datos para probar el disparador (ninguna organizacion con un unico administrador)';
  else
    select user_id into v_admin
      from organization_members
     where organization_id = v_org and is_active and role in ('OWNER','ADMIN')
     limit 1;

    begin
      update organization_members set role = 'MEMBER'
       where organization_id = v_org and user_id = v_admin;
      raise exception '0023: el disparador NO impidio quedarse sin administradores';
    exception
      when others then
        if position('sin ningun administrador' in sqlerrm) = 0 then raise; end if;
    end;

    begin
      delete from organization_members
       where organization_id = v_org and user_id = v_admin;
      raise exception '0023: el disparador NO impidio borrar al ultimo administrador';
    exception
      when others then
        if position('sin ningun administrador' in sqlerrm) = 0 then raise; end if;
    end;

    -- Y que no sea un disparador que lo bloquea TODO: desactivar a un miembro
    -- normal tiene que seguir funcionando.
    if exists (select 1 from organization_members
                where organization_id = v_org and role = 'MEMBER' and is_active) then
      update organization_members set is_active = false
       where organization_id = v_org and role = 'MEMBER' and is_active
         and user_id = (select user_id from organization_members
                         where organization_id = v_org and role = 'MEMBER' and is_active limit 1);
      -- Se deja como estaba: esto es una comprobacion, no un cambio de datos.
      update organization_members set is_active = true
       where organization_id = v_org and role = 'MEMBER' and not is_active;
    end if;

    raise notice 'CORRECTO: 0023 el ultimo administrador no se puede degradar ni borrar';
  end if;

  raise notice '0023 aplicada: el grupo no se queda sin administradores.';
end $$;
