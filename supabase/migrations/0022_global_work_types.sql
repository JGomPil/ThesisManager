-- =============================================================================
-- 0022 · Los tipos de trabajo GLOBALES, administrables
--
-- QUÉ FALLABA, Y CÓMO SE VIO
-- Al editar un tipo de trabajo precargado —TFG, TFM, TESIS, ACADEMIA— la
-- pantalla respondía:
--
--     Cannot coerce the result to a single JSON object [PGRST116]
--     The result contains 0 rows
--
-- No era un fallo de la interfaz. La política `work_types_write` de la 0003
-- exige `organization_id is not null`, así que un UPDATE sobre una fila global
-- no afectaba a NINGUNA fila: PostgreSQL no da error cuando una política
-- descarta filas en un UPDATE, simplemente no las toca, y el cliente pedía una
-- fila de vuelta (`.single()`) y recibía cero. El código de PostgREST que
-- asomaba en el aviso era el síntoma; la causa era que no se podía editar.
--
-- Y la pantalla afirmaba dos cosas que no eran ciertas:
--   · el aviso ámbar del diálogo decía «si lo editas, el cambio afecta a todas
--     las organizaciones», cuando no se podía editar en absoluto;
--   · el pie decía que los datos de un tipo global «solo pueden editarse si se
--     copian a tu organización», un camino que no existe en ninguna parte.
--
-- El mismo agujero dejaba inútil el botón de desactivar de la lista: retirar un
-- tipo es un UPDATE de `is_active`, así que fallaba igual.
--
-- Síntoma gemelo, y por eso se explica aquí: «en todos los tipos pone global
-- menos en Prácticas». Correcto y esperado —Prácticas la creó la organización y
-- los otros vienen del catálogo inicial—, pero era además la razón por la que
-- Prácticas era el ÚNICO tipo editable.
--
-- -----------------------------------------------------------------------------
-- LA DECISIÓN, Y POR QUÉ ESTA Y NO LA OTRA
--
-- Había dos salidas. La primera, ofrecer un «adoptar en mi organización» que
-- copie el tipo global a la organización y edite la copia. Se descarta: deja
-- dos TFG en el catálogo, y el global no se puede ni ocultar —ocultarlo es
-- justamente el UPDATE que no se podía hacer—, con lo que el desplegable de
-- alta de trabajo acabaría con el tipo duplicado para siempre.
--
-- La segunda, que es esta: la administración edita las filas globales, con el
-- mismo razonamiento y los mismos límites que la 0020 y la 0021 ya aplicaron a
-- los estados, los roles y los tipos de documento. Hoy hay UNA organización
-- —el grupo—, los catálogos globales los comparte quien no existe, y el aviso
-- de la pantalla pasa a ser verdad en lugar de mentira.
--
-- SOLO UPDATE, NUNCA DELETE, por lo mismo que en la 0021: un tipo global lo
-- comparten todas las organizaciones, y `academic_works.work_type_id` es
-- `on delete restrict`, que protege los tipos EN USO pero no uno recién creado
-- y sin trabajos. Retirar (`is_active = false`) es reversible y conserva el
-- histórico; borrar no. Los tipos propios de la organización se siguen
-- pudiendo borrar con `work_types_write`, que no se toca.
--
-- Y DOS COSAS QUE SE CIERRAN AL ABRIR ESTA PUERTA:
--
--   1. La ORGANIZACIÓN de un tipo es inmutable. Con dos políticas permisivas,
--      PostgreSQL combina con OR los `USING` entre sí y los `WITH CHECK` entre
--      sí, por separado: no empareja las dos condiciones de la misma política
--      (SECURITY.md §5.2.tervicies, descubierto por la prueba [152] con los
--      tipos de documento). Un tipo global que pasa a propio cumpliría el
--      `USING` de la política nueva y el `WITH CHECK` de `work_types_write`, y
--      el cambio pasaría. Lo impide un disparador, que es lo único que puede.
--
--   2. El CÓDIGO de un tipo es inmutable, como el de los estados en la 0020.
--      La aplicación no casa nunca por código —de eso va el catálogo: evita el
--      `if (tipo === 'TFG')`—, pero el catálogo inicial y la 0021 sí buscan
--      `code = 'ACADEMIA'`, y el `on conflict` del `seed` casa por código. Un
--      TFG renombrado a mano haría que una reinstalación creara un segundo TFG
--      sin avisar. La interfaz ya trataba el código como inmutable al editar
--      («puede estar referenciado»); ahora lo trata también la base de datos,
--      que es donde las prohibiciones se cumplen.
--
-- La salida para una migración futura es la de la 0020: `set local
-- app.migracion_catalogos = 'on'` dentro de su transacción, que queda escrito
-- en un fichero revisable y no viaja en una petición REST.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Los tipos globales: solo UPDATE
--
-- `app.is_any_org_admin()` es de la 0020: `app.is_org_admin(org)` necesita una
-- organización y estas filas no son de ninguna.
-- -----------------------------------------------------------------------------
drop policy if exists work_types_update_global on work_types;
create policy work_types_update_global on work_types for update to authenticated
  using (organization_id is null and app.is_any_org_admin())
  with check (organization_id is null and app.is_any_org_admin());

-- -----------------------------------------------------------------------------
-- 2. La organización y el código, inmutables
--
-- NO es `security definer`: no necesita privilegios, solo compara OLD y NEW.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_work_type_inmutables()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.migracion_catalogos', true), '') = 'on' then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'La organizacion de un tipo de trabajo no se puede cambiar: un tipo global lo comparten todas, y uno propio es de quien lo creo';
  end if;

  if new.code is distinct from old.code then
    raise exception 'El codigo de un tipo de trabajo no se puede cambiar (% -> %): el catalogo inicial y las migraciones casan por codigo',
      old.code, new.code;
  end if;

  return new;
end;
$$;

revoke all on function app.enforce_work_type_inmutables() from public;
revoke all on function app.enforce_work_type_inmutables() from anon;

drop trigger if exists work_types_inmutables on work_types;
create trigger work_types_inmutables
  before update on work_types
  for each row execute function app.enforce_work_type_inmutables();

-- -----------------------------------------------------------------------------
-- 3. Comprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_n int; v_id uuid; v_org uuid;
begin
  -- 3.1 Las dos políticas de escritura están, la vieja y la nueva.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('work_types_write','work_types_update_global');
  if v_n <> 2 then
    raise exception '0022: faltan politicas de escritura de work_types (hay %)', v_n;
  end if;

  -- 3.2 Y la de los globales es SOLO de update: con un `for all` se podrian
  --     borrar, que es justo lo que no debe poder hacerse.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname = 'work_types_update_global' and cmd = 'UPDATE';
  if v_n <> 1 then
    raise exception '0022: work_types_update_global deberia ser solo de UPDATE';
  end if;

  -- 3.3 El disparador está.
  select count(*) into v_n from pg_trigger
   where tgname = 'work_types_inmutables' and not tgisinternal;
  if v_n <> 1 then
    raise exception '0022: falta el disparador work_types_inmutables';
  end if;

  -- 3.4 Y MUERDE, probado de verdad y con los privilegios del propietario, que
  --     es el caso mas favorable: si aqui no salta, no salta nunca.
  select id, organization_id into v_id, v_org
    from work_types where organization_id is null limit 1;
  if v_id is not null then
    begin
      update work_types
         set organization_id = '00000000-0000-0000-0000-000000000000'
       where id = v_id;
      raise exception '0022: el disparador NO impidio mover un tipo de trabajo de organizacion';
    exception
      when others then
        if position('no se puede cambiar' in sqlerrm) = 0 then raise; end if;
    end;

    begin
      update work_types set code = code || '_X' where id = v_id;
      raise exception '0022: el disparador NO impidio cambiar el codigo de un tipo de trabajo';
    exception
      when others then
        if position('no se puede cambiar' in sqlerrm) = 0 then raise; end if;
    end;

    raise notice 'CORRECTO: 0022 la organizacion y el codigo de un tipo de trabajo son inmutables';
  end if;

  raise notice '0022 aplicada: los tipos de trabajo globales se editan y se retiran; no se borran.';
end $$;
