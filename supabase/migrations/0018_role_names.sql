-- =============================================================================
-- 0018 · «Director», no «Director principal»
--
-- EL PORQUÉ, que es de lenguaje y no de modelo
-- El catálogo llamaba `Director principal` a la función `PRIMARY_SUPERVISOR`, y
-- ese nombre se pinta tal cual en la pantalla de Personas, en los informes y en
-- los participantes de cada trabajo. En el uso académico real, quien dirige una
-- tesis o un TFG es **el director**, sin apellido: lo de «principal» solo tiene
-- sentido frente a «codirector», y para eso ya está la palabra «codirector».
--
-- LO QUE NO CAMBIA, Y CONVIENE TENERLO CLARO
--   · El `code` sigue siendo `PRIMARY_SUPERVISOR`. Las políticas RLS leen los
--     FLAGS (`is_supervisory`, `can_manage_plan`…), nunca el nombre ni el
--     código, así que esto no toca la seguridad ni por asomo.
--   · `work_members.is_primary` sigue existiendo y significando otra cosa: de
--     entre varias personas con la MISMA función en un trabajo, cuál es la de
--     referencia. Que el nombre de la función ya no diga «principal» no lo
--     vuelve ambiguo; al contrario, deja de competir con él.
--
-- SE ACTUALIZA CON CUIDADO: solo si el nombre sigue siendo el que puso el
-- catálogo inicial. Si alguien lo ha cambiado a mano desde Administración →
-- Catálogos, esta migración no le pisa su decisión. Un `update` incondicional
-- sobre datos que el usuario puede editar es una forma silenciosa de deshacer
-- el trabajo de otro.
-- =============================================================================

update work_roles
   set name = 'Director'
 where code = 'PRIMARY_SUPERVISOR'
   and name = 'Director principal';

do $$
declare v_nombre text;
begin
  select name into v_nombre from work_roles where code = 'PRIMARY_SUPERVISOR';

  if v_nombre is null then
    raise notice 'Migracion 0018: no existe PRIMARY_SUPERVISOR en este despliegue, nada que hacer.';
  elsif v_nombre = 'Director principal' then
    raise exception 'La funcion sigue llamandose «Director principal» y deberia ser «Director».';
  else
    raise notice 'Migracion 0018 correcta: la funcion se llama «%».', v_nombre;
  end if;
end $$;
