-- =============================================================================
-- 0025 · Borrar una tarea deja de ser definitivo
--
-- QUE PASO
-- La papelera del icono de la tarjeta hacia `delete from tasks`: borrado real,
-- en cascada sobre sus subtareas, de un solo clic y sin preguntar nada. Una
-- tarea borrada sin querer NO SE PODIA RECUPERAR de ninguna manera desde la
-- aplicacion: `tasks` no tenia `deleted_at`, y ningun disparador registraba el
-- contenido de lo borrado en `activity_logs`. Paso de verdad, el 8 de noviembre
-- de 2026.
--
-- Y era una incoherencia dentro del propio modelo: los trabajos se archivan
-- desde la 0008 (`deleted_at` + pantalla de archivados), los documentos y los
-- comentarios tambien. Lo mas fragil del plan de trabajo —una tarea, que se
-- borra con un icono que esta al lado de todo lo demas— era lo unico sin vuelta
-- atras.
--
-- QUE HACE ESTA MIGRACION
--   1. `tasks.deleted_at`: borrar es archivar.
--   2. La politica de SELECT deja ver lo archivado a quien puede planificar, y
--      solo a quien puede planificar. Esto NO es un detalle: PostgreSQL exige
--      que la fila resultante de un UPDATE siga siendo visible para quien lo
--      ejecuta, asi que sin esto archivar fallaria; y un archivado invisible
--      para todos seria un borrado con otro nombre. Es la leccion de la 0008
--      (SECURITY.md §5.2.quinquies), aplicada aqui desde el principio.
--   3. Archivar una tarea se lleva sus SUBTAREAS, y restaurarla las devuelve.
--      Sin eso, los puntos de la lista de comprobacion de una tarea archivada
--      se quedarian sueltos: sin padre visible no los ve nadie, pero siguen
--      contando en cualquier consulta que los sume.
--   4. Quien solo informa de lo suyo no archiva ni restaura: `deleted_at` entra
--      en la lista de campos que `app.enforce_task_update_scope` protege.
--
-- El borrado definitivo sigue existiendo (`tasks_delete`, para quien
-- planifica), pero ahora es una segunda decision que se toma mirando la
-- papelera, y no el efecto de pulsar un icono.
-- =============================================================================

alter table tasks add column if not exists deleted_at timestamptz;

-- Las listas normales lo filtran en el repositorio (`.is('deleted_at', null)`),
-- igual que los trabajos archivados. Este indice es para la papelera.
create index if not exists tasks_papelera_idx on tasks (work_id, deleted_at)
  where deleted_at is not null;

-- -----------------------------------------------------------------------------
-- Ver lo archivado: quien planifica, y nadie mas
-- -----------------------------------------------------------------------------
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (
    work_id in (select app.accessible_work_ids())
    and (deleted_at is null or app.can_manage_plan(work_id))
  );

-- -----------------------------------------------------------------------------
-- Archivar una tarea se lleva sus subtareas; restaurarla, las devuelve
-- -----------------------------------------------------------------------------
-- `security definer` porque tiene que alcanzarlas TODAS. Con los permisos de
-- quien escribe, la politica de UPDATE de `tasks` podria descartarle alguna
-- fila —y un UPDATE con filas descartadas no da error—, dejando media lista de
-- comprobacion archivada y la otra media no, en silencio.
--
-- La recursion termina sola: el `where` exige que la subtarea tenga un
-- `deleted_at` distinto del que se le va a poner, asi que la segunda vuelta no
-- encuentra nada que escribir.
create or replace function app.cascade_task_soft_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update tasks set deleted_at = new.deleted_at
   where parent_task_id = new.id
     and deleted_at is distinct from new.deleted_at;
  return null;
end;
$$;
revoke all on function app.cascade_task_soft_delete() from public;

drop trigger if exists cascade_task_soft_delete on tasks;
create trigger cascade_task_soft_delete
  after update of deleted_at on tasks
  for each row when (new.deleted_at is distinct from old.deleted_at)
  execute function app.cascade_task_soft_delete();

-- -----------------------------------------------------------------------------
-- Quien no planifica no archiva
-- -----------------------------------------------------------------------------
-- Se reescribe entera (venia de la 0024) para añadir `deleted_at` a la lista.
-- Mover su tarjeta y cambiar su estado, si; hacer desaparecer la tarea del plan
-- de trabajo, no: eso es planificar.
create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id, new.deleted_at)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id, old.deleted_at)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea y su sitio en el tablero';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_task_update_scope() from public;

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'deleted_at'
  ) then
    raise exception '0025: falta tasks.deleted_at';
  end if;
  -- Que la politica de SELECT mencione `deleted_at`: sin eso, o no se puede
  -- archivar, o lo archivado no lo ve nadie.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_select'
       and qual like '%deleted_at%'
  ) then
    raise exception '0025: tasks_select no mira deleted_at; archivar seria imposible o irreversible';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'cascade_task_soft_delete' and p.prosecdef
  ) then
    raise exception '0025: falta cascade_task_soft_delete (o no es security definer): las subtareas se quedarian sueltas';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'enforce_task_update_scope') not like '%deleted_at%' then
    raise exception '0025: enforce_task_update_scope no protege deleted_at; cualquiera podria archivar su tarea';
  end if;
  raise notice 'CORRECTO: 0025 la papelera de tareas, con vuelta atras';
end $$;
