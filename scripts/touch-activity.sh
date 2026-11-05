#!/usr/bin/env bash
# Marca de actividad MANUAL del repositorio.
#
# Para qué: GitHub desactiva los workflows programados de un repositorio público
# tras 60 días sin actividad. Lo único que reinicia ese contador es un commit.
# Entrar en la web publicada NO cuenta.
#
# Este commit no afecta a nada:
#   · solo escribe una fecha en maintenance/last-activity.txt
#   · lleva [skip ci], así que no dispara ningún workflow
#   · deploy.yml ignora maintenance/**, así que no redespliega la aplicación
#
# Uso:  ./scripts/touch-activity.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p maintenance
{
  echo "Marca de actividad del repositorio."
  echo "Evita que GitHub desactive los workflows programados por inactividad."
  echo ""
  echo "Ultima actualizacion: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} > maintenance/last-activity.txt

git add maintenance/last-activity.txt

if git diff --cached --quiet; then
  echo "Nada que registrar: el fichero ya tiene esta marca."
  exit 0
fi

git commit -m "chore: marca de actividad del repositorio [skip ci]"
git push

echo
echo "Hecho. El contador de 60 dias vuelve a cero."
echo "Comprueba de paso que 'Keepalive Supabase' sigue activo:"
echo "  gh workflow list --all"
