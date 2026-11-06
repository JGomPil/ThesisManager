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

echo "▸ Ejecutando pruebas…"
# Toda la salida se guarda para poder analizarla: psql devuelve 0 aunque haya
# habido errores, así que mirar solo su código de salida no vale de nada. Fue
# así como una tanda con «permission denied for function has_work_capability»
# en tres pruebas seguía dando el visto bueno.
SALIDA="$(mktemp)"
for f in "$ROOT"/supabase/tests/[1-9]0_*.sql; do
  docker exec -i "$CONTAINER" psql -U postgres -q < "$f" 2>&1 | tee -a "$SALIDA"
done

echo
# Las pruebas que esperan un error lo capturan en un bloque de excepciones y
# avisan con NOTICE, así que a estas alturas cualquier `ERROR:` es real.
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
