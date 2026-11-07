#!/usr/bin/env bash
# =============================================================================
# Los colores del catálogo tienen que sobrevivir al build
#
# POR QUÉ EXISTE ESTE GUION
# Tailwind no ejecuta el código: rastrea los ficheros buscando cadenas que
# parezcan nombres de clase y borra del CSS final todo lo que no encuentra. Una
# clase construida al vuelo —`tone-${tono}`— no la ve, de modo que la regla
# `.tone-blue` desaparecía del CSS publicado y la pastilla del TFG se dibujaba
# con una clase sin ninguna regla detrás: sin fondo, blanca, con cualquier color
# que eligiera la administración.
#
# ESTE FALLO NO DA NINGÚN ERROR. No hay excepción, no hay aviso en la consola,
# el HTML lleva la clase correcta y la pantalla se dibuja entera. Simplemente no
# hay color. Estuvo así desde el primer despliegue y se descubrió el 7 de
# noviembre de 2026 leyendo el CSS que servía el sitio, porque cambiar el color
# de un tipo de trabajo no cambiaba nada. Once de los doce tonos no habían
# pintado nunca; el duodécimo, `slate`, sobrevivía porque está escrito como
# valor por defecto, y eso disimulaba el problema: el color por omisión sí iba.
#
# Por eso no se comprueba el CSS de origen —ahí están los doce, siempre— sino
# **el compilado**, que es lo que de verdad se publica.
#
# La lista no se escribe aquí: se saca de `src/lib/utils.ts`, de los nombres
# completos que el propio rastreador de Tailwind tiene que encontrar. Así, añadir
# un color al catálogo queda cubierto sin tocar este guion.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DIST="${1:-dist}"

echo "▸ Colores del catálogo: las clases .tone-* y .edge-* en el CSS compilado"

if [ ! -d "${DIST}/assets" ]; then
  echo "▸ ERROR: no hay '${DIST}/assets'. Hay que compilar antes (npm run build)." >&2
  exit 1
fi

CSS="$(find "${DIST}/assets" -maxdepth 1 -name '*.css' | head -1)"
if [ -z "${CSS}" ]; then
  echo "▸ ERROR: no se ha encontrado ninguna hoja de estilos en '${DIST}/assets'." >&2
  exit 1
fi

# Los nombres completos, tal y como los escribe el mapa de `utils.ts`.
ESPERADAS="$(grep -oE "'(tone|edge)-[a-z]+'" src/lib/utils.ts | tr -d "'" | sort -u)"
TOTAL="$(printf '%s\n' "${ESPERADAS}" | grep -c . || true)"

# Si esto se queda vacío, el guion pasaría sin comprobar nada: el peor de los
# resultados posibles, verde por no haber mirado. Es el error de método que ya
# se pagó una vez con un patrón de ficheros que se comía dos pruebas.
if [ "${TOTAL}" -lt 24 ]; then
  echo "▸ ERROR: solo se han encontrado ${TOTAL} nombres de clase en src/lib/utils.ts." >&2
  echo "  Se esperaban al menos 24 (doce tonos y doce franjas) escritos completos." >&2
  echo "  Si los mapas han cambiado de forma, hay que revisar este guion: sin nombres" >&2
  echo "  completos, Tailwind vuelve a borrar los colores y nadie se entera." >&2
  exit 1
fi

FALTAN=''
for CLASE in ${ESPERADAS}; do
  # En el CSS minificado la clase va seguida de '{' o de ',' si el minificador
  # agrupa declaraciones idénticas.
  if ! grep -q "\.${CLASE}[{,]" "${CSS}"; then
    FALTAN="${FALTAN} ${CLASE}"
  fi
done

if [ -n "${FALTAN}" ]; then
  echo "▸ ERROR: Tailwind ha borrado del CSS compilado estas clases de color:" >&2
  for CLASE in ${FALTAN}; do echo "    .${CLASE}" >&2; done
  echo "  Pasa cuando el nombre se construye al vuelo en lugar de escribirse" >&2
  echo "  completo. En pantalla no da error: deja de haber color." >&2
  echo "  Fichero mirado: ${CSS}" >&2
  exit 1
fi

echo "OK: las ${TOTAL} clases de color del catálogo están en $(basename "${CSS}")."
