# FREE_TIER.md — Proveedores, límites, condiciones y costes

> **Cifras verificadas el 5 de noviembre de 2026.** Los proveedores cambian sus condiciones sin
> aviso: revisar este documento cada seis meses y antes de cualquier decisión que dependa de un
> límite concreto. Donde la documentación oficial y las guías de terceros no coinciden, se indica.

## 1. Coste real

| Concepto | Coste |
|---|--:|
| GitHub Free (repositorio **público** + Pages + Actions) | 0 € |
| Supabase Free (1 proyecto) | 0 € |
| Dominio propio (opcional, no necesario) | ~10 €/año |
| SMTP institucional de la UVa (recomendado) | 0 € |
| **Total recurrente obligatorio** | **0 €** |

No hay ningún coste obligatorio. Dos avisos honestos:

1. **GitHub Pages en repositorio privado requiere plan de pago** (Pro, Team o Enterprise). Con
   GitHub Free, Pages solo funciona en repositorios **públicos**. Mantener el objetivo de 0 €
   implica repositorio público, con las consecuencias de `SECURITY.md` §8.
2. Si el proyecto crece más allá del plan Free de Supabase, el salto es a **Pro (~25 $/mes)**.
   No hay escalón intermedio. Con los volúmenes previstos (§3) esto no debería ocurrir.

## 2. Límites del plan Free de Supabase

| Recurso | Límite |
|---|---|
Tamaño de base de datos | 500 MB |
CPU / RAM | Compartida, 500 MB de RAM |
Egress (transferencia de salida) | 5 GB/mes (+5 GB de egress en caché) |
Usuarios activos mensuales (MAU) | 50.000 |
Proyectos activos | **2 por cuenta**, contados en todas las organizaciones donde seas Owner o Admin |
Invocaciones de Edge Functions | 500.000/mes |
Conexiones Realtime | 200 |
Copias de seguridad automáticas | **Ninguna** |
Pausa por inactividad | **Tras 1 semana** con muy pocas peticiones a la base de datos |

Sobre los excesos: los proyectos Free **no se facturan**; al superar una cuota, Supabase
**restringe** el proyecto en lugar de cobrar. Las fuentes consultadas no coinciden sobre el
comportamiento exacto al alcanzar los 500 MB de base de datos (una indica paso a solo lectura);
no he podido confirmarlo en la documentación oficial, así que **no conviene acercarse al límite**.

Los proyectos pausados **conservan los datos** y pueden restaurarse desde el panel durante un año.
Los proyectos de planes de pago no se pausan nunca.

### 2.1. Pausa por inactividad: lo que se puede y no se puede afirmar

- La pausa se basa en **actividad de base de datos**, no en inicios de sesión ni en visitas.
- Un `SELECT` periódico es actividad de base de datos, y es un uso permitido por el proveedor.
- **Supabase no garantiza que la actividad periódica impida la pausa.** Este documento no afirma
  lo contrario. El mecanismo de `keepalive.yml` reduce el riesgo; no lo elimina.

## 3. Estimación de consumo para GIB-UVa (entregable 10)

| Recurso | Límite | Uso previsto | Margen |
|---|---|---|---|
Base de datos | 500 MB | ~10 MB/año, ~48 MB a 5 años (`DATABASE.md` §8) | **>90 %** |
MAU | 50.000 | 100–120 usuarios | **>99 %** |
Egress Supabase | 5 GB/mes | ~120 usuarios × ~30 sesiones × ~200 KB de JSON ≈ **0,7 GB/mes** | ~85 % |
Storage Supabase | Reducido en el plan Free | Solo avatares y adjuntos pequeños; memorias y datos **enlazados** a Drive institucional | Dependiente del uso |
Egress Pages | 100 GB/mes (límite blando) | *Bundle* ~700 KB × ~3.600 cargas/mes ≈ **2,5 GB/mes** | ~97 % |
Actions | Ilimitado en repos públicos | ~95 ejecuciones/mes × ~1 min | — |

Los activos estáticos los sirve **GitHub Pages**, no Supabase: el egress de Supabase es solo
JSON de la API, que es el motivo de que el margen sea tan holgado.

> El límite exacto de Supabase Storage en el plan Free no he podido confirmarlo en la página
> oficial durante esta verificación. Como la estrategia documental ya prioriza **enlazar** a
> repositorios institucionales en lugar de subir ficheros, el diseño no depende de esa cifra.
> Conviene comprobarla antes de habilitar subidas de archivos en la Fase 2.

## 4. Límites de Supabase Auth en el plan Free

El servicio de correo **integrado** está fuertemente limitado y **solo puede ampliarse
configurando SMTP propio**. La documentación oficial menciona un valor por defecto de 4 correos/hora
(julio de 2023), reducido a 3/hora (octubre de 2023); varias guías de terceros hablan de 2/hora.
El límite es **compartido** por todos los tipos de correo: confirmación, enlace mágico,
recuperación de contraseña e **invitación**.

**Decisión tomada: se acepta el límite del servicio integrado.** No se configura SMTP propio.

Consecuencias que conviene tener presentes, porque aparecerán en septiembre:

- Dar de alta ~30 estudiantes exige **repartir las invitaciones**: a 2–3 correos/hora son unas
  10–15 horas de reloj, es decir dos o tres tardes, o una semana sin prisa. La aplicación
  encolará las invitaciones pendientes y mostrará cuántas quedan.
- El límite es **compartido** con los correos de recuperación de contraseña y de enlace mágico.
  Si una tanda de invitaciones está consumiendo la cuota, un usuario que olvide su contraseña ese
  día puede no recibir el correo de recuperación. Mitigación: el administrador puede fijar una
  contraseña temporal desde el panel de Supabase.
- Los correos salen de un dominio de Supabase, no de la UVa, por lo que es probable que acaben en
  la carpeta de correo no deseado de algunos estudiantes. Conviene avisarles por otro canal de que
  la invitación va a llegar.

Esto **no es una decisión irreversible**: configurar SMTP institucional más adelante es rellenar
un formulario en el panel de Supabase. No requiere ningún cambio de código ni de esquema.

## 5. Riesgos y limitaciones (entregables 11 y 13)

### 5.1. GitHub desactiva los *cron* tras 60 días sin actividad del repositorio

**Confirmado en la documentación oficial de GitHub**: en un repositorio público, los workflows
programados se desactivan automáticamente cuando no ha habido actividad en el repositorio durante
60 días. Una vez desactivados **no vuelven a ejecutarse solos**: hay que reactivarlos a mano.

Esto es el riesgo más insidioso del diseño, porque falla **en silencio** justo cuando el proyecto
lleva tiempo sin tocarse: exactamente la situación en la que el mantenimiento hace falta.
Mitigaciones, por orden de fiabilidad:

> **Aclaración importante, porque es contraintuitiva:** ni las visitas a la web publicada ni las
> ejecuciones de los propios *cron* cuentan como actividad del repositorio. Que alguien entre en la
> aplicación cada mes **sí** evita que Supabase la pause (son peticiones a la base de datos), pero
> **no** evita que GitHub desactive los workflows programados. Son dos relojes independientes.
> Lo único que reinicia el contador de 60 días es un *commit*.

1. **`repo-activity.yml`**: un workflow propio que el día 3 de cada mes escribe la fecha en
   `maintenance/last-activity.txt` y hace un *commit* con `[skip ci]`. Veinte veces de margen
   frente al límite de 60 días. Es un paso de cinco líneas con `GITHUB_TOKEN`, sin dependencias de
   terceros: si GitHub desactivase también este *cron*, la mitigación 2 lo detecta.
2. **Comprobación desde la propia aplicación**: el panel de administración muestra
   `keepalive.last_ping_at` y avisa en pantalla si supera 24 horas. Es la única detección que **no
   depende de que GitHub siga ejecutando nada**, y por eso es la red de seguridad real.
3. **Actividad real del repositorio**: cualquier *commit* humano reinicia el contador. Durante el
   desarrollo activo esto ocurre solo; el riesgo aparece en los años de mantenimiento tranquilo.
4. Reactivación, si llega a ocurrir: pestaña Actions → el workflow → *Enable workflow*, o bien
   `gh workflow enable keepalive.yml`.

> **Límite de esta mitigación, dicho con claridad**: GitHub no documenta expresamente que un
> *push* hecho con `GITHUB_TOKEN` reinicie el contador de 60 días. La experiencia de la comunidad
> indica que sí, y es el mecanismo que usan las acciones de terceros dedicadas a esto, pero no es
> una garantía del proveedor. Por eso el aviso en la aplicación (punto 2) no es opcional.

### 5.2. Los *cron* de GitHub Actions no son puntuales

GitHub puede retrasar las ejecuciones programadas, especialmente en horas en punto. Por eso el
*cron* es `17 */8 * * *` y por eso el margen de 8 horas frente a una ventana de inactividad de
7 días es amplio: aunque fallen varias ejecuciones seguidas, queda holgura.

### 5.3. Sin copias de seguridad automáticas

El plan Free no incluye ninguna. Y en un repositorio **público** no se puede automatizar el
volcado: los artefactos de Actions son descargables por cualquiera. Procedimiento manual en
`BACKUP.md`.

### 5.4. Límite de 2 proyectos activos

No habrá un entorno de *staging* permanente en Supabase. El desarrollo usa Supabase local
(`supabase start`, Docker) contra las mismas migraciones.

### 5.5. GitHub Pages

- Límite blando de 100 GB/mes de transferencia; sin corte duro documentado, pero puede dejar de
  servirse el sitio o llegar un correo de soporte si se abusa.
- 10 minutos de tiempo máximo de despliegue; límite blando de 10 compilaciones/hora (no aplica a
  los workflows propios de Actions, que es nuestro caso).
- Varias fuentes secundarias mencionan un límite de 1 GB para el sitio publicado; no he podido
  confirmarlo en la página oficial vigente. Irrelevante aquí: el *bundle* ronda 1 MB.
- **Sin reescritura de URL**: de ahí el truco de `404.html` (`DEPLOYMENT.md` §4).
- El contenido publicado es **siempre público**, incluso si el repositorio fuese privado.

### 5.6. Estrategia documental derivada de los límites

Las memorias de TFG/TFM y los conjuntos de datos no entran en Supabase Storage. Se registran como
**enlaces** a Drive/OneDrive/SharePoint institucional, con su versión, estado de revisión e
historial en la base de datos. Lo que la aplicación gestiona es el **seguimiento** de las entregas;
los ficheros viven donde la universidad ya paga por almacenarlos.

Limitación honesta: la aplicación no puede garantizar que un enlace externo sea accesible. Quien
lo abra necesita permisos en el servicio correspondiente, y si alguien mueve o borra el fichero en
Drive, la aplicación conservará el registro pero no el contenido.

## 6. Procedimiento de comprobación del mantenimiento

Mensual, dos minutos:

1. Actions → *Keepalive Supabase*: comprobar que la última ejecución es de hace menos de 8 horas y
   está en verde. Si el workflow aparece desactivado, reactivarlo (§5.1).
2. Panel de administración de la aplicación: `last_ping_at` reciente.
3. Panel de Supabase: el proyecto aparece *Active*, no *Paused*.
4. Ejecución manual de prueba: Actions → *Run workflow*.

## 6.bis. Reactivación si GitHub ya ha desactivado los *cron*

Sí, se puede reactivar, y no se pierde nada: los workflows no se borran, solo se desactivan.

**Desde la web**: repositorio → pestaña **Actions** → en la barra lateral, *Keepalive Supabase* →
aparece un aviso de que el workflow está desactivado por inactividad → botón **Enable workflow**.
Después, *Run workflow* para lanzarlo de inmediato sin esperar al siguiente *cron*.

**Desde la terminal** (requiere `gh auth login` una sola vez):

```bash
gh workflow list --all                  # muestra cuáles están disabled_inactivity
gh workflow enable keepalive.yml
gh workflow enable repo-activity.yml
gh workflow run keepalive.yml           # ejecución inmediata de comprobación
gh run list --workflow=keepalive.yml    # ver el resultado
```

**Marca de actividad manual**, para reiniciar el contador de 60 días cuando quieras:

```bash
./scripts/touch-activity.sh
```

Hace un *commit* de una línea en `maintenance/last-activity.txt` con `[skip ci]`. No dispara
ningún workflow y `deploy.yml` ignora esa ruta, así que no redespliega la aplicación. Cualquier
*commit* normal de desarrollo sirve igual: lo que cuenta es que haya actividad en el repositorio.

Si los *cron* llevaban desactivados más de una semana, Supabase habrá pausado el proyecto: primero
reactiva los workflows y después restaura el proyecto (§7). El orden importa poco, pero si
restauras sin reactivar, en una semana estarás igual.

## 7. Recuperación si Supabase pausa el proyecto

1. Panel de Supabase → proyecto → **Restore project**. Los datos se conservan (hasta un año).
2. La restauración tarda unos minutos; la aplicación da errores de conexión mientras ocurre.
3. Comprobar que `keepalive.yml` sigue activo: la pausa suele ser síntoma de que el *cron* dejó
   de ejecutarse (§5.1).
4. Lanzar el workflow manualmente para confirmar la recuperación.
5. Si el proyecto llevaba pausado más de un año, los datos pueden no ser recuperables: es la razón
   de ser de `BACKUP.md`.

## Fuentes

- [Supabase · Pricing & Fees](https://supabase.com/pricing)
- [Supabase Docs · Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [GitHub Docs · Disable and enable workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
- [GitHub Docs · GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Docs · What is GitHub Pages (disponibilidad por plan)](https://help.github.com/articles/what-is-github-pages)
- Guías de terceros consultadas para contrastar cifras (no son fuente oficial):
  [uibakery](https://uibakery.io/blog/supabase-pricing) ·
  [CloudZero](https://www.cloudzero.com/blog/supabase-pricing/) ·
  [MyKavo](https://mykavo.app/blog/supabase-free-tier-limits) ·
  [flaviocopes](https://flaviocopes.com/supabase-email-rate-limit/)

## 8. Storage, desde el 6 de noviembre de 2026

El cubo privado `work-documents` guarda los ficheros de los documentos. Límites
del plan gratuito y cómo se han acotado:

| Límite de Supabase | Valor | Cómo se acota |
|---|---|---|
| Almacenamiento total | 1 GB | 25 MB por fichero (`file_size_limit` del cubo) |
| Tipos de fichero | sin límite propio | lista blanca de MIME en el cubo: PDF, Office, ODT, texto, PNG/JPEG, ZIP, TeX |
| Transferencia saliente | 5 GB/mes (compartidos) | descargas con URL firmada de 120 s, sin CDN público |

Con 25 MB por fichero, 1 GB da para unos 40 ficheros en el peor caso y para
varios cientos de memorias y artículos reales, que rara vez pasan de 2–5 MB. Si
algún día se acerca al límite hay dos salidas sin coste: registrar los
documentos pesados como **enlace externo** en lugar de subirlos (la aplicación
ya lo admite en la misma ficha), o descargar y retirar lo de los cursos
cerrados. **El aviso aparecerá en el panel de Supabase, no en la aplicación**,
así que conviene mirarlo en la revisión mensual de §6.

Hay tres cubos, todos privados, y los dos pequeños están acotados para que no
compitan por el gigabyte con lo que de verdad importa:

| Cubo | Qué guarda | Tope por fichero | Coste realista |
|---|---|--:|---|
| `work-documents` | entregas y memorias | 25 MB | lo que se lleva el gigabyte |
| `template-files` | guiones y rúbricas compartidos | 10 MB | material común, una copia para todos |
| `avatars` | fotos de perfil | 2 MB | **~20 kB por persona**: el navegador las reduce a 256 px antes de subir |

Las fotos no son un problema de espacio y conviene decirlo con números: cuarenta
personas son unos 800 kB, menos del 0,1 % del cubo. Lo serían si se subieran tal
cual salen del móvil (4–6 MB cada una, un cuarto del gigabyte) y por eso se
redimensionan en el cliente, con el tope de 2 MB del cubo como cinturón.
