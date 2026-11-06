#!/usr/bin/env bash
# =============================================================================
# Las pruebas unitarias no importan la capa de infraestructura
#
# POR QUÉ EXISTE ESTE GUION
# `src/lib/supabase.ts` CREA el cliente al cargarse. Cualquier fichero de
# pruebas que lo importe —aunque sea de rebote, a través de un componente o de
# un repositorio— levanta un cliente real solo para comprobar una función pura.
#
# Pasó el 6 de noviembre de 2026: una prueba de cómo se abrevian los nombres
# importaba `iniciales` de un componente, el componente importaba `lib/avatars`
# y este `lib/supabase`. En local pasó (Node 24 trae WebSocket nativo); en
# Actions, con Node 20, la tanda entera murió con «native WebSocket not found»
# y el despliegue se quedó sin hacer. El fallo no estaba en la prueba ni en el
# componente: estaba en que la prueba miraba hacia fuera del dominio.
#
# La regla de dependencias de ARCHITECTURE.md ya lo decía («de fuera hacia
# dentro, nunca al revés»). Esto la comprueba en lugar de confiarla.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROHIBIDO="@/lib/|@/data/|@/features/|@/components/|@/app/"
FALLOS=0

# `import type` NO cuenta: TypeScript lo borra al compilar, así que no ejecuta
# ningún módulo y no puede crear ningún cliente. Importar los tipos de la base
# de datos en una prueba del dominio es correcto y se hace.
while IFS= read -r f; do
  if LINEAS=$(grep -nE "^import .*from '($PROHIBIDO)" "$f" | grep -vE "^[0-9]+:import type "); then
    echo "▸ $f importa infraestructura:"
    echo "$LINEAS" | sed 's/^/    /'
    FALLOS=$((FALLOS + 1))
  fi
done < <(find src -name '*.test.ts' -o -name '*.test.tsx')

if [ "$FALLOS" -gt 0 ]; then
  cat <<'TXT'

Las pruebas unitarias solo pueden importar de `@/domain/`.

Si necesitas probar una función que vive en un componente, en un repositorio o
en `lib/`, es señal de que esa función es lógica y no infraestructura: muévela a
`src/domain/` y que el componente la importe de allí. Así la prueba no arrastra
el cliente de Supabase, que se crea al importar el módulo.
TXT
  exit 1
fi

echo "OK: las pruebas unitarias no importan infraestructura."
