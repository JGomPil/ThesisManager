#!/usr/bin/env bash
# Comprueba que los artefactos publicados no contienen credenciales
# privilegiadas de Supabase.
#
# Lo que SÍ es correcto que aparezca en el bundle: la clave anon/publishable.
# Es pública por diseño y la protección real la ejerce RLS en PostgreSQL.
#
# Lo que NUNCA debe aparecer:
#   · clave secreta nueva   → sb_secret_<valor>
#   · clave service_role    → JWT cuyo payload lleva "role":"service_role"
#   · el nombre de la variable de entorno del secreto
#
# Dos sutilezas aprendidas a base de falsos negativos y positivos:
#
#  1. La librería @supabase/supabase-js contiene las cadenas "sb_secret_" y
#     "sb_publishable_" en su código de detección de formato. Por eso no se
#     busca el prefijo suelto, sino el prefijo seguido de un valor real.
#  2. No sirve buscar el base64 de '"role":"service_role"': dentro de un JWT
#     la codificación depende del desplazamiento del fragmento en el payload.
#     Hay que extraer los JWT y DECODIFICARLOS.
set -euo pipefail

DIR="${1:-dist}"

if [ ! -d "$DIR" ]; then
  echo "No existe el directorio '$DIR'. Ejecuta primero el build." >&2
  exit 2
fi

found=0

# --- 1. Claves secretas con formato nuevo -----------------------------------
if grep -rIlE "sb_secret_[A-Za-z0-9_-]{20,}" "$DIR" 2>/dev/null; then
  echo "::error::Clave secreta (sb_secret_...) detectada en los artefactos." >&2
  found=1
fi

# --- 2. Nombre de la variable del secreto -----------------------------------
if grep -rIlE "SUPABASE_SERVICE_ROLE" "$DIR" 2>/dev/null; then
  echo "::error::Referencia a SUPABASE_SERVICE_ROLE detectada en los artefactos." >&2
  found=1
fi

# --- 3. JWT con rol privilegiado: extraer y decodificar ---------------------
# -I descarta binarios; se analizan solo ficheros de texto.
if ! python3 -I - "$DIR" <<'PY'
import base64, json, pathlib, re, sys

root = pathlib.Path(sys.argv[1])
# Un JWT: tres segmentos base64url separados por puntos, empezando por eyJ ('{"').
jwt_re = re.compile(r'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{4,}')
PRIVILEGED = {'service_role', 'supabase_admin', 'postgres'}

def decode(segment: str):
    try:
        return json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
    except Exception:
        return None

bad = []
for path in root.rglob('*'):
    if not path.is_file():
        continue
    try:
        text = path.read_text(encoding='utf-8', errors='strict')
    except (UnicodeDecodeError, OSError):
        continue  # binario o ilegible
    for token in jwt_re.findall(text):
        payload = decode(token.split('.')[1])
        if isinstance(payload, dict) and str(payload.get('role', '')) in PRIVILEGED:
            bad.append((path, payload.get('role')))

for path, role in bad:
    print(f'::error::JWT con rol «{role}» detectado en {path}', file=sys.stderr)

sys.exit(1 if bad else 0)
PY
then
  found=1
fi

if [ "$found" -ne 0 ]; then
  echo "Se ha detectado una credencial privilegiada en '$DIR'. Despliegue abortado." >&2
  exit 1
fi

echo "OK: sin credenciales privilegiadas en '$DIR'."
