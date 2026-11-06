# BACKUP.md — Copias de seguridad y recuperación

> El plan Free de Supabase **no incluye copias de seguridad automáticas**. Las copias son
> responsabilidad del administrador y **no pueden automatizarse dentro de este repositorio**,
> porque es público: los artefactos de GitHub Actions son descargables por cualquiera y un volcado
> contiene datos personales. Automatizar la copia aquí sería una brecha de datos, no una mejora.

## 1. Qué hay que respaldar

| Elemento | Dónde vive | Quién lo respalda |
|---|---|---|
Esquema de la base de datos | `supabase/migrations/` en Git | **Ya respaldado**: está versionado |
Datos académicos | PostgreSQL de Supabase | Volcado manual (§2) |
Usuarios de autenticación | Esquema `auth` de Supabase | Incluido en el volcado completo |
Documentos (memorias, datos) | Drive/OneDrive institucional | Respaldo de la universidad |
Enlaces y metadatos de documentos | PostgreSQL | Volcado manual (§2) |
Avatares y adjuntos pequeños | Supabase Storage | `supabase storage` (§4) |

Lo valioso y frágil es la base de datos. Los ficheros grandes están fuera por diseño
(`FREE_TIER.md` §5.6), y de ellos responde la infraestructura institucional.

## 2. Volcado de la base de datos

### 2.1. Con el guion (procedimiento recomendado)

```bash
./scripts/backup-dump.sh                      # pregunta región y contraseña
./scripts/backup-dump.sh eu-west-3 ~/copias   # si ya se saben
```

Pide la contraseña sin que se vea ni quede en el historial, construye la cadena de
conexión, vuelca los cuatro esquemas y **ensaya la copia acto seguido** con
`restore-drill.sh` (§5.0). No hace falta instalar PostgreSQL ni la CLI de Supabase:
usa `pg_dump` dentro de Docker. Se niega a escribir dentro del repositorio.

Los dos únicos datos que hay que tener a mano:

- **La contraseña de la base de datos**: panel → *Settings → Database*. Si no se
  recuerda, se restablece ahí mismo sin consecuencias: la aplicación **no la usa**
  (entra con la clave pública `anon`), así que cambiarla no rompe nada.
- **La región del proyecto**: aparece en el panel, en la página del proyecto, junto
  a su nombre. No se puede deducir desde fuera: las cabeceras HTTP de la API
  devuelven el nodo de Cloudflare más cercano a quien pregunta, no la región de
  Supabase.

### 2.2. A mano, si se prefiere

```bash
pg_dump "postgresql://postgres.<REF>:<PASS>@aws-0-<REGION>.pooler.supabase.com:5432/postgres" \
  --schema=public --schema=auth --schema=app --schema=storage \
  --file "thesis-manager-$(date +%Y%m%d).sql"
```

**El anfitrión es el del «session pooler», no la conexión directa.** La conexión
directa de Supabase (`db.<REF>.supabase.co`) ya solo publica registro AAAA, es decir
**solo IPv6**, y desde una red sin IPv6 —la mayoría de las universitarias y
domésticas— no resuelve siquiera: el error que da no menciona IPv6 y se parece a un
problema de contraseña. El *pooler* responde por IPv4. Y el puerto es **5432**, el
de sesión; el 6543 es el de transacción y `pg_dump` no funciona con él.

Dos mensajes de error que conviene saber leer:

| Mensaje | Qué significa de verdad |
|---|---|
| `tenant/user ... not found` | La región no es esa, o el usuario no lleva `.<REF>` detrás de `postgres` |
| `password authentication failed` | La contraseña |

**Los cuatro esquemas, y cada uno por un motivo**: `public` son los datos
académicos; `auth` son **los usuarios**, y sin él se restaura todo y nadie puede
entrar; `app` son las funciones que usan las políticas de RLS; `storage` son los
metadatos de los ficheros. `storage` pertenece a un rol administrativo de Supabase
y a veces `pg_dump` no puede con todo él; el guion reintenta sin ese esquema antes
que quedarse sin copia, y avisa.

**Destino del fichero**: unidad institucional (Drive/OneDrive de la UVa) o disco
cifrado. **Nunca** el repositorio, ni un *issue*, ni un artefacto de Actions, ni un
servicio personal.

## 3. Calendario de copias

| Momento | Tipo |
|---|---|
Inicio y fin de cada curso académico | Volcado completo |
Trimestral | Volcado completo |
Antes de aplicar una migración que altere datos | Volcado completo |
Antes de reactivar un proyecto pausado | No hace falta: los datos se conservan |

Conservar las **cuatro** últimas copias. Una copia que nunca se ha restaurado no es una copia:
es un fichero que se le parece. **Cada volcado se ensaya el mismo día**, con un comando:

```bash
./scripts/restore-drill.sh thesis-manager-YYYYMMDD.sql
```

Tarda menos de un minuto, no toca nada de producción y responde a la única pregunta que importa
(§5.0).

## 4. Supabase Storage

**Un volcado SQL trae los metadatos de los ficheros, nunca los ficheros.** La tabla
`storage.objects` viaja en la copia; los bytes, no. Y esa asimetría es más peligrosa
que no tener nada: al restaurar, la plataforma apunta a ficheros que no existen, y
el síntoma no es un error sino una foto en blanco o una descarga vacía.

Los tres cubos, y hay que copiarlos los tres:

```bash
supabase storage cp -r ss://avatars         ./storage-backup/avatars         --experimental
supabase storage cp -r ss://work-documents  ./storage-backup/work-documents  --experimental
supabase storage cp -r ss://template-files  ./storage-backup/template-files  --experimental
```

El ensayo (§5.0) cuenta cuántos ficheros hay en los metadatos y lo recuerda si hay
alguno. **No lo cuenta como problema**, y es deliberado: el volcado está haciendo lo
correcto y el hueco está en el procedimiento, así que un ensayo en rojo cada vez por
una foto de perfil enseñaría a no mirar el rojo. El 2026-11-06 había 1 fichero
(una foto de perfil) y 3 cubos.

## 5. Restauración

### 5.0. Ensayo automático de la copia (lo primero que hay que hacer)

```bash
./scripts/restore-drill.sh mi-copia.sql     # o .dump
./scripts/restore-drill.sh                  # autoprueba: fabrica un volcado y lo ensaya
```

Levanta un PostgreSQL 16 desechable en Docker, restaura ahí la copia y después **interroga** a la
base restaurada:

| Comprueba | Por qué, si falla, la copia no sirve |
|---|---|
Las 18 tablas del núcleo académico | Una copia sin `work_members` restaura trabajos sin nadie dentro |
**RLS activada en todas las tablas de `public`** | Una copia restaurada sin RLS lo deja todo a la vista en cuanto se pone en servicio, y no avisa |
Que `anon` no ejecute ninguna función de `app` | Es la comprobación de la prueba `[33]`, aplicada a la copia |
**Que haya filas en `auth.users`** | Lo que ningún documento decía: un volcado sin el esquema `auth` devuelve todos los datos y deja la plataforma sin nadie que pueda entrar |
**Que el esquema `app` traiga funciones** | Si viene creado y vacío, «ninguna función es ejecutable por `anon`» es cierto porque no hay ninguna, y las políticas de RLS que las llaman quedan rotas |
Cuántos ficheros hay en `storage.objects` | Un volcado SQL trae los metadatos y nunca los bytes: al restaurar, la plataforma apunta a ficheros que no existen y el síntoma es una foto en blanco, no un error (§4). Avisa, pero no lo cuenta como problema |

Termina con un recuento de lo restaurado (trabajos, participantes, tareas, documentos…) y **sale
con código distinto de cero** si algo falla, así que vale para un *cron* local. No se conecta a
Supabase y no necesita contraseñas: la copia se monta como solo lectura.

Comprueba además que el esquema `app` **traiga funciones**: puede venir creado y vacío, y
entonces «ninguna función es ejecutable por `anon`» es cierto por la peor de las razones —porque
no hay ninguna— y las políticas de RLS que las llaman quedarían rotas al restaurar.

Si avisa de que falta `auth.users`, el volcado necesita además el esquema de autenticación:
`supabase db dump` con `-s auth`, guardado junto al principal. Con `backup-dump.sh` ya va dentro.

### En Supabase local (prueba manual de la copia)

```bash
supabase start
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f thesis-manager-YYYYMMDD.sql
```

### En un proyecto nuevo de Supabase (desastre)

1. Crear proyecto nuevo (región UE).
2. Restaurar el volcado completo con `psql` o `pg_restore`.
3. Reconfigurar `Authentication`: registro público desactivado, URLs de redirección, SMTP.
4. Actualizar los *secrets* `SUPABASE_URL` y `SUPABASE_ANON_KEY` en GitHub.
5. Volver a desplegar (`deploy.yml` → *Run workflow*).
6. Ejecutar `keepalive.yml` manualmente y comprobar que responde 200.
7. Verificar RLS: sin sesión, `academic_works` devuelve 0 filas.

### Proyecto pausado por inactividad

No requiere restauración: panel → *Restore project*. Los datos se conservan hasta un año.
Ver `FREE_TIER.md` §7.

## 6. Exportación de la información académica (portabilidad)

Independiente de las copias técnicas, y pensada para que los datos no queden presos:

- **Informes → CSV** (en la aplicación): una fila por trabajo con los catálogos resueltos y las
  dos cifras de progreso separadas. Lleva separador `;` y BOM de UTF-8, que es lo que Excel en
  español necesita. El PDF sale de la impresión del navegador, también por trabajo.
- **Administración → Copia de los datos académicos**: un JSON con todo lo que la cuenta puede
  leer, en un clic y sin la CLI. Es la red de seguridad de en medio entre dos volcados
  trimestrales; **no** sustituye al volcado, y el propio fichero dice en su `_meta` qué no
  incluye (usuarios de autenticación, esquema, Storage y notas privadas de reunión).
- **Consultas SQL documentadas**: [`docs/EXPORTACION.md`](docs/EXPORTACION.md), con los `JOIN` de
  catálogos ya hechos (tipo, estado, curso, titulación, línea y funciones con su nombre legible en
  lugar de UUID). Las ejecuta de verdad `./scripts/check-export-queries.sh` contra el esquema
  actual, de modo que no puedan quedarse obsoletas en silencio.
- Desde Supabase: `Table Editor → Export as CSV` por tabla, que da UUID en vez de nombres y casi
  nunca es lo que se quiere.

## 7. Qué no está cubierto

- **Recuperación a un punto en el tiempo** (PITR): es función de pago. Entre dos volcados
  trimestrales puede perderse hasta un trimestre de seguimiento.
- Si Supabase sufriera una pérdida de datos irrecuperable, el límite del daño es la antigüedad de
  la última copia manual. Esa es la razón del calendario de §3.
- Si un administrador borra un trabajo por error: el borrado es **lógico** (`deleted_at`) en
  `academic_works` y `documents`, así que es reversible por SQL. Las tareas, reuniones y
  comentarios de un trabajo borrado en firme se van en cascada y solo se recuperan del volcado.
