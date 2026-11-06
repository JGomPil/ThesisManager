#!/usr/bin/env bash
# =============================================================================
# Ensayo de restauración: comprueba que una copia de seguridad SIRVE.
#
# POR QUÉ EXISTE
# `BACKUP.md` describe cómo hacer el volcado desde la primera versión del
# proyecto, y nadie lo había restaurado nunca. Una copia que no se ha restaurado
# no es una copia: es un fichero que se parece a una copia. Los dos fallos
# habituales no se ven mirando el `.sql` —que se restaure a medias por roles que
# no existen, y que le falte lo que de verdad hace falta— y los dos se descubren
# el día que hay una urgencia, que es el peor día posible.
#
# QUÉ HACE
# Levanta un PostgreSQL 16 desechable en Docker, restaura ahí el fichero que se
# le pase y después INTERROGA a la base restaurada:
#   · ¿están las tablas del núcleo académico?
#   · ¿tiene RLS activada CADA tabla de `public`? (una copia restaurada sin RLS
#     es una copia que, si se pone en producción, lo deja todo a la vista);
#   · ¿puede `anon` ejecutar alguna función del esquema `app`?
#   · ¿cuántas filas hay en lo que importa, y hay usuarios de `auth`?
#
# Lo último es el aviso que ningún documento daba: un volcado que no incluya
# `auth.users` restaura todos los datos académicos y deja la plataforma sin
# nadie que pueda entrar. Mejor saberlo hoy.
#
# NO TOCA NADA DE PRODUCCIÓN. No se conecta a Supabase, no necesita contraseñas
# y el contenedor se destruye al terminar. El fichero de copia se monta como
# solo lectura.
#
# USO
#   ./scripts/restore-drill.sh copia.sql       # volcado en texto (psql)
#   ./scripts/restore-drill.sh copia.dump      # formato comprimido (pg_restore)
#   ./scripts/restore-drill.sh                 # AUTOPRUEBA: se fabrica un
#                                              # volcado sintético y lo ensaya,
#                                              # para comprobar el ensayo mismo
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE=postgres:16-alpine
ORIGEN=drill-origen
DESTINO=drill-destino
COPIA="${1:-}"

limpiar() {
  docker rm -f "$ORIGEN" "$DESTINO" >/dev/null 2>&1 || true
  [ -n "${TEMPORAL:-}" ] && rm -rf "$TEMPORAL"
  return 0
}
trap limpiar EXIT
limpiar

esperar() {
  for _ in $(seq 1 40); do
    docker exec "$1" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "▸ ERROR: el PostgreSQL de pruebas no ha arrancado." >&2
  exit 1
}

# -----------------------------------------------------------------------------
# 0. Si no se da fichero: fabricar uno. Es la autoprueba del ensayo.
# -----------------------------------------------------------------------------
if [ -z "$COPIA" ]; then
  echo "▸ Sin fichero: AUTOPRUEBA. Se fabrica un volcado sintético y se ensaya."
  TEMPORAL="$(mktemp -d)"
  COPIA="$TEMPORAL/sintetico.sql"

  docker run -d --rm --name "$ORIGEN" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null
  esperar "$ORIGEN"
  # El ruido de las migraciones no interesa aquí: se guarda y solo se muestra si
  # algo falla. Lo que se ensaya es la restauración, no la instalación.
  LOG="$TEMPORAL/instalacion.log"
  aplicar() {
    if ! docker exec -i "$ORIGEN" psql -U postgres -v ON_ERROR_STOP=1 -q < "$1" >>"$LOG" 2>&1; then
      echo "▸ ERROR aplicando $1 (ver $LOG)" >&2
      tail -20 "$LOG" >&2
      exit 1
    fi
  }
  aplicar "$ROOT/supabase/tests/00_harness.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do aplicar "$f"; done
  aplicar "$ROOT/supabase/seed/0001_catalogs.sql"
  # Un par de filas ficticias para que los recuentos digan algo.
  docker exec -i "$ORIGEN" psql -U postgres -v ON_ERROR_STOP=1 -q >>"$LOG" 2>&1 <<'SQL'
insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999999','ensayo@test.invalid');
insert into organizations (id, name, slug) values
  ('99990000-0000-0000-0000-000000000001','Ensayo','ensayo');
insert into organization_members (organization_id, user_id, role) values
  ('99990000-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','OWNER');
insert into academic_works (organization_id, work_type_id, status_id, title)
select '99990000-0000-0000-0000-000000000001',
       (select id from work_types where code='TFG'),
       (select id from work_statuses where code='EN_DESARROLLO'),
       'Trabajo del ensayo';
SQL
  docker exec "$ORIGEN" pg_dump -U postgres postgres > "$COPIA"
  docker rm -f "$ORIGEN" >/dev/null
  echo "  · volcado sintético: $(wc -l < "$COPIA" | tr -d ' ') líneas"
fi

if [ ! -f "$COPIA" ]; then
  echo "▸ ERROR: no existe el fichero «$COPIA»." >&2
  exit 1
fi

echo "▸ Ensayando la restauración de: $COPIA"
echo "  ($(du -h "$COPIA" | cut -f1))"

# -----------------------------------------------------------------------------
# 1. Contenedor destino, con los roles que un volcado de Supabase da por hechos
#
# Un volcado trae `grant ... to anon` y `alter default privileges ... to
# authenticated`. Si esos roles no existen, psql suelta decenas de errores y la
# restauración queda a medias: es el primer fallo clásico, y no se ve leyendo el
# fichero. Aquí se crean antes, igual que habría que hacer en un proyecto nuevo
# que no fuera de Supabase.
# -----------------------------------------------------------------------------
docker run -d --rm --name "$DESTINO" -e POSTGRES_PASSWORD=pg \
  -v "$(cd "$(dirname "$COPIA")" && pwd)/$(basename "$COPIA")":/copia:ro "$IMAGE" >/dev/null
esperar "$DESTINO"

docker exec -i "$DESTINO" psql -U postgres -q <<'SQL'
do $$
declare r text;
begin
  foreach r in array array[
    'anon','authenticated','service_role','authenticator',
    'supabase_admin','supabase_auth_admin','supabase_storage_admin','dashboard_user'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
SQL

echo "▸ Restaurando…"
SALIDA="$(mktemp)"
case "$COPIA" in
  *.dump|*.custom)
    docker exec "$DESTINO" pg_restore -U postgres -d postgres --no-owner /copia > "$SALIDA" 2>&1 || true
    ;;
  *)
    docker exec "$DESTINO" psql -U postgres -q -f /copia > "$SALIDA" 2>&1 || true
    ;;
esac

ERRORES="$(grep -ciE '^(ERROR|pg_restore: error)' "$SALIDA" || true)"
if [ "$ERRORES" -gt 0 ]; then
  echo "  · avisos y errores durante la restauración: $ERRORES"
  grep -iE '^(ERROR|pg_restore: error)' "$SALIDA" | sort | uniq -c | sort -rn | head -8 | sed 's/^/      /'
  echo "    (los «ya existe» son normales; los de permisos o relación inexistente, no)"
else
  echo "  · restauración sin errores"
fi
rm -f "$SALIDA"

# -----------------------------------------------------------------------------
# 2. Interrogar a la base restaurada
# -----------------------------------------------------------------------------
echo "▸ Comprobando la copia restaurada:"
docker exec -i "$DESTINO" psql -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
\pset border 0
\pset tuples_only on

do $$
declare
  faltan text;
  sin_rls text;
  abiertas text;
  n_auth int := -1;
  problemas int := 0;
begin
  -- a) El núcleo académico. Si falta una de estas, la copia no sirve.
  select string_agg(t, ', ') into faltan
    from unnest(array[
      'organizations','organization_members','profiles','work_types','work_statuses',
      'work_roles','academic_works','work_members','tasks','milestones','documents',
      'document_versions','document_comments','meetings','meeting_private_notes',
      'templates','template_tasks','notifications'
    ]) t
   where to_regclass('public.' || t) is null;
  if faltan is not null then
    raise warning 'FALTAN TABLAS DEL NUCLEO: %', faltan;
    problemas := problemas + 1;
  else
    raise notice 'OK  tablas del nucleo academico: las 18 presentes';
  end if;

  -- b) RLS. Una copia restaurada sin RLS lo deja todo a la vista en cuanto se
  --    pone en servicio: es el fallo que no avisa.
  select string_agg(c.relname, ', ') into sin_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if sin_rls is not null then
    raise warning 'TABLAS SIN RLS: %', sin_rls;
    problemas := problemas + 1;
  else
    raise notice 'OK  RLS activada en todas las tablas de public';
  end if;

  -- c) Privilegios del esquema `app`, la misma comprobacion que la prueba [33].
  if to_regnamespace('app') is null then
    raise warning 'NO HAY ESQUEMA app: la copia no trae las funciones de las politicas';
    problemas := problemas + 1;
  else
    select string_agg(p.proname, ', ') into abiertas
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute');
    if abiertas is not null then
      raise warning 'anon PUEDE EJECUTAR funciones de app: %', abiertas;
      problemas := problemas + 1;
    else
      raise notice 'OK  ninguna funcion de app es ejecutable por anon';
    end if;
  end if;

  -- d) Usuarios de autenticacion. El aviso que ningun documento daba.
  if to_regclass('auth.users') is not null then
    execute 'select count(*) from auth.users' into n_auth;
    if n_auth = 0 then
      raise warning 'auth.users ESTA VACIA: los datos volverian, pero nadie podria entrar';
      problemas := problemas + 1;
    else
      raise notice 'OK  auth.users: % cuenta(s)', n_auth;
    end if;
  else
    raise warning 'LA COPIA NO INCLUYE auth.users: habria que volcar el esquema auth aparte';
    problemas := problemas + 1;
  end if;

  if problemas = 0 then
    raise notice '>>> ENSAYO CORRECTO: esta copia se puede restaurar y queda protegida.';
  else
    raise exception '>>> ENSAYO CON % PROBLEMA(S): lee los avisos de arriba antes de confiar en esta copia.', problemas;
  end if;
end $$;
SQL

echo "▸ Recuento de lo restaurado:"
docker exec -i "$DESTINO" psql -U postgres -q -t <<'SQL'
select format('    %-22s %s', t.tabla, t.filas)
from (
  select 'trabajos' as tabla, count(*) as filas from academic_works
  union all select 'participantes', count(*) from work_members
  union all select 'tareas', count(*) from tasks
  union all select 'documentos', count(*) from documents
  union all select 'versiones', count(*) from document_versions
  union all select 'comentarios de version', count(*) from document_comments
  union all select 'reuniones', count(*) from meetings
  union all select 'plantillas', count(*) from templates
  union all select 'personas', count(*) from profiles
) t;
SQL
echo "▸ Ensayo terminado. El contenedor de pruebas se destruye ahora."
