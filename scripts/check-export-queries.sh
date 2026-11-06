#!/usr/bin/env bash
# =============================================================================
# Ejecuta de verdad las consultas de `docs/EXPORTACION.md`.
#
# POR QUÉ
# Son consultas que alguien va a pegar en el SQL Editor de Supabase el día que
# tenga que entregar un listado, probablemente con prisa. Documentación con SQL
# que no compila es peor que no tener documentación: hace perder el tiempo
# exactamente cuando no se tiene. Y es el tipo de cosa que se rompe sin que
# nadie lo note, porque basta que una migración renombre una columna.
#
# CÓMO
# Levanta un PostgreSQL 16 desechable, aplica el arnés, las migraciones y los
# catálogos, extrae cada bloque ```sql del documento y lo ejecuta. No comprueba
# que devuelvan filas —la base está casi vacía— sino que son SQL válido contra
# ESTE esquema: nombres de tabla, de columna y de catálogo.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=thesis-manager-export-check
IMAGE=postgres:16-alpine
DOC="$ROOT/docs/EXPORTACION.md"

limpiar() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap limpiar EXIT
limpiar

docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null
for _ in $(seq 1 40); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

LOG="$(mktemp)"
aplicar() {
  if ! docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q < "$1" >>"$LOG" 2>&1; then
    echo "▸ ERROR aplicando $(basename "$1"):" >&2; tail -15 "$LOG" >&2; exit 1
  fi
}
aplicar "$ROOT/supabase/tests/00_harness.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do aplicar "$f"; done
aplicar "$ROOT/supabase/seed/0001_catalogs.sql"
rm -f "$LOG"

TMP="$(mktemp -d)"
trap 'limpiar; rm -rf "$TMP"' EXIT

python3 - "$DOC" "$TMP" <<'PY'
import pathlib, re, sys
doc, destino = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
bloques = re.findall(r'```sql\n(.*?)```', doc.read_text(), re.S)
for i, b in enumerate(bloques, 1):
    (destino / f'{i:02d}.sql').write_text(b)
print(len(bloques))
PY

TOTAL=0
for f in "$TMP"/*.sql; do
  TOTAL=$((TOTAL + 1))
  if docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>"$TMP/err"; then
    echo "  · consulta $(basename "$f" .sql): correcta"
  else
    echo "▸ FALLA la consulta $(basename "$f" .sql) de docs/EXPORTACION.md:" >&2
    sed 's/^/      /' "$TMP/err" >&2
    exit 1
  fi
done

if [ "$TOTAL" -eq 0 ]; then
  echo "▸ ERROR: no se ha extraído ninguna consulta de $DOC" >&2
  exit 1
fi
echo "OK: las $TOTAL consultas de docs/EXPORTACION.md son validas contra el esquema actual."
