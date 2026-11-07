#!/usr/bin/env bash
# =============================================================================
# Una rejilla sin columna base DESBORDA EL ANCHO DEL MÓVIL
#
# POR QUÉ EXISTE ESTE GUION
# `grid gap-4 lg:grid-cols-3` parece correcto —en móvil, una columna; en
# escritorio, tres— y no lo es. Sin `grid-cols-*` para el tamaño base, la
# rejilla crea UNA columna implícita de tamaño `auto`, y el suelo de una pista
# `auto` es el *min-content* de lo que lleva dentro. Cualquier descendiente con
# `white-space: nowrap` —que es lo que pone `truncate`— aporta como min-content
# **la cadena entera**: un título largo, un correo, un nombre de fichero. La
# pista crece hasta ese ancho, la página se hace más ancha que la pantalla y
# aparece desplazamiento lateral en un teléfono.
#
# `grid-cols-1` de Tailwind no es `grid-template-columns: 1fr`, es
# `repeat(1, minmax(0, 1fr))`. Ese `minmax(0, …)` es justo el que pone el suelo
# a cero y acaba con el problema, y por eso añadirlo no cambia nada de lo que se
# ve: la rejilla ya tenía una sola columna.
#
# SÍNTOMA REAL (7 y 8 de noviembre de 2026): en un teléfono, la ficha de un
# trabajo se podía arrastrar a los lados y el cronograma se veía cortado, porque
# el panel del Gantt —`flex-1`, pensado para medir lo que mida la tarjeta—
# heredaba el ancho de una página ya desbordada y su propio desplazamiento
# horizontal no servía para nada. Un `truncate` dentro de una rejilla sin
# columna base lo provocaba sin dar ningún error.
#
# Esto no lo ve `eslint` ni el compilador de TypeScript: son nombres de clase.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▸ Rejillas: toda rejilla con columnas por tamaño necesita columna base"

# Una línea sospechosa es la que declara columnas SOLO para un tamaño
# (`sm:`, `md:`…) y no las declara para el tamaño base. `[^:-]` delante evita
# confundir `lg:grid-cols-3` con una declaración base, y `-` evita que
# `auto-cols-…` o nombres compuestos cuenten como tal.
#
# Las líneas de COMENTARIO se descartan: en este proyecto los comentarios
# explican por qué una rejilla es como es y citan sus clases («sus cinco
# columnas (`xl:grid-cols-5`)»), de modo que sin este filtro el guion se
# quejaría de su propia documentación.
sospechosas() { # sospechosas <carpeta>
  grep -rEn '(sm|md|lg|xl|2xl):grid-cols-[0-9]' "$1" --include='*.tsx' \
    | grep -vE '(^|[^:-])grid-cols-[0-9]' \
    | awk '{ texto = $0; sub(/^[^:]+:[0-9]+:/, "", texto);
             if (texto !~ /^[[:space:]]*(\*|\/\/|\/\*)/) print }' || true
}

# AUTOCOMPROBACIÓN. Un detector que no detecta nada pasa como correcto, que es
# el peor resultado posible: verde por no haber mirado. Antes de medir el
# proyecto se le da de comer un caso malo y uno bueno, y se exige que distinga.
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
printf '%s\n' '<div className="grid gap-4 lg:grid-cols-3">' > "${TMP}/malo.tsx"
printf '%s\n' '<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">' > "${TMP}/bueno.tsx"
if [ -z "$(sospechosas "${TMP}" | grep malo.tsx || true)" ]; then
  echo "▸ ERROR: la autocomprobación falla: el guion NO detecta una rejilla sin columna base." >&2
  exit 1
fi
if [ -n "$(sospechosas "${TMP}" | grep bueno.tsx || true)" ]; then
  echo "▸ ERROR: la autocomprobación falla: el guion marca como mala una rejilla correcta." >&2
  exit 1
fi

MALAS="$(sospechosas src)"
if [ -n "${MALAS}" ]; then
  echo "▸ ERROR: estas rejillas declaran columnas por tamaño y no para el tamaño base:" >&2
  printf '%s\n' "${MALAS}" | sed 's/^/    /' >&2
  echo "  Añade 'grid-cols-1' (o la base que corresponda). Sin ella, un 'truncate'" >&2
  echo "  de dentro puede ensanchar la página entera en un móvil, sin dar error." >&2
  exit 1
fi

TOTAL="$(grep -rEc 'grid-cols-[0-9]' src --include='*.tsx' | awk -F: '{s+=$2} END {print s}')"
echo "OK: ninguna rejilla sin columna base (${TOTAL} declaraciones de columnas revisadas)."
