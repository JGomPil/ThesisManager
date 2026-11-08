# Pruebas de seguridad del modelo de datos

Validan **contra un PostgreSQL real** las afirmaciones centrales del diseño, sin necesidad de
proyecto en Supabase ni de frontend. Son la red de seguridad de `SECURITY.md` §9.

`00_harness.sql` emula lo mínimo que aporta Supabase (esquema `auth`, roles `anon` y
`authenticated`, y un `auth.uid()` que lee la variable de sesión `test.uid` para poder suplantar
usuarios). **Es solo para pruebas**: nunca se aplica a un proyecto real.

## Ejecución

```bash
./scripts/test-rls.sh      # requiere Docker
```

## Qué se comprueba

| # | Comprobación |
|---|---|
1 | Un usuario con varias funciones ve sus 2 trabajos (director en uno, doctorando en otro) |
2 | **Ve las notas privadas del trabajo que dirige, y NO las del trabajo donde es estudiante**, aunque también tenga allí una función de supervisión |
3 | Un estudiante solo ve su propio trabajo |
4 | Un estudiante no ve ninguna nota privada |
5 | Un miembro de la organización sin relación con ningún trabajo no ve nada |
6 | Un administrador ve todos los trabajos de su organización |
7 | El rol `anon` no accede a `academic_works` |
8–10 | Catálogo de tipos precargado; ciclo de vida restringido de `ACADEMIA`; tipos sin restricción admiten todos los estados |
11–12 | **Un administrador crea un tipo nuevo ("Prácticas de empresa") y lo usa de inmediato, sin migración ni despliegue** |
13–14 | Un estudiante no puede modificar el catálogo, pero sí leerlo |
15 | No se puede borrar un tipo de trabajo en uso (`ON DELETE RESTRICT`) |
16–18 | `anon` lee `keepalive`, no puede modificarla, y no accede a ninguna otra tabla |
19–24 | El estudiante solo puede cambiar el **estado** de su tarea; no la fecha límite, ni el responsable, ni crear tareas. El director sí |
25–28 | Cola de invitaciones: el administrador la gestiona, no se duplican invitaciones vivas para el mismo correo y los correos se exigen en minúsculas |
29 | **Al entrar por primera vez, la invitación se cierra y la persona queda de alta con la función prevista** |
30 | **Quien entra SIN invitación no obtiene ninguna pertenencia**: la cuenta existe y no ve nada |
31 | Un usuario no administrador no ve ninguna invitación (contienen correos de terceros) |
**32** | **Estructural: toda función de `app` invocada por una política es ejecutable por `authenticated`** |
**33** | **Ninguna función de `app` es ejecutable por `anon`** |
34 | El director lee los participantes de su trabajo: el `embed` que hacen el resumen y la ficha |
35 | El director principal añade un participante (política `wm_write`) |
36 | El estudiante no puede añadir participantes |
37 | Un director **no** puede archivar su trabajo (reservado a la administración) |
38 | ...pero conserva la edición del trabajo: el disparador no le quita nada más |
39 | La administración sí archiva |
40 | Y puede restaurar: el archivado es reversible |
41 | **Un trabajo archivado lo ve la administración y nadie más**, ni sus propios directores |
42 | **El alta en un solo paso**: crear el trabajo y asignar dirección y estudiante acto seguido, y el estudiante lo ve de inmediato |
43 | **El estudiante marca un punto de su lista de comprobación** (subtarea sin responsable propio) |
44 | El estudiante **no** puede añadir puntos: la dirección define el plan, él informa del avance |
45 | El estudiante **no** puede renombrar un punto, solo cambiar su estado |
46 | Recuento de la lista (hechos / total) |
47-49 | **Ficheros**: cada cual ve los del trabajo al que tiene acceso y solo esos; `anon` no ve ninguno aunque tenga privilegios de tabla |
50-52 | Se puede subir a la carpeta del trabajo propio, no a la de otro, y nunca con una ruta que no empiece por el uuid del trabajo |
53 | Un estudiante no puede borrar el fichero de un trabajo ajeno |
54 | El estudiante **entrega** un documento |
55-56 | ...y **no** puede borrar ni archivar el que subió la dirección |
57 | ...pero **sí** puede retirar el que subió él |
58-59 | **Aprobar es acto de supervisión**: el estudiante no puede aprobarse su entrega; la dirección sí |
60 | Un documento no puede vincularse a una tarea de **otro** trabajo |
61 | Un director **no** puede borrar definitivamente un trabajo |
62 | La administración **sí**, y se lleva en cascada participantes, tareas, documentos y versiones |
63 | **Los ficheros NO se van en cascada**: por eso `worksRepo.destroy()` los borra antes, y tras el borrado quedan inalcanzables incluso para la administración |
64 | Asignar una tarea avisa al responsable y **no** a quien la asigna |
65 | Una mención avisa **solo** a quien ya tiene acceso al trabajo: mencionar a un ajeno no le abre ninguna puerta ni le llega nada |
66 | Una entrega avisa a quien valida entregables, no al resto |
67 | Convocar una reunión avisa a todos los participantes menos a quien convoca |
68 | **Nadie puede escribir en el buzón de otro**: `notifications` no tiene política de INSERT |
69 | Cada cual ve solo su buzón |
70 | **Una nota privada no genera ninguna notificación**: avisar de algo privado es filtrarlo |
71 | El estudiante **no** ve la nota privada de su propia reunión |
72 | ...pero **sí** ve el acta compartida de esa misma reunión |
73 | La administración puede añadir participantes y acuerdos (arreglo de la `0011`) |
74 | El estudiante **no** puede convocar reuniones ni escribir acuerdos |
75 | El autor **sí** puede borrar su propio comentario (arreglo de `comments_select`) |
76 | Una dependencia normal **sí** se puede crear: la regla no es excesiva |
77 | El ciclo directo A→B→A se rechaza **con error**, no en silencio |
78 | El ciclo largo A→B→C→A también, y el mensaje dice que es un ciclo |
79 | Una tarea **no** puede depender de una tarea de otro trabajo, ni siquiera lo consigue la administración, que sí pasa la política |
80 | El estudiante **no** puede crear dependencias: el orden del plan lo pone la dirección |
81 | `met_at` lo escribe la base de datos al marcar el hito, y lo borra al revertirlo |
82 | El estudiante **ve** los hitos de su trabajo pero no los escribe |
83 | Solo la administración crea plantillas; un director no |
84 | **Aplicar una plantilla genera el plan completo**: 3 tareas, fechas relativas correctas y jerarquía resuelta |
85 | El estudiante **no** puede aplicar una plantilla: `app.apply_template` no es `security definer` |
86 | Una plantilla de **otro tipo de trabajo** se rechaza |
87 | Una plantilla mal formada **no deja medio plan creado**: o entera o nada |
88 | `anon` no puede ejecutar `app.apply_template`; `authenticated`, sí |
89 | La envoltura `public.apply_template` funciona y **no concede nada extra**: el estudiante sigue sin poder |
90 | Un director **no** puede crear ni borrar líneas de investigación |
91 | La administración crea, renombra y retira una línea |
92 | **Borrar una línea en uso no falla**: deja en blanco la línea de los trabajos que la tenían. Documenta el peligro, no lo celebra |
93 | **Retirar** una línea **no** la quita de los trabajos que la usaban: esa es la diferencia con borrar |
94 | Un director tampoco toca titulaciones ni cursos académicos |
95 | No puede haber dos cursos académicos marcados como actuales (índice único parcial) |
96 | La administración **ve** una cuenta creada a mano, sin organización |
97 | ...pero **`profiles_select` no se ha ensanchado**: por la vía normal ese perfil sigue siendo invisible. Es la prueba que justifica haber hecho una función en vez de ampliar la política |
98 | Quien no administra nada recibe una lista **vacía**, no un error: un error diría «aquí hay algo que no puedes ver» |
99 | Al autorizar la cuenta deja de estar pendiente y aparece en el directorio |
100 | `anon` no puede listar cuentas pendientes |
101 | Una tarea de plantilla guarda **en qué consiste, quién la hace y con qué material** |
102 | Un director **no** puede adjuntar material a una plantilla: es material común, lo pone la administración |
103 | El estudiante **sí** ve el material de la plantilla. Es la única información del sistema compartida a propósito entre trabajos: son guiones y rúbricas escritos para que los lea |
104 | `anon` no llega al material: **ni privilegio de tabla** —la `0006` canceló el `grant` por defecto y por eso sigue cerrada una tabla creada ocho migraciones después— ni filas |
105 | El material **no puede cruzarse entre plantillas** (disparador `app.enforce_template_file_scope`) |
106 | Al aplicar la plantilla, **cada tarea cae en quien ejerce esa función** en ese trabajo: la revisión en el director principal, la entrega en el estudiante. Y la tarea recuerda de qué tarea de plantilla sale |
107 | Si **nadie** ejerce esa función, la tarea se crea **sin responsable**: un plan con una tarea sin asignar es mejor que negarse a crear el plan |
108 | **Borrar una tarea de plantilla no falla** y deja sin material a las tareas ya creadas desde ella. Documenta el peligro, no lo celebra: es la razón del aviso con recuento en la interfaz |
109 | El estudiante **descarga** el material del cubo y **no puede subir** nada a él |
110 | La administración sube, y **ni ella** puede usar una ruta que no empiece por el uuid de una plantilla |
111 | La dirección comenta la entrega del estudiante y el comentario queda anclado a **esa versión** |
112 | **El `work_id` se deriva de la versión, no se cree al cliente**: mandar otro no coloca el comentario en otro trabajo, y comentar la versión de un trabajo ajeno lo rechaza la política sobre el trabajo de verdad. Es la prueba que cierra la laguna de la 0002 |
113 | Un ajeno —miembro del grupo, de ningún trabajo— no puede comentar |
114 | La administración del trabajo **sí** puede, aunque no sea miembro (arreglo de `doccomments_insert`) |
115 | Un ajeno no ve ningún comentario; el estudiante ve los de su propia entrega |
116 | Solo el autor retira su comentario: el estudiante no borra el de la dirección |
117 | **El hilo avisa en los dos sentidos** —a quien subió la versión, a quien ya había comentado y a quien valida— y nadie se avisa a sí mismo |
118 | `anon` no llega a los comentarios |
119 | Un estudiante **no ve** a quien no comparte ningún trabajo con él, aunque compartan grupo |
120 | ...pero sí se ve a sí mismo y a la dirección de su trabajo |
121 | La relación es **simétrica**: el director ve a su estudiante y no al ajeno. Dirigir da acceso a los participantes, no al grupo |
122 | La administración **sí** ve a todos los miembros de su organización |
123 | `work_members` y `profiles` hablan del mismo conjunto: **ningún participante legible sin nombre legible**. Si fallara, las pantallas mostrarían huecos en lugar de mostrar menos |
124 | La dirección **localiza por correo exacto** a alguien que no ve en el directorio: es lo que permite añadir un codirector nuevo |
125 | Esa búsqueda **no sirve para enumerar**: `%`, cadena vacía, `null` y un dominio suelto devuelven 0 filas |
126 | Un estudiante **no puede** buscar personas por correo: lista vacía, no error |
127 | `anon` no ve ningún perfil y no puede ejecutar la búsqueda |
128 | Dar de baja a alguien de un trabajo **no borra su nombre del historial**: sus actas y comentarios siguen resolviéndose |
129 | El cubo `avatars` es **privado**: público en Supabase es legible por internet sin sesión |
130 | Cada cual sube la foto **solo en su carpeta**: nadie le cambia la foto a nadie |
131 | **La foto se ve exactamente como el nombre.** No comprueba cada frontera por separado, comprueba que *coinciden*: del compañero de trabajo, nombre y foto; del ajeno, ninguna de las dos |
132 | La administración ve las fotos de su organización, igual que ve los nombres |
133 | Una ruta cuyo primer segmento no es un uuid **no la lee nadie**: no la ha generado esta aplicación |
134 | La administración puede **retirar** una foto inapropiada pero **no subir** una en nombre de otro: moderar es retirar, no suplantar |
135 | `anon` no ve ninguna foto |
136 | La administración define los **documentos previstos** de una plantilla; un **director del trabajo no** puede: la plantilla es de la coordinación |
137 | Un estudiante **sí los lee**: es material común y sin datos de nadie, saber qué hay que entregar no es un secreto |
138 | **Aplicar la plantilla crea los documentos previstos sin ninguna versión**, con su tipo heredado. Los crea `apply_template`, que no es `security definer`: los crea quien podría crearlos a mano |
139 | Aplicarla **dos veces no duplica los entregables**, aunque sí repita las tareas. Una tarea repetida es trabajo por hacer y se ve; dos fichas con el mismo nombre no se distinguen |
140 | Un entregable previsto **se cumple**: el estudiante le sube su primera versión. La ficha vacía no es un callejón |
141 | Dos entregables con el **mismo nombre** en una plantilla (distinta caja y espacios incluidos) se rechazan al definirlos, no al aplicarlos |
142 | `anon` no ve ni escribe `template_documents` |
143 | La administración **renombra y reordena** un estado y un rol. Existe para que la prohibición no sea total: una regla que lo prohibiese todo pasaría la 145 y la 146 y dejaría la pantalla inútil |
144 | Un **director no** puede renombrar un estado ni un rol: son catálogos del grupo, no del trabajo |
145 | El **código** de un estado es inmutable, también para la administración: el cronograma colorea por código y el dominio casa por código, así que renombrarlo rompe pantallas **sin dar error** |
146 | **Los permisos de un rol no se cambian por la API.** Es la prueba central: marcar `can_see_private_notes` en «Estudiante» publicaría, en ese instante y en todos los trabajos, las notas que la dirección escribió creyéndolas privadas, sin aviso y sin rastro |
147 | Un rol **nuevo nace sin capacidades** (lo impone la política `roles_insert`, no un disparador, porque el catálogo inicial sí tiene que poder crearlos con ellas), y un rol **en uso no se puede borrar** |
148 | Un estado **en uso no se puede borrar** (`on delete restrict`) y **retirarlo lo conserva** en los trabajos que ya lo tenían |
149 | `anon` no lee ni escribe estos catálogos. Admite los dos desenlaces correctos —«permission denied» por falta de GRANT, o cero filas por RLS— para no atar la prueba a cuál de las dos barreras actúa primero |
150 | La administración crea un **tipo de documento de su organización**; un director no |
151 | Un tipo de documento **global se renombra y se retira, pero no se borra**: la clave ajena es `on delete set null`, así que borrarlo dejaría sin tipo —y sin rastro— los documentos de todas las organizaciones |
152 | Un tipo de documento **no se puede mover de organización**. Falló mientras esto se dejaba a las políticas, y por una razón que vale recordar: con **dos** políticas permisivas, PostgreSQL combina con OR los `USING` entre sí y los `WITH CHECK` entre sí **por separado**, así que una fila propia que pasa a global cumple el `USING` de una política y el `WITH CHECK` de la otra. Hace falta un *trigger* |
153 | La administración define **qué estados aplican a un tipo de trabajo**; un director no |
154 | **Quitar todas las filas es volver al valor por omisión**: el tipo admite otra vez todos los estados activos. Comprueba que un error en esa pantalla es reversible |
155 | `anon` no ve ni escribe tipos de documento ni ciclos de vida |
156 | La administración **edita un tipo de trabajo GLOBAL** —nombre, color y duración—; un director no. Es la prueba del aviso `PGRST116 · 0 rows` que salió al editar un TFG: la política de la `0003` pedía `organization_id is not null` y **un UPDATE al que una política le descarta las filas no da error**, así que no cambiaba nada y no se quejaba nadie |
157 | Un tipo de trabajo **global se retira, pero no se borra**: lo comparten todas las organizaciones. Se prueba sobre un tipo global SIN trabajos, creado a propósito, porque con trabajos el borrado lo impediría la clave ajena y la prueba pasaría sin comprobar la política |
158 | La **organización y el código** de un tipo de trabajo son inmutables. Mismo motivo que la 152: con dos políticas permisivas no lo puede impedir el `WITH CHECK`, hace falta un *trigger* |
159 | Los tipos **propios de la organización** se siguen creando, editando y borrando: la `0022` añade una política y no quita nada de la `0003` |
160 | La administración **nombra administrador** a un miembro; un miembro **no puede ascenderse a sí mismo**. Se comprueba el dato y no la ausencia de error: a un `UPDATE` sin permiso, la política le descarta las filas y no falla |
161 | **El último administrador no se puede degradar, ni desactivar, ni borrar.** Tumbó la primera versión del *trigger*, que no era `security definer`: al desactivarse, el administrador dejaba de ver su propia organización y la comprobación se apartaba sola. Fallaba **abierto** |
162 | **Con dos administradores, uno sí puede dejar de serlo.** Igual de importante que la 161: un *trigger* que protegiera de más cerraría el relevo, y se vería igual de poco |
163 | Un miembro normal se desactiva y se reactiva sin problema: no es un *trigger* que bloquee todo |
164 | **La dirección registra su propio juicio**: un director que no es administrador del grupo escribe el progreso académico y el fin real, y puede dejar el progreso «sin valorar» otra vez. No hace falta ninguna migración —`works_update` ya admitía a los directores desde la `0003`—; lo que faltaba era un sitio donde escribirlo. La prueba exige antes que ese director sea `MEMBER`: si fuese administrador pasaría por la otra rama de la política y no comprobaría nada de lo que dice comprobar
165 | El **estudiante** no puede tocar ni el progreso ni el fin real de su trabajo —se comprueba el dato, no la ausencia de error— y el **rango 0–100** lo rechaza la base de datos aunque lo escriba quien tiene permiso
166 | **El DIRECTOR del trabajo crea sus columnas con el nombre que quiera**; el estudiante no. La prueba exige antes que ese director **no** sea administrador del grupo: es la única sesión que distingue la frontera buena (`can_manage_plan`) de la equivocada (`is_org_admin`), y el error no se vería, porque a un `UPDATE` sin permiso la política le descarta las filas y no falla |
167 | **Mover la tarjeta no cambia el estado, y cambiar el estado no mueve la tarjeta.** Es la promesa central: son dos clasificaciones distintas a propósito. Si una se llevara a la otra, reordenar el tablero movería el progreso del trabajo y los colores del cronograma, o marcar algo como hecho reordenaría el tablero solo |
168 | Una columna **de otro trabajo se rechaza**. Lo intenta el director, que SÍ puede escribir esa tarea: si el *trigger* no fuese `security definer` no podría leer la columna del otro trabajo y la comprobación **fallaría abierta** (§5.2 de `SECURITY.md`), y una prueba hecha por alguien sin permiso no lo distinguiría |
169 | El **estudiante mueve su tarjeta de columna y la coloca**, pero no renombra la columna ni toca el título. Las dos mitades importan: arrastrar **escribe una posición siempre**, así que prohibir `order_index` dejaba el gesto fallando con un mensaje que no le dice nada; y la columna del tablero es del plan, como el título |
170 | Una columna **con tarjetas dentro no se borra** (`on delete restrict`), y la **marca de completado la pone la base de datos**: la tarea quedó `COMPLETADA` sin que nadie escribiera `completed_at`, y al dejar de estarlo se retira. Una tarea completada sin esa fecha no da error, falta de los recuentos por fechas |
171 | Dos columnas con el **mismo nombre en el mismo tablero** se rechazan —no se distinguirían—, y el mismo nombre **en otro trabajo** se admite: la unicidad es por trabajo, que si fuera global dos tesis no podrían tener las dos su columna «Papers» |
172 | **Archivar una tarea tiene vuelta atrás.** Quien planifica la archiva, **la sigue viendo** —si no la viera no podría restaurarla, y el propio `UPDATE` habría fallado: PostgreSQL exige que la fila resultante siga siendo visible para quien lo ejecuta—, la subtarea se va con ella y al restaurarla vuelven las dos. Es la lección de la `0008` aplicada a tiempo |
173 | El **estudiante no archiva** su tarea —hacer desaparecer algo del plan es planificar— y **no ve** lo que está en la papelera, para que no le salgan tareas fantasma. Se comprueba el dato, no la ausencia de error. Destapa de paso que el disparador se aplica también a una sesión sin usuario: una sesión administrativa tampoco archiva, y conviene saberlo antes de escribir un guion de mantenimiento |
174 | El **borrado definitivo sigue siendo posible, y sigue siendo de quien planifica**. Importa tanto como las otras dos: una papelera que no se puede vaciar es una tabla que crece para siempre, y si el borrado se hubiera cerrado del todo nadie lo habría notado hasta tener mil tareas dentro |
175 | **El color de una tarea lo pone quien planifica, no el responsable.** El color no significa nada —no hay cálculo que pueda mentir—, así que lo único que hay que fijar es quién pinta, y es justo lo que no se vería: `tasks_update` deja al responsable escribir su propia fila, de modo que lo único que lo impide es que `color` figure en la lista de campos de `enforce_task_update_scope`. Una columna nueva no está protegida por omisión |

La prueba 33 ha vuelto a ganarse el sueldo con la migración `0020`: los dos disparadores nuevos
(`enforce_status_code_inmutable`, `enforce_role_solo_descriptivo`) nacieron ejecutables por `anon`
por lo de siempre —no son `security definer`, así que PostgreSQL les da EXECUTE a `public`— y la
33 los cazó antes de que el cambio saliera del portátil. Un disparador no necesita que nadie tenga
EXECUTE: lo invoca el motor, así que revocarlo no rompe nada.

Y la `0020` dejó una lección propia, que no la dio ninguna prueba sino el propio catálogo inicial:
la primera versión impedía con un disparador que un rol naciera con capacidades, y eso **bloqueaba
el seed**, que crea los cuatro roles con las suyas. Habría roto toda instalación nueva desde
`bundle/install.sql`. La regla se movió a la política `roles_insert`, porque el propietario de la
tabla no sufre RLS y quien entra por la API nunca es el propietario: la misma frontera, en el sitio
donde distingue esos dos casos.

La prueba 33 ha vuelto a ganarse el sueldo en la Fase 3. Recorre todas las funciones del
esquema `app` y exige que `anon` no pueda ejecutar ninguna; al añadir la migración `0012` falló,
porque las tres funciones de disparador nuevas nacieron abiertas a `anon`. La causa está
documentada en `SECURITY.md` §5.2.decies: la `0007` terminaba con un `alter default privileges
... revoke`, que se lee como «y las que vengan, también» y **no hace eso**. Comprobado contra
PostgreSQL 16: esa sentencia no deja ni una fila en `pg_default_acl`. Dos agujeros de privilegios
encontrados por pruebas estructurales y ninguno por leer el SQL.

Las pruebas 68 y 70 son las dos que justifican el diseño de las notificaciones. La 68 es la
razón de que no exista política de INSERT en `notifications`: si el cliente pudiera crearlas,
cualquiera podría escribir avisos en el buzón de cualquier otro, y un aviso falso en el buzón de
un tribunal no es una molestia, es una suplantación. Las crean disparadores de la base de datos.
La 70 comprueba lo contrario de lo habitual —que **no** pase nada—: no hay disparador sobre
`meeting_private_notes`, porque «la dirección ha anotado algo privado sobre ti» revela
exactamente lo que la nota privada existe para no revelar.

Las pruebas 32 y 33 son estructurales y son las importantes: en lugar de comprobar casos sueltos,
leen las políticas reales de `pg_policy`, extraen cada función del esquema `app` que invocan y
exigen el privilegio correcto. Existen porque un fallo de este tipo llegó a producción y las 31
pruebas anteriores no lo vieron; el relato completo está en `SECURITY.md` §5.2.ter.

**Las pruebas no conceden permisos.** Antes lo hacían, y por eso no verificaban nada: concedían
`grant execute on all functions in schema app to authenticated`, exactamente el permiso que
faltaba en producción. Hoy el estado de privilegios lo fijan solo el arnés (que emula los
`alter default privileges` de Supabase) y las propias migraciones. Si añades una prueba, **no
pongas un `grant` para que funcione**: si hace falta, es que falta en una migración.

La prueba 113 se cayó dos veces antes de existir de verdad: usaba al usuario `4444` como «ajeno»,
y la prueba 35 lo había hecho colaborador de TFG-01 cuarenta pruebas antes. Una prueba montada
sobre un dato que otra modifica no comprueba lo que dice comprobar, y además da verde. Ahora crea
su propio ajeno (`5555`, miembro de la organización y de ningún trabajo) en el mismo fichero.

La prueba 124 falló al escribirla, y por una razón que merece quedar escrita: construía su dato de
entrada —el correo del ajeno— **ya suplantando al director**, y RLS le oculta ese perfil, que es
justo lo que la prueba comprueba. El `select` devolvía `NULL` y la búsqueda, 0 filas: la prueba
fallaba por su propio montaje, no por la función. Los datos de entrada se preparan antes de
`set role`, como `postgres`; si se preparan con los permisos que se quieren medir, la prueba mide
el montaje.

La prueba 134 nació dando verde sin comprobar nada: hacía el `delete` y acto seguido
`v_borrado := 1` escrito a mano. Un `delete` que no borra ninguna fila no da error, así que la
prueba habría pasado igual con la política mal puesta. Ahora cuenta con `get diagnostics ... =
row_count`. Es el tercer caso del mismo error de método en este proyecto —medir con algo que sale
verde por razones ajenas a lo que se quiere comprobar—, y conviene mirarlo con lupa en cada prueba
nueva que afirme que algo **sí** se puede hacer.

**Las migraciones que corrigen DATOS se repiten sobre el catálogo sembrado.** El arnés aplica las
migraciones y *después* el seed, así que una migración que arregla una fila del catálogo —la `0018`,
que renombra «Director principal» a «Director»— no encuentra nada y se queda sin probar justo lo
único que hace, avisando además de que no había nada que hacer: verde por el motivo equivocado, el
mismo error de método de la prueba 134. En el proyecto real el orden es el contrario, porque el
catálogo se sembró hace meses. Por eso `scripts/test-rls.sh`, después del seed, pone el nombre
antiguo, vuelve a aplicar la `0018` y comprueba **las dos direcciones**: que renombra lo que puso el
catálogo inicial y que **no** pisa un nombre cambiado a mano desde Administración → Catálogos.
Comprobado también en negativo: con la condición de la migración estropeada, la tanda se detiene
ahí. No lleva número porque no es una prueba de RLS; es un gate del guion.

Todos los datos son ficticios y los dominios de correo son `.invalid`, reservado por el RFC 2606
precisamente para ejemplos.
