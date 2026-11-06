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
#   ./scripts/backup-dump.sh eu-west-3 --sin-ficheros   # solo la base de datos
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
IMAGE=postgres:17-alpine          # el cliente debe ser >= que el servidor
ARGS=()
SIN_FICHEROS=0
for a in "$@"; do
  case "$a" in
    --sin-ficheros) SIN_FICHEROS=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
REGION="${ARGS[0]:-}"
DESTINO="${ARGS[1]:-$HOME/copias-thesis-manager}"

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
# PRIMERO SE COMPRUEBA, DESPUÉS SE CREA. Al revés —que es como estaba— el guion
# creaba la carpeta dentro del repositorio y solo entonces se negaba a escribir
# en ella: se quedaba una carpeta `copias/` suelta en un repositorio público,
# esperando a que alguien la llenara a mano. Y para comprobarlo sin crearla hay
# que resolver la ruta a partir del antepasado que SÍ existe, porque `cd` a una
# carpeta que no existe no se puede.
ancestro="$DESTINO"
while [ ! -d "$ancestro" ]; do
  padre="$(dirname "$ancestro")"
  [ "$padre" = "$ancestro" ] && break
  ancestro="$padre"
done
ancestro="$(cd "$ancestro" 2>/dev/null && pwd -P || echo "$PWD")"

case "$ancestro/" in
  "$ROOT"/* | "$ROOT")
    echo "▸ ERROR: «${DESTINO}» está dentro del repositorio, que es PÚBLICO." >&2
    echo "  Un volcado lleva datos personales. Elige una carpeta de fuera," >&2
    echo "  por ejemplo: ./scripts/backup-dump.sh '${REGION}' ~/copias-thesis-manager" >&2
    exit 1
    ;;
esac

mkdir -p "$DESTINO"
DESTINO="$(cd "$DESTINO" && pwd -P)"

# -----------------------------------------------------------------------------
# La cadena de conexión
# -----------------------------------------------------------------------------
URL="${SUPABASE_DB_URL:-}"

if [ -z "$URL" ]; then
  # Hace falta un terminal de verdad: la contraseña se lee con `read -s`, y sin
  # terminal esa lectura devuelve vacío sin avisar. El fallo aparecería después
  # como «password authentication failed», que manda a mirar la contraseña en
  # lugar de dónde se está ejecutando el guion.
  if [ ! -t 0 ]; then
    echo "▸ ERROR: este guion pide la contraseña por teclado y necesita un terminal." >&2
    echo "  Ábrelo en tu Terminal:  cd ~/ThesisManager && ./scripts/backup-dump.sh" >&2
    echo "  O, sin teclado, pásale la cadena entera por el entorno:" >&2
    echo "  SUPABASE_DB_URL='postgresql://...' ./scripts/backup-dump.sh" >&2
    exit 1
  fi

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
# La imagen se descarga APARTE, y antes. Docker manda el progreso de la descarga
# por la salida de error, así que si se mezcla con la de `psql` acaba dentro de
# la variable de la versión: el primer uso fallaría aunque la conexión fuese
# perfecta, y el mensaje de error vendría sepultado bajo cincuenta líneas de
# «Pulling fs layer».
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "  · descargando $IMAGE (solo la primera vez)"
  docker pull -q "$IMAGE" >/dev/null
fi

# Y aquí la salida de error se guarda aparte, no en la variable.
ERRORES="$(mktemp "${TMPDIR:-/tmp}/volcado.XXXXXX")"
trap 'rm -f "$ERRORES"' EXIT
VERSION="$(docker run --rm -e PGCONNECT_TIMEOUT=15 "$IMAGE" \
  psql "$URL" -Atqc 'show server_version_num' 2>"$ERRORES" || true)"

if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+$'; then
  echo "▸ ERROR: no se ha podido conectar." >&2
  sed 's/^/    /' "$ERRORES" >&2
  echo "  · «tenant/user ... not found»        → la REGIÓN no es esa (o falta" >&2
  echo "    el «.${REF:-<REF>}» detrás de «postgres» en el usuario)." >&2
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
if ! volcar --schema=public --schema=auth --schema=app --schema=storage 2>"$ERRORES"; then
  echo "  · con el esquema «storage» ha fallado; se repite sin él:"
  sed 's/^/      /' "$ERRORES" | tail -4
  volcar --schema=public --schema=auth --schema=app
  echo "  · AVISO: la copia NO incluye los metadatos de Storage."
fi

chmod 600 "$DESTINO/$FICHERO"
echo "  · $(du -h "$DESTINO/$FICHERO" | cut -f1), permisos 600"

# -----------------------------------------------------------------------------
# Y el ensayo, en el mismo acto. Es el punto de todo esto.
# -----------------------------------------------------------------------------
echo
"$ROOT/scripts/restore-drill.sh" "$DESTINO/$FICHERO"

# -----------------------------------------------------------------------------
# Y los ficheros de Storage, que NO van en un volcado SQL
#
# Se hace aquí y no en una orden aparte porque aquí ya se sabe el nombre del
# volcado con el que hay que comparar, y porque una copia en dos ordenes es una
# copia en la que algun dia se olvida la segunda. Pide la contraseña de la
# CUENTA (otra distinta), asi que se puede saltar con --sin-ficheros.
# -----------------------------------------------------------------------------
if [ "${SIN_FICHEROS:-0}" = "1" ]; then
  echo
  echo "▸ Ficheros de Storage: omitidos (--sin-ficheros)."
  echo "  La copia NO está completa hasta que se ejecute:"
  echo "  python3 scripts/backup-storage.py $DESTINO/storage-$(date +%Y%m%d) --segun-volcado $DESTINO/$FICHERO"
elif command -v python3 >/dev/null 2>&1; then
  echo
  if ! python3 "$ROOT/scripts/backup-storage.py" "$DESTINO/storage-$(date +%Y%m%d)" \
       --segun-volcado "$DESTINO/$FICHERO"; then
    echo >&2
    echo "▸ LA BASE DE DATOS SÍ ESTÁ COPIADA Y ENSAYADA: $DESTINO/$FICHERO" >&2
    echo "  Lo que ha fallado son los FICHEROS. La copia no está completa." >&2
    exit 1
  fi
fi

echo
echo "▸ La copia está en: $DESTINO/$FICHERO"
echo "  Llévala a la unidad institucional o a un disco cifrado y conserva las cuatro últimas."
echo "  NUNCA al repositorio, ni a un issue, ni a un artefacto de Actions."
