-- =============================================================================
-- El color de una tarea (migracion 0026)
--
-- QUE SE JUEGA AQUI
-- Poco, y por eso la prueba es corta: el color no significa nada para la
-- aplicacion, asi que no hay ningun calculo que pueda mentir. Lo unico que hay
-- que fijar es QUIEN pinta.
--
-- CAMBIO DE DOCTRINA EN LA 0030: antes el color era un campo del plan y el
-- responsable no lo tocaba. Ahora el responsable escribe SU tarea entera, color
-- incluido. El limite se ha movido, no se ha quitado: de «que campo es» a «de
-- quien es la tarea», y eso es lo que comprueba la segunda mitad.
-- =============================================================================

\echo '================ COLOR DE UNA TAREA ================'

\echo '[175] Pintan quien planifica y el responsable; la tarea de otro, no'
do $$
declare v_color text;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set color = 'violet' where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select color into v_color from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_color <> 'violet' then
    raise exception 'FALLO [175]: quien planifica no ha podido pintar la tarea (%)', coalesce(v_color,'NULO');
  end if;

  -- El estudiante es el RESPONSABLE de esta tarea: desde la 0030 la escribe
  -- entera, y el color es parte de lo suyo.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set color = 'red' where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  if (select color from tasks where id = 'dddddddd-0000-0000-0000-000000000001') <> 'red' then
    raise exception 'FALLO [175]: el responsable no ha podido pintar su tarea';
  end if;

  -- Y EL LIMITE: una tarea del mismo trabajo que no es suya. Aqui no salta
  -- ninguna excepcion, porque `tasks_update` le descarta la fila y el UPDATE
  -- dice «0 filas»; asi que se comprueba el DATO.
  insert into tasks (id, work_id, title, assignee_id, color)
  values ('dddddddd-0000-0000-0000-000000000175','bbbbbbbb-0000-0000-0000-000000000001',
          'Tarea del director','22222222-2222-2222-2222-222222222222','slate');

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set color = 'red' where id = 'dddddddd-0000-0000-0000-000000000175';
  reset role;
  if (select color from tasks where id = 'dddddddd-0000-0000-0000-000000000175') <> 'slate' then
    raise exception 'FALLO DE SEGURIDAD [175]: ha repintado la tarea de otro';
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
