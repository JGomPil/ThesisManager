-- =============================================================================
-- Verificación del estado de la base de datos. SE PEGA EN EL EDITOR SQL.
--
-- POR QUÉ EXISTE
-- Todas las migraciones de este proyecto terminan con comprobaciones que
-- escriben `raise notice 'CORRECTO: …'`. En `psql` y en el arnés de pruebas se
-- leen; en el **editor SQL del panel de Supabase, no**: ese editor descarta los
-- avisos y responde «Success. No rows returned». Así que quien aplica una
-- migración desde el panel —que es como se aplican aquí— no ve ninguna de las
-- comprobaciones que acaba de ejecutar.
--
-- Eso no es tan grave como parece, porque un `raise exception` SÍ sale en rojo:
-- «Success» ya significa que ninguna comprobación falló. Pero deja sin respuesta
-- la otra pregunta, la que de verdad se hace quien está delante del panel: «¿y
-- qué estado tengo ahora?».
--
-- Esta consulta la contesta DEVOLVIENDO FILAS, que es lo único que ese editor
-- muestra. No cambia nada: solo lee catálogos del sistema.
--
-- CÓMO SE LEE: si alguna fila dice FALLO, ahí está el problema. Las filas de
-- migración que digan «falta» indican que esa migración no se ha aplicado.
--
-- Se comprueba a sí misma en `scripts/test-rls.sh`, que exige que todas las
-- filas salgan OK sobre una base recién construida.
-- =============================================================================
with comprobaciones as (

  -- 1. RLS activada en todas las tablas de `public`. Si falla esto, no importa
  --    nada de lo demás: los datos están a la vista.
  select 1 as n, 'RLS en todas las tablas de public' as comprobacion,
         case when count(*) = 0 then 'OK' else 'FALLO' end as estado,
         case when count(*) = 0 then 'ninguna tabla sin RLS'
              else 'sin RLS: ' || string_agg(c.relname, ', ') end as detalle
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  -- 2. `anon` no ejecuta ninguna función del esquema `app`. Es la prueba [33].
  select 2, 'anon no ejecuta funciones de app',
         case when count(*) = 0 then 'OK' else 'FALLO' end,
         case when count(*) = 0 then 'ninguna abierta a anon'
              else 'abiertas: ' || string_agg(p.proname, ', ') end
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')

  union all
  -- 3. Las 18 tablas del núcleo académico.
  select 3, 'tablas del nucleo academico',
         case when count(*) = 18 then 'OK' else 'FALLO' end,
         count(*) || ' de 18'
    from unnest(array[
      'organizations','organization_members','profiles','work_types','work_statuses',
      'work_roles','academic_works','work_members','tasks','milestones','meetings',
      'meeting_participants','documents','document_versions','comments','notifications',
      'templates','template_tasks'
    ]) t
   where to_regclass('public.' || t) is not null

  union all
  -- 4. Migraciones que se pueden reconocer por lo que dejan.
  select 4, 'migracion 0011 (notificaciones)',
         case when to_regclass('public.notifications') is not null then 'OK' else 'FALLO' end,
         case when to_regclass('public.notifications') is not null then 'tabla presente' else 'falta' end
  union all
  select 5, 'migracion 0015 (comentarios de version)',
         case when exists (select 1 from pg_policies
                            where tablename = 'document_comments' and policyname like '%version%')
                or to_regclass('public.document_comments') is not null then 'OK' else 'FALLO' end,
         case when to_regclass('public.document_comments') is not null then 'tabla presente' else 'falta' end
  union all
  select 6, 'migracion 0017 (fotos de perfil)',
         case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                            where ns.nspname = 'app' and p.proname = 'can_see_profile')
              then 'OK' else 'FALLO' end,
         case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                            where ns.nspname = 'app' and p.proname = 'can_see_profile')
              then 'app.can_see_profile presente' else 'falta' end
  union all
  select 7, 'migracion 0019 (documentos de plantilla)',
         case when to_regclass('public.template_documents') is not null then 'OK' else 'FALLO' end,
         case when to_regclass('public.template_documents') is not null then 'tabla presente' else 'falta' end

  union all
  -- 5. La 0020, que es la que acaba de aplicarse: sus tres politicas y sus dos
  --    disparadores. Los disparadores son lo que impide cambiar el codigo de un
  --    estado y las capacidades de un rol, asi que su ausencia es grave.
  select 8, 'migracion 0020: politicas de escritura',
         case when count(*) = 4 then 'OK' else 'FALLO' end,
         count(*) || ' de 4 (' || coalesce(string_agg(policyname, ', ' order by policyname), 'ninguna') || ')'
    from pg_policies
   where schemaname = 'public'
     and policyname in ('statuses_write','roles_insert','roles_update','roles_delete')

  union all
  select 9, 'migracion 0020: disparadores que cierran los permisos',
         case when count(*) = 2 then 'OK' else 'FALLO' end,
         count(*) || ' de 2 (' || coalesce(string_agg(tgname, ', ' order by tgname), 'ninguno') || ')'
    from pg_trigger
   where not tgisinternal
     and tgname in ('work_statuses_code_inmutable','work_roles_solo_descriptivo')

  union all
  -- 5.bis La 0021: las tres politicas y el disparador que hace inmutable la
  --       organizacion de un tipo de documento. Ese disparador no es un adorno:
  --       con dos politicas permisivas, el WITH CHECK no puede impedirlo.
  select 11, 'migracion 0021: politicas de tipos de documento y ciclo de vida',
         case when count(*) = 3 then 'OK' else 'FALLO' end,
         count(*) || ' de 3 (' || coalesce(string_agg(policyname, ', ' order by policyname), 'ninguna') || ')'
    from pg_policies
   where schemaname = 'public'
     and policyname in ('doctypes_write','doctypes_update_global','wtstatuses_write')

  union all
  select 12, 'migracion 0021: la organizacion de un tipo de documento es inmutable',
         case when count(*) = 1 then 'OK' else 'FALLO' end,
         case when count(*) = 1 then 'disparador presente' else 'falta' end
    from pg_trigger
   where not tgisinternal and tgname = 'doctypes_org_inmutable'

  union all
  -- 5.ter La 0022: la politica que hace editables los tipos de trabajo GLOBALES
  --       y el disparador que, al abrir esa puerta, cierra las otras dos (la
  --       organizacion y el codigo de un tipo). Sin la politica, editar un TFG
  --       devuelve «PGRST116 · 0 rows» y no cambia nada.
  select 13, 'migracion 0022: los tipos de trabajo globales son administrables',
         case when (select count(*) from pg_policies
                     where schemaname = 'public'
                       and policyname = 'work_types_update_global') = 1
                   and (select count(*) from pg_trigger
                         where not tgisinternal and tgname = 'work_types_inmutables') = 1
              then 'OK' else 'FALLO' end,
         (select case when count(*) = 1 then 'politica presente' else 'FALTA LA POLITICA' end
            from pg_policies
           where schemaname = 'public' and policyname = 'work_types_update_global')
         || ' · ' ||
         (select case when count(*) = 1 then 'disparador presente' else 'falta el disparador' end
            from pg_trigger
           where not tgisinternal and tgname = 'work_types_inmutables')

  union all
  -- 5.quater La 0023: el disparador que impide que el grupo se quede sin
  --          administradores. Sin el, el ultimo administrador puede degradarse
  --          y nadie —ni el— puede devolver el papel desde la aplicacion.
  select 14, 'migracion 0023: el grupo no se queda sin administradores',
         case when count(*) = 1 then 'OK' else 'FALLO' end,
         case when count(*) = 1 then 'disparador presente' else 'falta' end
    from pg_trigger
   where not tgisinternal and tgname = 'org_members_last_admin'

  union all
  -- 6.bis Y que de verdad quede alguien administrando: un grupo sin
  --       administracion no se arregla desde la aplicacion.
  select 15, 'cada organizacion tiene al menos un administrador activo',
         case when count(*) = 0 then 'OK' else 'FALLO' end,
         case when count(*) = 0 then 'todas tienen administracion'
              else 'SIN ADMINISTRACION: ' || string_agg(name, ', ') end
    from organizations o
   where not exists (
     select 1 from organization_members m
      where m.organization_id = o.id and m.is_active and m.role in ('OWNER','ADMIN')
   )

  union all
  -- 5.quinquies La 0024: las columnas del tablero de tareas. Se mira la tabla,
  --             su RLS y que el disparador que deriva el estado sea
  --             SECURITY DEFINER. Si no lo fuera, no podria leer la
  --             organizacion de la columna y la comprobacion de que la columna
  --             es del mismo grupo FALLARIA ABIERTA (SECURITY.md §5.2).
  select 16, 'migracion 0024: columnas del tablero configurables',
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = 'board_columns'
                       and c.relrowsecurity) = 1
                   and (select count(*) from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
                         where n.nspname = 'app' and pr.proname = 'sync_task_board_column'
                           and pr.prosecdef) = 1
                   and (select count(*) from information_schema.columns
                         where table_schema = 'public' and table_name = 'tasks'
                           and column_name = 'board_column_id') = 1
              then 'OK' else 'FALLO' end,
         (select case when count(*) = 1 then 'tabla con RLS' else 'FALTA LA TABLA O SU RLS' end
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'board_columns' and c.relrowsecurity)
         || ' · ' ||
         (select case when count(*) = 1 then 'disparador security definer'
                      else 'EL DISPARADOR FALLA ABIERTO O FALTA' end
            from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
           where n.nspname = 'app' and pr.proname = 'sync_task_board_column' and pr.prosecdef)
         || ' · ' ||
         (select case when count(*) = 1 then 'tasks.board_column_id' else 'FALTA LA COLUMNA EN tasks' end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'tasks' and column_name = 'board_column_id')

  union all
  -- 6. Y que ningun rol tenga capacidades que no deba: el estudiante, ninguna.
  select 10, 'el rol de estudiante no tiene capacidades',
         case when count(*) = 0 then 'OK' else 'FALLO' end,
         case when count(*) = 0 then 'correcto'
              else 'EL ROL DE ESTUDIANTE TIENE CAPACIDADES: ' || string_agg(code, ', ') end
    from work_roles
   where is_student
     and (can_manage_plan or can_see_private_notes
          or can_validate_deliverables or can_manage_members)
)
select estado, comprobacion, detalle
  from comprobaciones
 order by case estado when 'FALLO' then 0 else 1 end, n;
