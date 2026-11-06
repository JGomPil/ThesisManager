#!/usr/bin/env python3
# =============================================================================
# Copia de los ficheros de Storage, con la clave pública y tu propia cuenta.
#
# POR QUÉ EXISTE
# Un volcado SQL trae `storage.objects` —los METADATOS— y nunca los bytes. Al
# restaurar, la plataforma apunta a ficheros que no existen y el síntoma no es un
# error sino una foto en blanco o una descarga vacía (BACKUP.md §4). El ensayo de
# restauración lo avisa; esto es lo que falta para taparlo.
#
# `supabase storage cp` exige instalar la CLI, iniciar sesión y vincular el
# proyecto. Esto no necesita nada de eso: habla con la API documentada usando lo
# que ya hay en `.env.local`, es decir **la clave pública `anon`**, y se
# identifica con TU CUENTA.
#
# LO QUE ESO IMPLICA, Y ES A PROPÓSITO
# No usa `service_role` ni ninguna clave privilegiada. Por tanto solo puede
# guardar los ficheros que tú podrías descargar a mano desde la aplicación: lo
# que te dejen ver las políticas de Storage. Si algún día esta copia saliera
# incompleta, no sería un fallo del guion: sería que esa cuenta no tiene acceso,
# y la respuesta es ejecutarlo con una cuenta que sí, no elevar privilegios.
#
# USO
#   python3 scripts/backup-storage.py ~/copias-thesis-manager/storage-20261106
#   python3 scripts/backup-storage.py <carpeta> --email alguien@uva.es
# =============================================================================
import argparse
import getpass
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

CUBOS = ['avatars', 'work-documents', 'template-files']
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def contexto_ssl():
    """Verificación de certificado, pase lo que pase.

    Los Python descargados de python.org llegan SIN almacén de certificados
    configurado (`cafile` vale None) hasta que alguien ejecuta a mano el
    «Install Certificates.command», que nadie ejecuta. El síntoma es
    CERTIFICATE_VERIFY_FAILED contra cualquier sitio, y la receta que circula
    por internet es desactivar la verificación.

    Aquí eso no: por esta conexión van a pasar memorias, rúbricas y fotos de
    personas. Si falta el almacén, se busca uno —`certifi`, que viene con esos
    mismos Python, o el del sistema— y si no hay ninguno se aborta.
    """
    if ssl.get_default_verify_paths().cafile:
        return ssl.create_default_context()
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for ruta in ('/etc/ssl/cert.pem', '/usr/local/etc/openssl/cert.pem'):
        if os.path.exists(ruta):
            return ssl.create_default_context(cafile=ruta)
    salir('este Python no tiene almacén de certificados y no se ha encontrado '
          'ninguno.\n  Instálalo con:  python3 -m pip install certifi\n'
          '  No se descarga nada sin verificar el certificado.')


SSL = None


def leer_entorno():
    """URL y clave pública, de .env.local. La clave anon es pública por diseño."""
    ruta = os.path.join(RAIZ, '.env.local')
    if not os.path.exists(ruta):
        salir(f'no existe {ruta}: cópialo de .env.example y rellénalo')
    datos = {}
    with open(ruta, encoding='utf-8') as f:
        for linea in f:
            linea = linea.strip()
            if linea and not linea.startswith('#') and '=' in linea:
                clave, valor = linea.split('=', 1)
                datos[clave.strip()] = valor.strip().strip('"\'')
    url = datos.get('VITE_SUPABASE_URL', '').rstrip('/')
    clave = datos.get('VITE_SUPABASE_ANON_KEY', '')
    if not url or not clave:
        salir('faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local')
    return url, clave


def salir(mensaje):
    print(f'▸ ERROR: {mensaje}', file=sys.stderr)
    sys.exit(1)


def pedir(url, clave, ruta, metodo='GET', cuerpo=None, jwt=None, crudo=False):
    cabeceras = {'apikey': clave}
    if jwt:
        cabeceras['Authorization'] = f'Bearer {jwt}'
    datos = None
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode('utf-8')
        cabeceras['Content-Type'] = 'application/json'
    pet = urllib.request.Request(f'{url}{ruta}', data=datos, headers=cabeceras, method=metodo)
    try:
        with urllib.request.urlopen(pet, timeout=60, context=SSL) as r:
            bruto = r.read()
            return bruto if crudo else json.loads(bruto)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'HTTP {e.code} en {ruta}: {detalle}') from None
    except urllib.error.URLError as e:
        raise RuntimeError(f'no se pudo conectar: {e.reason}') from None


def listar(url, clave, jwt, cubo, prefijo=''):
    """Devuelve (ficheros, carpetas). En esta API una carpeta viene con id nulo.

    Se pagina de cien en cien: la API tiene tope y una carpeta con más ficheros
    que el tope se quedaría a medias sin avisar, que es el peor de los fallos
    posibles en una copia de seguridad.
    """
    ficheros, carpetas, desplazamiento = [], [], 0
    while True:
        lote = pedir(url, clave, f'/storage/v1/object/list/{cubo}', 'POST', {
            'prefix': prefijo,
            'limit': 100,
            'offset': desplazamiento,
            'sortBy': {'column': 'name', 'order': 'asc'},
        }, jwt)
        if not lote:
            break
        for entrada in lote:
            nombre = f"{prefijo}{entrada['name']}"
            (carpetas if entrada.get('id') is None else ficheros).append(nombre)
        if len(lote) < 100:
            break
        desplazamiento += len(lote)
    return ficheros, carpetas


def esperados_del_volcado(ruta):
    """Cuántos ficheros dice el volcado SQL que hay, por cubo.

    POR QUÉ HACE FALTA ESTO
    Sin sesión, `/storage/v1/object/list/<cubo>` responde HTTP 200 y una lista
    VACÍA: para un cubo al que no se tiene acceso y para un cubo que no existe.
    Comprobado. Así que «0 ficheros» no demuestra «no hay ficheros», y una copia
    de seguridad que no distingue esas dos cosas es peor que no tener copia,
    porque se anuncia como correcta.

    El volcado SQL sí trae la verdad —`storage.objects`, los metadatos— así que
    se usa como segunda fuente y se comparan los dos números.
    """
    cuenta = {}
    with open(ruta, encoding='utf-8', errors='replace') as f:
        columnas, dentro = None, False
        for linea in f:
            if not dentro:
                if linea.startswith('COPY storage.objects ('):
                    columnas = [c.strip().strip('"') for c in
                                linea[linea.index('(') + 1:linea.rindex(')')].split(',')]
                    dentro = True
                continue
            if linea.startswith('\\.'):
                break
            campos = linea.rstrip('\n').split('\t')
            if len(campos) == len(columnas):
                fila = dict(zip(columnas, campos))
                nombre = fila.get('name', '')
                if not nombre.endswith('.emptyFolderPlaceholder'):
                    cuenta[fila.get('bucket_id', '?')] = cuenta.get(fila.get('bucket_id', '?'), 0) + 1
    return cuenta


def autoprueba():
    """Comprueba el contador de esperados contra un volcado fabricado.

    El contador es la única defensa contra una copia vacía con cara de éxito, y
    es un analizador de texto escrito a mano: si algún día cambia el formato del
    volcado, devolvería cero y la comparación aprobaría cualquier cosa. Así que
    antes de confiar en él se le da un volcado cuyo resultado se conoce.
    """
    import tempfile
    cebo = (
        'COPY public.otra_cosa (id, bucket_id) FROM stdin;\n'
        '1\tavatars\n'
        '\\.\n'
        '\n'
        'COPY storage.objects (id, bucket_id, name, owner) FROM stdin;\n'
        'a1\tavatars\tfoto.webp\tu1\n'
        'a2\twork-documents\tmemoria.pdf\tu1\n'
        'a3\twork-documents\tcarpeta/anexo.pdf\tu2\n'
        'a4\twork-documents\tcarpeta/.emptyFolderPlaceholder\tu2\n'
        '\\.\n'
        'COPY storage.buckets (id, name) FROM stdin;\n'
        'avatars\tavatars\n'
        '\\.\n'
    )
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f:
        f.write(cebo)
        ruta = f.name
    try:
        obtenido = esperados_del_volcado(ruta)
    finally:
        os.unlink(ruta)

    # 1 avatar y 2 documentos: el marcador de carpeta vacía NO cuenta, y la
    # tabla `public.otra_cosa` con una columna del mismo nombre tampoco.
    esperado = {'avatars': 1, 'work-documents': 2}
    if obtenido != esperado:
        salir(f'la autoprueba del contador falla: {obtenido} en lugar de {esperado}')
    print('\u25b8 Autoprueba del contador: CORRECTA '
          f'(1 avatar, 2 documentos, el marcador de carpeta vacía no cuenta)')


def main():
    global SSL
    SSL = contexto_ssl()
    sys.stdout.reconfigure(line_buffering=True)

    p = argparse.ArgumentParser(description='Copia los ficheros de Storage.')
    p.add_argument('destino', nargs='?',
                   help='carpeta donde guardarlos, FUERA del repositorio')
    p.add_argument('--autoprueba', action='store_true',
                   help='comprueba el contador de esperados y termina')
    p.add_argument('--email', help='cuenta con la que identificarse')
    p.add_argument('--segun-volcado', metavar='FICHERO.sql',
                   help='volcado SQL con el que comparar: comprueba que no falte ningún fichero')
    args = p.parse_args()

    if args.autoprueba:
        autoprueba()
        return
    if not args.destino:
        p.error('falta la carpeta de destino')

    # El destino nunca dentro del repositorio: es público y estos ficheros son
    # memorias, rúbricas y fotos de personas. Se comprueba ANTES de crear nada.
    destino = os.path.abspath(os.path.expanduser(args.destino))
    ancestro = destino
    while not os.path.isdir(ancestro):
        padre = os.path.dirname(ancestro)
        if padre == ancestro:
            break
        ancestro = padre
    if os.path.realpath(ancestro).startswith(os.path.realpath(RAIZ) + os.sep) \
       or os.path.realpath(ancestro) == os.path.realpath(RAIZ):
        salir(f'«{destino}» está dentro del repositorio, que es PÚBLICO.\n'
              '  Elige una carpeta de fuera, por ejemplo ~/copias-thesis-manager/storage')

    url, clave = leer_entorno()
    print(f'▸ Proyecto: {url}')
    print('  Se usa la clave pública anon y tu cuenta. Nada de service_role.')

    # Sin terminal, getpass avisa de que va a mostrar la contraseña en pantalla
    # y la lee de todas formas. Preferimos no empezar.
    if not sys.stdin.isatty():
        salir('esto pide la contraseña por teclado y necesita un terminal.\n'
              '  Ábrelo en tu Terminal:  python3 scripts/backup-storage.py <carpeta>')

    correo = args.email or input('Correo de tu cuenta: ').strip()
    contrasena = getpass.getpass('Contraseña de la cuenta (no se verá): ')

    try:
        sesion = pedir(url, clave, '/auth/v1/token?grant_type=password', 'POST',
                       {'email': correo, 'password': contrasena})
    except RuntimeError as e:
        salir(f'{e}\n  Es la contraseña de tu CUENTA de la plataforma, no la de la base de datos.')
    del contrasena
    jwt = sesion.get('access_token')
    if not jwt:
        salir('la respuesta no trae sesión')
    print(f"  · identificado como {sesion.get('user', {}).get('email', correo)}")

    total, fallos, por_cubo = 0, [], {}
    for cubo in CUBOS:
        try:
            pendientes, n = [''], 0
            while pendientes:
                prefijo = pendientes.pop()
                ficheros, carpetas = listar(url, clave, jwt, cubo, prefijo)
                pendientes += [f'{c}/' for c in carpetas]
                for fichero in ficheros:
                    # `.emptyFolderPlaceholder` es un fichero vacío que crea la
                    # propia API para sostener carpetas vacías. No es un dato.
                    if fichero.endswith('.emptyFolderPlaceholder'):
                        continue
                    bytes_ = pedir(url, clave, f'/storage/v1/object/{cubo}/{fichero}',
                                   jwt=jwt, crudo=True)
                    salida = os.path.join(destino, cubo, fichero)
                    os.makedirs(os.path.dirname(salida), exist_ok=True)
                    with open(salida, 'wb') as f:
                        f.write(bytes_)
                    os.chmod(salida, 0o600)
                    n += 1
            print(f'  · {cubo}: {n} fichero(s)')
            por_cubo[cubo] = n
            total += n
        except RuntimeError as e:
            print(f'  · {cubo}: NO SE HA PODIDO ({e})')
            fallos.append(cubo)

    # Lo descargado contra lo que dice el volcado. Sin esta comparación, una
    # cuenta sin acceso produce una copia vacía con cara de éxito.
    if args.segun_volcado:
        esperado = esperados_del_volcado(os.path.expanduser(args.segun_volcado))
        print(f'\u25b8 Contra el volcado ({sum(esperado.values())} fichero(s) en storage.objects):')
        for cubo in CUBOS:
            quiero, tengo = esperado.get(cubo, 0), por_cubo.get(cubo, 0)
            if tengo < quiero:
                print(f'  · {cubo}: FALTAN {quiero - tengo} de {quiero}')
                fallos.append(cubo)
            elif quiero or tengo:
                print(f'  · {cubo}: {tengo} de {quiero}  CORRECTO')
    elif total == 0:
        print('\u25b8 ERROR: no se ha descargado NI UN FICHERO.', file=sys.stderr)
        print('  Sin sesión válida la API responde 200 y lista vacía, así que esto', file=sys.stderr)
        print('  puede ser «no hay nada» o «esta cuenta no ve nada», y no se puede', file=sys.stderr)
        print('  distinguir sin una segunda fuente. Vuelve a ejecutarlo con:', file=sys.stderr)
        print('    --segun-volcado ~/copias-thesis-manager/thesis-manager-FECHA.sql', file=sys.stderr)
        sys.exit(1)
    else:
        print('\u25b8 AVISO: no se ha comprobado que esté completo. Para comprobarlo:')
        print('    --segun-volcado ~/copias-thesis-manager/thesis-manager-FECHA.sql')

    if fallos:
        print(f'▸ COPIA INCOMPLETA: faltan {", ".join(fallos)}.', file=sys.stderr)
        print('  Si es un 4xx, esa cuenta no tiene acceso a ese cubo; ejecútalo con', file=sys.stderr)
        print('  una que sí. No se eleva a service_role para esto.', file=sys.stderr)
        sys.exit(1)

    print(f'▸ {total} fichero(s) en {destino}')
    print('  Guárdalo junto al volcado .sql: los dos juntos son la copia.')
    print('  A la unidad institucional o a un disco cifrado. Nunca al repositorio.')


if __name__ == '__main__':
    main()
