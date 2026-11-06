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

Las pruebas 32 y 33 son estructurales y son las importantes: en lugar de comprobar casos sueltos,
leen las políticas reales de `pg_policy`, extraen cada función del esquema `app` que invocan y
exigen el privilegio correcto. Existen porque un fallo de este tipo llegó a producción y las 31
pruebas anteriores no lo vieron; el relato completo está en `SECURITY.md` §5.2.ter.

**Las pruebas no conceden permisos.** Antes lo hacían, y por eso no verificaban nada: concedían
`grant execute on all functions in schema app to authenticated`, exactamente el permiso que
faltaba en producción. Hoy el estado de privilegios lo fijan solo el arnés (que emula los
`alter default privileges` de Supabase) y las propias migraciones. Si añades una prueba, **no
pongas un `grant` para que funcione**: si hace falta, es que falta en una migración.

Todos los datos son ficticios y los dominios de correo son `.invalid`, reservado por el RFC 2606
precisamente para ejemplos.
