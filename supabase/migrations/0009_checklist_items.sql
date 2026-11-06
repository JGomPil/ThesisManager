-- =============================================================================
-- 0009 · Quien tiene la tarea puede marcar los puntos de su lista
--
-- EL PROBLEMA
-- Las listas de comprobación se implementan como subtareas reales
-- (`tasks.parent_task_id`), de modo que heredan la seguridad de `tasks` sin
-- añadir políticas nuevas. Pero la política `tasks_update` exige
-- `assignee_id = app.uid()`, y los puntos de una lista no llevan responsable:
-- el responsable es el de la tarea que los contiene.
--
-- Resultado: el estudiante veía su lista y al marcar un punto la operación no
-- afectaba a ninguna fila. Sin error de permisos, sin mensaje: una casilla que
-- parecía funcionar y no hacía nada. Lo detectó la prueba [43] antes de que
-- llegara a la aplicación.
--
-- POR QUÉ NO SE RESUELVE COPIANDO EL RESPONSABLE AL CREAR EL PUNTO
-- Sería más simple, pero quedaría desincronizado: al reasignar la tarea a otra
-- persona, los puntos seguirían apuntando a la anterior y volvería el mismo
-- fallo silencioso. La pertenencia de un punto es la de su tarea, así que es
-- la política la que debe mirar ahí, y no un dato duplicado.
--
-- La consulta va en una función SECURITY DEFINER, como el resto de `app`, por
-- dos razones: evita que una política sobre `tasks` tenga que leer `tasks`
-- pasando otra vez por RLS, y al ser STABLE se evalúa una vez por sentencia en
-- lugar de una por fila.
-- =============================================================================

create or replace function app.is_parent_task_assignee(parent uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select parent is not null
     and exists (
       select 1 from tasks
       where id = parent and assignee_id = auth.uid()
     );
$$;

revoke all on function app.is_parent_task_assignee(uuid) from public;
revoke all on function app.is_parent_task_assignee(uuid) from anon;
grant execute on function app.is_parent_task_assignee(uuid) to authenticated;

-- El disparador `app.enforce_task_update_scope()` sigue limitando a esta
-- persona a la columna `status`: puede marcar el punto, no renombrarlo ni
-- moverlo de tarea. Esta política decide SI puede tocar la fila; el disparador,
-- QUÉ columnas.
alter policy tasks_update on tasks
  using (
    app.can_manage_plan(work_id)
    or assignee_id = app.uid()
    or app.is_parent_task_assignee(parent_task_id)
  )
  with check (
    app.can_manage_plan(work_id)
    or assignee_id = app.uid()
    or app.is_parent_task_assignee(parent_task_id)
  );

do $$
begin
  if not has_function_privilege('authenticated', 'app.is_parent_task_assignee(uuid)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.is_parent_task_assignee';
  end if;
  if has_function_privilege('anon', 'app.is_parent_task_assignee(uuid)', 'execute') then
    raise exception 'anon puede ejecutar app.is_parent_task_assignee';
  end if;
  raise notice 'Listas de comprobacion: el responsable de la tarea puede marcar sus puntos.';
end $$;
