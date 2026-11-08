-- =============================================================================
-- LinkedIn en el perfil (migracion 0028)
--
-- QUE SE JUEGA AQUI
-- Una columna nueva en `profiles` no trae politica propia: hereda la de la fila
-- (`app.can_see_profile`, 0016/0017). Esta prueba lo fija, porque es la clase de
-- cosa que se da por supuesta y que, si algun dia dejara de ser verdad, no
-- avisaria: un dato de contacto visible para todo el grupo en lugar de para
-- quien tiene relacion academica con esa persona.
--
--   ajeno = 4444...  MEMBER de la organizacion, SIN relacion academica con el
--                    estudiante (3333...)
-- =============================================================================

\echo '================ LINKEDIN EN EL PERFIL ================'

\echo '[178] El LinkedIn se guarda en el perfil propio, y no lo ve quien no ve el perfil'
do $$
declare v_url text; v_filas int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update profiles set linkedin_url = 'https://www.linkedin.com/in/estudiante/'
   where id = '33333333-3333-3333-3333-333333333333';
  select linkedin_url into v_url from profiles where id = '33333333-3333-3333-3333-333333333333';
  reset role;
  if v_url is distinct from 'https://www.linkedin.com/in/estudiante/' then
    raise exception 'FALLO [178]: no se ha guardado el LinkedIn propio (%)', coalesce(v_url,'NULO');
  end if;

  -- Y quien no tiene relacion academica con el estudiante no ve su ficha: ni el
  -- LinkedIn ni nada. Se cuentan FILAS, porque la politica no oculta columnas,
  -- oculta la persona entera.
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  select count(*) into v_filas from profiles
   where id = '33333333-3333-3333-3333-333333333333';
  reset role;
  if v_filas <> 0 then
    raise exception 'FALLO DE SEGURIDAD [178]: un miembro sin relacion academica ve la ficha ajena';
  end if;
  raise notice 'CORRECTO [178]';
end $$;
