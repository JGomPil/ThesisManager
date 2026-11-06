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

## 2. Volcado manual (procedimiento recomendado)

Requiere Supabase CLI y la contraseña de la base de datos (panel → *Settings → Database*).

```bash
# Volcado completo: esquema + datos + usuarios de auth
supabase db dump --db-url "postgresql://postgres:<PASS>@db.<REF>.supabase.co:5432/postgres" \
  --file "thesis-manager-$(date +%Y%m%d).sql"

# Solo datos (más pequeño, para restaurar sobre migraciones ya aplicadas)
supabase db dump --data-only --db-url "..." --file "datos-$(date +%Y%m%d).sql"
```

Alternativa con `pg_dump` directo, si se prefiere formato comprimido:

```bash
pg_dump "postgresql://postgres:<PASS>@db.<REF>.supabase.co:5432/postgres" \
  -Fc -f "thesis-manager-$(date +%Y%m%d).dump"
```

**Destino del fichero**: unidad institucional (Drive/OneDrive de la UVa) o disco cifrado.
**Nunca** el repositorio, ni un *issue*, ni un artefacto de Actions, ni un servicio personal.

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

```bash
supabase storage cp -r ss://<bucket> ./storage-backup --experimental
```

Solo si se llegan a usar adjuntos. Por diseño, aquí hay poco que perder.

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

Termina con un recuento de lo restaurado (trabajos, participantes, tareas, documentos…) y **sale
con código distinto de cero** si algo falla, así que vale para un *cron* local. No se conecta a
Supabase y no necesita contraseñas: la copia se monta como solo lectura.

Si avisa de que falta `auth.users`, el volcado necesita además el esquema de autenticación:
`supabase db dump` con `-s auth`, guardado junto al principal.

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
