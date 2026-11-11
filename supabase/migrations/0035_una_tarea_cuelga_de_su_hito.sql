-- =============================================================================
-- 0035 · Una tarea cuelga de su hito
--
-- `tasks.milestone_id` existe desde la 0002 y hasta hoy no la escribia nadie:
-- la columna estaba, la relacion no. Era uno de los huecos que el guarda
-- `check:columnas` cantaba en cada ejecucion -el que mas se echaba en falta-,
-- porque un hito es UNA FECHA QUE HAY QUE CUMPLIR y lo que de verdad se
-- pregunta ante esa fecha es «que me queda por hacer para llegar».
--
-- LO QUE HACE FALTA EN LA BASE NO ES UN PERMISO: ES INTEGRIDAD. Quien puede
-- escribir la columna ya estaba decidido desde la 0030 -quien planifica, y el
-- responsable en su tarea; para todos los demas `milestone_id` esta en la lista
-- de columnas protegidas del disparador de alcance-. Lo que no comprobaba nadie
-- es que el hito SEA DEL MISMO TRABAJO que la tarea.
--
-- Y la clave ajena no lo comprueba: `milestone_id references milestones(id)`
-- admite cualquier hito de cualquier trabajo. Sin esta migracion, una peticion
-- a PostgREST -no la pantalla: la pantalla ofrece solo los hitos del trabajo-
-- podia colgar una tarea del deposito de la tesis de otra persona. No da ningun
-- error, y lo que se ve despues es un hito con tareas que nadie de ese trabajo
-- reconoce. Es el mismo razonamiento que la 0031 ya habia aplicado al mudar una
-- tarea de trabajo: alli el `milestone_id` SE SUELTA, justamente porque el hito
-- se queda en el trabajo viejo.
--
-- SE PROTEGE CON UN DISPARADOR Y NO CON UN `check`: una restriccion de tabla no
-- puede consultar otra tabla. Y en los dos sentidos, insert y update, porque un
-- alta tambien puede traer la columna puesta.
-- =============================================================================

create or replace function app.enforce_task_milestone_same_work()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.milestone_id is not null and not exists (
    select 1 from milestones m
     where m.id = new.milestone_id
       and m.work_id = new.work_id
  ) then
    raise exception 'Una tarea solo puede colgar de un hito de su propio trabajo'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_task_milestone_same_work() from public;
revoke all on function app.enforce_task_milestone_same_work() from anon;

drop trigger if exists tasks_milestone_same_work on tasks;
create trigger tasks_milestone_same_work
  before insert or update on tasks
  for each row execute function app.enforce_task_milestone_same_work();

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tasks'::regclass
       and tgname = 'tasks_milestone_same_work'
  ) then
    raise exception '0035: falta el disparador que ata la tarea al hito de su trabajo';
  end if;

  -- El disparador de alcance sigue protegiendo la columna para quien no es ni
  -- responsable ni planifica. Es una lista escrita a mano (0026, §5.2.octovicies)
  -- y se comprueba que `milestone_id` siga en ella: si saliera, cualquier
  -- participante podria recolocar el plan de otro sin que nada fallara.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_task_update_scope';
  if v_def not like '%milestone_id%' then
    raise exception '0035: enforce_task_update_scope ya no protege milestone_id';
  end if;

  -- Y mudar una tarea de trabajo sigue soltando el hito: si no, la tarea
  -- llegaria al trabajo nuevo colgada de un hito del viejo, que es exactamente
  -- lo que el disparador de arriba prohibe. Las dos reglas tienen que decir lo
  -- mismo o una de las dos es mentira.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'mover_tarea_de_trabajo';
  if v_def not like '%milestone_id%' then
    raise exception '0035: mover_tarea_de_trabajo ya no suelta el hito del trabajo viejo';
  end if;

  raise notice '0035 OK: una tarea cuelga de un hito, y solo de uno de su trabajo.';
end $$;
