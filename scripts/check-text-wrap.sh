#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Todo texto que escribe una persona tiene que poder PARTIR PALABRAS.
#
# POR QUÉ EXISTE ESTE GUION
# En un móvil, una sola palabra sin espacios —una URL pegada en la descripción
# de un trabajo, un DOI, el nombre de un fichero— ensancha su tarjeta más que la
# pantalla. Y como el ancho de la página lo fija el elemento más ancho, no se
# descoloca esa tarjeta: se descoloca la página entera. Síntoma real: «las
# fichas de trabajo no veo nada porque son muy anchas». No se ve en una revisión
# de código ni en el escritorio, porque solo aparece con datos reales.
#
# `whitespace-pre-wrap` y `whitespace-pre-line` respetan los saltos de línea del
# usuario, que es justo lo que se quiere, pero NO parten una palabra larga. La
# pareja es `break-words`. Diez sitios la tenían suelta y uno la tenía bien: el
# hilo de comentarios, donde el problema ya había aparecido una vez.
#
# La regla es mecánica, así que la comprueba un guion y no la memoria.
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "▸ Texto libre: whitespace-pre-* exige break-words"

# Se recorre cada línea con una de esas clases y se mira si la MISMA línea trae
# `break-words`. La clase y su pareja se escriben siempre juntas, en el mismo
# `className`, así que la línea es la unidad correcta; partir el className en
# varias líneas haría que esto avise de más, que es el lado por el que conviene
# equivocarse.
SOSPECHOSAS="$(grep -rn 'whitespace-pre-wrap\|whitespace-pre-line' src/ --include='*.tsx' --include='*.ts' \
  | grep -v 'break-words' \
  | grep -v '^\s*//' \
  | grep -v '\* ' || true)"

if [ -n "$SOSPECHOSAS" ]; then
  echo "▸ ERROR: texto de usuario sin 'break-words'. Una palabra larga sin espacios"
  echo "  ensancha la tarjeta y, con ella, la página entera en el móvil:"
  echo "$SOSPECHOSAS" | sed 's/^/    /'
  exit 1
fi

echo "OK: el texto libre puede partir palabras."
