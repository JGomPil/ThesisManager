# Puesta en marcha paso a paso

Guía para dejar Thesis Manager funcionando con datos reales. Son cuatro bloques y unos 20 minutos.
Lo único que no puede hacer nadie más que tú es el bloque 1.

---

## 1. Crear el proyecto de Supabase

### 1.1. Entrar al panel, no a la web comercial

`supabase.com` es la web de presentación del producto y **ahí no hay botón de proyecto nuevo**.
El panel está en otra dirección:

> **https://supabase.com/dashboard/projects**

También puedes llegar con el botón **Dashboard**, arriba a la derecha en `supabase.com`.

Si no has iniciado sesión te pedirá entrar. Puedes usar tu cuenta de GitHub (`JGomPil`), que es lo
más cómodo porque ya la tienes.

### 1.2. Crear una organización, si es la primera vez

Supabase cuelga los proyectos de una **organización**. En una cuenta nueva no hay ninguna, y
mientras no exista **no aparece la opción de crear un proyecto**: ese es el motivo más probable de
que no vieras el botón.

Si te pide crearla:

| Campo | Qué poner |
|---|---|
| Name | `GIB-UVa` |
| Type | *Educational* o *Personal*, lo que ofrezca |
| Plan | **Free** |

### 1.3. Crear el proyecto

Botón verde **New project** (arriba a la derecha), o directamente
**https://supabase.com/dashboard/new**

| Campo | Qué poner |
|---|---|
| Name | `ThesisManager` |
| Database Password | **Genérala y GUÁRDALA** (ver aviso abajo) |
| Region | **Central EU (Frankfurt)** o **West EU (Ireland)** |
| Plan | Free |

> **Sobre la contraseña de la base de datos:** no se puede recuperar después, solo restablecer.
> Hace falta para las copias de seguridad (`BACKUP.md`). Guárdala en el gestor de contraseñas de la
> universidad, no en un fichero del repositorio.

> **Sobre la región:** tiene que estar en la Unión Europea. Es un requisito de RGPD, no una
> preferencia: la aplicación guarda nombres y correos de estudiantes. Si eliges una región de
> EE. UU. estarás transfiriendo datos personales fuera del EEE.

El proyecto tarda 1–2 minutos en aprovisionarse.

> **Límite del plan gratuito:** 2 proyectos activos por cuenta. Si ya tienes dos, Supabase no te
> dejará crear el tercero y tendrás que pausar uno.

---

## 2. Crear las tablas

1. En el panel del proyecto, barra lateral: **SQL Editor** → **New query**.
2. Abre `supabase/bundle/install.sql` de este repositorio y **copia todo el contenido**.
   También puedes verlo en
   https://github.com/JGomPil/ThesisManager/blob/main/supabase/bundle/install.sql
   (botón *Copy raw file*).
3. Pégalo en el editor y pulsa **Run**.

Debe terminar sin errores y crear 35 tablas con 70 políticas de seguridad. Para comprobarlo, pega
esto en una consulta nueva:

```sql
select count(*) as tablas from pg_tables where schemaname = 'public';
select count(*) as politicas from pg_policies where schemaname = 'public';
select code, name from work_types order by display_order;
```

Lo esperado: 35, 70, y los cuatro tipos de trabajo (TFG, TFM, Tesis y Academia de Alumnos
Internos).

---

## 3. Configurar la autenticación

En **Authentication → Sign In / Providers** (o *Providers*, según la versión del panel):

1. Deja habilitado solo **Email**.
2. **Desactiva** *Allow new users to sign up*. Esto es lo que impide que cualquiera con la
   dirección de la web se cree una cuenta. El alta es siempre por invitación.
3. Deja **Confirm email** activado.

En **Authentication → URL Configuration**:

| Campo | Valor |
|---|---|
| Site URL | `https://jgompil.github.io/ThesisManager/` |
| Redirect URLs | `https://jgompil.github.io/ThesisManager/**` |
| Redirect URLs | `http://localhost:5173/**` |

Sin esas dos redirecciones, los enlaces de invitación y de recuperación de contraseña no vuelven a
la aplicación.

---

## 4. Conectar la aplicación

### 4.1. Copiar las credenciales

**Project Settings → API** (icono de engranaje, abajo a la izquierda). Necesitas dos cosas:

- **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
- **anon / public / publishable key**: una cadena larga que empieza por `eyJ…` o por `sb_publishable_`

> **No copies la clave `service_role`.** Salta todas las políticas de seguridad: con ella, cualquier
> visitante de la web podría leer y borrar todo. La aplicación no la usa en ningún punto, y el
> despliegue tiene una comprobación que lo aborta si detecta una.
>
> La clave anon, en cambio, **es pública por diseño** y acaba en el código de la web. Eso es
> correcto: la protección la ejerce RLS dentro de PostgreSQL.

### 4.2. Guardarlas en el repositorio

```bash
gh secret set SUPABASE_URL --body "https://TU_REF.supabase.co"
gh secret set SUPABASE_ANON_KEY --body "TU_CLAVE_ANON"
```

### 4.3. Volver a desplegar

```bash
gh workflow run deploy.yml
```

Al terminar, **https://jgompil.github.io/ThesisManager/** ya no mostrará la pantalla de
configuración, sino la de acceso.

### 4.4. Para desarrollo local

```bash
cp .env.example .env.local
# rellenar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

---

## 5. Crear tu usuario administrador

Todavía no hay nadie dentro, y el registro público está desactivado, así que el primer usuario se
crea a mano:

1. **Authentication → Users → Add user → Create new user**.
2. Correo: `javier.gomez.pilar@uva.es`. Marca *Auto Confirm User*.
3. Copia el **UID** que aparece en la lista.
4. **SQL Editor**, sustituyendo el UID:

```sql
-- 1) Organización y grupo
insert into organizations (name, slug) values ('Universidad de Valladolid', 'uva')
  returning id;   -- copia este id para el paso siguiente

-- 2) Con el id anterior:
insert into research_groups (organization_id, name, acronym)
values ('<ID_ORGANIZACION>', 'Grupo de Ingeniería Biomédica', 'GIB');

insert into academic_years (organization_id, code, start_date, end_date, is_current)
values ('<ID_ORGANIZACION>', '2026/2027', '2026-09-01', '2027-08-31', true);

-- 3) Tu perfil y tus permisos de administrador
update profiles set full_name = 'Javier Gómez Pilar', department = 'Teoría de la Señal'
where id = '<TU_UID>';

insert into organization_members (organization_id, user_id, role)
values ('<ID_ORGANIZACION>', '<TU_UID>', 'ADMIN');
```

Ya puedes entrar en la aplicación con ese correo y la contraseña que pusiste.

A partir de aquí todo se hace desde la interfaz: invitar al resto del grupo
(*Administración → Invitaciones*), crear titulaciones y líneas, ajustar los tipos de trabajo y dar
de alta los trabajos.

---

## 6. Comprobaciones finales

| Comprobación | Resultado esperado |
|---|---|
Entrar en la aplicación | Llegas al resumen, con una tarjeta por tipo de trabajo |
*Administración → Tipos de trabajo* | Los cuatro tipos, editables |
Recargar una ruta profunda | No da 404 |
`gh run list --workflow=keepalive.yml` | En verde |
*Administración* | Sin aviso rojo de mantenimiento |
Abrir la web sin sesión y mirar la consola | Ninguna consulta devuelve datos |

Si algo no cuadra, `FREE_TIER.md` §6 y §7 tienen los procedimientos de comprobación y recuperación.
