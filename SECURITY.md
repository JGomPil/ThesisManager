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

### 5.3. Reglas transversales

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **y** `FORCE ROW LEVEL SECURITY` donde aplique, en
  todas las tablas sin excepción. Una tabla sin RLS en Supabase es una tabla pública.
- Sin políticas `USING (true)` salvo `keepalive`.
- `REVOKE ALL ON SCHEMA public FROM anon` excepto lo estrictamente necesario.
- Las vistas usadas por el dashboard se crean con `security_invoker = true` para que hereden RLS.
- Los permisos nunca se heredan entre trabajos: todas las políticas se anclan en `work_id`.

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

> **Ya verificadas en la Fase 0.** Las migraciones de `supabase/migrations/` se han aplicado a un
> PostgreSQL 16 real y se han ejecutado 24 comprobaciones de seguridad, todas correctas:
> `./scripts/test-rls.sh` (detalle en `supabase/tests/README.md`). Cubren los puntos 1–6, 12 y 13
> de la lista siguiente. Los puntos 7, 10 y 11 dependen del frontend y del despliegue, y los 8 y 9
> del proyecto real de Supabase; se validan en la Fase 1.
>
> Esa ejecución encontró y corrigió un fallo real: la política de `SELECT` de `academic_works`
> rechazaba el `INSERT ... RETURNING` de un administrador, porque `app.accessible_work_ids()` es
> `STABLE` y no ve la fila recién insertada. Dado que `supabase-js` usa `RETURNING` por defecto en
> `.insert().select()`, el fallo habría aparecido en el primer formulario de creación de trabajos
> de la Fase 1.


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
