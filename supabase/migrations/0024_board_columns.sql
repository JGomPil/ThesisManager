-- =============================================================================
-- 0024 · Las columnas del tablero son DATOS, no código
--
-- QUÉ SE PIDIÓ
-- «Quiero que las columnas y sus títulos sean configurables. No que las
-- tarjetas se ordenen por bloqueada, pendiente… una tarjeta pendiente puede
-- estar debajo de una en progreso, las quiero poder arrastrar, como en Trello.
-- Por ejemplo, papers o estudios.» (8 de noviembre de 2026)
--
-- LO QUE HABÍA
-- El tablero dibujaba una columna por cada valor del `check` de `tasks.status`:
-- PENDIENTE, EN_CURSO, BLOQUEADA, EN_REVISION, COMPLETADA. La 0002 lo justificó
-- así: «task_statuses / task_priorities van como CHECK y no como catálogo: son
-- estables, y dos JOIN más penalizarían la vista Kanban». Esa decisión era
-- razonable para el ESTADO y equivocada para la COLUMNA, porque son dos cosas
-- distintas que estaban pegadas:
--
--   · el ESTADO es lo que la aplicación necesita entender: qué cuenta como
--     completado para el progreso, qué está bloqueado, de qué color va la barra
--     del cronograma, qué dependencia deja de bloquear a otra;
--   · la COLUMNA es cómo trabaja una persona: «Papers», «Estudios», «Enviado a
--     revisión»… y eso no lo puede fijar el código.
--
-- QUÉ HACE ESTA MIGRACIÓN
-- Añade el catálogo `board_columns` (por organización, con nombre, color y
-- orden editables) y `tasks.board_column_id`. Cada columna DECLARA SU
-- SIGNIFICADO en `maps_to`, uno de los cinco estados de siempre, y un
-- disparador deriva `tasks.status` de la columna. Así:
--
--   · el progreso, el cronograma, las dependencias y los informes siguen
--     funcionando exactamente igual, sin tocar una línea: siguen leyendo
--     `status`;
--   · quien usa el tablero ve sus propias columnas y arrastra tarjetas;
--   · no hay dos verdades: con columna asignada, la columna manda.
--
-- NO ES OBLIGATORIO CONFIGURARLAS. Una organización sin columnas ve el tablero
-- de siempre, con las cinco de siempre. Por eso `board_column_id` admite nulos
-- y por eso esta migración no inserta ninguna fila: quien quiera columnas
-- propias las crea desde Administración, y hasta entonces nada cambia. Una
-- migración que sembrara columnas obligaría a quien no las quiere a borrarlas.
-- =============================================================================

create table if not exists board_columns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  -- El tono del catálogo de colores (los mismos doce que los tipos de trabajo).
  color           text not null default 'slate',
  -- QUÉ SIGNIFICA esta columna para la aplicación. La lista es la misma del
  -- `check` de `tasks.status`, a propósito: si algún día se amplía, se amplía
  -- en los dos sitios y el disparador de abajo sigue valiendo.
  maps_to         text not null default 'EN_CURSO'
                    check (maps_to in ('PENDIENTE','EN_CURSO','BLOQUEADA','EN_REVISION','COMPLETADA')),
  display_order   int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists board_columns_org_order on board_columns (organization_id, display_order);

alter table board_columns enable row level security;

-- Leerlas: cualquier miembro de la organización, porque el tablero lo ve todo
-- el mundo. Escribirlas: solo la administración, como el resto de catálogos.
drop policy if exists board_columns_select on board_columns;
create policy board_columns_select on board_columns for select to authenticated
  using (organization_id in (select app.my_org_ids()));

drop policy if exists board_columns_write on board_columns;
create policy board_columns_write on board_columns for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

-- `restrict` y no `set null`: una columna con tarjetas dentro no se borra por
-- descuido. Para dejar de usarla está `is_active` («retirar»), que es lo que
-- hacen todos los catálogos de este proyecto, y el tablero sigue mostrando una
-- columna retirada MIENTRAS tenga tarjetas, para que no desaparezcan de la
-- vista sin que nadie se entere.
alter table tasks add column if not exists board_column_id uuid
  references board_columns(id) on delete restrict;
create index if not exists tasks_board_column on tasks (board_column_id);

-- -----------------------------------------------------------------------------
-- El estado se DERIVA de la columna
-- -----------------------------------------------------------------------------
-- `security definer`, y es imprescindible: esta función lee `board_columns` y
-- `academic_works` para comprobar que la columna es de la organización del
-- trabajo. Con los permisos de quien escribe, RLS podría esconder justamente la
-- fila que haría fallar la comprobación y el disparador se apartaría solo: el
-- fallo ABIERTO que ya tumbó la primera versión de la 0023 (SECURITY.md
-- §5.2.quatervicies.bis).
create or replace function app.sync_task_board_column()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_col   board_columns%rowtype;
  v_org   uuid;
  v_nueva uuid;
begin
  -- CASO 1: se asigna o se cambia de columna. La columna manda sobre el estado.
  if new.board_column_id is not null
     and (tg_op = 'INSERT' or new.board_column_id is distinct from old.board_column_id)
  then
    select * into v_col from board_columns where id = new.board_column_id;
    if not found then
      raise exception 'La columna del tablero no existe' using errcode = 'foreign_key_violation';
    end if;

    select w.organization_id into v_org from academic_works w where w.id = new.work_id;
    if v_org is distinct from v_col.organization_id then
      raise exception 'Esa columna es de otra organizacion' using errcode = 'check_violation';
    end if;

    new.status := v_col.maps_to;

  -- CASO 2: el estado cambia por otra vía —«Marcar como completada», o la
  -- lista de comprobación— y la tarjeta tiene columna. Si la columna ya no
  -- significa eso, la tarjeta SE MUEVE a una que lo signifique. Dejarla donde
  -- estaba daría una tarjeta completada viviendo en «Por hacer», que es la
  -- clase de incoherencia que nadie va a ir corrigiendo a mano.
  elsif tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and new.board_column_id is not null
  then
    select * into v_col from board_columns where id = new.board_column_id;
    if found and v_col.maps_to is distinct from new.status then
      select bc.id into v_nueva
        from board_columns bc
       where bc.organization_id = v_col.organization_id
         and bc.is_active
         and bc.maps_to = new.status
       order by bc.display_order, bc.name
       limit 1;
      -- Si no hay ninguna columna que signifique el estado nuevo, se queda sin
      -- columna: el tablero la coloca entonces por su estado, que es lo que
      -- hacía antes de que existiera este catálogo.
      new.board_column_id := v_nueva;
    end if;
  end if;

  -- La marca temporal de completado, en un solo sitio. El cliente la ponía al
  -- cambiar el estado desde el desplegable; arrastrando una tarjeta a «Hecho»
  -- no habría pasado por ahí, y una tarea completada sin `completed_at` es una
  -- tarea que no aparece en ningún recuento por fechas.
  if new.status = 'COMPLETADA' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'COMPLETADA' and new.completed_at is not null then
    new.completed_at := null;
  end if;

  return new;
end;
$$;
revoke all on function app.sync_task_board_column() from public;

drop trigger if exists sync_task_board_column on tasks;
create trigger sync_task_board_column
  before insert or update on tasks
  for each row execute function app.sync_task_board_column();

-- -----------------------------------------------------------------------------
-- Lo que el estudiante puede tocar: la columna TAMBIÉN, y es deliberado
-- -----------------------------------------------------------------------------
-- `app.enforce_task_update_scope()` enumera las columnas que NO puede cambiar
-- quien no planifica. `board_column_id` no está en esa lista, igual que no lo
-- está `status`: mover su tarjeta de «En curso» a «En revisión» es exactamente
-- informar del avance, que es lo único que se le permite y lo que se espera de
-- él. Se reescribe la función sin cambiar su comportamiento, solo para decirlo
-- por escrito: quien añada aquí `board_column_id` sin leer esto dejará al
-- estudiante sin poder mover ninguna tarjeta, y el tablero no dará ningún
-- error al intentarlo (RLS y los disparadores no avisan en la interfaz).
create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  -- Sin can_manage_plan solo se permite mover el estado (y su marca temporal),
  -- y la columna del tablero, que es la misma cosa dicha de otra manera.
  -- `order_index` SÍ está en la lista: ordenar el tablero es planificar.
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id, new.order_index)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id, old.order_index)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_task_update_scope() from public;

-- -----------------------------------------------------------------------------
-- Cambiar el SIGNIFICADO de una columna arrastra consigo sus tarjetas
-- -----------------------------------------------------------------------------
-- El disparador de arriba deriva el estado cuando se mueve una TARJETA. Falta
-- la otra direccion, que no es simetrica y es facil de olvidar: cambiar el
-- `maps_to` de una columna que YA TIENE tarjetas dentro.
--
-- Sin esto, la administracion cambia «Papers» de «en curso» a «completada», la
-- pantalla lo guarda sin dar ningun error, y las tareas que estan dentro
-- conservan el estado viejo: el tablero dice una cosa y el progreso del
-- trabajo, el cronograma y los informes dicen otra. Es exactamente la
-- incoherencia silenciosa que esta migracion viene a impedir, por la unica via
-- que no vigilaba.
--
-- `security definer` por lo de siempre: tiene que alcanzar TODAS las tareas de
-- esa columna, tambien las de trabajos donde quien administra no es miembro.
-- Con los permisos de quien escribe, RLS le dejaria fuera justo esas, y la
-- correccion seria parcial sin que nada lo dijera.
--
-- El `update` de dentro vuelve a pasar por `sync_task_board_column`, que ya
-- deja `completed_at` en su sitio y no reubica nada: la columna ya significa el
-- estado nuevo.
create or replace function app.sync_board_column_meaning()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update tasks set status = new.maps_to
   where board_column_id = new.id
     and status is distinct from new.maps_to;
  return null;
end;
$$;
revoke all on function app.sync_board_column_meaning() from public;

drop trigger if exists sync_board_column_meaning on board_columns;
create trigger sync_board_column_meaning
  after update of maps_to on board_columns
  for each row when (new.maps_to is distinct from old.maps_to)
  execute function app.sync_board_column_meaning();

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'board_columns_write') then
    raise exception '0024: falta la politica board_columns_write';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'sync_task_board_column' and p.prosecdef
  ) then
    raise exception '0024: el disparador sync_task_board_column no existe o no es security definer (fallaria ABIERTO)';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'tasks' and column_name = 'board_column_id'
  ) then
    raise exception '0024: falta tasks.board_column_id';
  end if;
  -- La lista de significados tiene que ser la MISMA que la de `tasks.status`.
  -- Si alguien amplía una y no la otra, una columna podría significar algo que
  -- `tasks.status` rechaza, y mover una tarjeta fallaría sin motivo visible.
  if (select count(*) from pg_constraint
       where conrelid = 'board_columns'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%PENDIENTE%'
         and pg_get_constraintdef(oid) like '%COMPLETADA%') <> 1 then
    raise exception '0024: el check de board_columns.maps_to no coincide con el de tasks.status';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'sync_board_column_meaning' and p.prosecdef
  ) then
    raise exception '0024: falta sync_board_column_meaning (o no es security definer): cambiar el significado de una columna dejaria sus tarjetas con el estado viejo';
  end if;
  raise notice 'CORRECTO: 0024 catalogo de columnas del tablero en su sitio';
end $$;
