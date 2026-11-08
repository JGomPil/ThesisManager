-- =============================================================================
-- El color de una tarea (migracion 0026)
--
-- QUE SE JUEGA AQUI
-- Poco, y por eso la prueba es corta: el color no significa nada para la
-- aplicacion, asi que no hay ningun calculo que pueda mentir. Lo unico que hay
-- que fijar es QUIEN pinta, y es lo que no se veria: `tasks_update` deja al
-- responsable escribir su propia fila, de modo que si `color` no estuviera en la
-- lista de campos protegidos de `app.enforce_task_update_scope`, el estudiante
-- podria repintar el plan y nadie recibiria ningun aviso.
-- =============================================================================

\echo '================ COLOR DE UNA TAREA ================'

\echo '[175] Quien planifica pinta una tarea; el responsable de la tarea, no'
do $$
declare v_color text; v_pintada boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set color = 'violet' where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select color into v_color from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_color <> 'violet' then
    raise exception 'FALLO [175]: quien planifica no ha podido pintar la tarea (%)', coalesce(v_color,'NULO');
  end if;

  -- El estudiante es el RESPONSABLE de esta tarea, o sea que RLS le deja
  -- escribir la fila: lo unico que lo impide es el disparador.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update tasks set color = 'red' where id = 'dddddddd-0000-0000-0000-000000000001';
    v_pintada := true;
  exception when others then null;
  end;
  reset role;
  if v_pintada then
    raise exception 'FALLO DE SEGURIDAD [175]: el estudiante ha repintado una tarea del plan';
  end if;
  if (select color from tasks where id = 'dddddddd-0000-0000-0000-000000000001') <> 'violet' then
    raise exception 'FALLO DE SEGURIDAD [175]: el color ha cambiado';
  end if;

  -- Sin color es un valor normal, y es el de todas las tareas de antes de esta
  -- migracion: se comprueba que se puede volver a el.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set color = null where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  if (select color from tasks where id = 'dddddddd-0000-0000-0000-000000000001') is not null then
    raise exception 'FALLO [175]: no se ha podido quitar el color';
  end if;
  raise notice 'CORRECTO [175]';
end $$;
