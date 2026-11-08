-- =============================================================================
-- 0024 · Las columnas del tablero son del TRABAJO, y solo tienen nombre
--
-- QUE RESUELVE
-- El tablero dibujaba una columna por cada valor del `check` de `tasks.status`
-- —Pendiente, En curso, Bloqueada, En revision, Completada— y agrupaba las
-- tarjetas por ese estado. Es decir: el tablero lo decidia el codigo, y el
-- orden dentro de cada columna no lo decidia nadie.
--
-- Esto se parece a Trello, que es lo que se ha pedido: un tablero por trabajo,
-- con las LISTAS que quiera quien lo dirige —«Papers», «Estudios», «Enviado a
-- revision»— y las tarjetas arrastrandose entre ellas y dentro de ellas.
--
-- TRES DECISIONES, Y LAS TRES SE PUEDEN LEER EN LA TABLA
--
-- 1. LAS COLUMNAS SON DEL TRABAJO, no de la organizacion: `work_id`. Un
--    tablero es de un trabajo igual que una lista de Trello es de su tablero.
--    Por eso quien las administra es quien dirige ese trabajo —la politica usa
--    `app.can_manage_plan`, la misma que los hitos y las fases—, y no la
--    administracion del grupo: la direccion de una tesis no tiene por que
--    pedirle a nadie que le cambie el nombre de una columna.
--
-- 2. UNA COLUMNA NO SIGNIFICA NADA. No hay `maps_to`: la columna tiene nombre,
--    color y orden, y ya. El estado de la tarea —`tasks.status`— sigue siendo
--    un dato suyo, independiente, que se ve y se cambia en la propia tarjeta.
--    Mover una tarjeta NO cambia el estado, y cambiar el estado NO mueve la
--    tarjeta. Son dos clasificaciones a la vez, que es justo lo que hace falta:
--    «Papers» no es un estado, y una tarjeta de «Papers» puede estar pendiente
--    o en curso.
--
--    La primera version de esta migracion hacia que cada columna declarase su
--    significado y derivaba `tasks.status` de ella. Sobraba: obligaba a elegir
--    un significado para cada nombre que se inventara, y el significado ya esta
--    en la tarjeta. Lo que si hay que mantener es que el progreso del trabajo,
--    los colores del cronograma, los bloqueos por dependencia y los informes
--    siguen leyendo `tasks.status`, que es lo que hacen desde la 0002: esta
--    migracion no toca ese campo.
--
-- 3. SIN COLUMNAS, EL TABLERO ES EL DE ANTES. Ningun trabajo nace con
--    columnas, y la migracion no siembra ninguna: mientras un trabajo no tenga
--    las suyas, el tablero agrupa por estado exactamente como hasta ahora. Es
--    la unica forma de que esto no sea un cambio obligatorio para quien no lo
--    ha pedido.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Si estaba aplicada la PRIMERA version de esta misma migracion
-- -----------------------------------------------------------------------------
-- Aquella tenia las columnas por organizacion y con `maps_to`. Entre una y
-- otra no hay conversion posible —ni sensata: una columna del grupo no se
-- reparte entre trabajos—, asi que se tira y se vuelve a empezar. Lo que se
-- pierde son las columnas que se hubieran creado, no las tareas: las tarjetas
-- se quedan sin columna, y sin columna el tablero las agrupa por estado, que es
-- el comportamiento de siempre.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_columns'
       and column_name = 'organization_id'
  ) then
    update tasks set board_column_id = null where board_column_id is not null;
    drop table board_columns cascade;
    raise notice 'AVISO: se descarta la version anterior de board_columns (columnas por organizacion)';
  end if;
end $$;

drop trigger if exists sync_task_board_column on tasks;
drop function if exists app.sync_task_board_column();
drop function if exists app.sync_board_column_meaning();

-- -----------------------------------------------------------------------------
-- Las columnas
-- -----------------------------------------------------------------------------
create table if not exists board_columns (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references academic_works(id) on delete cascade,
  name          text not null,
  color         text,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  -- Dos columnas con el mismo nombre en el mismo tablero no se distinguen, y
  -- arrastrar una tarjeta a «la de Papers» dejaria de querer decir algo.
  constraint board_columns_nombre_unico unique (work_id, name),
  constraint board_columns_nombre_no_vacio check (char_length(btrim(name)) between 1 and 60)
);

create index if not exists board_columns_work_idx on board_columns (work_id, display_order);

alter table board_columns enable row level security;

-- Las ve cualquiera que vea el trabajo: sin las columnas no se puede dibujar el
-- tablero, y el nombre de una columna no es un dato de nadie.
drop policy if exists board_columns_select on board_columns;
create policy board_columns_select on board_columns for select to authenticated
  using (work_id in (select app.accessible_work_ids()));

-- Y las administra quien planifica ESE trabajo: la direccion, y la
-- administracion del grupo por la via de `app.is_admin_of_work`. La misma
-- politica que los hitos y las fases de la 0003, que es la frase que ya
-- significaba «esto es el plan de trabajo».
drop policy if exists board_columns_write on board_columns;
create policy board_columns_write on board_columns for all to authenticated
  using (app.can_manage_plan(work_id)) with check (app.can_manage_plan(work_id));

-- -----------------------------------------------------------------------------
-- En que columna esta cada tarjeta
-- -----------------------------------------------------------------------------
-- NULL = sin columna. No es un hueco a rellenar: es lo que tienen todas las
-- tareas hasta que alguien crea columnas, y lo que vuelven a tener si se borra
-- la suya.
alter table tasks add column if not exists board_column_id uuid;
alter table tasks drop constraint if exists tasks_board_column_id_fkey;
-- `restrict` y no `set null`: borrar una columna con tarjetas dentro las
-- esparciria sin que nadie lo haya pedido. La aplicacion solo ofrece borrar las
-- vacias, y la base de datos lo garantiza aunque la peticion venga de otro
-- sitio.
alter table tasks add constraint tasks_board_column_id_fkey
  foreign key (board_column_id) references board_columns(id) on delete restrict;

create index if not exists tasks_board_column_idx on tasks (board_column_id);

-- -----------------------------------------------------------------------------
-- La columna tiene que ser del MISMO trabajo que la tarea
-- -----------------------------------------------------------------------------
-- Es lo unico que la clave ajena no puede comprobar, y sin esto una tarjeta
-- podria acabar en el tablero de otro trabajo: invisible donde estaba y
-- apareciendo donde no es.
--
-- `security definer`, y es imprescindible: esta funcion LEE `board_columns`
-- para saber de que trabajo es la columna. Con los permisos de quien escribe,
-- RLS le esconderia precisamente la columna de otro trabajo —la que hay que
-- rechazar—, el `select` no devolveria fila y la comprobacion se apartaria
-- sola. Es el fallo ABIERTO que tumbo la primera version de la 0023
-- (SECURITY.md §5.2.quatervicies.bis): una comprobacion que se desactiva en el
-- unico caso que importa.
create or replace function app.assert_task_board_column_same_work()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_work uuid;
begin
  if new.board_column_id is not null
     and (tg_op = 'INSERT' or new.board_column_id is distinct from old.board_column_id)
  then
    select work_id into v_work from board_columns where id = new.board_column_id;
    if not found then
      raise exception 'La columna del tablero no existe' using errcode = 'foreign_key_violation';
    end if;
    if v_work is distinct from new.work_id then
      raise exception 'Esa columna es de otro trabajo' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.assert_task_board_column_same_work() from public;

drop trigger if exists assert_task_board_column_same_work on tasks;
create trigger assert_task_board_column_same_work
  before insert or update on tasks
  for each row execute function app.assert_task_board_column_same_work();

-- -----------------------------------------------------------------------------
-- De paso: la marca de completado, en un solo sitio
-- -----------------------------------------------------------------------------
-- `completed_at` la ponia el cliente al cambiar el estado desde el desplegable.
-- Cualquier otra via de cambiar el estado —la lista de comprobacion, una
-- peticion a PostgREST— dejaba una tarea COMPLETADA sin `completed_at`, y una
-- tarea asi no aparece en ningun recuento por fechas: no da error, falta de los
-- informes. Aqui se decide una vez y para todas las vias.
--
-- Solo rellena lo que falta: una fecha de completado puesta a mano —poner al
-- dia una tarea que se termino la semana pasada— se respeta.
create or replace function app.sync_task_completed_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'COMPLETADA' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'COMPLETADA' and new.completed_at is not null then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app.sync_task_completed_at() from public;

drop trigger if exists sync_task_completed_at on tasks;
create trigger sync_task_completed_at
  before insert or update on tasks
  for each row execute function app.sync_task_completed_at();

-- -----------------------------------------------------------------------------
-- Lo que puede tocar quien no planifica: su columna y su sitio
-- -----------------------------------------------------------------------------
-- `app.enforce_task_update_scope()` (0003) enumeraba lo que NO puede cambiar
-- quien no tiene `can_manage_plan`, y en esa lista estaba `order_index`, con el
-- argumento de que ordenar el tablero es planificar.
--
-- Con un tablero que se arrastra, ese argumento se vuelve contra si mismo:
-- soltar una tarjeta ESCRIBE una posicion, siempre. Si se permite cambiar de
-- columna pero no la posicion, el gesto falla con «Solo puede actualizarse el
-- estado de la tarea», que no le dice nada a quien acaba de arrastrar su propia
-- tarea. Y RLS ya limita el daño: `tasks_update` solo le deja escribir las
-- filas donde es responsable, asi que mueve SUS tarjetas y ninguna otra.
--
-- Lo que sigue prohibido es lo que cambia el plan: titulo, descripcion,
-- responsable, prioridad, fechas, trabajo, tarea padre e hito.
create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id)
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
  if not exists (select 1 from pg_policy where polname = 'board_columns_write') then
    raise exception '0024: falta la politica board_columns_write';
  end if;
  -- Que las columnas sean del TRABAJO no es un detalle de forma: de ahi sale
  -- que las administre la direccion y no la administracion del grupo.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_columns' and column_name = 'work_id'
  ) then
    raise exception '0024: board_columns tiene que ser del trabajo (falta work_id)';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_columns' and column_name = 'maps_to'
  ) then
    raise exception '0024: board_columns.maps_to sigue ahi; una columna solo tiene nombre';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'assert_task_board_column_same_work' and p.prosecdef
  ) then
    raise exception '0024: el disparador assert_task_board_column_same_work no existe o no es security definer (fallaria ABIERTO)';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'sync_task_completed_at'
  ) then
    raise exception '0024: falta el disparador sync_task_completed_at';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'board_column_id'
  ) then
    raise exception '0024: falta tasks.board_column_id';
  end if;
  raise notice 'CORRECTO: 0024 columnas del tablero, del trabajo y con nombre libre';
end $$;
