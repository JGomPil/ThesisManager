#!/usr/bin/env bash
# =============================================================================
# Vigila los embeds de PostgREST que necesitan una pista explícita.
#
# EL PROBLEMA QUE PREVIENE
# Cuando dos tablas están unidas por más de una clave ajena, PostgREST no puede
# decidir cuál usar en un embed y responde HTTP 300 con el código PGRST201,
# «Could not embed because more than one relationship was found». No es un
# error de permisos ni de datos: la consulta entera falla y la pantalla se
# queda sin información. Pasó de verdad con `work_members` → `profiles`
# (`user_id` y `created_by`) y con `tasks` → `profiles` (`assignee_id` y
# `created_by`): el resumen, la ficha y el tablero se quedaron vacíos.
#
# Peor aún, la pista no es cosmética: con la pista equivocada la consulta
# funciona pero devuelve a la PERSONA EQUIVOCADA (el creador en lugar del
# asignado). Un fallo silencioso, que es la razón de ser de esta comprobación.
#
# CÓMO LO HACE
# Lee las migraciones, cuenta las claves ajenas inline (`references X(id)`) por
# tabla y deduce qué pares tienen más de una. Después exige que todo embed de
# una tabla que sea DESTINO de un par ambiguo lleve pista `!restriccion`.
#
# LIMITACIÓN ASUMIDA A PROPÓSITO (es estricto de más)
# Marca `:profiles(` incluso desde una tabla con una sola clave ajena hacia
# `profiles`, donde la pista no haría falta. Es deliberado: poner la pista
# nunca estorba, deja la intención escrita y evita que el día que alguien añada
# un segundo `references profiles(id)` a esa tabla se rompa la pantalla sin
# que nadie lo vea venir. Si un caso concreto molesta, añade la pista igual.
#
# NO DETECTA claves ajenas declaradas aparte con `alter table ... add
# constraint`. Hoy no hay ninguna en embeds; si se añadieran, habría que
# extender el parseo o pasar a comprobarlo contra la base de datos.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - "$@" <<'PY'
import pathlib, re, sys

mig = sorted(pathlib.Path('supabase/migrations').glob('*.sql'))
sql = "\n".join(p.read_text() for p in mig)

# Bloques `create table <nombre> ( ... );`
pares = {}
for m in re.finditer(r'create table (?:if not exists )?(\w+)\s*\((.*?)\n\);', sql, re.S):
    origen, cuerpo = m.group(1), m.group(2)
    for r in re.finditer(r'references\s+(?:public\.)?(\w+)\s*\(', cuerpo):
        pares.setdefault((origen, r.group(1)), 0)
        pares[(origen, r.group(1))] += 1

ambiguos = {(o, d) for (o, d), n in pares.items() if n > 1}
destinos = sorted({d for _, d in ambiguos})

print("Pares con más de una clave ajena (todo embed suyo necesita pista):")
for o, d in sorted(ambiguos):
    print(f"  {o} -> {d}  ({pares[(o, d)]} claves)")
if not destinos:
    print("No hay pares ambiguos; nada que vigilar.")
    sys.exit(0)
print(f"\nTablas destino vigiladas: {', '.join(destinos)}")

fallos = []
for f in list(pathlib.Path('src').rglob('*.ts')) + list(pathlib.Path('src').rglob('*.tsx')):
    for n, linea in enumerate(f.read_text().splitlines(), 1):
        if linea.lstrip().startswith(('//', '*', '/*')):
            continue
        for d in destinos:
            # Embed sin pista: `algo:destino(` o `destino(` precedido de coma.
            for m in re.finditer(rf'(?:(\w+):)?\b{d}\s*\(', linea):
                antes = linea[:m.start()]
                # Solo es un embed si va dentro de un select: lleva `:` o coma antes.
                if m.group(1) is None and not antes.rstrip().endswith((',', '`', '(')):
                    continue
                if f'{d}!' in linea[m.start():m.start() + len(d) + 2]:
                    continue
                fallos.append((f, n, linea.strip()))

if fallos:
    print("\nFALTA LA PISTA en estos embeds (PostgREST devolverá HTTP 300 PGRST201):")
    for f, n, linea in fallos:
        print(f"  {f}:{n}")
        print(f"      {linea}")
    print("\nAñade `!<nombre_de_la_restriccion>`, por ejemplo:")
    print("  profile:profiles!work_members_user_id_fkey(id,full_name)")
    sys.exit(1)

print("\nOK: todos los embeds de tablas ambiguas llevan pista explícita.")
PY
