# SECURITY.md — Roles, permisos y protección de datos

## 1. Modelo de amenaza

El frontend es **código público** servido desde un repositorio **público** (requisito de GitHub
Pages gratuito, ver `docs/FASE_0.md` D1). Cualquiera puede leer el JavaScript, obtener la clave
`anon` y lanzar peticiones arbitrarias a la API REST de Supabase.

Por tanto:

> **RLS es la única frontera de seguridad real.** Toda política de acceso debe ser cierta en
> PostgreSQL con la clave `anon` en manos de un atacante.

Lo que el frontend aporta es usabilidad: no mostrar lo que no se puede usar. Nunca protección.

## 2. Los dos ejes de permisos

### 2.1. Permisos administrativos — `organization_members.role`

| Rol | Puede |
|---|---|
`OWNER` | Todo lo de `ADMIN`, más gestionar administradores y ajustes críticos |
`ADMIN` | Gestionar usuarios, invitar, gestionar grupos y **catálogos** (incluidos los tipos de trabajo), crear y configurar trabajos, asignar participantes, ver todos los trabajos de la organización, estadísticas globales, plantillas |
`MEMBER` | Pertenecer a la organización; acceso solo a los trabajos donde tenga relación académica |

El rol administrativo **no concede** funciones académicas. Un `ADMIN` ve los trabajos para
gestionarlos, pero no es director de nada salvo que exista su fila en `work_members`.

Excepción documentada: un `ADMIN` **sí** puede leer `meeting_private_notes`, por responsabilidad de
gestión del grupo. Queda registrado en `activity_logs`. Si prefieres lo contrario, es un cambio de
una sola política.

### 2.2. Permisos académicos — `work_members`, por trabajo

| Rol (`work_roles.code`) | `is_student` | `is_supervisory` | plan | notas privadas | validar | miembros |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
`PRIMARY_SUPERVISOR` | no | **sí** | sí | sí | sí | sí |
`CO_SUPERVISOR` | no | **sí** | sí | sí | sí | no |
`COLLABORATOR` | no | **sí** | no | no | no | no |
`STUDENT` | **sí** | no | no | **no** | no | no |

El estudiante puede: consultar su trabajo, ver tareas y fechas, **actualizar el estado de sus
propias tareas**, subir o enlazar documentos y versiones, leer y responder comentarios, ver
reuniones y acuerdos compartidos, y ver su progreso. No puede crear ni reasignar tareas, cambiar
fechas límite, modificar el estado del trabajo, ni ver nada de otro trabajo.

## 3. Roles no excluyentes: el caso que valida el diseño

Una sola cuenta, una sola fila en `profiles`, varias filas en `work_members`:

```
profiles: "Investigador X"
├─ work_members(TFG-01, PRIMARY_SUPERVISOR)   → gestiona plan, ve notas privadas de TFG-01
├─ work_members(TFM-03, CO_SUPERVISOR)        → supervisa TFM-03
└─ work_members(TESIS-02, STUDENT)            → es el DOCTORANDO de su propia tesis
                                                 NO ve las notas privadas de TESIS-02
```

Ninguna de las tres relaciones filtra permisos hacia las otras. Es el escenario 5 del prompt y la
prueba de aceptación obligatoria.

## 4. Resolución de conflictos (definida para evitar ambigüedad)

1. Las capacidades son la **unión** de las filas activas de `work_members` del usuario en ese
   trabajo. Tener más funciones nunca resta.
2. `work_members.permissions` (`jsonb`) puede conceder o denegar una capacidad concreta y tiene
   precedencia sobre los *flags* del rol.
3. **Regla de protección del estudiante**: si el usuario tiene alguna función activa con
   `is_student = true` en ese trabajo, `can_see_private_notes` se fuerza a falso para ese trabajo,
   sea cual sea el resto. Evita que alguien lea las notas de supervisión *sobre sí mismo*.
4. Un rol administrativo nunca se deduce de una relación académica, ni al contrario.
5. `status = 'INACTIVE'` o `end_date` pasada ⇒ la fila no concede nada (conserva el histórico).

## 5. Políticas RLS previstas (entregable 9)

### 5.1. Funciones auxiliares `SECURITY DEFINER`

Son necesarias por dos razones, no por comodidad:

1. **Recursión**: una política sobre `work_members` que consulte `work_members` provoca
   recursión infinita. Una función `SECURITY DEFINER` rompe el ciclo.
2. **Rendimiento**: marcadas `STABLE`, el planificador las evalúa una vez por consulta en lugar de
   una vez por fila.

```sql
app.uid()                         -- (select auth.uid()), envuelto para que sea InitPlan
app.is_org_admin(org uuid)        -- OWNER o ADMIN en organization_members
app.is_work_member(work uuid)     -- cualquier relación activa
app.is_work_supervisor(work uuid) -- relación activa con work_roles.is_supervisory
app.can_manage_plan(work uuid)
app.can_see_private_notes(work uuid)  -- incluye la regla 3 de §4
app.accessible_work_ids()         -- SETOF uuid: trabajos propios + todos si es ADMIN
```

Se definen en el esquema `app`, con `search_path` fijado explícitamente
(`SET search_path = public, pg_temp`) para que no puedan ser secuestradas.

### 5.2. Patrón de política

| Tabla | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
`academic_works` | `id IN (SELECT app.accessible_work_ids())` | `app.is_org_admin(organization_id)` o `app.is_work_supervisor(id)` (UPDATE) |
`work_members` | `app.is_work_member(work_id)` o admin | solo admin o `can_manage_members` |
`tasks` | `work_id IN (SELECT app.accessible_work_ids())` | INSERT/DELETE: `app.can_manage_plan(work_id)`. UPDATE: `can_manage_plan` **o** (`assignee_id = app.uid()` y solo cambia `status`) |
`meetings`, `meeting_participants`, `meeting_agreements` | miembro del trabajo | solo supervisores |
**`meeting_private_notes`** | **`app.can_see_private_notes(work_id)`** | solo supervisores con ese *flag* |
`documents`, `document_versions` | miembro del trabajo | miembro; `review_status` solo supervisores |
`comments` | miembro del trabajo | INSERT: miembro; UPDATE/DELETE: solo autor |
`notifications` | `user_id = app.uid()` | UPDATE solo del propio `read_at` |
`profiles` | miembros de la misma organización | UPDATE: solo el propio perfil (o admin) |
Catálogos (`work_types`…) | cualquier autenticado de la organización | **solo `ADMIN`/`OWNER`** |
`keepalive` | **`anon` y `authenticated`: `USING (true)`** | nadie |

La restricción del UPDATE de tareas por parte del estudiante (solo `status`) se implementa con un
*trigger* `BEFORE UPDATE` que rechaza cambios en otras columnas cuando el usuario no tiene
`can_manage_plan`: RLS decide *si* se puede actualizar la fila, pero no *qué columnas*.

### 5.2.bis. Privilegios de tabla del rol `anon`: una capa por debajo de RLS

RLS decide **qué filas** ve un rol; los privilegios de tabla de PostgreSQL deciden si ese rol
puede **tocar la tabla en absoluto**. Son dos capas, y aquí se usan las dos.

Supabase define privilegios por defecto (`ALTER DEFAULT PRIVILEGES`) que conceden a `anon`
permisos sobre cada tabla nueva del esquema `public`. Por eso un `revoke all ... from anon` solo
protege las tablas que existían cuando se ejecutó: las posteriores vuelven a heredarlos.

Ocurrió realmente en este proyecto: `keepalive` (migración 0004) e `invitations` (0005) se crearon
después del `revoke` de 0003 y heredaron privilegios de escritura. **No hubo fuga de datos** —RLS
devolvía 0 filas y rechazaba las escrituras, comprobado contra el proyecto real con la clave
pública— pero la seguridad quedaba dependiendo de una sola capa, y en una tabla con correos de
personas que aún no son usuarias eso no es aceptable.

La migración `0006_harden_anon_grants.sql` lo corrige y, sobre todo, lo hace irrepetible:

1. Revoca los privilegios de `anon` sobre **todas** las tablas, sin excepciones.
2. Concede luego, de forma mínima y explícita, lo único que `anon` necesita: `SELECT` sobre
   `keepalive` y `EXECUTE` sobre `keepalive_ping()`.
3. Cambia los **privilegios por defecto** del esquema para que ninguna tabla futura los herede.
4. Termina con dos comprobaciones que **hacen fallar la migración** si queda algún privilegio
   indebido o alguna tabla sin RLS. Al aplicarse en el conjunto de pruebas, cualquier migración
   futura que reintroduzca el problema lo detecta sola.

Estado garantizado desde entonces: el rol `anon` solo puede hacer `SELECT` sobre `keepalive`.

### 5.3. Reglas transversales

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **y** `FORCE ROW LEVEL SECURITY` donde aplique, en
  todas las tablas sin excepción. Una tabla sin RLS en Supabase es una tabla pública.
- Sin políticas `USING (true)` salvo `keepalive`.
- `REVOKE ALL ON SCHEMA public FROM anon` excepto lo estrictamente necesario.
- Las vistas usadas por el dashboard se crean con `security_invoker = true` para que hereden RLS.
- Los permisos nunca se heredan entre trabajos: todas las políticas se anclan en `work_id`.

### 5.2.ter · El EXECUTE que faltaba en `app.has_work_capability`

Encontrado en producción el 6 de noviembre de 2026, con la aplicación ya en
funcionamiento. La migración `0003` terminaba con una línea suelta:

```sql
revoke all on function app.has_work_capability(uuid, text) from public;
```

que quitaba el permiso de ejecución al pseudo-rol `public` **sin concedérselo a
`authenticated`**. La política `wm_write` de `work_members` invoca esa función
directamente, y como el resumen y la ficha de trabajo embeben `work_members`,
ambas pantallas abortaban con `permission denied for function
has_work_capability`. No era un problema de datos ni de RLS: la consulta entera
fallaba antes de evaluar nada.

Lo corrige `0007_grant_app_functions.sql`, que no se limita a deshacer aquel
`revoke`: adopta la postura contraria y la aplica a todas las funciones del
esquema `app`. Revoca `public` y `anon` en todas, concede `execute` a
`authenticated` una por una, y fija los `alter default privileges` para que las
futuras nazcan igual. Esto cerró además un segundo hueco que nadie había
mirado: antes de la 0007, **`anon` podía ejecutar 14 funciones del esquema
`app`**, entre ellas `app.can_see_private_notes` y `app.accessible_work_ids`.
No era explotable, porque PostgREST solo expone el esquema `public` y estas
viven en `app`, pero era una protección que dependía de una configuración
ajena en lugar de un privilegio nuestro.

#### Por qué 31 pruebas no lo vieron

Esta es la parte incómoda, y la que más ha cambiado:

1. **Los ficheros de prueba concedían el permiso que debían verificar.**
   `10_roles_and_privacy.sql` y `40_invitations.sql` hacían
   `grant execute on all functions in schema app to authenticated`. Retirado.

2. **El arnés no emulaba los privilegios por defecto de Supabase.** Supabase
   fija `alter default privileges` sobre `public` para `anon` y `authenticated`;
   sin eso, `authenticated` corría sin privilegios de tabla y las pruebas eran
   ciegas a cualquier `revoke` mal puesto. Añadido a `00_harness.sql`.

3. **Ninguna prueba leía ni escribía `work_members` como `authenticated`.** Las
   llamadas a `has_work_capability` desde dentro de otra función `SECURITY
   DEFINER` se ejecutan con los privilegios de su propietario y por tanto no
   fallan: el error solo aparece cuando una política la invoca directamente.

4. **El runner devolvía 0 aunque hubiera errores.** `psql` no aborta sin
   `ON_ERROR_STOP`, así que una tanda con tres `permission denied` seguía dando
   el visto bueno. Ahora analiza la salida, cuenta los fallos y sale con 1.

La prueba `[32]` de `50_policy_function_privileges.sql` es la que impide que
vuelva a pasar, y no por el caso concreto: lee las políticas reales de
`pg_policy`, extrae cada función de `app` que invocan y exige que
`authenticated` pueda ejecutarla. Cubre así las políticas de las fases
siguientes sin tener que acordarse de nada. `document_versions` ya depende de
ella. Verificado apartando la 0007: la suite pasa de 36 correctas a señalar
5 fallos y salir con código 1.

### 5.2.quater · Archivar un trabajo: dos fallos que solo aparecieron al probarlo

Al implementar el botón de archivar (pedido por el usuario el 6 de noviembre de
2026, al no encontrar cómo borrar un trabajo de pruebas) salieron dos problemas
que la lectura del código no revelaba.

**Uno, las dos vías de borrado no coincidían.** `works_delete` (borrado físico)
estaba reservada a la administración, pero el archivado se implementa como
`update academic_works set deleted_at = now()`, y `works_update` permite
actualizar también a los directores del trabajo. Es decir: un director podía
hacer desaparecer un trabajo de todos los listados. Lo corrige el disparador
`app.enforce_soft_delete_scope()` de la migración `0008`, que exige ser
administrador para tocar esa columna y no toca nada más: la prueba `[38]`
comprueba que el director conserva la edición del trabajo.

Se usa un disparador y no una política porque **una política no puede
distinguir qué columna ha cambiado**: restringir `works_update` habría quitado
a los directores la edición legítima. Es el mismo patrón que
`app.enforce_task_update_scope()`, que limita al estudiante a la columna
`status` de sus tareas.

**Dos, archivar era imposible, y además habría sido irreversible.** La política
de `SELECT` llevaba `deleted_at is null`, y PostgreSQL exige que la fila
resultante de un `UPDATE` siga siendo visible para quien lo ejecuta.
Comprobado en PostgreSQL 16.15: el `update` fallaba con *new row violates
row-level security policy*, y bastaba quitar `deleted_at is null` de la
política de `SELECT` para que pasara.

Lo segundo es lo grave: si se hubiera conseguido archivar, el trabajo habría
quedado invisible para **todo el mundo**, también para la administración, y por
tanto irrecuperable desde la aplicación. Un archivado del que no se puede
volver no es un archivado, es un borrado con otro nombre. La política pasa a
dejar ver lo archivado a la administración y solo a ella (prueba `[41]`: ni los
propios directores del trabajo lo ven), y hay una pantalla
`/admin/archivados` para restaurar.

### 5.2.quinquies · La casilla que no hacía nada

Las listas de comprobación se implementaron como subtareas reales
(`tasks.parent_task_id`) y no como un campo de texto o un `jsonb`, para que
heredaran la seguridad de `tasks` sin añadir ni una política. La herencia
funcionó, pero con un efecto que no estaba previsto: `tasks_update` exige
`assignee_id = app.uid()`, y **los puntos de una lista no llevan
responsable** — el responsable es el de la tarea que los contiene.

El estudiante veía su lista, pulsaba una casilla y la sentencia no afectaba a
ninguna fila. **Sin error de permisos y sin mensaje**: RLS no lanza excepción
cuando simplemente no hay filas que tocar. Una casilla que parecía funcionar
sin hacer nada es peor que un botón deshabilitado, porque el estudiante creería
haber informado de su avance. Lo detectó la prueba `[43]` antes de llegar a la
aplicación.

Lo corrige la migración `0009` con `app.is_parent_task_assignee()`. No se
resuelve copiando el responsable al crear el punto, que sería más simple:
quedaría desincronizado en cuanto se reasignara la tarea, y volvería el mismo
fallo silencioso. La pertenencia de un punto es la de su tarea, así que la
política mira ahí y no un dato duplicado.

El reparto resultante queda fijado por las pruebas `[43]`–`[45]`: la dirección
**define** los puntos (INSERT y DELETE sobre `tasks`), y quien tiene la tarea
solo **informa** de su avance (UPDATE de `status`, lo único que le permite el
disparador `app.enforce_task_update_scope`). Si alguna vez se relajara la
política de `tasks`, esas tres pruebas fallarían.

#### Nota sobre cómo se escriben estas pruebas

La primera versión de `[45]` daba por bueno que no saltara una excepción. Era
un falso positivo: la sentencia no afectaba a ninguna fila y por eso no había
error. Una prueba de RLS **no puede conformarse con la ausencia de excepción**;
tiene que comprobar el estado resultante. Es el mismo descuido, en pequeño, que
hacía que el runner devolviera 0 con tres `permission denied` en la salida.

### 5.2.sexies · Ficheros: una frontera distinta de la de las filas

`storage.objects` tiene **su propia RLS**, independiente de las tablas. Una fila
de `document_versions` perfectamente protegida que apunte a un objeto mal
protegido no protege nada: el fichero se descarga igual. Y lo que hay dentro de
esos ficheros son memorias y borradores con datos de alumnos, así que es la
parte del sistema donde un error se paga más caro.

La llave de autorización es **el primer segmento de la ruta**:
`<work_id>/<document_id>/<fichero>`. De ahí se deduce a qué trabajo pertenece el
objeto, y con eso se reutiliza `app.accessible_work_ids()` sin duplicar ninguna
regla. Si la ruta no empieza por un uuid válido, se deniega: una ruta así no la
ha generado la aplicación. Cambiar esa convención en el código sin cambiar las
políticas abriría el cubo, y por eso está advertido en `documentsRepo.upload`.

El cubo es **privado**. No hay URL pública: las descargas usan URL firmadas de
120 segundos que Storage solo emite si estas políticas dejan leer el objeto.

Para poder probarlo, `00_harness.sql` emula `storage.buckets` y
`storage.objects` con los privilegios que Supabase concede de serie —`anon`
incluido, que los necesita para los cubos públicos— de modo que la prueba `[49]`
(«`anon` no ve ningún fichero») sea una prueba de verdad y no un artefacto del
emulador. Pruebas `[47]`–`[53]`.

### 5.2.septies · La regla del borrado lógico, aprendida tres veces

PostgreSQL exige que la fila resultante de un `UPDATE` siga siendo visible para
quien lo ejecuta. Combinado con el patrón «política de `SELECT` que filtra por
`deleted_at`», eso produce un fallo que no se ve leyendo el código:

| Dónde | Síntoma |
|---|---|
| `academic_works` (§5.2.quater) | Archivar un trabajo fallaba siempre |
| `documents` | Archivar un documento fallaba siempre |
| `documents`, segunda vuelta (prueba `[57]`) | El autor no podía retirar el suyo |

**La regla, para no volver a tropezar:** *toda política de `SELECT` que filtre
por `deleted_at` debe dejar ver lo archivado a **todos** los que puedan
archivarlo.* Si no, el borrado lógico falla; y si por algún camino llegara a
ejecutarse, lo archivado sería irrecuperable desde la aplicación, que es peor
que el propio fallo. Está escrita como comentario en la migración `0010`, junto
a la política que la cumple.

### 5.2.octies · Borrado definitivo, y los ficheros que no se van con él

La política `works_delete` reservaba el borrado físico a la administración desde
la migración `0003`, pero **ninguna pantalla la usaba y ninguna prueba la
cubría**. Al añadir la opción (Administración → Trabajos archivados, a petición
del usuario el 6 de noviembre de 2026) llegaron las pruebas `[61]`–`[63]`, y con
ellas un detalle que no era evidente.

El borrado arrastra en cascada todo lo del trabajo: participantes, fases, hitos,
tareas, reuniones con sus actas y notas privadas, documentos con sus versiones,
comentarios, notificaciones y el registro de actividad. **Los ficheros del cubo,
no.** `storage.objects` no tiene clave ajena hacia `academic_works`, así que
sobreviven al borrado de la fila (prueba `[63]`).

Y no sobreviven de forma inocua: una vez borrado el trabajo, su uuid ya no está
en `app.accessible_work_ids()`, de modo que **las políticas del cubo dejan de
autorizar a cualquiera**, también a la administración. Los ficheros quedarían
ocupando sitio del gigabyte gratuito sin que nadie pueda verlos ni borrarlos
desde la aplicación. Por eso `worksRepo.destroy()` los borra **antes** de la
fila, y aborta sin borrar el trabajo si esa limpieza falla: es preferible un
trabajo que sigue ahí a unos ficheros inalcanzables.

La interfaz exige **escribir el título** del trabajo para confirmar. No es
ceremonia: el plan gratuito no tiene copias de seguridad automáticas
(`BACKUP.md`), así que un clic en la fila equivocada borraría el trabajo de un
alumno sin vuelta atrás. El flujo es de dos pasos a propósito —archivar y
después borrar— para que ningún borrado definitivo esté a un solo clic desde un
listado.

### 5.2.nonies · Notificaciones: por qué las escribe la base de datos y no el cliente

Al llegar la Fase 2, `notifications` tenía políticas de `SELECT`, `UPDATE` y
nada más. No era un descuido a medias: faltaba la de `INSERT`, así que **no
había manera de crear una notificación**. La solución evidente —añadir una
política de `INSERT` para `authenticated`— es la equivocada, y conviene dejar
escrito por qué.

Una política de `INSERT` en una tabla cuya clave es `user_id` solo puede decir
una de dos cosas. O exige `user_id = app.uid()`, y entonces cada cual solo
puede escribir en su propio buzón, que es inútil (la notificación nace de un
acto ajeno: alguien te asigna una tarea). O permite escribir con otro
`user_id`, y entonces **cualquier usuario puede meter avisos en el buzón de
cualquier otro**. Un aviso inventado en el buzón de un miembro del tribunal, con
el aspecto de venir del sistema, no es una molestia: es una suplantación. No hay
tercera redacción, porque el cliente no puede demostrar que el hecho notificado
ha ocurrido.

Quien sí puede demostrarlo es la propia transacción que lo produce. De ahí la
migración `0011`: cuatro disparadores `after insert` sobre `tasks`, `comments`,
`document_versions` y `meetings`, que llaman a `app.notify(...)` —`SECURITY
DEFINER`, sin `EXECUTE` para nadie— y escriben el aviso al lado del hecho, en el
mismo `COMMIT`. Si el hecho se deshace, el aviso también. La tabla sigue sin
política de `INSERT`, y la prueba `[68]` lo verifica intentando escribir en un
buzón ajeno; la condición *estructural* de que no exista tal política se
comprueba en el bloque de aserciones de la propia migración.

Tres detalles del diseño que no son adorno:

- **`app.notify` sale sin hacer nada si el destinatario es `auth.uid()`.** Nadie
  necesita que le avisen de lo que acaba de hacer, y un buzón lleno de ecos
  propios es un buzón que se deja de mirar (pruebas `[64]` y `[67]`).
- **Las menciones se comprueban contra `work_members` antes de avisar.** Un
  comentario puede mencionar un uuid cualquiera; el disparador solo notifica a
  quien es miembro activo del trabajo. Mencionar a un ajeno no le abre ninguna
  puerta ni le llega nada (prueba `[65]`). En el cliente, además, las menciones
  **se eligen de una lista**, no se escriben: `comments.mentions` guarda
  identificadores, no texto. Buscar «@Nombre» dentro del contenido falla en
  silencio con dos personas del mismo nombre, con un nombre con espacios y con
  cualquier errata, y el autor creería haber avisado a alguien que nunca recibió
  nada.
- **No hay disparador sobre `meeting_private_notes`, y es deliberado.** Avisar
  de que existe una nota privada revela justo lo que la nota privada existe para
  no revelar. La prueba `[70]` comprueba que escribir una nota de dirección
  genera **cero** notificaciones; es una de las pocas pruebas del proyecto cuya
  condición de éxito es que no ocurra nada.

Las notificaciones tampoco se consultan por *Realtime*. El recuento de no
leídas se pide una vez por minuto con una petición `head` que no devuelve filas.
Una suscripción por websocket y pestaña sería el primer límite del plan gratuito
en tocarse (`FREE_TIER.md`), a cambio de ganar segundos en un aviso que no es
urgente.

### 5.2.decies · El `alter default privileges` que no protegía nada

La migración `0007` termina así:

    alter default privileges in schema app revoke all on functions from public;
    alter default privileges in schema app revoke all on functions from anon;

Se lee como «y las funciones que se creen a partir de ahora, también quedan
cerradas». **No hace eso.** Comprobado contra PostgreSQL 16 en un contenedor
limpio: tras ejecutar esa sentencia, `pg_default_acl` no tiene ni una fila para
el esquema `app`, y una función creada después sigue siendo ejecutable por
`anon`, que es miembro de `PUBLIC`. La sentencia no da error ni aviso; no hace
nada.

Las tres funciones de disparador de la migración `0012`
(`assert_no_dependency_cycle`, `enforce_dependency_same_work`,
`set_milestone_met_at`) nacieron por tanto abiertas a `anon`.

**Lo encontró la prueba `[33]`**, que recorre `pg_proc` y exige que `anon` no
pueda ejecutar ninguna función del esquema. Es el segundo agujero de privilegios
que encuentra una prueba estructural y que la lectura del SQL no veía; el
primero fue §5.2.ter. El patrón se repite: los permisos son un estado
acumulado, no una línea de código, así que la única forma fiable de comprobarlos
es preguntarle a la base de datos cómo ha quedado, no leer lo que se le pidió.

La regla para las migraciones siguientes, escrita también en la cabecera de la
`0012`:

> Toda migración que cree funciones en `app` termina con
> `revoke all on all functions in schema app from public;` (y de `anon`), y
> concede después, una por una, solo las que hagan falta.

El `revoke` en bloque es inmediato y no toca lo concedido a `authenticated`, así
que no deshace nada de la `0007`. La `0012` añade además una aserción propia que
recorre el esquema entero y falla si quedara alguna función abierta: si la
próxima migración olvida el `revoke`, salta al aplicarla y no a las semanas.

### 5.2.undecies · `apply_template`: una comodidad que no podía ser un atajo

Aplicar una plantilla crea N tareas. Hacerlo con N inserciones desde el
navegador deja medio plan creado si la quinta falla, y obliga al cliente a
resolver la jerarquía interna de la plantilla descubriendo identificadores a
mitad de la secuencia (`template_tasks.parent_index` apunta al `order_index` del
padre **dentro de la plantilla**, no a un uuid que todavía no existe). De ahí
`app.apply_template(...)`: una llamada, una transacción, o el plan entero o
nada (prueba `[87]`).

Lo que importa aquí es lo que esa función **no** lleva: `security definer`. Es
la tentación obvia —«que la función se encargue»— y habría convertido una
comodidad en un agujero: cualquiera habría podido llenar de tareas el trabajo de
cualquiera. Sin `definer`, la función se ejecuta con los privilegios de quien
llama y las políticas de `tasks` siguen decidiendo; un estudiante que la invoque
sobre su propio trabajo es rechazado exactamente igual que si insertara a mano
(prueba `[85]`). Que no sea `definer` se comprueba en la aserción de la propia
migración, para que nadie se lo añada «para que funcione» sin que salte nada.

Hay una segunda función, `public.apply_template`, que solo reenvía a la
anterior. Existe porque PostgREST expone únicamente los esquemas configurados
—en Supabase, `public`, `graphql_public` y `storage`—, de modo que `app` no es
invocable desde el navegador, y eso es deliberado: ahí viven los ayudantes de
las políticas. La envoltura tampoco es `definer`, y la prueba `[89]` comprueba
las dos cosas que importan: que funciona y que el estudiante sigue sin poder
usarla. Todo lo que vive en `public` lo ve PostgREST, y por tanto también el rol
`anon`; de ahí que la migración revoque explícitamente y conceda solo a
`authenticated` (prueba `[88]`).

### 5.2.duodecies · Los ciclos «se validan en aplicación»

La migración `0002` creó `task_dependencies` con este comentario:

    check (task_id <> depends_on_task_id)   -- los ciclos se validan en aplicación

Impide que A dependa de A, y nada más. A→B→A pasaba sin problema. Y un ciclo en
este grafo no es un dato feo: es un dato que **cuelga a quien lo lea**. El
recorrido para ordenar el cronograma, para calcular qué tarea está esperando a
otra o para propagar una fecha entra en bucle infinito. Validarlo «en
aplicación» no vale, por la razón de siempre en este proyecto: la aplicación no
es el único cliente, y dos peticiones REST seguidas —o dos personas
planificando a la vez— crean el ciclo igual.

La `0012` lo valida con un CTE recursivo en un disparador, usando la cláusula
`CYCLE` del estándar, que deja de expandir un nodo en cuanto se repite. Esa
cláusula no es un adorno: sin ella, la comprobación de si existe un ciclo se
colgaría justo en el caso en que ya hubiera uno.

El mismo repaso descubrió un segundo hueco en la política: `taskdeps_write`
comprobaba el permiso sobre el trabajo de `task_id` y no miraba
`depends_on_task_id`, así que con dirigir un trabajo bastaba para colgar una
dependencia de una tarea de **otro** trabajo, posiblemente invisible para quien
la creaba. El cronograma mostraría un vínculo hacia una fila que RLS no deja
ver, y el estado «esperando» de una tarea dependería de algo que su equipo no
puede resolver. Se cierra por los dos lados, y son dos cosas distintas: la
política dice **quién** puede escribir (ahora exige permiso en ambos extremos) y
un disparador dice **qué es un dato válido** (los dos extremos, el mismo
trabajo). Por eso la administración, que pasa la política para dos trabajos
suyos, sigue sin poder cruzarlos (prueba `[79]`).

## 6. Autenticación y alta de usuarios

- Supabase Auth, correo + contraseña, con `flowType: 'pkce'`.
- **Registro público deshabilitado.** El alta es siempre por invitación de un `ADMIN`.
- Un *trigger* `AFTER INSERT ON auth.users` crea la fila de `profiles`, pero **no** crea
  `organization_members`: sin esa fila, el usuario entra y no ve nada. La pertenencia es un acto
  administrativo explícito.
- Flujo de invitación: el `ADMIN` registra la invitación en la aplicación (tabla `invitations`) →
  la envía desde el panel de Supabase → la persona fija su contraseña → al crearse su perfil, el
  trigger `app.accept_invitation()` cierra la invitación y **la da de alta en la organización con
  la función prevista** → el `ADMIN` le asigna después sus relaciones académicas por trabajo.
- Quien se autentique **sin** invitación previa obtiene una cuenta sin organización: entra y no ve
  nada. Comprobado en la prueba 30 de `supabase/tests/`.
- **Correo: se usa el servicio integrado de Supabase** (decisión tomada, `FREE_TIER.md` §4). Son
  2–4 envíos por hora, compartidos entre invitación, recuperación de contraseña y enlace mágico.
  Implicaciones para la Fase 1:
  - La pantalla de invitaciones debe ser **una cola, no un formulario de envío masivo**: el
    administrador añade los 30 destinatarios, y la aplicación muestra enviadas / pendientes /
    fallidas, con reintento manual. Sin esto, el administrador creerá que ha invitado a 30 personas
    cuando solo han salido 3 correos.
  - El administrador necesita una vía alternativa: fijar contraseña temporal desde el panel de
    Supabase cuando un usuario no reciba el correo.
  - Migrar a SMTP institucional más adelante no requiere ningún cambio de código.
- Redirecciones a configurar en Supabase Auth (*Site URL* y *Redirect URLs*):
  `https://jgompil.github.io/ThesisManager/`, `https://jgompil.github.io/ThesisManager/*`
  y `http://localhost:5173/*` para desarrollo.

## 7. Gestión de secretos

| Secreto | Dónde vive | Dónde NO vive |
|---|---|---|
`VITE_SUPABASE_URL` | GitHub Variables + `.env.local` | — (no es secreto) |
`VITE_SUPABASE_ANON_KEY` | GitHub Secrets + `.env.local` | Es pública por diseño; aparece en el *bundle* |
`service_role` key | **En ningún sitio del proyecto** | Repositorio, frontend, workflows, Actions |
SMTP institucional | Panel de Supabase | Repositorio |
Clave de IA (Fase 6) | *Secrets* de Supabase Edge Functions | Repositorio, frontend |

`.env.local` está en `.gitignore`. El workflow de despliegue ejecuta
`./scripts/check-no-secrets.sh dist` y **aborta el despliegue** si encuentra una credencial
privilegiada. La comprobación **decodifica** los JWT presentes en `dist/` y rechaza cualquiera con
rol `service_role`, `supabase_admin` o `postgres`, además de buscar claves `sb_secret_<valor>` y
referencias a `SUPABASE_SERVICE_ROLE`.

Dos detalles que un simple `grep` no resuelve, y que están documentados en el propio script:

- La librería `@supabase/supabase-js` contiene las cadenas `"sb_secret_"` y `"sb_publishable_"` en
  su código de detección de formato de clave: buscar el prefijo suelto da **falso positivo** y
  bloquearía todos los despliegues.
- El rol de un JWT no es legible sin decodificar el payload: buscar el base64 de
  `"role":"service_role"` da **falso negativo**, porque la codificación depende del
  desplazamiento del fragmento dentro del payload.

## 8. RGPD y datos personales

- **Minimización**: nombre, apellidos, correo institucional, departamento y grupo. Nada más.
  Sin DNI, sin teléfono, sin dirección, sin fecha de nacimiento, sin expediente académico oficial.
- **Prohibido** cualquier dato clínico o identificativo de pacientes, incluso en descripciones de
  trabajos, objetivos o actas. Advertencia visible en los formularios de texto libre.
- Datos alojados en la infraestructura de Supabase: **elegir región UE** al crear el proyecto
  (Fráncfort o Irlanda) para no transferir datos fuera del EEE.
- Base jurídica: interés legítimo en la gestión académica del grupo. Conviene informar a los
  estudiantes de que sus datos de seguimiento se gestionan en esta plataforma.
- Derechos: `profiles` permite rectificación; la supresión se resuelve anonimizando `profiles`
  (nombre y correo) y conservando las relaciones académicas, que son registro académico legítimo.
- **El repositorio público no contendrá jamás datos reales**: ni *seeds*, ni volcados, ni capturas,
  ni artefactos de Actions (en un repositorio público los artefactos son descargables por cualquiera).
- `activity_logs` registra actor, acción y entidad para trazabilidad; se purga a los 24 meses.

## 9. Pruebas de seguridad obligatorias antes de cerrar la Fase 1

Cada una debe ejecutarse **contra la base de datos** con el JWT del usuario correspondiente, no
desde la interfaz.

> **Ya verificadas.** Las migraciones de `supabase/migrations/` se han aplicado a un
> PostgreSQL 16 real y se ejecutan **95 pruebas** de seguridad, todas correctas:
> `./scripts/test-rls.sh` (detalle en `supabase/tests/README.md`). Cubren los puntos 1–6, 12 y 13
> de la lista siguiente. Los puntos 7, 10 y 11 dependen del frontend y del despliegue, y los 8 y 9
> del proyecto real de Supabase; se validan en la Fase 1.
>
> Esa suite encontró y corrigió **dos** fallos reales. El primero, la política de `SELECT` de `academic_works`
> rechazaba el `INSERT ... RETURNING` de un administrador, porque `app.accessible_work_ids()` es
> `STABLE` y no ve la fila recién insertada. Dado que `supabase-js` usa `RETURNING` por defecto en
> `.insert().select()`, el fallo habría aparecido en el primer formulario de creación de trabajos
> de la Fase 1.
>
> El segundo apareció ya en producción y la suite **no** lo detectó: el `EXECUTE` que faltaba en
> `app.has_work_capability` (§5.2.ter). Las cuatro razones por las que se escapó, y lo que se ha
> cambiado para que no vuelva a pasar, están documentadas allí. El recuento subió de 31 a 95
> pruebas y el runner ahora falla de verdad cuando algo va mal, que antes no lo hacía.


1. Un usuario es estudiante de un trabajo y supervisor de otro: ambas cosas funcionan.
2. Un supervisor ve N trabajos y exactamente N.
3. Un estudiante que consulta `academic_works` sin filtros recibe **solo** su trabajo.
4. Un codirector que pide por `id` un trabajo ajeno recibe 0 filas (no un 403: 0 filas).
5. Un estudiante que consulta `meeting_private_notes` de su propio trabajo recibe 0 filas.
6. Cambiar un rol en el trabajo A no altera ningún permiso en el trabajo B.
7. La sesión sobrevive a cerrar y volver a abrir el navegador.
8. Los datos persisten tras reiniciar / reactivar el proyecto de Supabase.
9. El workflow de mantenimiento consulta `keepalive` correctamente.
10. El frontend se despliega y carga en GitHub Pages con rutas profundas.
11. `grep -rE '(service_role|sb_secret_|SUPABASE_SERVICE)' dist/` no devuelve nada.
12. Con solo la clave `anon` y sin sesión, `GET /rest/v1/academic_works` devuelve 0 filas.
13. Un estudiante que intenta `UPDATE` de `due_date` en su propia tarea es rechazado por el *trigger*.
