#!/usr/bin/env bash
# Regenera supabase/bundle/install.sql: todas las migraciones y los catálogos
# en un solo fichero, para poder instalarlo con un único pegado en el SQL
# Editor de Supabase.
#
# Ejecútalo cada vez que añadas una migración.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT=supabase/bundle/install.sql
mkdir -p supabase/bundle

{
  cat <<'HEADER'
-- =============================================================================
-- INSTALACIÓN COMPLETA DE THESIS MANAGER
--
-- Fichero generado: no se edita a mano. Se regenera con
--   ./scripts/build-install-sql.sh
--
-- Contiene, en orden: las migraciones y los catálogos iniciales.
-- NO contiene los datos de demostración (están en seed/0002_demo_data.sql).
--
-- CÓMO USARLO
--   1. Panel de Supabase → SQL Editor → New query
--   2. Pegar TODO este fichero
--   3. Run
-- =============================================================================

HEADER

  for f in supabase/migrations/*.sql supabase/seed/0001_catalogs.sql; do
    printf '\n\n-- #############################################################################\n'
    printf -- '-- ### %s\n' "$f"
    printf -- '-- #############################################################################\n\n'
    cat "$f"
  done
} > "$OUT"

echo "Generado $OUT ($(wc -l < "$OUT" | tr -d ' ') líneas)"
