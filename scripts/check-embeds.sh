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
# Lee las migraciones, recoge TODAS las claves ajenas —las que van dentro del
# `create table` y las que se añaden después con `alter table ... add
# constraint`— y cuenta cuántas relaciones hay entre cada PAR de tablas,
# **sin mirar la dirección**. Si hay más de una, las dos tablas quedan
# vigiladas: cualquier embed de una desde la otra necesita pista.
#
# LA DIRECCIÓN NO IMPORTA, Y ESO COSTÓ UNA PANTALLA ROTA
# La primera versión contaba claves por (origen, destino) y solo leía las
# declaraciones inline. Se le escaparon `templates` y `work_types`, que están
# unidas por dos claves EN SENTIDOS OPUESTOS: `templates.work_type_id` dentro
# del `create table`, y `work_types.default_template_id`, añadida con un
# `alter table` al final de la 0002 porque cuando se crea `work_types` la tabla
# `templates` todavía no existe. Para PostgREST son dos relaciones entre las
# mismas dos tablas y el embed es ambiguo igual; la pantalla de plantillas se
# quedó en blanco con PGRST201. Las dos lagunas —la dirección y el `alter
# table`— están cerradas.
#
# LIMITACIÓN ASUMIDA A PROPÓSITO (es estricto de más)
# Marca `:profiles(` incluso desde una tabla con una sola clave ajena hacia
# `profiles`, donde la pista no haría falta. Es deliberado: poner la pista
# nunca estorba, deja la intención escrita y evita que el día que alguien añada
# un segundo `references profiles(id)` a esa tabla se rompa la pantalla sin
# que nadie lo vea venir. Si un caso concreto molesta, añade la pista igual.
#
# LO QUE SIGUE SIN DETECTAR
# Claves ajenas creadas con una sintaxis que no sea `references X(` ni
# `alter table ... foreign key ... references X`, y las que añada alguien a
# mano en el panel de Supabase sin dejarlas en una migración. Lo primero es
# improbable; lo segundo sería un problema mayor que este guardián.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - "$@" <<'PY'
import pathlib, re, sys

mig = sorted(pathlib.Path('supabase/migrations').glob('*.sql'))
sql = "\n".join(p.read_text() for p in mig)

# 1. Claves ajenas declaradas dentro del `create table`.
aristas = []   # (origen, destino)
for m in re.finditer(r'create table (?:if not exists )?(\w+)\s*\((.*?)\n\);', sql, re.S):
    origen, cuerpo = m.group(1), m.group(2)
    for r in re.finditer(r'references\s+(?:public\.)?(\w+)\s*\(', cuerpo):
        aristas.append((origen, r.group(1)))

# 2. Claves ajenas añadidas después. Es el caso de `work_types.default_template_id`,
#    que no cabe en el `create table` porque `templates` aún no existe.
for m in re.finditer(
    r'alter table\s+(?:only\s+)?(?:public\.)?(\w+)(.*?);',
    sql, re.S | re.I,
):
    origen, cuerpo = m.group(1), m.group(2)
    for r in re.finditer(r'foreign key\s*\([^)]*\)\s*references\s+(?:public\.)?(\w+)', cuerpo, re.I):
        aristas.append((origen, r.group(1)))

# El par se cuenta SIN dirección: para PostgREST, dos relaciones entre las
# mismas dos tablas son ambiguas vayan en el sentido que vayan.
pares = {}
for o, d in aristas:
    clave = tuple(sorted((o, d)))
    pares[clave] = pares.get(clave, 0) + 1

ambiguos = {par for par, n in pares.items() if n > 1}
# Las dos tablas de un par ambiguo quedan vigiladas, no solo la de destino.
destinos = sorted({t for par in ambiguos for t in par})

print("Pares con más de una relación (todo embed entre ellas necesita pista):")
for par in sorted(ambiguos):
    detalle = ", ".join(f"{o}->{d}" for o, d in aristas if tuple(sorted((o, d))) == par)
    print(f"  {par[0]} <-> {par[1]}  ({pares[par]} relaciones: {detalle})")
if not destinos:
    print("No hay pares ambiguos; nada que vigilar.")
    sys.exit(0)
print(f"\nTablas vigiladas: {', '.join(destinos)}")

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
