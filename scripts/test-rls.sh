#!/usr/bin/env bash
# Aplica las migraciones y ejecuta las pruebas de seguridad en un PostgreSQL
# desechable. Requiere Docker. No toca ningún proyecto de Supabase.
set -euo pipefail

CONTAINER=thesis-manager-sqltest
IMAGE=postgres:16-alpine
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "▸ Arrancando PostgreSQL de pruebas…"
docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

run() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "▸ Aplicando arnés y migraciones…"
run < "$ROOT/supabase/tests/00_harness.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  · $(basename "$f")"
  run < "$f"
done
echo "▸ Aplicando catálogos…"
run < "$ROOT/supabase/seed/0001_catalogs.sql"

# -----------------------------------------------------------------------------
# Las migraciones que CORRIGEN DATOS del catálogo se repiten aquí, y no por
# gusto: el arnés aplica las migraciones ANTES del seed, así que una migración
# como la 0018 («Director principal» → «Director») no encuentra la fila y se
# limita a avisar de que no hay nada que hacer. Quedaba sin probar justo lo
# único que hace. En el proyecto real el orden es el contrario —el catálogo se
# sembró hace meses—, y es ese orden el que hay que comprobar.
#
# Se prueba en LAS DOS DIRECCIONES: que renombra lo que puso el catálogo, y que
# NO pisa un nombre cambiado a mano desde Administración → Catálogos. Lo
# segundo es lo que de verdad puede estropear el trabajo de alguien.
echo "▸ Repitiendo las migraciones de datos sobre el catálogo ya sembrado…"
asegura() { # asegura <nombre esperado> <que se estaba comprobando>
  run -c "do \$\$
  declare v text;
  begin
    select name into v from work_roles where code = 'PRIMARY_SUPERVISOR';
    if v is distinct from '$1' then
      raise exception '0018 no $2: la funcion se llama %', coalesce(v, 'NADA');
    end if;
    raise notice 'CORRECTO: 0018 $2';
  end \$\$;"
}
run -c "update work_roles set name = 'Director principal' where code = 'PRIMARY_SUPERVISOR';"
run < "$ROOT/supabase/migrations/0018_role_names.sql"
asegura 'Director' 'renombra el nombre que puso el catalogo inicial'
run -c "update work_roles set name = 'Tutor academico' where code = 'PRIMARY_SUPERVISOR';"
run < "$ROOT/supabase/migrations/0018_role_names.sql"
asegura 'Tutor academico' 'respeta un nombre editado a mano'
run -c "update work_roles set name = 'Director' where code = 'PRIMARY_SUPERVISOR';"

# La 0021 mira si ACADEMIA conserva su ciclo de vida propio, y antes del seed no
# hay ACADEMIA: su comprobacion se quedaba muda, que es la misma trampa de la
# 0018. Repetida aqui, con el catalogo ya sembrado, si habla; y se exige que
# hable, porque un aviso que no sale no se distingue de uno que no existe.
SALIDA_0021="$(run < "$ROOT/supabase/migrations/0021_doctypes_and_lifecycle.sql" 2>&1)"
if ! printf '%s' "$SALIDA_0021" | grep -q 'CORRECTO: 0021 ACADEMIA conserva su ciclo de vida'; then
  echo "▸ ERROR: la 0021 no ha comprobado el ciclo de vida de ACADEMIA sobre el catalogo sembrado:" >&2
  printf '%s\n' "$SALIDA_0021" | sed 's/^/    /' >&2
  exit 1
fi
echo "  · CORRECTO: 0021 ACADEMIA conserva su ciclo de vida sobre el catalogo sembrado"

echo "▸ Ejecutando pruebas…"
# Toda la salida se guarda para poder analizarla: psql devuelve 0 aunque haya
# habido errores, así que mirar solo su código de salida no vale de nada. Fue
# así como una tanda con «permission denied for function has_work_capability»
# en tres pruebas seguía dando el visto bueno.
SALIDA="$(mktemp)"
# Se ejecutan TODOS los .sql de supabase/tests/ salvo el arnes, y se dice cual.
#
# Antes el patron era `[1-9]0_*.sql`, que exige un 0 en la segunda posicion. Se
# comio dos ficheros sin avisar: `40_invitations.sql` cuando el patron era
# `[123]0_*` y `95_hard_delete.sql` despues. Una prueba que no se ejecuta es
# peor que una que falla, porque cuenta como verde. Ahora el patron no
# selecciona nada: coge todo y lo lista, de modo que un fichero que falte se vea.
EJECUTADOS=0
for f in "$ROOT"/supabase/tests/*.sql; do
  [ "$(basename "$f")" = "00_harness.sql" ] && continue
  echo "  · $(basename "$f")"
  docker exec -i "$CONTAINER" psql -U postgres -q < "$f" 2>&1 | tee -a "$SALIDA"
  EJECUTADOS=$((EJECUTADOS + 1))
done

ESPERADOS="$(find "$ROOT/supabase/tests" -maxdepth 1 -name '*.sql' ! -name '00_harness.sql' | wc -l | tr -d ' ')"
if [ "$EJECUTADOS" -ne "$ESPERADOS" ]; then
  echo "▸ ERROR: se han ejecutado $EJECUTADOS ficheros de $ESPERADOS."
  rm -f "$SALIDA"
  exit 1
fi

echo
# Las pruebas que esperan un error lo capturan en un bloque de excepciones y
# avisan con NOTICE, así que a estas alturas cualquier `ERROR:` es real.
# La consulta de verificación del panel (`supabase/verify.sql`) también se
# comprueba aquí: sobre una base recién construida TODAS sus filas tienen que
# decir OK. Sin esto seria una consulta que nadie ha visto funcionar, ofrecida
# justo para los momentos en los que hay dudas.
echo "▸ Consulta de verificación del panel (supabase/verify.sql)"
VERIFICACION="$(docker exec -i "$CONTAINER" psql -U postgres -At -F '|' < "$ROOT/supabase/verify.sql" 2>&1)"
if printf '%s' "$VERIFICACION" | grep -q '^FALLO'; then
  echo "▸ ERROR: verify.sql informa de fallos sobre una base recien construida:" >&2
  printf '%s\n' "$VERIFICACION" | grep '^FALLO' | sed 's/^/    /' >&2
  exit 1
fi
if [ "$(printf '%s' "$VERIFICACION" | grep -c '^OK')" -lt 22 ]; then
  echo "▸ ERROR: verify.sql deberia devolver 22 comprobaciones y ha devuelto:" >&2
  printf '%s\n' "$VERIFICACION" | sed 's/^/    /' >&2
  exit 1
fi
echo "  · 22 comprobaciones, todas OK"

FALLOS="$(grep -cE '^(ERROR|FALLO)|FALLO \[' "$SALIDA" || true)"
EJECUTADAS="$(grep -cE '^\[[0-9]+\]' "$SALIDA" || true)"
CORRECTAS="$(grep -c 'CORRECTO' "$SALIDA" || true)"
echo "▸ Pruebas ejecutadas: $EJECUTADAS   ·   comprobaciones correctas: $CORRECTAS"
if [ "$FALLOS" -gt 0 ]; then
  echo "▸ HAY $FALLOS FALLO(S):"
  grep -nE '^(ERROR|FALLO)|FALLO \[' "$SALIDA" | sed 's/^/    /'
  rm -f "$SALIDA"
  exit 1
fi
rm -f "$SALIDA"
echo "▸ Todo correcto."
