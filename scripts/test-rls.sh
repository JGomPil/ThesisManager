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
for f in "$ROOT"/supabase/tests/[123]0_*.sql; do
  docker exec -i "$CONTAINER" psql -U postgres -q < "$f"
done

echo
echo "▸ Revisa que no aparezca ningún 'FALLO' arriba."
