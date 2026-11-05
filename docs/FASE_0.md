# Fase 0 — Análisis y arquitectura

> Estado: **propuesta pendiente de aprobación**. No se ha escrito código de aplicación.
> Fecha: 2026-11-05 · Arquitectura: GitHub Pages + Supabase Free + GitHub Actions (sin sustituciones).

## 0. Resultado de la inspección previa (pasos 1–2 de la Fase 0)

- El directorio `/Users/javiergomezpilar/ThesisManager` estaba **vacío** y **no era un repositorio Git**.
- No existe código previo que inspeccionar ni que pueda sobrescribirse.
- Esta fase crea **únicamente documentación, SQL propuesto y workflows propuestos**. Ningún fichero de aplicación.
- Pendiente de ti: `git init` + creación del repositorio en GitHub (ver nota sobre visibilidad en §11).

## 1. Cambio de alcance incorporado: el tipo de trabajo es un catálogo, no un enum

Requisito nuevo: además de TFG, TFM y tesis doctoral hay que gestionar **Academia de Alumnos Internos**
y «es posible que haya otros», por lo que debe poder **añadirse como campo nuevo** sin tocar código.

Consecuencia de diseño, aplicada en todo el modelo:

| Enfoque descartado | Enfoque adoptado |
|---|---|
| `work_type AS ENUM ('tfg','tfm','phd')` | Tabla `work_types` administrable desde la UI |
| Estados fijos en código | Tabla `work_statuses` + mapeo opcional por tipo |
| Roles académicos fijos | Tabla `work_roles` con *flags* de capacidad |
| Dashboard con 3 tarjetas fijas (TFG/TFM/Tesis) | Una tarjeta por tipo activo, generada desde `work_types` |
| Plantillas de tareas atadas a TFG/TFM | `templates.work_type_id` → plantilla por tipo |

Un `ENUM` de PostgreSQL obliga a una migración SQL (`ALTER TYPE ... ADD VALUE`, no reversible
dentro de una transacción) y a desplegar código nuevo cada vez que aparezca un tipo de trabajo.
Con un catálogo, un administrador crea «Academia de Alumnos Internos», «Prácticas de empresa» o
«Estancia de investigación» desde la interfaz, en caliente, y el resto del sistema se adapta.

Tipos precargados (*seed*): `TFG`, `TFM`, `TESIS`, `ACADEMIA`.

El coste de esta decisión: más `JOIN`s y la imposibilidad de que la base de datos garantice por sí
sola reglas específicas de un tipo. Se compensa con *flags* declarativos en `work_types`
(`requires_defense`, `requires_deposit`, `allows_multiple_students`, `default_duration_months`…)
en lugar de condicionales `if (tipo === 'TFG')` repartidos por el código.

## 2. Los 13 entregables y dónde están

| # | Entregable | Documento |
|---|---|---|
| 1 | Estructura React + TypeScript + Vite | [`ARCHITECTURE.md`](../ARCHITECTURE.md) §3 |
| 2 | Configuración para GitHub Pages | [`DEPLOYMENT.md`](../DEPLOYMENT.md) §2–§4 |
| 3 | Integración con Supabase Free | [`ARCHITECTURE.md`](../ARCHITECTURE.md) §5 |
| 4 | Modelo de datos inicial | [`DATABASE.md`](../DATABASE.md) |
| 5 | Roles y permisos con funciones múltiples | [`SECURITY.md`](../SECURITY.md) §2–§4 |
| 6 | Workflow de despliegue | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) |
| 7 | Workflow de mantenimiento periódico | [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml) |
| 8 | SQL inicial + tabla `keepalive` | [`supabase/migrations/`](../supabase/migrations/) |
| 9 | Políticas RLS previstas | [`0003_rls_policies.sql`](../supabase/migrations/0003_rls_policies.sql) + `SECURITY.md` §5 |
| 10 | Límites de almacenamiento, usuarios y transferencia | [`FREE_TIER.md`](../FREE_TIER.md) §3 |
| 11 | Limitaciones de los proveedores | [`FREE_TIER.md`](../FREE_TIER.md) §1–§2 |
| 12 | Roadmap de implementación | [`ROADMAP.md`](../ROADMAP.md) |
| 13 | Riesgos y limitaciones | [`FREE_TIER.md`](../FREE_TIER.md) §5 + este documento §4 |
| — | *Extra*: pruebas de seguridad ejecutadas | [`supabase/tests/`](../supabase/tests/README.md) |

## 2.bis. Validación ya realizada (no es solo papel)

El SQL propuesto no es un boceto: se ha aplicado a un **PostgreSQL 16 real** (contenedor
desechable) con `ON_ERROR_STOP`, y sobre él se han ejecutado **24 comprobaciones de seguridad,
todas correctas**. Reproducible con `./scripts/test-rls.sh` (requiere Docker).

Lo más relevante que demuestran:

- El investigador que dirige un TFG **y** es doctorando de su propia tesis ve ambos trabajos, ve
  las notas privadas del TFG que dirige y **no** ve las del trabajo donde figura como estudiante,
  incluso teniendo allí además una función de supervisión.
- Un estudiante solo ve su trabajo, ninguna nota privada, no puede crear tareas y solo puede
  cambiar el **estado** de las suyas: ni la fecha límite ni el responsable.
- Un administrador crea el tipo «Prácticas de empresa» desde la interfaz y lo usa de inmediato,
  **sin migración ni despliegue**. Un estudiante no puede tocar el catálogo, pero sí leerlo.
- No se puede borrar un tipo de trabajo en uso.
- El rol `anon` lee `keepalive` y **nada más**: ni `academic_works` ni `profiles`.

La ejecución encontró un fallo real en mi primera versión de las políticas: la de `SELECT` de
`academic_works` rechazaba el `INSERT ... RETURNING` de un administrador, porque
`app.accessible_work_ids()` es `STABLE` y no ve la fila recién insertada. Como `supabase-js` usa
`RETURNING` por defecto, habría roto el primer formulario de creación de trabajos de la Fase 1.
Corregido y vuelto a validar.

## 3. Decisiones técnicas (las cuatro, aprobadas el 5 de noviembre de 2026)

Son las cuatro en las que el prompt no podía anticipar lo que he encontrado al verificar
las condiciones actuales de los proveedores.

### D1. El repositorio debe ser público (o Pages cuesta dinero) ✅

GitHub Pages solo está disponible **en repositorios privados con GitHub Pro / Team / Enterprise**.
Con GitHub Free, Pages exige **repositorio público**. Como el objetivo es 0 € recurrentes,
la recomendación es **repositorio público**, con estas consecuencias:

- El código es público. No hay problema: la clave `anon` de Supabase está diseñada para ser pública.
- **Ningún dato personal ni académico puede entrar en el repositorio**, en ningún momento, ni en
  *seeds*, ni en capturas, ni en *issues*, ni en artefactos de Actions (en un repo público los
  artefactos son descargables por cualquiera). Esto condiciona la estrategia de copias (`BACKUP.md`).
- La seguridad recae **íntegramente en RLS**, no en la opacidad del código.

Alternativa si prefieres repositorio privado: GitHub Pro (~4 $/mes). Rompe el objetivo de 0 €.

### D2. Enrutado: `BrowserRouter` + `404.html`, no `HashRouter` ✅

GitHub Pages no sabe reescribir rutas. La solución habitual es `HashRouter`, pero **entra en
conflicto con Supabase Auth**, que usa el *fragmento* de la URL para devolver tokens en el flujo
implícito. Propuesta: `BrowserRouter` + copia de `index.html` como `404.html` en el *build*
(Pages sirve `404.html` conservando la ruta, y React Router la resuelve) + **flujo PKCE** en
Supabase Auth, que devuelve `?code=` en la *query* y no toca el fragmento.

### D3. Correo de autenticación: se acepta el límite del servicio integrado ✅

El servicio de correo integrado de Supabase está limitado a **unos pocos envíos por hora**
(la documentación oficial menciona 4/h en julio de 2023 y 3/h desde octubre de 2023; algunas
guías hablan de 2/h) y **solo puede ampliarse configurando SMTP propio**. Con altas por
invitación de ~30 estudiantes al inicio de curso, el límite integrado es inviable.

**Decidido**: no se configura SMTP propio. Consecuencia asumida: las ~30 altas de septiembre se
reparten en varias tandas (10–15 horas de reloj) y el límite se comparte con los correos de
recuperación de contraseña.

Esto cambia un requisito de la Fase 1, y es la única consecuencia de peso: la pantalla de
invitaciones debe ser **una cola con estado** (enviadas / pendientes / fallidas, con reintento),
no un botón de envío masivo. Sin eso, el administrador creerá haber invitado a 30 personas cuando
solo hayan salido tres correos. Detalle en `SECURITY.md` §6 y `FREE_TIER.md` §4.

Reversible en cualquier momento: configurar SMTP institucional es rellenar un formulario en el
panel de Supabase, sin tocar código.

### D4. Si algún día hay IA, irá en Supabase Edge Functions ✅

**La IA no es necesaria y no se va a implementar.** Era el punto 8 de tu propio prompt, marcado
como futuro y opcional; esta decisión solo fija *dónde* iría si alguna vez la quieres, para no
tomar ahora decisiones de arquitectura que lo impidan. La plataforma funciona completa sin ella.

El prompt asume que no hay backend donde esconder claves privadas. Matiz: el plan Free de Supabase
**incluye Edge Functions** (500.000 invocaciones/mes según la página de precios). Es un entorno de
servidor dentro de la arquitectura ya elegida, con *secrets* propios. Por tanto la integración con
Anthropic de la Fase 6 **no exige añadir proveedores ni coste**: solo la clave de API del modelo,
que seguiría siendo opcional y configurable. No se implementa nada de esto ahora.

## 4. Riesgos principales (detalle completo en `FREE_TIER.md` §5)

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Supabase pausa el proyecto tras **1 semana** sin actividad de base de datos | Alta | `keepalive.yml` cada 8 h; reactivación documentada |
| GitHub **desactiva los workflows programados** tras 60 días sin actividad del repositorio | Alta | `repo-activity.yml` (*commit* mensual) + aviso de `last_ping_at` en la app. **Entrar en la web NO cuenta como actividad del repositorio** (`FREE_TIER.md` §5.1) |
| Sin copias de seguridad automáticas en el plan Free | Alta | `BACKUP.md`: `pg_dump` manual trimestral fuera del repositorio |
| Límite de 500 MB de base de datos | Baja | Estimación de uso: < 50 MB a 5 años (`FREE_TIER.md` §3) |
| Máximo de 2 proyectos activos por cuenta Free | Media | Un solo proyecto; sin entorno de *staging* permanente en Supabase |
| Las condiciones de los proveedores pueden cambiar | Media | Cifras fechadas y con fuente en `FREE_TIER.md`; revisión semestral |

**No puedo garantizar** que el mecanismo de mantenimiento evite siempre la pausa: ni Supabase
garantiza que la actividad periódica lo impida, ni GitHub garantiza la ejecución puntual de los
*cron*. El objetivo es reducir el riesgo al mínimo con los medios permitidos por ambos proveedores.

## 5. Estado de la Fase 0: cerrada

Todo lo que estaba pendiente quedó resuelto el 5 de noviembre de 2026:

| Punto | Decisión |
|---|---|
D1 · Visibilidad del repositorio | **Público**. Ningún dato real en el repositorio |
D2 · Enrutado | `BrowserRouter` + `404.html` + PKCE |
D3 · Correo | Servicio integrado de Supabase, con sus 2–4 envíos/hora. Invitaciones en cola |
D4 · IA | No se implementa. Si algún día se quiere, Edge Functions |
Nombre del repositorio | `ThesisManager` → `https://<usuario>.github.io/ThesisManager/` |
Academia de Alumnos Internos | Sin defensa, sin depósito, sin titulación asociada, **9 meses** (igual que un TFG), memoria final como entregable principal y entregables opcionales |

Riesgo de los *cron* de GitHub: mitigado con `repo-activity.yml`, un *commit* mensual automático.
Las visitas a la web no servían para esto (ver `FREE_TIER.md` §5.1).

**Siguiente paso: Fase 1 (MVP funcional).** Ver [`ROADMAP.md`](../ROADMAP.md), con un requisito
nuevo derivado de D3: la pantalla de invitaciones es una cola con estado, no un envío masivo.
