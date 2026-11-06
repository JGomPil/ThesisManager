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
> PostgreSQL 16 real y se ejecutan **41 pruebas** de seguridad, todas correctas:
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
> cambiado para que no vuelva a pasar, están documentadas allí. El recuento subió de 31 a 41
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
