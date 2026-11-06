#!/usr/bin/env bash
# =============================================================================
# Volcado de la base de datos real, y ensayo inmediato de la copia.
#
# POR QUÉ EXISTE
# `BACKUP.md` describe el volcado con `pg_dump` o con la CLI de Supabase, y el
# procedimiento se atascaba siempre en el mismo sitio: encontrar la cadena de
# conexión en un panel que cambia de sitio cada pocos meses, y acertar con el
# formato. Lo único que de verdad no se puede adivinar es la REGIÓN del proyecto
# y la contraseña; el resto se construye.
#
# QUÉ HACE
#   1. Pregunta la contraseña SIN que se vea ni quede en el historial.
#   2. Construye la cadena del «session pooler», que es la que funciona por
#      IPv4 (la conexión directa de Supabase solo publica IPv6).
#   3. Vuelca `public`, `auth`, `app` y `storage` con `pg_dump` dentro de Docker,
#      así que no hay que instalar PostgreSQL.
#   4. Ensaya la copia acto seguido con `restore-drill.sh`. Una copia sin ensayar
#      no es una copia.
#
# DÓNDE DEJA EL FICHERO
# Fuera del repositorio, y se niega a escribir dentro. Un volcado lleva datos
# personales reales y este repositorio es público: no es una precaución
# exagerada, es la única que impide el accidente.
#
# USO
#   ./scripts/backup-dump.sh                       # pregunta región y contraseña
#   ./scripts/backup-dump.sh eu-west-3             # región ya sabida
#   ./scripts/backup-dump.sh eu-west-3 ~/copias    # y carpeta de destino
#   SUPABASE_DB_URL="postgresql://..." ./scripts/backup-dump.sh
#                                                  # cadena completa, si la tienes
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE=postgres:17-alpine          # el cliente debe ser >= que el servidor
REGION="${1:-}"
DESTINO="${2:-$HOME/copias-thesis-manager}"

# El identificador del proyecto no es un secreto (va en la URL pública de la
# API), así que se lee de `.env.local` y, si no está, se pregunta.
REF="$(grep -ho 'https://[a-z0-9]*\.supabase\.co' "$ROOT/.env.local" 2>/dev/null \
       | head -1 | sed 's|https://||; s|\.supabase\.co||' || true)"

if ! command -v docker >/dev/null 2>&1; then
  echo "▸ ERROR: hace falta Docker (no hay que instalar PostgreSQL, pero sí Docker)." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# El destino NUNCA dentro del repositorio.
# -----------------------------------------------------------------------------
mkdir -p "$DESTINO"
DESTINO="$(cd "$DESTINO" && pwd)"
case "$DESTINO/" in
  "$ROOT"/*)
    echo "▸ ERROR: «$DESTINO» está dentro del repositorio, que es PÚBLICO." >&2
    echo "  Un volcado lleva datos personales. Elige una carpeta de fuera," >&2
    echo "  por ejemplo: ./scripts/backup-dump.sh '$REGION' ~/copias-thesis-manager" >&2
    exit 1
    ;;
esac

# -----------------------------------------------------------------------------
# La cadena de conexión
# -----------------------------------------------------------------------------
URL="${SUPABASE_DB_URL:-}"

if [ -z "$URL" ]; then
  if [ -z "$REF" ]; then
    read -r -p "Identificador del proyecto (lo de <esto>.supabase.co): " REF
  fi
  echo "▸ Proyecto: $REF"

  if [ -z "$REGION" ]; then
    echo "  La región aparece en el panel de Supabase, en la página del proyecto."
    echo "  Las habituales en Europa: eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-north-1"
    read -r -p "Región: " REGION
  fi

  # La contraseña con `-s`: no se ve al teclearla y no entra en el historial del
  # intérprete, que es donde se queda si se pega en la línea de comandos.
  read -r -s -p "Contraseña de la base de datos (no se verá): " PASS
  echo

  # Se codifica lo que rompería la URL. Sin esto, una contraseña con «@» parte
  # la cadena en dos y el error que da no apunta a la contraseña.
  PASS_ESC="$(printf '%s' "$PASS" | sed \
    -e 's|%|%25|g' -e 's|@|%40|g' -e 's|:|%3A|g' -e 's|/|%2F|g' \
    -e 's|?|%3F|g' -e 's|#|%23|g' -e 's|\[|%5B|g' -e 's|\]|%5D|g')"
  unset PASS

  URL="postgresql://postgres.${REF}:${PASS_ESC}@aws-0-${REGION}.pooler.supabase.com:5432/postgres"
  URL_SEGURA="postgresql://postgres.${REF}:********@aws-0-${REGION}.pooler.supabase.com:5432/postgres"
else
  URL_SEGURA="$(printf '%s' "$URL" | sed -E 's|://([^:]+):[^@]*@|://\1:********@|')"
fi

echo "▸ Conectando a: $URL_SEGURA"

# -----------------------------------------------------------------------------
# Comprobación de conexión y de versión, antes de volcar
#
# Se hace aparte para que un fallo de contraseña o de región se vea en un
# segundo, en vez de aparecer a mitad de un volcado de minutos. El mensaje del
# «pooler» distingue los dos casos y conviene leerlo: «Tenant or user not
# found» es la REGIÓN equivocada; «password authentication failed» es la
# contraseña.
# -----------------------------------------------------------------------------
VERSION="$(docker run --rm -e PGCONNECT_TIMEOUT=15 "$IMAGE" \
  psql "$URL" -Atqc 'show server_version_num' 2>&1 || true)"

if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+$'; then
  echo "▸ ERROR: no se ha podido conectar." >&2
  printf '%s\n' "$VERSION" | sed 's/^/    /' >&2
  echo "  · «Tenant or user not found»        → la REGIÓN no es esa." >&2
  echo "  · «password authentication failed»  → la contraseña." >&2
  echo "  · La contraseña se restablece en Settings → Database. La aplicación" >&2
  echo "    NO la usa (entra con la clave pública anon), así que cambiarla no" >&2
  echo "    rompe nada." >&2
  exit 1
fi

MAYOR=$((VERSION / 10000))
echo "  · PostgreSQL $MAYOR del servidor; cliente $IMAGE"
if [ "$MAYOR" -gt 17 ]; then
  echo "▸ ERROR: el servidor es más nuevo que el cliente. Cambia IMAGE a postgres:$MAYOR-alpine." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# El volcado
#
# LOS CUATRO ESQUEMAS, y cada uno por un motivo:
#   public  → los datos académicos;
#   auth    → LOS USUARIOS. Sin esto se restaura todo y nadie puede entrar, que
#             es el fallo que descubrió el ensayo y que ningún documento decía;
#   app     → las funciones que usan las políticas de RLS;
#   storage → los metadatos de ficheros y fotos.
#
# `storage` pertenece a un rol administrativo de Supabase y a veces `pg_dump` no
# puede con todo él. Si falla, se repite sin ese esquema en lugar de quedarse sin
# copia: los metadatos de ficheros se pueden reconstruir, los datos académicos no.
# -----------------------------------------------------------------------------
FICHERO="thesis-manager-$(date +%Y%m%d-%H%M).sql"
volcar() {
  docker run --rm -e PGCONNECT_TIMEOUT=15 -v "$DESTINO":/copias -w /copias "$IMAGE" \
    pg_dump "$URL" "$@" --file "/copias/$FICHERO"
}

echo "▸ Volcando a $DESTINO/$FICHERO"
if ! volcar --schema=public --schema=auth --schema=app --schema=storage 2>/tmp/dump.err; then
  echo "  · con el esquema «storage» ha fallado; se repite sin él:"
  sed 's/^/      /' /tmp/dump.err | tail -4
  volcar --schema=public --schema=auth --schema=app
  echo "  · AVISO: la copia NO incluye los metadatos de Storage."
fi
rm -f /tmp/dump.err

chmod 600 "$DESTINO/$FICHERO"
echo "  · $(du -h "$DESTINO/$FICHERO" | cut -f1), permisos 600"

# -----------------------------------------------------------------------------
# Y el ensayo, en el mismo acto. Es el punto de todo esto.
# -----------------------------------------------------------------------------
echo
"$ROOT/scripts/restore-drill.sh" "$DESTINO/$FICHERO"

echo
echo "▸ La copia está en: $DESTINO/$FICHERO"
echo "  Llévala a la unidad institucional o a un disco cifrado y conserva las cuatro últimas."
echo "  NUNCA al repositorio, ni a un issue, ni a un artefacto de Actions."
