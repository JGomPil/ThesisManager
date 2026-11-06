#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Una variable pegada a un carácter no ASCII necesita llaves: ${VAR}, no $VAR.
#
# POR QUÉ EXISTE ESTE GUION
# Los mensajes de estos guiones están en español y entrecomillan los valores con
# «comillas latinas». Escrito así:
#
#     echo "no existe el fichero «$COPIA»"
#
# funciona en un terminal en UTF-8 y FALLA donde el entorno no lo está —un cron,
# un contenedor, una acción de CI, que suelen venir en locale C—, porque bash
# toma los bytes del «»» como parte del nombre de la variable y aborta con
# «COPIA?: unbound variable».
#
# Lo grave no es el carácter raro en pantalla: esas líneas son EL CAMINO DE
# ERROR. Se ejecutan justo cuando algo ha ido mal, y lo que debía ser un aviso
# claro —«esa carpeta está dentro del repositorio, que es público»— se convierte
# en un error de bash sobre una variable que sí existe. Quien lo lea buscará el
# fallo donde no está. Síntoma real: el guion del volcado se cayó en la línea
# del mensaje de error, no en el volcado.
#
# `${VAR}` cierra el nombre y el problema desaparece.
#
# POR QUÉ SE AUTOCOMPRUEBA
# La primera versión de este guion usaba `grep -P`, que en Linux existe y en
# macOS no. `grep` salía con error, el error iba a /dev/null y la comprobación
# anunciaba «CORRECTO: ninguna» sin haber mirado nada: verde por un motivo que
# no tiene nada que ver con lo que se mide, el mismo fallo que ya apareció en la
# prueba [134] y en la migración 0018. Así que antes de buscar de verdad, el
# guion se busca a sí mismo un caso que SABE que está mal; si no lo encuentra,
# aborta en lugar de aprobar.
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DONDE="${1:-scripts}"
echo "▸ Guiones: una variable junto a un carácter no ASCII necesita \${llaves}"

# `perl` sin `use utf8` trabaja con BYTES, que es exactamente lo que se busca:
# \x80-\xFF es como empieza cualquier carácter no ASCII en UTF-8. Y está tanto
# en macOS como en los ejecutores de GitHub.
PATRON='print "$ARGV:$.: $_" if /\$[A-Za-z_]\w*[\x80-\xFF]/'

if ! command -v perl >/dev/null 2>&1; then
  echo "▸ ERROR: hace falta perl para comprobar esto." >&2
  exit 1
fi

# Autocomprobación: un caso que está mal, a ver si lo ve.
# `mktemp -t cebo` vale en macOS y GNU lo rechaza: exige las X en la plantilla.
# La forma portatil es dar la ruta completa.
CEBO="$(mktemp "${TMPDIR:-/tmp}/cebo.XXXXXX")"
printf 'echo "mal con «$VARIABLE»"\necho "bien con «${VARIABLE}»"\n' > "$CEBO"
PILLADAS="$(perl -ne "$PATRON" "$CEBO" | wc -l | tr -d ' ')"
rm -f "$CEBO"
if [ "$PILLADAS" != "1" ]; then
  echo "▸ ERROR: la propia comprobación no funciona (ha visto ${PILLADAS} de 1)." >&2
  echo "  No se aprueba nada a ciegas." >&2
  exit 1
fi

# Y ahora de verdad.
# Este guion se excluye a sí mismo: es el único fichero del proyecto que tiene
# que contener el caso malo, en el comentario de arriba y en el cebo.
MALOS="$(find "$DONDE" -type f -name '*.sh' ! -name 'check-shell-quoting.sh' -print0 \
  | xargs -0 perl -ne "$PATRON" || true)"
if [ -n "$MALOS" ]; then
  echo "▸ ERROR: variables sin llaves junto a un carácter no ASCII:" >&2
  printf '%s\n' "$MALOS" | sed 's/^/    /' >&2
  echo "  Escribe \${VAR} en lugar de \$VAR en esas líneas." >&2
  exit 1
fi

echo "  CORRECTO: ninguna"
