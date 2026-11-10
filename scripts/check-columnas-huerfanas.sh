#!/usr/bin/env bash
# =============================================================================
# Columnas que la base de datos tiene y la aplicación no usa
#
# POR QUÉ EXISTE ESTE GUARDA
# Tres veces en una semana apareció el mismo fallo, y las tres las encontró la
# dirección usando la aplicación, no una prueba:
#
#   · `academic_works.defense_date` existía desde la 0002 y ningún formulario
#     la escribía. «¿La fecha de defensa no se puede cambiar? No veo dónde».
#   · `academic_works.progress_override` igual: la ficha enseñaba «Progreso
#     académico · a juicio de la dirección» y no había manera de emitir ese
#     juicio.
#   · `academic_works.is_archived` era peor, porque se LEÍA en tres sitios sin
#     que nada la escribiera: el filtro «solo activos» del panel y de los
#     informes no filtraba nada, y nadie podía notarlo. No daba ningún error;
#     respondía otra pregunta.
#
# Una columna sin interfaz NO PRODUCE NINGÚN SÍNTOMA. No hay excepción, no hay
# aviso en consola, no falla ninguna prueba: solo hay una pantalla que no sirve
# para lo que alguien esperaba. Es justo el tipo de fallo que este repositorio
# persigue con guardas, así que aquí va el suyo.
#
# QUÉ HACE
# Saca las columnas de `create table` y `alter table ... add column` de las
# migraciones, y comprueba que el nombre aparezca en algún sitio de `src/`.
#
# `src/data/types/` QUEDA FUERA A PROPÓSITO: ese fichero describe la base
# entera, así que si contara, todas las columnas estarían «usadas» siempre y el
# guarda no serviría para nada.
#
# LAS EXCEPCIONES SE ESCRIBEN AQUÍ ABAJO, CON SU MOTIVO. Una lista de
# excepciones sin motivo se convierte en el sitio donde se esconden los fallos;
# con motivo, es documentación de qué hay en la base que la aplicación no usa y
# por qué, que es una pregunta que nadie más contesta.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - <<'PY'
import re, io, glob, subprocess, sys

# -----------------------------------------------------------------------------
# Columnas que la aplicación NO usa y está bien que no use.
# Cada una con el motivo; sin motivo no se admite ninguna.
# -----------------------------------------------------------------------------
ACEPTADAS = {
    # Las escribe la propia base y no hay —todavía— pantalla que las lea.
    'activity_logs.actor_id':        'lo escribe el disparador de auditoria; no hay pantalla de actividad',
    'activity_logs.diff':            'lo escribe el disparador de auditoria; no hay pantalla de actividad',
    'invitations.accepted_user_id':  'lo rellena el alta al entrar por primera vez (0006)',
    'keepalive.note':                'tabla de latido para que Supabase no pause el proyecto',

    # Modelo de grupo de investigacion que la aplicacion no explota: la unidad
    # real es la organizacion. Se deja en la base porque hay datos y porque
    # separarlo algun dia es mas facil que volver a meterlo.
    'academic_works.research_group_id':       'el grupo no se usa como unidad: manda la organizacion',
    'research_group_members.research_group_id': 'idem',
    'research_lines.research_group_id':       'idem',
    'research_groups.acronym':                'idem',
    'organizations.slug':                     'idem: se selecciona y no se enseña en ninguna parte',

    # La escribe un disparador, no el cliente.
    'tasks.completed_at':            'la pone la base al pasar a COMPLETADA y la retira al salir (0024)',

    # SI las escribe la aplicacion, dentro de `src/data/`: la pantalla trabaja
    # con el objeto ya resuelto (el nombre del revisor, el hilo de la version)
    # y nunca nombra la columna. Son falsos positivos de la regla de arriba, y
    # se apuntan en vez de aflojar la regla.
    'document_versions.reviewed_at': 'la escribe documents.repo al validar una entrega',
    'document_versions.reviewer_id': 'idem; la ficha enseña el nombre del revisor, no la columna',
    'document_comments.version_id':  'la escribe documents.repo al comentar una version',
}

# -----------------------------------------------------------------------------
# Lo que SÍ es un hueco conocido, apuntado para que no se olvide. El guarda no
# falla por ellas, pero las enseña en cada ejecución: son funciones que la base
# ya permite y la interfaz no ofrece.
# -----------------------------------------------------------------------------
PENDIENTES = {
    'comments.parent_comment_id': 'responder a un comentario concreto: el hilo es plano en pantalla',
    'milestones.phase_id':        'colgar un hito de una fase del plan',
    'tasks.milestone_id':         'enganchar una tarea a un hito (la columna la protege el disparador)',
    # REGLA MUERTA: esta en el catalogo, se puede rellenar y no la hace cumplir
    # nadie. Peor que faltar, porque quien la rellena cree haber decidido algo.
    # (`max_supervisors` estaba aqui y salio de la lista el 10-11-2026: ahora
    # avisa al anadir a la direccion. La salida de esta lista la canto el propio
    # guion, que avisa de las excepciones que sobran.)
}

sql = ''.join(io.open(f, encoding='utf-8').read() for f in sorted(glob.glob('supabase/migrations/*.sql')))
fuentes = subprocess.run(
    ['bash', '-c', 'find src -name "*.ts" -o -name "*.tsx" | grep -v "^src/data/types/"'],
    capture_output=True, text=True).stdout.split()
blob = ''.join(io.open(f, encoding='utf-8').read() for f in fuentes)
# Y aparte, solo lo que ve una persona: pantallas, esquemas de formulario y
# dominio. Sin `src/data/`, que es la capa que habla con PostgREST.
blob_pantalla = ''.join(io.open(f, encoding='utf-8').read()
                        for f in fuentes if not f.startswith('src/data/'))

tablas = {}
for m in re.finditer(r'create table (?:if not exists )?(\w+)\s*\((.*?)\n\);', sql, re.S):
    for linea in m.group(2).split('\n'):
        l = linea.strip()
        if not l or l.startswith('--'):
            continue
        if l.lower().startswith(('constraint', 'check', 'unique', 'primary', 'foreign', 'exclude')):
            continue
        col = l.split()[0]
        if re.fullmatch(r'[a-z_][a-z0-9_]*', col):
            tablas.setdefault(m.group(1), set()).add(col)
for m in re.finditer(r'alter table (\w+)\s+add column (?:if not exists )?(\w+)', sql):
    tablas.setdefault(m.group(1), set()).add(m.group(2))

if not tablas:
    print('  ✗ no se ha leido ninguna tabla de las migraciones: el guarda no estaria comprobando nada')
    sys.exit(1)

def mencionada(texto, col):
    return re.search(r'\b' + re.escape(col) + r'\b', texto) is not None

todas = [(t, c) for t, cols in sorted(tablas.items()) for c in sorted(cols)]
huerfanas = [f'{t}.{c}' for t, c in todas if not mencionada(blob, c)]

# LA VARIANTE QUE MAS CUESTA VER: la columna SI aparece en `src/`, pero solo en
# `src/data/`. La capa de datos la conoce —la lee, la filtra— y ninguna pantalla
# ni ningun formulario la escribe nunca. Es lo que pasaba con
# `academic_works.is_archived`: `works.repo.ts` filtraba por ella en tres
# consultas y NADA la ponia a `true`, asi que el filtro «solo activos» no
# quitaba nada y el selector «Incluir archivados» de Informes no hacia nada.
# Un hueco de los de antes avisa al usarlo; este contesta otra pregunta y se
# calla.
solo_datos = [f'{t}.{c}' for t, c in todas
              if mencionada(blob, c) and not mencionada(blob_pantalla, c)]

nuevas = [h for h in huerfanas + solo_datos if h not in ACEPTADAS and h not in PENDIENTES]
vivas = [h for h in huerfanas + solo_datos if h in PENDIENTES]
vistas = set(huerfanas) | set(solo_datos)
muertas = [h for h in list(ACEPTADAS) + list(PENDIENTES) if h not in vistas]

print(f'▸ {len(tablas)} tablas · {sum(len(c) for c in tablas.values())} columnas')

if vivas:
    print('  Huecos conocidos (la base lo permite y la interfaz no lo ofrece):')
    for h in vivas:
        print(f'    · {h} — {PENDIENTES[h]}')

if muertas:
    # Una excepción que ya no hace falta es ruido que esconde las que sí.
    print('  Excepciones que sobran (la columna ya se usa; quítalas de este guion):')
    for h in muertas:
        print(f'    · {h}')

if nuevas:
    print('  ✗ COLUMNAS SIN INTERFAZ, y sin motivo escrito:')
    for h in nuevas:
        donde = 'solo la conoce src/data/' if h in solo_datos else 'no aparece en src/'
        print(f'    · {h}  ({donde})')
    print()
    print('  Una columna que la base tiene y ninguna pantalla escribe no da ningun')
    print('  error: solo deja una pantalla que no sirve, o un filtro que no filtra.')
    print('  O le das interfaz, o la apuntas aqui arriba con su motivo.')
    sys.exit(1)

if muertas:
    sys.exit(1)

print('OK: toda columna de la base llega a la aplicacion, o tiene su motivo escrito.')
PY
