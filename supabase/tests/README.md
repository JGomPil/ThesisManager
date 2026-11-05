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

Todos los datos son ficticios y los dominios de correo son `.invalid`, reservado por el RFC 2606
precisamente para ejemplos.
