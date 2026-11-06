#!/usr/bin/env bash
# =============================================================================
# Comprobación de la aplicación instalable
#
# POR QUÉ HACE FALTA: cuando esto se rompe, NO se nota. Un icono que da 404 no
# produce ningún error visible: el navegador enseña su icono genérico y la
# aplicación «se instala igual». Lo mismo con una ruta absoluta en el manifest,
# que en local funciona y en GitHub Pages —que sirve desde /ThesisManager/—
# apunta a la raíz del dominio, donde no hay nada.
#
# Se ejecuta sobre `dist/`, es decir sobre lo que de verdad se publica, no sobre
# las fuentes.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DIST="${1:-dist}"
FALLOS=0
fallo() { echo "  ✗ $1"; FALLOS=$((FALLOS + 1)); }

[ -d "$DIST" ] || { echo "No existe '$DIST'. Ejecuta antes: npm run build"; exit 1; }

echo "▸ Manifest"
MANIFEST="$DIST/manifest.webmanifest"
[ -f "$MANIFEST" ] || { echo "  ✗ falta manifest.webmanifest"; exit 1; }
python3 - "$MANIFEST" "$DIST" <<'PY'
import json, pathlib, sys
manifest = pathlib.Path(sys.argv[1]); dist = pathlib.Path(sys.argv[2])
m = json.loads(manifest.read_text())
fallos = 0

for clave in ('name', 'short_name', 'start_url', 'scope', 'display', 'icons'):
    if clave not in m:
        print(f'  ✗ falta la clave «{clave}»'); fallos += 1

# Rutas relativas: una barra inicial apunta a la raíz del dominio, no al
# subdirectorio de Pages. Es el error que no se ve hasta que se despliega.
for clave in ('start_url', 'scope'):
    if str(m.get(clave, '')).startswith('/'):
        print(f'  ✗ «{clave}» es absoluta ({m[clave]}): romperá bajo /ThesisManager/'); fallos += 1

if m.get('display') not in ('standalone', 'fullscreen', 'minimal-ui'):
    print(f'  ✗ display={m.get("display")}: no se abrirá como aplicación'); fallos += 1

tamanos = set()
for icono in m.get('icons', []):
    src = icono.get('src', '')
    if src.startswith('/'):
        print(f'  ✗ icono con ruta absoluta: {src}'); fallos += 1
    destino = dist / src
    if not destino.is_file():
        print(f'  ✗ icono que no existe en dist: {src}'); fallos += 1
    elif destino.stat().st_size == 0:
        print(f'  ✗ icono vacío: {src}'); fallos += 1
    tamanos.add(icono.get('sizes'))
    if 'maskable' in (icono.get('purpose') or ''):
        tamanos.add('maskable')

# Android pide 192 y 512; sin un maskable, el icono sale recortado dentro de la
# forma que imponga el fabricante.
for exigido in ('192x192', '512x512', 'maskable'):
    if exigido not in tamanos:
        print(f'  ✗ falta un icono {exigido}'); fallos += 1

print(f'  · {len(m.get("icons", []))} iconos declarados, todos presentes' if fallos == 0 else '')
sys.exit(1 if fallos else 0)
PY

echo "▸ index.html"
grep -q 'rel="manifest"' "$DIST/index.html" || fallo "index.html no enlaza el manifest"
grep -q 'apple-touch-icon' "$DIST/index.html" || fallo "sin apple-touch-icon: el iPhone pondría una captura de la página"
grep -q 'name="theme-color"' "$DIST/index.html" || fallo "sin theme-color"
grep -qE 'href="(manifest|/)' "$DIST/index.html" || true
grep -q 'href="/manifest' "$DIST/index.html" && fallo "el manifest se enlaza con ruta absoluta"

echo "▸ Service worker"
[ -f "$DIST/sw.js" ] || fallo "falta sw.js: Chrome en Android no ofrecerá instalar"
grep -q "addEventListener('fetch'" "$DIST/sw.js" || fallo "sw.js sin manejador de fetch: no cuenta como instalable"
# La regla que evita el fallo clásico: el HTML NUNCA se sirve de caché primero.
grep -q "peticion.mode === 'navigate'" "$DIST/sw.js" || fallo "sw.js no distingue las navegaciones"

if [ "$FALLOS" -gt 0 ]; then
  echo "▸ $FALLOS problema(s) en la aplicación instalable."
  exit 1
fi
echo "OK: instalable, con iconos presentes y rutas relativas."
